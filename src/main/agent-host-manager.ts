import path from "node:path";
import { AgentHost } from "./agent-host";
import type { AgentEvent, AgentSnapshot, AgentStartOptions } from "../shared/types";

export interface AgentHostManagerOptions {
  maxIdleHosts?: number;
  idleTimeoutMs?: number;
}

export interface AgentHostStartResult {
  host: AgentHost;
  snapshot: AgentSnapshot;
  reused: boolean;
}

export class AgentHostManager {
  private hosts = new Map<string, AgentHost>();
  private activeSessionPath?: string;
  /**
   * Single-flight: concurrent starts for the same session (or tempId) allow only one
   * real spawn. Without it, two near-simultaneous renderer `agent:start` calls make
   * two rpc-entries open the same session.jsonl at once - pi's SessionManager uses
   * `openSync(file,"wx")` for the first write and `"w"` truncation for rewrites, so two
   * writers mean EEXIST throws / clobbered writes / interleaved appends, which the user
   * sees as "clicking send does nothing until I quit and reopen".
   */
  private starting = new Map<string, Promise<AgentHostStartResult>>();
  /**
   * Hosts being torn down: `retire()` registers them here synchronously, and a process
   * that is still exiting (SIGTERM -> 2s -> SIGKILL) still holds the session file. A
   * later start must wait for it to finish, otherwise it would spawn a second runtime
   * sharing the same session.jsonl. Keys = session paths (including any alias keys the
   * host used).
   */
  private stopping = new Map<string, Promise<void>>();
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
  ): Promise<AgentHostStartResult> {
    const requestedSessionPath = options.sessionPath
      ? path.resolve(options.sessionPath)
      : undefined;

    // Single-flight key: prefer the session path, then tempId, then cwd (a brand-new
    // session with no file yet).
    const startKey =
      requestedSessionPath ?? (options.tempId ? `temp:${options.tempId}` : `cwd:${options.cwd}`);
    const inFlight = this.starting.get(startKey);
    if (inFlight) {
      // The second concurrent request waits to reuse the same spawn; it never spawns a
      // runtime of its own.
      const settled = await inFlight;
      return { host: settled.host, snapshot: settled.snapshot, reused: true };
    }

    const promise = this.createHost(options, requestedSessionPath);
    this.starting.set(startKey, promise);
    try {
      return await promise;
    } finally {
      if (this.starting.get(startKey) === promise) this.starting.delete(startKey);
    }
  }

  private async createHost(
    options: AgentStartOptions & {
      cwd: string;
      visionExtension?: string;
      visionConfig?: string;
      visionUploads?: string;
    },
    requestedSessionPath: string | undefined,
  ): Promise<AgentHostStartResult> {
    // A previous host for the same session may still be inside its SIGTERM -> 2s ->
    // SIGKILL window holding the session file; wait for it to exit before deciding to
    // reuse or spawn, otherwise we start a second process writing the same jsonl.
    await this.awaitPendingStops(requestedSessionPath, options.tempId);

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

    await this.retire(host);
  }

  async stopAll(): Promise<void> {
    const allHosts = [...new Set(this.hosts.values())];
    await Promise.allSettled(allHosts.map((h) => this.retire(h)));
  }

  /**
   * Detach the host from the routing table and stop it. Semantics:
   *  - removal is synchronous (`getHost` no longer sees it, so it is never routed to);
   *  - stopping is asynchronous, but "is stopping" is registered in `stopping`
   *    synchronously, so a later start for the same session waits instead of spawning a
   *    second writer in parallel.
   */
  private retire(host: AgentHost): Promise<void> {
    const keys: string[] = [];
    for (const [k, h] of this.hosts.entries()) {
      if (h === host) {
        keys.push(k);
        this.hosts.delete(k);
      }
    }
    if (this.activeSessionPath && !this.hosts.has(this.activeSessionPath)) {
      this.activeSessionPath = undefined;
    }
    const stopKey =
      host.sessionPath && !host.sessionPath.includes("unknown_") ? host.sessionPath : keys[0];
    const stopping = host.stop().catch(() => undefined);
    for (const key of new Set([...keys, ...(stopKey ? [stopKey] : [])])) {
      this.stopping.set(key, stopping);
      void stopping.finally(() => {
        if (this.stopping.get(key) === stopping) this.stopping.delete(key);
      });
    }
    return stopping;
  }

  /** Wait for the previous stop for the same session to settle (at most the 2s SIGKILL fallback). */
  private async awaitPendingStops(
    ...candidates: Array<string | undefined>
  ): Promise<void> {
    const pending: Promise<void>[] = [];
    for (const candidate of candidates) {
      if (!candidate) continue;
      const direct = this.stopping.get(candidate) ?? this.stopping.get(path.resolve(candidate));
      if (direct) pending.push(direct);
    }
    if (pending.length > 0) await Promise.allSettled(pending);
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
        void this.retire(candidate.host);
      } else {
        remaining.push(candidate);
      }
    }

    // 2. Evict excess idle hosts beyond maxIdleHosts
    while (remaining.length > this.maxIdleHosts) {
      const oldest = remaining.shift();
      if (oldest) {
        void this.retire(oldest.host);
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
