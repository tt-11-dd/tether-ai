import type { Locale } from "./i18n";
import type { AgentSkillCommand } from "./skills";

/** Previews load through their own origin so page storage works without reaching the app. */
export const PREVIEW_SCHEME = "harness-preview";
export const PREVIEW_HOST = "workspace";
/** Staged image uploads live outside the workspace, so they get their own preview host. */
export const UPLOADS_HOST = "uploads";

export const PROVIDER_IDS = [
  "deepseek",
  "openai-codex",
  "openai",
  "anthropic",
  "openrouter",
  "zai",
  "kimi-coding",
  "minimax",
  "xai",
  "opencode-go",
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];
export type PermissionMode = "plan" | "ask" | "auto" | "full";
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export interface WorkspaceItem {
  path: string;
  name: string;
  lastOpenedAt: string;
}

export interface SessionSummary {
  path: string;
  storagePath: string;
  id: string;
  cwd: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  provider?: string;
  model?: string;
  messageCount: number;
  preview?: string;
  pinned: boolean;
  archived: boolean;
}

export interface ProviderStatus {
  id: ProviderId;
  name: string;
  configured: boolean;
  source?: "stored" | "environment";
  defaultModel: string;
  baseUrl?: string;
  preferred?: boolean;
}

export interface AgentStartOptions {
  cwd?: string;
  project?: boolean;
  provider: ProviderId;
  model?: string;
  baseUrl?: string;
  maxTokens?: number;
  effort?: string;
  permission: PermissionMode;
  sandbox: SandboxMode;
  network?: boolean;
  sessionPath?: string;
  resume?: boolean;
}

export interface AgentSessionStats {
  sessionFile?: string;
  sessionId: string;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolResults: number;
  totalMessages: number;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  cost: number;
  contextUsage?: {
    tokens: number | null;
    contextWindow: number;
    percent: number | null;
  };
}

export interface AgentSnapshot {
  state: Record<string, unknown>;
  messages: unknown[];
  models: Array<{ provider: string; id: string; contextWindow?: number; reasoning?: boolean }>;
  thinkingLevels: string[];
  stats?: AgentSessionStats;
  cwd?: string;
  skills?: AgentSkillCommand[];
}

export type AgentEvent = Record<string, unknown> & { type: string };

export type ExtensionUiRequest = {
  type: "extension_ui_request";
  id: string;
  method: "select" | "confirm" | "input" | "editor" | "notify" | "setStatus" | "setWidget" | "setTitle" | "set_editor_text";
  title?: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
  notifyType?: "info" | "warning" | "error";
  [key: string]: unknown;
};

export interface DesktopApi {
  platform: NodeJS.Platform;
  app: {
    version(): Promise<string>;
    openExternal(url: string): Promise<void>;
    checkUpdate(): Promise<void>;
    getLocale(): Promise<Locale>;
    setLocale(locale: Locale): Promise<void>;
  };
  /** Frameless windows off macOS need the renderer to drive the caption buttons. */
  window: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<void>;
    close(): Promise<void>;
  };
  workspace: {
    choose(): Promise<string | null>;
    recent(): Promise<WorkspaceItem[]>;
    forget(path: string): Promise<WorkspaceItem[]>;
    read(path: string, cwd?: string): Promise<{ path: string; content: string; binary: boolean }>;
    open(path: string, cwd?: string): Promise<void>;
    reveal(path: string, cwd?: string): Promise<void>;
    list(cwd?: string): Promise<string[]>;
    restore(files: Array<{ path: string; content: string | null; mode?: number }>, cwd?: string): Promise<{ restored: string[] }>;
    onChanged(listener: (root: string) => void): () => void;
  };
  vision: {
    config(): Promise<{ endpoint: string; model: string; apiKey: string }>;
    saveConfig(config: { endpoint: string; model: string; apiKey?: string }): Promise<void>;
    stage(images: string[]): Promise<string[]>;
  };
  sessions: {
    list(cwd?: string): Promise<SessionSummary[]>;
    remove(id: string): Promise<void>;
    pin(id: string, pinned: boolean): Promise<void>;
    rename(id: string, title: string): Promise<void>;
  };
  auth: {
    status(): Promise<ProviderStatus[]>;
    readApiKey(provider: Exclude<ProviderId, "openai-codex">): Promise<string>;
    saveApiKey(provider: Exclude<ProviderId, "openai-codex">, key: string, baseUrl?: string, model?: string): Promise<void>;
    listModels(baseUrl: string, apiKey: string): Promise<string[]>;
    profiles(): Promise<import("./chat-profiles").ChatProfiles>;
    saveProfiles(profiles: import("./chat-profiles").ChatProfiles): Promise<void>;
    logout(provider: ProviderId): Promise<void>;
  };
  agent: {
    start(options: AgentStartOptions): Promise<AgentSnapshot>;
    stop(): Promise<void>;
    command<T = unknown>(type: string, data?: Record<string, unknown>): Promise<T>;
    respondToUi(id: string, response: Record<string, unknown>): Promise<void>;
    onEvent(listener: (event: AgentEvent) => void): () => void;
    onError(listener: (message: string) => void): () => void;
  };
  onAppCommand(listener: (command: string) => void): () => void;
}
