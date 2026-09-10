import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AgentHostManager, sessionFileOf } from "./agent-host-manager";
import type { AgentHost } from "./agent-host";
import type { AgentSnapshot } from "../shared/types";

describe("sessionFileOf", () => {
  it("extracts sessionFile from stats or state", () => {
    const snap1: AgentSnapshot = {
      state: {},
      messages: [],
      models: [],
      thinkingLevels: [],
      stats: {
        sessionId: "s1",
        sessionFile: "/path/to/session1.jsonl",
        userMessages: 0,
        assistantMessages: 0,
        toolCalls: 0,
        toolResults: 0,
        totalMessages: 0,
        tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        cost: 0,
      },
    };
    expect(sessionFileOf(snap1)).toBe("/path/to/session1.jsonl");

    const snap2: AgentSnapshot = {
      state: { sessionFile: "/path/to/session2.jsonl" },
      messages: [],
      models: [],
      thinkingLevels: [],
    };
    expect(sessionFileOf(snap2)).toBe("/path/to/session2.jsonl");

    const snap3: AgentSnapshot = {
      state: {},
      messages: [],
      models: [],
      thinkingLevels: [],
    };
    expect(sessionFileOf(snap3)).toBeUndefined();
  });
});

describe("AgentHostManager", () => {
  it("manages activeSessionPath correctly", () => {
    const manager = new AgentHostManager(vi.fn(), vi.fn());
    expect(manager.getActiveSessionPath()).toBeUndefined();

    manager.setActiveSessionPath("/a/b/session.jsonl");
    expect(manager.getActiveSessionPath()).toBe(path.resolve("/a/b/session.jsonl"));

    manager.setActiveSessionPath(undefined);
    expect(manager.getActiveSessionPath()).toBeUndefined();
  });

  it("prunes idle non-active hosts when exceeding maxIdleHosts", async () => {
    const manager = new AgentHostManager(vi.fn(), vi.fn(), {
      maxIdleHosts: 2,
      idleTimeoutMs: 60_000,
    });

    const now = Date.now();
    const mockHost = (sessionPath: string, busy = false, lastActiveAt = now) => {
      return {
        sessionPath: path.resolve(sessionPath),
        isRunning: () => true,
        isBusy: () => busy,
        getLastActiveAt: () => lastActiveAt,
        stop: vi.fn().mockResolvedValue(undefined),
      } as unknown as AgentHost;
    };

    const h1 = mockHost("/s1", false, now - 3000);
    const h2 = mockHost("/s2", false, now - 2000);
    const h3 = mockHost("/s3", false, now - 1000);
    const hActive = mockHost("/sActive", false, now - 4000);

    // Inject into manager's hosts map
    const hostsMap = (manager as unknown as { hosts: Map<string, AgentHost> }).hosts;
    hostsMap.set(h1.sessionPath!, h1);
    hostsMap.set(h2.sessionPath!, h2);
    hostsMap.set(h3.sessionPath!, h3);
    hostsMap.set(hActive.sessionPath!, hActive);

    manager.setActiveSessionPath(hActive.sessionPath);

    // Active session path should NEVER be pruned
    // Among h1, h2, h3: count is 3 > maxIdleHosts(2).
    // Oldest is h1 (100), so h1 should be pruned.
    manager.pruneIdleHosts();

    expect(hostsMap.has(h1.sessionPath!)).toBe(false);
    expect(h1.stop).toHaveBeenCalled();
    expect(hostsMap.has(h2.sessionPath!)).toBe(true);
    expect(hostsMap.has(h3.sessionPath!)).toBe(true);
    expect(hostsMap.has(hActive.sessionPath!)).toBe(true);
  });

  it("does not prune busy hosts even if old", () => {
    const manager = new AgentHostManager(vi.fn(), vi.fn(), {
      maxIdleHosts: 1,
      idleTimeoutMs: 1000,
    });

    const mockHost = (sessionPath: string, busy: boolean, lastActiveAt: number) => {
      return {
        sessionPath: path.resolve(sessionPath),
        isRunning: () => true,
        isBusy: () => busy,
        getLastActiveAt: () => lastActiveAt,
        stop: vi.fn().mockResolvedValue(undefined),
      } as unknown as AgentHost;
    };

    const hBusy = mockHost("/busy", true, 50);
    const hIdle = mockHost("/idle", false, 100);

    const hostsMap = (manager as unknown as { hosts: Map<string, AgentHost> }).hosts;
    hostsMap.set(hBusy.sessionPath!, hBusy);
    hostsMap.set(hIdle.sessionPath!, hIdle);

    manager.pruneIdleHosts();

    expect(hostsMap.has(hBusy.sessionPath!)).toBe(true);
    expect(hBusy.stop).not.toHaveBeenCalled();
  });

  it("stopAll stops all hosts and clears map", async () => {
    const manager = new AgentHostManager(vi.fn(), vi.fn());
    const mockHost = (sessionPath: string) => {
      return {
        sessionPath: path.resolve(sessionPath),
        isRunning: () => true,
        stop: vi.fn().mockResolvedValue(undefined),
      } as unknown as AgentHost;
    };

    const h1 = mockHost("/s1");
    const h2 = mockHost("/s2");
    const hostsMap = (manager as unknown as { hosts: Map<string, AgentHost> }).hosts;
    hostsMap.set(h1.sessionPath!, h1);
    hostsMap.set(h2.sessionPath!, h2);

    await manager.stopAll();

    expect(h1.stop).toHaveBeenCalled();
    expect(h2.stop).toHaveBeenCalled();
    expect(hostsMap.size).toBe(0);
    expect(manager.getActiveSessionPath()).toBeUndefined();
  });

  it("getRunningSessions returns busy hosts and excludes unknown temporary sessions", () => {
    const manager = new AgentHostManager(vi.fn(), vi.fn());
    const mockHost = (sessionPath: string, busy: boolean) => {
      return {
        sessionPath: sessionPath.startsWith("/") ? path.resolve(sessionPath) : sessionPath,
        isRunning: () => true,
        isBusy: () => busy,
      } as unknown as AgentHost;
    };

    const hRunning1 = mockHost("/session1.jsonl", true);
    const hIdle = mockHost("/session2.jsonl", false);
    const hUnknown = mockHost("unknown_12345", true);

    const hostsMap = (manager as unknown as { hosts: Map<string, AgentHost> }).hosts;
    hostsMap.set(hRunning1.sessionPath!, hRunning1);
    hostsMap.set(hIdle.sessionPath!, hIdle);
    hostsMap.set(hUnknown.sessionPath!, hUnknown);

    const running = manager.getRunningSessions();
    expect(running).toEqual([path.resolve("/session1.jsonl")]);
  });

  it("getHost does not fall back to other running sessions when sessionPath is specified", () => {
    const manager = new AgentHostManager(vi.fn(), vi.fn());
    const mockHost = (sessionPath: string) => {
      return {
        sessionPath: path.resolve(sessionPath),
        isRunning: () => true,
        isBusy: () => true,
      } as unknown as AgentHost;
    };

    const hRunning = mockHost("/session1.jsonl");
    const hostsMap = (manager as unknown as { hosts: Map<string, AgentHost> }).hosts;
    hostsMap.set(hRunning.sessionPath!, hRunning);
    manager.setActiveSessionPath(hRunning.sessionPath);

    // Matching sessionPath returns the host
    expect(manager.getHost("/session1.jsonl")).toBe(hRunning);

    // Unmatched sessionPath MUST return undefined, NOT fall back to hRunning
    expect(manager.getHost("/session2.jsonl")).toBeUndefined();

    // No sessionPath falls back to active session
    expect(manager.getHost()).toBe(hRunning);
  });

  it("getHost and stop find host by tempId", async () => {
    const manager = new AgentHostManager(vi.fn(), vi.fn());
    const mockHost = (sessionPath: string, tempId: string) => {
      return {
        sessionPath: path.resolve(sessionPath),
        tempId,
        isRunning: () => true,
        isBusy: () => true,
        stop: vi.fn().mockResolvedValue(undefined),
      } as unknown as AgentHost;
    };

    const hTemp = mockHost("/real/session.jsonl", "temp_123");
    const hostsMap = (manager as unknown as { hosts: Map<string, AgentHost> }).hosts;
    hostsMap.set(hTemp.sessionPath!, hTemp);
    hostsMap.set("temp_123", hTemp);

    expect(manager.getHost("temp_123")).toBe(hTemp);

    await manager.stop("temp_123");
    expect(hTemp.stop).toHaveBeenCalled();
    expect(hostsMap.has("temp_123")).toBe(false);
    expect(hostsMap.has(hTemp.sessionPath!)).toBe(false);
  });

  it("getHost returns undefined when the active path lost its host, instead of another running one", () => {
    const manager = new AgentHostManager(vi.fn(), vi.fn());
    const mockHost = (sessionPath: string) => {
      return {
        sessionPath: path.resolve(sessionPath),
        isRunning: () => true,
        isBusy: () => true,
      } as unknown as AgentHost;
    };

    const other = mockHost("/other.jsonl");
    const hostsMap = (manager as unknown as { hosts: Map<string, AgentHost> }).hosts;
    hostsMap.set(other.sessionPath!, other);
    // Active conversation was stopped or pruned; only an unrelated host remains.
    manager.setActiveSessionPath("/gone.jsonl");

    expect(manager.getHost()).toBeUndefined();
  });

  it("getHost falls back to the only running host when no session is active", () => {
    const manager = new AgentHostManager(vi.fn(), vi.fn());
    const mockHost = (sessionPath: string, running: boolean) => {
      return {
        sessionPath: path.resolve(sessionPath),
        isRunning: () => running,
        isBusy: () => true,
      } as unknown as AgentHost;
    };

    const only = mockHost("/solo.jsonl", true);
    const stopped = mockHost("/stopped.jsonl", false);
    const hostsMap = (manager as unknown as { hosts: Map<string, AgentHost> }).hosts;
    hostsMap.set(stopped.sessionPath!, stopped);
    hostsMap.set(only.sessionPath!, only);
    // The same host is keyed twice in practice (tempId + resolved path); it stays one candidate.
    hostsMap.set("temp_keyed_twice", only);

    expect(manager.getHost()).toBe(only);
  });

  it("getHost returns undefined when no session is active and several hosts run", () => {
    const manager = new AgentHostManager(vi.fn(), vi.fn());
    const mockHost = (sessionPath: string) => {
      return {
        sessionPath: path.resolve(sessionPath),
        isRunning: () => true,
        isBusy: () => true,
      } as unknown as AgentHost;
    };

    const first = mockHost("/first.jsonl");
    const second = mockHost("/second.jsonl");
    const hostsMap = (manager as unknown as { hosts: Map<string, AgentHost> }).hosts;
    hostsMap.set(first.sessionPath!, first);
    hostsMap.set(second.sessionPath!, second);

    expect(manager.getHost()).toBeUndefined();
  });

  it("getHost returns undefined when no session is active and no host runs", () => {
    const manager = new AgentHostManager(vi.fn(), vi.fn());
    const hostsMap = (manager as unknown as { hosts: Map<string, AgentHost> }).hosts;
    hostsMap.set("/dead.jsonl", {
      sessionPath: path.resolve("/dead.jsonl"),
      isRunning: () => false,
      isBusy: () => false,
    } as unknown as AgentHost);

    expect(manager.getHost()).toBeUndefined();
  });
});

