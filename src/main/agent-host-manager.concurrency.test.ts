import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression tests for the three ways a session file gets two writers at once:
 *  1. concurrent starts for one session must spawn a single runtime (single-flight);
 *  2. after `stop()` but before the old process is really gone, a new start must wait
 *     for it (otherwise both write the same jsonl);
 *  3. `pruneIdleHosts` detaches synchronously (getHost no longer sees it) but stops
 *     asynchronously.
 */
const fake = vi.hoisted(() => {
  interface FakeInstance {
    sessionPath?: string;
    tempId?: string;
    running: boolean;
    busy: boolean;
    lastActiveAt: number;
    stopCalls: number;
    stopResolvers: Array<() => void>;
    resolveStop(): void;
  }

  const created: FakeInstance[] = [];

  class FakeAgentHost implements FakeInstance {
    sessionPath?: string;
    tempId?: string;
    running = true;
    busy = false;
    lastActiveAt = Date.now();
    stopCalls = 0;
    stopResolvers: Array<() => void> = [];
    onSessionResolved?: (resolved: string, previous?: string) => void;

    constructor(
      _emit: unknown,
      _err: unknown,
      sessionPath?: string,
      public cwd?: string,
    ) {
      this.sessionPath = sessionPath;
      created.push(this);
    }

    isRunning(): boolean {
      return this.running;
    }
    isBusy(): boolean {
      return this.running && this.busy;
    }
    getLastActiveAt(): number {
      return this.lastActiveAt;
    }

    async start(): Promise<Record<string, unknown>> {
      return { sessionFile: this.sessionPath };
    }
    async snapshot(): Promise<Record<string, unknown>> {
      return { stats: { sessionFile: this.sessionPath } };
    }
    /** Until the test calls resolveStop(), stop() stays pending - models the SIGTERM -> 2s -> SIGKILL window. */
    stop(): Promise<void> {
      this.stopCalls += 1;
      this.running = false;
      return new Promise<void>((resolve) => {
        this.stopResolvers.push(() => {
          this.running = false;
          resolve();
        });
      });
    }
    resolveStop(): void {
      const pending = this.stopResolvers.splice(0, this.stopResolvers.length);
      for (const resolve of pending) resolve();
    }
  }

  return { FakeAgentHost, created };
});

vi.mock("./agent-host", () => ({ AgentHost: fake.FakeAgentHost }));

import { AgentHostManager } from "./agent-host-manager";

function makeManager(): AgentHostManager {
  return new AgentHostManager(() => undefined, () => undefined);
}

const SESSION = "/tmp/tether-test/session.jsonl";

beforeEach(() => {
  fake.created.length = 0;
});

describe("AgentHostManager concurrency", () => {
  it("spawns only one runtime for concurrent starts of the same session", async () => {
    const manager = makeManager();
    const [a, b, c] = await Promise.all([
      manager.getOrCreateHost({ cwd: "/tmp/tether-test", sessionPath: SESSION } as never),
      manager.getOrCreateHost({ cwd: "/tmp/tether-test", sessionPath: SESSION } as never),
      manager.getOrCreateHost({ cwd: "/tmp/tether-test", sessionPath: SESSION } as never),
    ]);
    expect(fake.created).toHaveLength(1);
    expect(a.host).toBe(b.host);
    expect(b.host).toBe(c.host);
    // Exactly one of them actually spawned; the rest were reused.
    expect([a.reused, b.reused, c.reused].filter((r) => r === false)).toHaveLength(1);
  });

  it("does not spawn a second runtime while a stop for the same session is still settling", async () => {
    const manager = makeManager();
    await manager.getOrCreateHost({ cwd: "/tmp/tether-test", sessionPath: SESSION } as never);
    const firstHost = fake.created[0]!;

    const stopping = manager.stop(SESSION);
    // The old process is still in its exit window: getHost no longer sees it
    // (synchronous detach), but a start must not spawn a new one yet.
    expect(manager.getHost(SESSION)).toBeUndefined();

    const restart = manager.getOrCreateHost({ cwd: "/tmp/tether-test", sessionPath: SESSION } as never);
    await new Promise((r) => setTimeout(r, 20));
    expect(fake.created).toHaveLength(1); // still waiting for the old process

    firstHost.resolveStop();
    await stopping;
    const { host } = await restart;
    expect(fake.created).toHaveLength(2); // only after the old one exited
    expect(host).toBe(fake.created[1]);
  });

  it("pruneIdleHosts detaches synchronously and stops asynchronously", async () => {
    const manager = makeManager();
    await manager.getOrCreateHost({ cwd: "/tmp/tether-test", sessionPath: SESSION } as never);
    const host = fake.created[0]!;
    host.lastActiveAt = Date.now() - 60 * 60_000; // far beyond idleTimeoutMs

    manager.setActiveSessionPath("/tmp/tether-test/other.jsonl");
    manager.pruneIdleHosts();

    expect(manager.getHost(SESSION)).toBeUndefined();
    expect(host.stopCalls).toBe(1);
    // Stop is asynchronous: the promise has not settled, but the routing table is clean.
    host.resolveStop();
  });

  it("does not block a start once the previous stop has settled", async () => {
    const manager = makeManager();
    await manager.getOrCreateHost({ cwd: "/tmp/tether-test", sessionPath: SESSION } as never);
    const firstHost = fake.created[0]!;
    const stopping = manager.stop(SESSION);
    firstHost.resolveStop();
    await stopping;

    const { host, reused } = await manager.getOrCreateHost({
      cwd: "/tmp/tether-test",
      sessionPath: SESSION,
    } as never);
    expect(reused).toBe(false);
    expect(host).toBe(fake.created[1]);
  });
});
