import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { getTetherRpcEntryPath } from "tether-agent-core";
import type { AgentEvent, AgentSessionStats, AgentSnapshot, AgentStartOptions } from "../shared/types";
import { parseSkillCommands } from "../shared/skills";

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: NodeJS.Timeout;
}

const DEFAULT_RPC_TIMEOUT_MS = 45_000;
const LONG_RPC_TIMEOUT_MS = 30 * 60_000;
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

export class AgentHost {
  private child?: ChildProcessWithoutNullStreams;
  private buffer = "";
  private stderr = "";
  private requestId = 0;
  private pending = new Map<string, PendingRequest>();

  constructor(
    private readonly emitEvent: (event: AgentEvent) => void,
    private readonly emitError: (message: string) => void,
  ) {}

  isRunning(): boolean {
    return Boolean(this.child && this.child.exitCode === null);
  }

  async snapshot(): Promise<AgentSnapshot> {
    const [state, messages, models, thinkingLevels, stats, commands] = await Promise.all([
      this.request<Record<string, unknown>>("get_state"),
      this.request<{ messages: unknown[] }>("get_messages"),
      this.request<{ models: AgentSnapshot["models"] }>("get_available_models"),
      this.request<{ levels: string[] }>("get_available_thinking_levels"),
      this.request<AgentSessionStats>("get_session_stats").catch(() => undefined),
      this.request<{ commands: Array<{ name: string; description?: string; source?: string }> }>("get_commands").catch(() => ({ commands: [] })),
    ]);
    return {
      state,
      messages: messages.messages,
      models: models.models,
      thinkingLevels: thinkingLevels.levels,
      skills: parseSkillCommands(commands.commands),
      ...(stats ? { stats } : {}),
    };
  }

  async start(options: AgentStartOptions & {
    cwd: string;
    visionExtension?: string;
    visionConfig?: string;
    visionUploads?: string;
  }): Promise<AgentSnapshot> {
    await this.stop();
    const args = [
      getTetherRpcEntryPath(),
      "--mode",
      "rpc",
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
    if (options.effort) args.push("--effort", options.effort);
    args.push("--transport", "chat");
    if (options.sessionPath) args.push("--session", options.sessionPath);
    if (options.visionExtension) args.push("--extension", options.visionExtension);

    this.buffer = "";
    this.stderr = "";
    const child = spawn(process.execPath, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        PI_TELEMETRY: "0",
        PI_SKIP_VERSION_CHECK: "1",
        ...(options.visionConfig ? { HARNESS_VISION_CONFIG: options.visionConfig } : {}),
        ...(options.visionUploads ? { HARNESS_VISION_UPLOADS: options.visionUploads } : {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    child.stdout.on("data", (chunk: Buffer) => this.handleChunk(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      this.stderr += chunk.toString();
    });
    child.once("error", (error) => {
      if (this.child !== child) return;
      this.child = undefined;
      this.handleExit(error);
    });
    child.once("exit", (code, signal) => {
      if (this.child !== child) return;
      this.child = undefined;
      this.handleExit(new Error(`Agent stopped (code ${code ?? "unknown"}${signal ? `, ${signal}` : ""})`));
    });

    return this.snapshot();
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.child = undefined;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Agent session closed"));
    }
    this.pending.clear();
    if (child.exitCode !== null) return;
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
        resolve();
      }, 900);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  async request<T>(type: string, data: Record<string, unknown> = {}): Promise<T> {
    const child = this.child;
    if (!child || child.stdin.destroyed) throw new Error("No workspace session is active");
    const id = `desktop_${++this.requestId}`;
    const command = { ...data, type, id };
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Tether did not respond to ${type}. ${this.stderr}`.trim()));
      }, timeoutForRequest(type));
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      });
      child.stdin.write(`${JSON.stringify(command)}\n`);
    });
  }

  async respondToUi(id: string, response: Record<string, unknown>): Promise<void> {
    const child = this.child;
    if (!child || child.stdin.destroyed) throw new Error("No workspace session is active");
    child.stdin.write(`${JSON.stringify({ type: "extension_ui_response", id, ...response })}\n`);
  }

  private handleChunk(chunk: Buffer): void {
    this.buffer += chunk.toString("utf8");
    let index = this.buffer.indexOf("\n");
    while (index >= 0) {
      const line = this.buffer.slice(0, index).replace(/\r$/, "");
      this.buffer = this.buffer.slice(index + 1);
      if (line) this.handleLine(line);
      index = this.buffer.indexOf("\n");
    }
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
    if (typeof data.type === "string") this.emitEvent(data as AgentEvent);
  }

  private handleExit(error: Error): void {
    const detail = this.stderr.trim();
    const message = detail ? `${error.message}\n${detail}` : error.message;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(message));
    }
    this.pending.clear();
    this.emitError(message);
  }
}

function timeoutForRequest(type: string): number {
  return LONG_RUNNING_REQUESTS.has(type) ? LONG_RPC_TIMEOUT_MS : DEFAULT_RPC_TIMEOUT_MS;
}
