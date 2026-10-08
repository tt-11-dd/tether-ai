import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { getTetherRpcEntryPath, indexTetherSession } from "tether-agent-core";
import type { AgentEvent, AgentSessionStats, AgentSnapshot, AgentStartOptions } from "../shared/types";
import { parseSkillCommands } from "../shared/skills";
import { killProcessTree } from "./process-tree";
import { drainUtf8Lines } from "./rpc-lines";

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: NodeJS.Timeout;
}

const DEFAULT_RPC_TIMEOUT_MS = 45_000;
const LONG_RPC_TIMEOUT_MS = 30 * 60_000;
/**
 * 2026-10-03 P0：busy 期间的对账周期。主进程 busy 只由事件流驱动，
 * 漏一条 agent_settled 就会永久卡死，所以周期性向子进程要权威状态。
 */
const BUSY_WATCHDOG_MS = 10_000;
const LONG_RUNNING_REQUESTS = new Set([
  "prompt",
  "steer",
  "abort",
  "get_entries",
  "get_fork_messages",
  "get_messages",
  "get_session_stats",
  "fork",
  "compact",
]);

/**
 * The renderer only consumes message/tool/state events: `custom` events (such as the
 * tether-checkpoint entries that carry whole-file before/after snapshots) never land in
 * the UI - the chat view bails out on `custom`, and the body `/undo` needs is fetched on
 * demand via get_entries. A single such payload can reach 270KB, and sending it through
 * IPC as-is pays an extra serialization and copy for every patch, so above the threshold
 * we keep only the enumerable metadata.
 */
const CUSTOM_EVENT_PAYLOAD_LIMIT = 64 * 1024;

function slimAgentEvent(event: AgentEvent): AgentEvent {
  if (event.type !== "custom") return event;
  const data = (event as { data?: unknown }).data;
  if (data === undefined) return event;
  let size = 0;
  try {
    size = JSON.stringify(data).length;
  } catch {
    return event;
  }
  if (size <= CUSTOM_EVENT_PAYLOAD_LIMIT) return event;
  const raw = data as { id?: unknown };
  return {
    ...event,
    data: {
      ...(typeof raw.id === "string" ? { id: raw.id } : {}),
      truncated: true,
      originalChars: size,
    },
  };
}

export class AgentHost {
  private child?: ChildProcessWithoutNullStreams;
  private lineBuffer = Buffer.alloc(0);
  private stderr = "";
  private requestId = 0;
  private pending = new Map<string, PendingRequest>();
  private busy = false;
  private lastActiveAt = Date.now();
  private busyWatchdog?: NodeJS.Timeout;
  private idleProbeStreak = 0;
  private probing = false;
  private static readonly STDERR_CAP = 200_000;
  public onSessionResolved?: (resolvedPath: string, previousPath?: string) => void;
  public tempId?: string;

  constructor(
    private readonly emitEvent: (event: AgentEvent) => void,
    private readonly emitError: (message: string, sessionPath?: string) => void,
    public sessionPath?: string,
    public cwd?: string,
  ) {}

  isRunning(): boolean {
    return Boolean(this.child && this.child.exitCode === null);
  }

  isBusy(): boolean {
    return this.isRunning() && this.busy;
  }

  /**
   * 2026-10-03 P0：主进程 busy 是渲染层运行态的唯一依据（`agent:running-sessions` → `isBusy()`），
   * 但它是本地标志：子进程那一轮只要没走到 agent_settled（例如 prompt 在 isStreaming 时抛错、
   * 事件在 IPC 中丢失、子进程半死），busy 就会一直为 true。
   * 症状 = UI 永远是「停止」、输入被塞进队列永远发不出去、只能退出重开。
   * 兜底：busy 期间定期向子进程要权威状态（get_state.isStreaming），连续两次确认空闲才回落，
   * 避开「prompt 刚发出、agent_start 还没到」的窗口（和渲染层看门狗同一个防误判策略）。
   */
  private armBusyWatchdog(): void {
    if (this.busyWatchdog) return;
    this.busyWatchdog = setInterval(() => {
      void this.probeIdle();
    }, BUSY_WATCHDOG_MS);
    this.busyWatchdog.unref?.();
  }

  private disarmBusyWatchdog(): void {
    if (this.busyWatchdog) {
      clearInterval(this.busyWatchdog);
      this.busyWatchdog = undefined;
    }
    this.idleProbeStreak = 0;
  }

  private async probeIdle(): Promise<void> {
    if (this.probing) return;
    if (!this.busy || !this.isRunning()) {
      this.disarmBusyWatchdog();
      return;
    }
    this.probing = true;
    try {
      const state = await this.request<{ isStreaming?: boolean; pendingMessageCount?: number }>("get_state");
      const streaming = state?.isStreaming;
      const pending = state?.pendingMessageCount ?? 0;
      if (streaming === false && pending === 0) {
        this.idleProbeStreak += 1;
        if (this.idleProbeStreak >= 2) this.settleIfStale();
      } else {
        this.idleProbeStreak = 0;
      }
    } catch {
      // 探测失败不当作空闲，交给下一轮；真正的死亡由 handleExit 收尾。
      this.idleProbeStreak = 0;
    } finally {
      this.probing = false;
    }
  }

  /** 子进程已确认空闲但本地 busy 还是 true：回落并补一条 agent_settled，让渲染层本地 running 一起归位。 */
  private settleIfStale(): void {
    this.idleProbeStreak = 0;
    this.disarmBusyWatchdog();
    if (!this.busy) return;
    this.busy = false;
    this.emitEvent({
      type: "agent_settled",
      reconciled: true,
      ...(this.sessionPath ? { sessionPath: this.sessionPath } : {}),
      ...(this.tempId ? { tempId: this.tempId } : {}),
    });
  }

  getLastActiveAt(): number {
    return this.lastActiveAt;
  }

  setSessionPath(file: string): void {
    const resolved = path.resolve(file);
    if (this.sessionPath === resolved) return;
    const previous = this.sessionPath;
    this.sessionPath = resolved;
    this.onSessionResolved?.(resolved, previous);
    void indexTetherSession(resolved).catch(() => undefined);
    this.emitEvent({
      type: "session_created",
      sessionPath: resolved,
      cwd: this.cwd,
      ...(this.tempId ? { tempId: this.tempId } : {}),
    });
  }

  async resolveSessionPath(): Promise<string | undefined> {
    try {
      const state = await this.request<{ sessionFile?: string }>("get_state");
      const file = sessionFileFromUnknown(state);
      if (file && (!this.sessionPath || this.sessionPath.includes("unknown_"))) {
        this.setSessionPath(file);
        return this.sessionPath;
      }
    } catch {
      // Best-effort
    }
    return this.sessionPath;
  }

  async snapshot(): Promise<AgentSnapshot> {
    const [state, messages] = await Promise.all([
      this.request<Record<string, unknown>>("get_state"),
      this.request<{ messages: unknown[] }>("get_messages"),
    ]);
    if (!this.sessionPath || this.sessionPath.includes("unknown_")) {
      const file = sessionFileFromUnknown(state);
      if (file) this.setSessionPath(file);
    }
    // 2026-10-03 P0：子进程的 isStreaming 才是运行态权威（= agent-session 的 _isAgentRunActive）。
    // 每次快照对账一次：开/切会话本身就带着一次真实查询，顺手把脱节的本地标志拉回。
    const authoritative = typeof state.isStreaming === "boolean" ? state.isStreaming : undefined;
    if (authoritative !== undefined && authoritative !== this.busy) {
      this.busy = authoritative;
      if (authoritative) this.armBusyWatchdog();
      else this.disarmBusyWatchdog();
    }
    void this.emitSnapshotMeta();
    return {
      state: {
        ...state,
        isStreaming: this.busy,
        isBusy: this.busy,
      },
      messages: messages.messages,
      models: [],
      thinkingLevels: [],
      skills: [],
      ...(this.cwd ? { cwd: this.cwd } : {}),
    };
  }

  /** Non-blocking follow-up for models/skills/stats after first paint. */
  private async emitSnapshotMeta(): Promise<void> {
    try {
      const [models, thinkingLevels, stats, commands] = await Promise.all([
        this.request<{ models: AgentSnapshot["models"] }>("get_available_models"),
        this.request<{ levels: string[] }>("get_available_thinking_levels"),
        this.request<AgentSessionStats>("get_session_stats").catch(() => undefined),
        this.request<{
          commands: Array<{
            name: string;
            description?: string;
            source?: string;
            sourceInfo?: { path?: string; baseDir?: string };
          }>;
        }>("get_commands").catch(() => ({ commands: [] })),
      ]);
      this.emitEvent({
        type: "desktop_snapshot_meta",
        models: models.models,
        thinkingLevels: thinkingLevels.levels,
        skills: parseSkillCommands(commands.commands),
        ...(stats ? { stats } : {}),
        ...(this.sessionPath ? { sessionPath: this.sessionPath } : {}),
      });
    } catch {
      // First paint already succeeded; meta is best-effort.
    }
  }

  async start(options: AgentStartOptions & {
    cwd: string;
    visionExtension?: string;
    visionConfig?: string;
    visionUploads?: string;
  }): Promise<AgentSnapshot> {
    await this.stop();
    if (options.tempId) this.tempId = options.tempId;
    if (options.sessionPath) this.sessionPath = options.sessionPath;
    if (options.cwd) this.cwd = options.cwd;
    this.busy = false;
    this.disarmBusyWatchdog();
    this.lastActiveAt = Date.now();
    const args = [
      getTetherRpcEntryPath(),
      "--mode",
      "rpc",
      "--harness",
      "safe",
      "--provider",
      options.provider,
      "--permission",
      options.permission,
      "--sandbox",
      options.sandbox,
    ];
    if (options.network) args.push("--network");
    if (options.model) args.push("--model", options.model);
    if (options.baseUrl) args.push("--base-url", options.baseUrl);
    if (options.maxTokens) args.push("--max-tokens", String(options.maxTokens));
    if (options.effort) args.push("--effort", options.effort);
    args.push("--transport", "chat");
    if (options.sessionPath) args.push("--session", options.sessionPath);
    if (options.visionExtension) args.push("--extension", options.visionExtension);

    this.lineBuffer = Buffer.alloc(0);
    this.stderr = "";
    const child = spawn(process.execPath, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        PI_TELEMETRY: "0",
        PI_SKIP_VERSION_CHECK: "1",
        ...(options.extraModels?.length
          ? { HARNESS_EXTRA_MODELS: options.extraModels.join(",") }
          : {}),
        ...(options.visionConfig ? { HARNESS_VISION_CONFIG: options.visionConfig } : {}),
        ...(options.visionUploads ? { HARNESS_VISION_UPLOADS: options.visionUploads } : {}),
        ...(options.writableRoots?.length
          ? { TETHER_WRITABLE_ROOTS: options.writableRoots.join(path.delimiter) }
          : {}),
      },
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    child.stdout.on("data", (chunk: Buffer) => this.handleChunk(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      this.stderr = `${this.stderr}${chunk.toString()}`.slice(-AgentHost.STDERR_CAP);
    });
    child.stdin.on("error", (error) => {
      // EPIPE when the RPC worker exits mid-write must not crash the Electron main process.
      if (this.child !== child) return;
      const detail = error instanceof Error ? error.message : String(error);
      if (!/EPIPE|ECONNRESET|broken pipe/i.test(detail)) this.emitError(detail);
    });
    child.once("error", (error) => {
      if (this.child !== child) return;
      this.child = undefined;
      if (child.pid !== undefined) killProcessTree(child.pid, "SIGTERM");
      this.handleExit(error);
    });
    child.once("exit", (code, signal) => {
      if (this.child !== child) return;
      this.child = undefined;
      // Worker may die before its own wipe; reap leftover shells/delegates.
      if (child.pid !== undefined) killProcessTree(child.pid, "SIGTERM");
      this.handleExit(new Error(`Agent stopped (code ${code ?? "unknown"}${signal ? `, ${signal}` : ""})`));
    });

    return this.snapshot();
  }

  async stop(): Promise<void> {
    this.disarmBusyWatchdog();
    const child = this.child;
    if (!child) return;
    this.child = undefined;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Agent session closed"));
    }
    this.pending.clear();
    if (child.exitCode !== null || child.pid === undefined) return;
    // Kill the whole RPC tree (delegate explorers, shells, sandboxes) before the
    // desktop process exits — a plain child.kill() leaves detached orphans.
    killProcessTree(child.pid, "SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (child.exitCode === null && child.pid !== undefined) {
          killProcessTree(child.pid, "SIGKILL");
        }
        resolve();
      }, 2_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  async request<T>(type: string, data: Record<string, unknown> = {}): Promise<T> {
    const child = this.child;
    if (!child || child.stdin.destroyed) throw new Error("No workspace session is active");
    if (type === "prompt" || type === "steer") {
      this.busy = true;
      this.armBusyWatchdog();
    }
    if (type === "abort") {
      this.busy = false;
      this.disarmBusyWatchdog();
    }
    this.lastActiveAt = Date.now();
    const id = `desktop_${++this.requestId}`;
    // 2026-10-03 P0：Pi runtime 在 isStreaming 时，对没带 streamingBehavior 的 prompt 直接抛
    //   "Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message."
    // 渲染层的 running 与子进程的 _isAgentRunActive 是两个独立标志，只要错开一次（漏事件、跨会话切换、
    // 后台压缩还没收尾），这条 prompt 就会失败并把主进程 busy 永久焊死 → 输入发不出去、只能重开。
    // 统一补默认 "followUp"（排队到下一轮）后，运行中的提交变成真排队，而不是报错。
    const payload =
      type === "prompt" && data.streamingBehavior === undefined
        ? { ...data, streamingBehavior: "followUp" }
        : data;
    const command = { ...payload, type, id };
    const result = await new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Tether did not respond to ${type}. ${this.stderr}`.trim()));
      }, timeoutForRequest(type));
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      });
      try {
        child.stdin.write(`${JSON.stringify(command)}\n`);
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    if ((type === "prompt" || type === "steer") && (!this.sessionPath || this.sessionPath.includes("unknown_"))) {
      void this.resolveSessionPath();
    }
    return result;
  }

  async respondToUi(id: string, response: Record<string, unknown>): Promise<void> {
    const child = this.child;
    if (!child || child.stdin.destroyed) throw new Error("No workspace session is active");
    try {
      child.stdin.write(`${JSON.stringify({ type: "extension_ui_response", id, ...response })}\n`);
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  private handleChunk(chunk: Buffer): void {
    const drained = drainUtf8Lines(this.lineBuffer, chunk);
    this.lineBuffer = Buffer.from(drained.rest);
    for (const line of drained.lines) this.handleLine(line);
  }

  private handleLine(line: string): void {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    if (data.type === "response" && typeof data.id === "string") {
      const pending = this.pending.get(data.id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(data.id);
      if (data.success === false) pending.reject(new Error(String(data.error ?? "Tether command failed")));
      else pending.resolve(data.data);
      return;
    }
    if (typeof data.type === "string") {
      if (data.type === "agent_start") {
        this.busy = true;
        this.armBusyWatchdog();
        if (!this.sessionPath || this.sessionPath.includes("unknown_")) {
          void this.resolveSessionPath();
        }
      }
      if (data.type === "agent_settled") {
        this.busy = false;
        this.disarmBusyWatchdog();
        if (!this.sessionPath || this.sessionPath.includes("unknown_")) {
          void this.resolveSessionPath();
        }
      }
      this.lastActiveAt = Date.now();
      const event: AgentEvent = {
        ...(data as AgentEvent),
        ...(this.sessionPath ? { sessionPath: this.sessionPath } : {}),
        ...(this.tempId ? { tempId: this.tempId } : {}),
      };
      this.emitEvent(slimAgentEvent(event));
    }
  }

  private handleExit(error: Error): void {
    this.busy = false;
    this.disarmBusyWatchdog();
    const detail = this.stderr.trim();
    const message = detail ? `${error.message}\n${detail}` : error.message;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(message));
    }
    this.pending.clear();
    this.emitError(message, this.sessionPath);
  }
}

function timeoutForRequest(type: string): number {
  return LONG_RUNNING_REQUESTS.has(type) ? LONG_RPC_TIMEOUT_MS : DEFAULT_RPC_TIMEOUT_MS;
}

function sessionFileFromUnknown(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || !("sessionFile" in value)) return undefined;
  return typeof value.sessionFile === "string" ? value.sessionFile : undefined;
}
