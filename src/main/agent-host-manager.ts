import path from "node:path";
import { AgentHost } from "./agent-host";
import type { AgentEvent, AgentSnapshot, AgentStartOptions } from "../shared/types";

export interface AgentHostManagerOptions {
  maxIdleHosts?: number;
  idleTimeoutMs?: number;
}

export class AgentHostManager {
  private hosts = new Map<string, AgentHost>();
  private activeSessionPath?: string;
  private readonly maxIdleHosts: number;
  private readonly idleTimeoutMs: number;

  constructor(
    private readonly emitEvent: (event: AgentEvent) => void,
    private readonly emitError: (message: string, sessionPath?: string) => void,
    options: AgentHostManagerOptions = {},
  ) {
    this.maxIdleHosts = options.maxIdleHosts ?? 3;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 10 * 60_000;
  }

  getActiveSessionPath(): string | undefined {
    return this.activeSessionPath;
  }

  setActiveSessionPath(sessionPath?: string): void {
    this.activeSessionPath = sessionPath ? path.resolve(sessionPath) : undefined;
  }

  getRunningSessions(): string[] {
    const running = new Set<string>();
    for (const [sessionPath, host] of this.hosts.entries()) {
      if (host.isBusy() && !sessionPath.includes("unknown_")) {
        running.add(sessionPath);
        if (host.sessionPath && !host.sessionPath.includes("unknown_")) {
          running.add(host.sessionPath);
        }
        if (host.tempId) {
          running.add(host.tempId);
        }
      }
    }
    return Array.from(running);
  }

  getHost(sessionPath?: string): AgentHost | undefined {
    if (sessionPath) {
      const direct = this.hosts.get(sessionPath);
      if (direct) return direct;
      const resolved = path.resolve(sessionPath);
      const hostResolved = this.hosts.get(resolved);
      if (hostResolved) return hostResolved;
      const base = path.basename(sessionPath);
      for (const [key, h] of this.hosts.entries()) {
        if (key === sessionPath || path.basename(key) === base || h.tempId === sessionPath) {
          return h;
        }
      }
      return undefined;
    }
    if (this.activeSessionPath) {
      const activeHost = this.hosts.get(this.activeSessionPath);
      if (activeHost) return activeHost;
      // The active path is known but its host is gone (stopped or pruned). Falling back to
      // "whichever host runs first" would route the call into an unrelated conversation.
      return undefined;
    }
    // No active session: a single running host is unambiguous, several would be a guess.
    // One host is often keyed twice (tempId + resolved path), so de-duplicate first.
    const running = [...new Set(this.hosts.values())].filter((host) => host.isRunning());
    return running.length === 1 ? running[0] : undefined;
  }

  async getOrCreateHost(
    options: AgentStartOptions & {
      cwd: string;
      visionExtension?: string;
      visionConfig?: string;
      visionUploads?: string;
    },
  ): Promise<{ host: AgentHost; snapshot: AgentSnapshot; reused: boolean }> {
    const requestedSessionPath = options.sessionPath
      ? path.resolve(options.sessionPath)
      : undefined;

    // If we already have a running host for this session or tempId, reuse it!
    if (requestedSessionPath) {
      const existing = this.getHost(requestedSessionPath);
      if (existing && existing.isRunning()) {
        this.activeSessionPath = existing.sessionPath ?? requestedSessionPath;
        const snapshot = await existing.snapshot();
        return { host: existing, snapshot, reused: true };
      }
    }
    if (options.tempId) {
      const existingByTemp = this.getHost(options.tempId);
      if (existingByTemp && existingByTemp.isRunning()) {
        this.activeSessionPath = existingByTemp.sessionPath ?? options.tempId;
        const snapshot = await existingByTemp.snapshot();
        return { host: existingByTemp, snapshot, reused: true };
      }
    }

    // Before creating a new host, prune old idle non-active hosts
    this.pruneIdleHosts();

    const host = new AgentHost(
      (event) => {
        this.emitEvent(event);
      },
      (message, sPath) => {
        this.emitError(message, sPath ?? requestedSessionPath ?? this.activeSessionPath);
      },
      requestedSessionPath,
      options.cwd,
    );
    if (options.tempId) {
      host.tempId = options.tempId;
      this.hosts.set(options.tempId, host);
    }

    host.onSessionResolved = (resolved, previous) => {
      if (previous && previous !== host.tempId) {
        this.hosts.delete(previous);
      }
      this.hosts.set(resolved, host);
      this.activeSessionPath = resolved;
    };

    const snapshot = await host.start(options);
    const resolvedSessionPath =
      sessionFileOf(snapshot) ??
      host.sessionPath ??
      requestedSessionPath;

    if (resolvedSessionPath) {
      const canonicalPath = path.resolve(resolvedSessionPath);
      host.sessionPath = canonicalPath;
      this.hosts.set(canonicalPath, host);
      this.activeSessionPath = canonicalPath;
    } else {
      const tempKey = `unknown_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      host.sessionPath = tempKey;
      this.hosts.set(tempKey, host);
      this.activeSessionPath = tempKey;
    }

    return { host, snapshot, reused: false };
  }

  async stop(sessionPath?: string): Promise<void> {
    const host = sessionPath
      ? this.getHost(sessionPath)
      : (this.activeSessionPath ? this.hosts.get(this.activeSessionPath) : undefined);

    if (!host) {
      if (!sessionPath && !this.activeSessionPath) {
        return this.stopAll();
      }
      return;
    }

    for (const [k, h] of this.hosts.entries()) {
      if (h === host) {
        this.hosts.delete(k);
      }
    }
    if (this.activeSessionPath && !this.hosts.has(this.activeSessionPath)) {
      this.activeSessionPath = undefined;
    }
    await host.stop();
  }

  async stopAll(): Promise<void> {
    const allHosts = Array.from(this.hosts.values());
    this.hosts.clear();
    this.activeSessionPath = undefined;
    await Promise.allSettled(allHosts.map((h) => h.stop()));
  }

  pruneIdleHosts(): void {
    const now = Date.now();
    const idleCandidates: Array<{ path: string; host: AgentHost }> = [];

    for (const [sKey, host] of this.hosts.entries()) {
      if (sKey === this.activeSessionPath) continue;
      if (!host.isRunning()) {
        this.hosts.delete(sKey);
        continue;
      }
      if (!host.isBusy()) {
        idleCandidates.push({ path: sKey, host });
      }
    }

    // Sort by last active ascending (oldest first)
    idleCandidates.sort((a, b) => a.host.getLastActiveAt() - b.host.getLastActiveAt());

    // 1. Evict expired idle hosts
    const remaining: Array<{ path: string; host: AgentHost }> = [];
    for (const candidate of idleCandidates) {
      if (now - candidate.host.getLastActiveAt() > this.idleTimeoutMs) {
        this.hosts.delete(candidate.path);
        void candidate.host.stop();
      } else {
        remaining.push(candidate);
      }
    }

    // 2. Evict excess idle hosts beyond maxIdleHosts
    while (remaining.length > this.maxIdleHosts) {
      const oldest = remaining.shift();
      if (oldest) {
        this.hosts.delete(oldest.path);
        void oldest.host.stop();
      }
    }
  }
}

export function sessionFileOf(snapshot: AgentSnapshot): string | undefined {
  return (
    sessionFileFromUnknown(snapshot.stats) ??
    sessionFileFromUnknown(snapshot.state)
  );
}

function sessionFileFromUnknown(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || !("sessionFile" in value))
    return undefined;
  return typeof value.sessionFile === "string" ? value.sessionFile : undefined;
}
