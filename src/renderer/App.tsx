import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  AgentSessionStats,
  AgentSnapshot,
  ExtensionUiRequest,
  PermissionMode,
  ProviderStatus,
  SessionSummary,
  WorkspaceItem,
} from "../shared/types";
import { visionAgentPrompt } from "../shared/vision-api";
import {
  applyAgentEvent,
  collectTodos,
  collectWorkingFiles,
  dropLastTurn,
  groupConversation,
  lastTurnRestoreFiles,
  mentionedFiles,
  normalizeMessages,
  optimisticUserMessage,
  parseFeaturesJson,
  sessionTools,
  turnAnchorId,
  turnAnchors,
  type ChatMessage,
  type FileChange,
  type RestoreFile,
  type SessionTodo,
} from "./conversation";
import {
  ApprovalCard,
  AssistantTurn,
  Chat,
  FileDrawer,
  Icon,
  InspectPanel,
  Login,
  PromptBar,
  SidebarNav,
  Thinking,
  TurnNav,
  UserTurn,
} from "./ui";
import logo from "./logo.svg";

const PERMISSIONS: PermissionMode[] = ["plan", "ask", "auto", "full"];
const DEFAULT_SUGGESTIONS = [
  { label: "打开本地项目", icon: "M3 7h6l2 2h10v10H3z", action: "open" },
  { label: "解释代码架构", hint: "结构和入口" },
  { label: "找出可疑的 bug", hint: "排查风险" },
  { label: "编写一组测试", hint: "覆盖核心路径" },
];
const REPO_SUGGESTIONS = [
  { label: "解释这个仓库", hint: "结构和入口" },
  { label: "找出最可疑的 bug", hint: "先看风险" },
  { label: "补一组测试", hint: "覆盖核心路径" },
  { label: "拆成可跨会话的任务清单", hint: "先铺 features.json" },
];

function relativeTime(iso: string) {
  const delta = Date.now() - Date.parse(iso);
  const minutes = Math.round(delta / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.round(hours / 24);
  if (days === 1) return "昨天";
  if (days < 7) return `${days} 天前`;
  return new Date(iso).toLocaleDateString();
}

function sessionFileOf(snapshot: AgentSnapshot): string | undefined {
  if (typeof snapshot.stats?.sessionFile === "string") return snapshot.stats.sessionFile;
  if (typeof snapshot.state.sessionFile === "string") return snapshot.state.sessionFile;
  return undefined;
}

function isSameSession(session: SessionSummary, active?: string) {
  return Boolean(active && (session.path === active || session.storagePath === active));
}

const PIN_ICON =
  "M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z";
const PENCIL_ICON = "M21.2 6.8a1 1 0 0 0-4-4L3.8 16.2a2 2 0 0 0-.5.8l-1.3 4.4a.5.5 0 0 0 .6.6l4.4-1.3a2 2 0 0 0 .8-.5zM15 5l4 4";
const TRASH_ICON = "M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6";
/** Real filled dots: zero-length stroked segments render as thin nubs, not circles. */
function MoreIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="6" r="1.85" />
      <circle cx="12" cy="12" r="1.85" />
      <circle cx="12" cy="18" r="1.85" />
    </svg>
  );
}

function SessionRow({
  session,
  active,
  onOpen,
  onPin,
  onRename,
  onRemove,
}: {
  session: SessionSummary;
  active: boolean;
  onOpen(): void;
  onPin(): void;
  onRename(title: string): void;
  onRemove(): void;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number }>();
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(undefined);
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, [menu]);

  const openMenu = (x: number, y: number) => {
    setMenu({
      x: Math.max(8, Math.min(x, window.innerWidth - 190)),
      y: Math.max(8, Math.min(y, window.innerHeight - 154)),
    });
  };
  const action = (callback: () => void) => {
    setMenu(undefined);
    callback();
  };

  return (
    <div
      className={["session-item", active && "active", menu && "menu-open"].filter(Boolean).join(" ")}
      onContextMenu={(event) => {
        event.preventDefault();
        openMenu(event.clientX, event.clientY);
      }}
    >
      {editing ? (
        <input
          className="session-rename"
          defaultValue={session.title}
          autoFocus
          onFocus={(event) => event.currentTarget.select()}
          onBlur={(event) => {
            const next = event.currentTarget.value.trim();
            setEditing(false);
            if (next && next !== session.title) onRename(next);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              event.currentTarget.value = session.title;
              event.currentTarget.blur();
            }
          }}
        />
      ) : (
        <button type="button" className="session-row" onClick={onOpen}>
          {session.pinned && <Icon path={PIN_ICON} size={12} />}
          <span>{session.title || "未命名"}</span>
        </button>
      )}
      <button
        type="button"
        className="session-del session-more"
        aria-label="对话菜单"
        onClick={(event) => {
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          openMenu(rect.right + 4, rect.top);
        }}
      >
        <MoreIcon />
      </button>
      {menu && createPortal(
        <div
          className="session-menu"
          role="menu"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button type="button" role="menuitem" onClick={() => action(onPin)}>
            <Icon path={PIN_ICON} size={16} />
            <span>{session.pinned ? "取消置顶" : "置顶"}</span>
          </button>
          <button type="button" role="menuitem" onClick={() => action(() => setEditing(true))}>
            <Icon path={PENCIL_ICON} size={16} />
            <span>重命名</span>
          </button>
          <div className="session-menu-separator" />
          <button type="button" role="menuitem" className="danger" onClick={() => action(onRemove)}>
            <Icon path={TRASH_ICON} size={16} />
            <span>移除</span>
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}

const SANDBOX_OK_KEY = "harness:unsandboxed-projects";

function allowedProjects(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(SANDBOX_OK_KEY) ?? "[]") as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((item) => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

/** Windows/Linux have no Seatbelt; workspace-write cannot run commands without Docker. */
function confirmUnsandboxedProject(cwd?: string): boolean {
  if (window.harness.platform === "darwin" || !cwd) return false;
  const remembered = allowedProjects();
  if (remembered.has(cwd)) return true;
  const ok = window.confirm(`当前系统没有命令沙箱，agent 需要直接读写这个项目才能执行命令。\n\n允许访问：\n${cwd}`);
  if (ok) localStorage.setItem(SANDBOX_OK_KEY, JSON.stringify([...remembered, cwd]));
  return ok;
}

export function App() {
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [workspace, setWorkspace] = useState<string>();
  const [activeSession, setActiveSession] = useState<string>();
  const [model, setModel] = useState("");
  const [chatModels, setChatModels] = useState<string[]>([]);
  const [permission, setPermission] = useState<PermissionMode>("auto");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [stats, setStats] = useState<AgentSessionStats>();
  const [draft, setDraft] = useState("");
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [toast, setToast] = useState<string>();
  const [uiRequest, setUiRequest] = useState<ExtensionUiRequest>();
  const [fullscreen, setFullscreen] = useState(false);
  const [openProjects, setOpenProjects] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<FileChange>();
  const [featureTodos, setFeatureTodos] = useState<SessionTodo[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const agentCwd = useRef<string | undefined>(undefined);
  const sessionRef = useRef<string | undefined>(undefined);
  const sending = useRef(false);
  const stick = useRef(true);
  const live = useRef(false);
  const pendingUndo = useRef<{ files: RestoreFile[] } | undefined>(
    undefined,
  );
  const modelRef = useRef(model);
  modelRef.current = model;

  const groups = useMemo(() => groupConversation(messages), [messages]);
  const anchors = useMemo(() => turnAnchors(groups), [groups]);
  const tools = useMemo(() => sessionTools(messages), [messages]);
  const workingFiles = useMemo(() => collectWorkingFiles(tools, mentionedFiles(messages)), [messages, tools]);
  const chatTodos = useMemo(() => collectTodos(messages), [messages]);
  const todos = featureTodos.length ? featureTodos : chatTodos;
  const darwin = window.harness.platform === "darwin";
  const connected = providers.find((item) => item.id === "deepseek");
  const waiting = running && (groups.length === 0 || groups.at(-1)?.type === "user");
  const suggestions = workspace ? REPO_SUGGESTIONS : DEFAULT_SUGGESTIONS;

  const projects = useMemo(() => {
    const byPath = new Map<string, { item: WorkspaceItem; sessions: SessionSummary[] }>();
    for (const item of workspaces) byPath.set(item.path, { item, sessions: [] });
    for (const session of sessions) {
      byPath.get(session.cwd)?.sessions.push(session);
    }
    return [...byPath.values()];
  }, [sessions, workspaces]);

  const hydrate = useCallback((snapshot: AgentSnapshot) => {
    setMessages(normalizeMessages(snapshot.messages));
    setStats(snapshot.stats);
    setRunning(Boolean(snapshot.state.isStreaming));
  }, []);

  const refresh = useCallback(async () => {
    const [recent, status, threads] = await Promise.all([
      window.harness.workspace.recent(),
      window.harness.auth.status(),
      window.harness.sessions.list(),
    ]);
    setWorkspaces(recent);
    setProviders(status);
    setSessions(threads);
    return status;
  }, []);

  const startAgent = useCallback(async (cwd?: string, sessionPath?: string, asProject = false, resume = false, mode = permission) => {
    const accounts = await window.harness.auth.status();
    setProviders(accounts);
    const chat = accounts.find((item) => item.id === "deepseek");
    if (!chat?.configured) {
      setLoginOpen(true);
      setToast("先填写自定义配置");
      return false;
    }
    const modelId = modelRef.current.trim() || chat.defaultModel;
    setLoading(true);
    setUiRequest(undefined);
    if (!resume) {
      setActiveSession(sessionPath);
      sessionRef.current = sessionPath;
      if (cwd) {
        setWorkspace(cwd);
        setOpenProjects((current) => ({ ...current, [cwd]: true }));
      } else {
        setWorkspace(undefined);
      }
    }
    const sandbox = asProject
      ? (mode === "full" || confirmUnsandboxedProject(cwd) ? "danger-full-access" : "workspace-write")
      : "read-only";
    if (asProject && sandbox !== "danger-full-access" && window.harness.platform !== "darwin") {
      setLoading(false);
      setToast("已取消。Windows 没有沙箱时，必须允许直接读写才能跑命令。");
      return false;
    }
    try {
      const snapshot = await window.harness.agent.start({
        ...(cwd ? { cwd } : {}),
        project: asProject,
        provider: "deepseek",
        ...(modelId ? { model: modelId } : {}),
        ...(chat.baseUrl ? { baseUrl: chat.baseUrl } : {}),
        effort: "high",
        permission: mode,
        sandbox,
        ...(mode === "auto" || mode === "full" ? { network: true } : {}),
        ...(sessionPath ? { sessionPath } : {}),
        ...(resume ? { resume: true } : {}),
      });
      hydrate(snapshot);
      live.current = true;
      agentCwd.current = snapshot.cwd ?? cwd ?? agentCwd.current;
      if (modelId) {
        setModel(modelId);
        await window.harness.agent.command("set_model", { provider: "deepseek", modelId }).catch(() => undefined);
      }
      // ponytail: DeepSeek adapter defaults effort max; gpt-5.x only allows none|low|medium|high|xhigh.
      await window.harness.agent.command("set_thinking_level", { level: "high" }).catch(() => undefined);
      const file = sessionFileOf(snapshot) ?? sessionPath;
      if (file) {
        sessionRef.current = file;
        setActiveSession(file);
      }
      void window.harness.sessions.list().then(setSessions);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/Agent session closed/.test(message)) setToast(message);
      if (/not configured|credential|login|api key/i.test(message)) setLoginOpen(true);
      return false;
    } finally {
      setLoading(false);
    }
  }, [hydrate, permission]);

  const bindProject = useCallback(async (cwd: string): Promise<boolean> => {
    if (running && agentCwd.current && agentCwd.current !== cwd) {
      setToast("当前 agent 仍在运行，停止后再切换项目");
      return false;
    }
    if (running && agentCwd.current === cwd) return true;
    live.current = false;
    setWorkspace(cwd);
    setOpenProjects((current) => ({ ...current, [cwd]: true }));
    setMessages([]);
    setStats(undefined);
    setDraft("");
    setActiveSession(undefined);
    sessionRef.current = undefined;
    setRunning(false);
    setUiRequest(undefined);
    setPreview(undefined);
    setFeatureTodos([]);
    if (!agentCwd.current) return true;
    agentCwd.current = undefined;
    if (!running) await window.harness.agent.stop().catch(() => undefined);
    return true;
  }, [running]);

  const openFolder = useCallback(async () => {
    const selected = await window.harness.workspace.choose();
    if (!selected) return;
    if (!(await bindProject(selected))) return null;
    setWorkspaces(await window.harness.workspace.recent());
    return selected;
  }, [bindProject]);

  const newThread = useCallback(async () => {
    if (workspace) {
      await bindProject(workspace);
      return;
    }
    live.current = false;
    setMessages([]);
    setStats(undefined);
    setDraft("");
    setRunning(false);
    setUiRequest(undefined);
    setPreview(undefined);
    setFeatureTodos([]);
    setActiveSession(undefined);
    sessionRef.current = undefined;
    if (!agentCwd.current) return;
    agentCwd.current = undefined;
    await window.harness.agent.command("abort").catch(() => undefined);
    await window.harness.agent.stop().catch(() => undefined);
  }, [bindProject, workspace]);

  const removeSession = useCallback(async (session: SessionSummary) => {
    if (isSameSession(session, activeSession)) {
      if (agentCwd.current) {
        try {
          await window.harness.agent.command("new_session");
        } catch (error) {
          setToast(error instanceof Error ? error.message : String(error));
        }
      }
      setMessages([]);
      setStats(undefined);
      setActiveSession(undefined);
      setRunning(false);
      setUiRequest(undefined);
    }
    try {
      await window.harness.sessions.remove(session.id);
      setSessions(await window.harness.sessions.list());
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error));
    }
  }, [activeSession]);

  const pinSession = useCallback(async (session: SessionSummary) => {
    try {
      await window.harness.sessions.pin(session.id, !session.pinned);
      setSessions(await window.harness.sessions.list());
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const renameSession = useCallback(async (session: SessionSummary, title: string) => {
    try {
      await window.harness.sessions.rename(session.id, title);
      setSessions(await window.harness.sessions.list());
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const removeProject = useCallback(async (path: string) => {
    try {
      setWorkspaces(await window.harness.workspace.forget(path));
      setSessions(await window.harness.sessions.list());
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error));
      return;
    }
    if (workspace !== path) return;
    live.current = false;
    setWorkspace(undefined);
    setMessages([]);
    setStats(undefined);
    setActiveSession(undefined);
    setRunning(false);
    setUiRequest(undefined);
    sessionRef.current = undefined;
    agentCwd.current = undefined;
    await window.harness.agent.command("abort").catch(() => undefined);
    await window.harness.agent.stop().catch(() => undefined);
  }, [workspace]);

  const applyUndo = useCallback(async (files: RestoreFile[]) => {
    await window.harness.workspace.restore(files, workspace);
    setMessages((current) => dropLastTurn(current));
    const stats = await window.harness.agent.command<{ sessionFile?: string }>("get_session_stats").catch(() => undefined);
    if (typeof stats?.sessionFile === "string") {
      sessionRef.current = stats.sessionFile;
      setActiveSession(stats.sessionFile);
    }
    void window.harness.sessions.list().then(setSessions);
  }, [workspace]);

  const undoLastTurn = useCallback(async () => {
    if (running) return;
    if (!agentCwd.current) {
      const started = await startAgent(workspace, sessionRef.current, true, true);
      if (!started) {
        setToast("没有活动会话");
        return;
      }
    }
    try {
      const log = await window.harness.agent.command<{ entries: Parameters<typeof lastTurnRestoreFiles>[0] }>("get_entries");
      const files = lastTurnRestoreFiles(log.entries ?? []);
      if (files.length === 0) {
        setToast("这一轮没有可撤回的文件改动");
        return;
      }
      pendingUndo.current = { files };
      setUiRequest({
        type: "extension_ui_request",
        id: "harness:undo",
        method: "confirm",
        title: `Undo last turn?\n${files.map((file) => file.path).join("\n")}`,
      });
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error));
    }
  }, [running, startAgent, workspace]);

  const sendMessage = useCallback(async (preset?: string, images?: string[]) => {
    const text = (preset ?? draft).trim();
    if (text === "/undo") {
      setDraft("");
      void undoLastTurn();
      return;
    }
    if ((!text && !images?.length) || loading || sending.current) return;
    sending.current = true;
    try {
      if (!workspace && !agentCwd.current) {
        const opened = await openFolder();
        if (!opened) return;
        const started = await startAgent(opened, undefined, true);
        if (!started) return;
      } else if (!agentCwd.current) {
        const started = await startAgent(workspace, undefined, true);
        if (!started) return;
      }
      const question = text || "请详细描述这张图片的内容";
      const thumbs = (images ?? []).map((item) => {
        const match = item.match(/^data:([^;]+);base64,(.+)$/);
        return {
          mimeType: match?.[1] ?? "image/png",
          data: match?.[2] ?? item.replace(/^data:[^;]+;base64,/, ""),
        };
      });
      const message = images?.length
        ? visionAgentPrompt(question, await window.harness.vision.stage(images))
        : question;
      const alreadyRunning = running;
      setDraft("");
      setMessages((current) => [...current, optimisticUserMessage(question, alreadyRunning, thumbs)]);
      setRunning(true);
      try {
        await window.harness.agent.command(alreadyRunning ? "steer" : "prompt", { message });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        if (!/Agent session closed/.test(detail)) setToast(detail);
        setRunning(alreadyRunning);
      }
    } finally {
      sending.current = false;
    }
  }, [draft, loading, openFolder, running, startAgent, undoLastTurn, workspace, workspaces.length]);

  useEffect(() => {
    void refresh().then((status) => {
      const current = status.find((item) => item.id === "deepseek");
      if (current?.configured) setModel(current.defaultModel);
      if (!current?.configured) setLoginOpen(true);
    });
  }, []);

  useEffect(() => {
    const chat = providers.find((item) => item.id === "deepseek");
    if (!chat?.configured || !chat.baseUrl) return;
    let cancelled = false;
    void window.harness.auth.readApiKey("deepseek").then((key) => {
      if (!key.trim() || !chat.baseUrl) return;
      return window.harness.auth.listModels(chat.baseUrl, key);
    }).then((ids) => {
      if (!cancelled && ids?.length) setChatModels(ids);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [providers]);

  useEffect(() => {
    const offEvent = window.harness.agent.onEvent((event) => {
      if (!live.current) return;
      if (event.type === "agent_start") setRunning(true);
      if (event.type === "agent_settled") {
        setRunning(false);
        setUiRequest(undefined);
        void window.harness.agent.command<AgentSessionStats>("get_session_stats").then((nextStats) => {
          if (!live.current) return;
          setStats(nextStats);
          if (typeof nextStats?.sessionFile !== "string") return;
          sessionRef.current = nextStats.sessionFile;
          setActiveSession(nextStats.sessionFile);
        }).catch(() => undefined);
        void window.harness.sessions.list().then(setSessions);
      }
      if (event.type === "extension_error" && typeof event.error === "string") setToast(event.error);
      if (event.type === "tool_execution_end" && event.isError === true) {
        const detail = typeof event.result === "string" ? event.result : JSON.stringify(event.result ?? "");
        if (/read-only|permission denied|not permitted|sandbox/i.test(detail)) {
          setToast("当前是只读会话。点输入框里的「打开仓库」后才能改本地文件。");
        }
      }
      if (event.type === "extension_ui_request") {
        const request = event as ExtensionUiRequest;
        if (request.method === "notify") setToast(request.message ?? "通知");
        else if (["select", "confirm", "input", "editor"].includes(request.method)) setUiRequest(request);
      }
      setMessages((current) => (live.current ? applyAgentEvent(current, event) : current));
    });
    const offError = window.harness.agent.onError((message) => {
      if (!live.current) return;
      if (/Agent session closed/.test(message)) return;
      setRunning(false);
      setToast(message);
    });
    const offCommand = window.harness.onAppCommand((command) => {
      if (command === "new-thread") void newThread();
      if (command === "open-folder") void openFolder();
      if (command === "fullscreen-on") setFullscreen(true);
      if (command === "fullscreen-off") setFullscreen(false);
    });
    return () => {
      offEvent();
      offError();
      offCommand();
    };
  }, [newThread, openFolder, workspace]);

  useEffect(() => {
    if (!workspace) {
      setFeatureTodos([]);
      return;
    }
    let gone = false;
    void window.harness.workspace.read(".agents/features.json", workspace).then(
      (result) => {
        if (!gone) setFeatureTodos(result.binary ? [] : parseFeaturesJson(result.content));
      },
      () => {
        if (!gone) setFeatureTodos([]);
      },
    );
    return () => {
      gone = true;
    };
  }, [workspace, running, workingFiles]);

  useEffect(() => {
    const node = scroller.current;
    if (node && stick.current) node.scrollTop = node.scrollHeight;
  }, [messages, uiRequest]);

  const home = groups.length === 0;
  const homeRecents = (
    workspace
      ? projects.find((item) => item.item.path === workspace)?.sessions ?? []
      : projects.flatMap((item) => item.sessions).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  ).slice(0, 5);
  const composer = (
    <PromptBar
      value={draft}
      onChange={setDraft}
      onSubmit={(text, images) => void sendMessage(text, images)}
      onStop={() => {
        setRunning(false);
        void window.harness.agent.command("abort").catch(() => undefined);
      }}
      running={running}
      disabled={loading}
      workspace={workspace}
      onPickWorkspace={() => void openFolder()}
      model={model}
      models={[...new Set([model, ...chatModels].filter(Boolean))].map((id) => ({ value: id, label: id }))}
      onModel={(next) => {
        setModel(next);
        void window.harness.agent.command("set_model", { provider: "deepseek", modelId: next }).catch(() => undefined);
      }}
      permission={permission}
      onPermission={(next) => {
        const mode = next as PermissionMode;
        setPermission(mode);
        if (!agentCwd.current) return;
        void (async () => {
          await window.harness.agent.stop().catch(() => undefined);
          const ok = await startAgent(workspace, sessionRef.current, Boolean(workspace), true, mode);
          if (ok) setToast(mode === "full" ? "已关闭沙箱，命令不再询问主机权限" : "已按当前权限重新开会话");
        })();
      }}
      onCommand={(command) => {
        if (command === "/new") void newThread();
        if (command === "/open") void openFolder();
        if (command === "/undo") void undoLastTurn();
        if (command === "/login") setLoginOpen(true);
      }}
      stats={stats}
      placement={home ? "hero" : "dock"}
    />
  );

  return (
    <div className={["app", darwin && "darwin", fullscreen && "fullscreen"].filter(Boolean).join(" ")}>
      <SidebarNav
        onNew={() => void newThread()}
        onOpen={() => void openFolder()}
        account={(
          <button type="button" className="account" title="设置与模型管理" onClick={() => setLoginOpen(true)}>
            <div className="account-icon">
              <Icon path="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15H2.8a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.2 8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4V3.8a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.6 1z" size={15} />
            </div>
            <div className="account-meta">
              <strong>{connected?.configured ? model : "未配置模型"}</strong>
              <small>{connected?.configured ? "管理接口与密钥" : "配置接口与密钥"}</small>
            </div>
          </button>
        )}
      >
        <div className="section-label">项目</div>
        {projects.length === 0 && <p className="sidebar-empty">还没有打开过文件夹</p>}
        {projects.map(({ item, sessions: threads }) => {
          const open = openProjects[item.path] !== false;
          return (
            <div key={item.path} className={open ? "project open" : "project"}>
              <div
                className={item.path === workspace ? "project-head active" : "project-head"}
              >
              <button
                type="button"
                className="project-row"
                onClick={() => {
                  setOpenProjects((current) => ({ ...current, [item.path]: true }));
                  void bindProject(item.path);
                }}
              >
                <span
                  className="chevron-hit"
                  onClick={(event) => {
                    event.stopPropagation();
                    setOpenProjects((current) => ({ ...current, [item.path]: !open }));
                  }}
                >
                  <Icon className="chevron" path="M9 6l6 6-6 6" size={14} />
                </span>
                <Icon path="M3 7h6l2 2h10v10H3z" size={15} />
                <strong>{item.name}</strong>
              </button>
              <button
                type="button"
                className="session-del"
                aria-label="移除项目"
                onClick={(event) => {
                  event.stopPropagation();
                  void removeProject(item.path);
                }}
              >
                <Icon path="M6 6l12 12M18 6L6 18" size={12} />
              </button>
              </div>
              {open && (
                <div className="session-list nested">
                  {threads.length === 0 && <p className="task-empty">还没有对话</p>}
                  {threads.map((session) => (
                    <SessionRow
                      key={session.id}
                      session={session}
                      active={isSameSession(session, activeSession)}
                      onOpen={() => {
                        if (isSameSession(session, activeSession)) return;
                        void startAgent(session.cwd, session.path, true);
                      }}
                      onPin={() => void pinSession(session)}
                      onRename={(title) => void renameSession(session, title)}
                      onRemove={() => void removeSession(session)}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </SidebarNav>

      <Chat
        home={home}
        title={sessions.find((session) => isSameSession(session, activeSession))?.title || workspace?.split("/").pop()}
        composer={home ? undefined : composer}
        nav={<TurnNav items={anchors} />}
        inspect={workspace ? (
          <InspectPanel
            files={workingFiles}
            todos={todos}
            folder={workspace.split("/").pop()}
            workspace={workspace}
            refresh={running}
            running={running}
            onOpen={setPreview}
            onUndo={() => void undoLastTurn()}
          />
        ) : undefined}
      >
        <div
          className={home ? "conversation home" : "conversation"}
          ref={scroller}
          onScroll={(event) => {
            const node = event.currentTarget;
            stick.current = node.scrollHeight - node.scrollTop - node.clientHeight < 96;
          }}
        >
          {home && (
            <div className="empty">
              <div className="empty-hero">
                <img className="empty-logo" src={logo} alt="" width={30} height={17} />
                <h1>{workspace ? workspace.split("/").pop() : "今天想做点什么？"}</h1>
              </div>
              {composer}
              <div className="suggestions">
                {suggestions.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => {
                      if ("action" in item && item.action === "open") {
                        void openFolder();
                      } else {
                        void sendMessage(item.label);
                      }
                    }}
                  >
                    {"icon" in item && item.icon && <Icon path={item.icon} size={13} />}
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
              {homeRecents.length > 0 && (
                <div className="home-recents">
                  <div className="home-recents-head">
                    <span>最近活跃</span>
                  </div>
                  {homeRecents.map((session) => (
                    <button
                      key={session.id}
                      type="button"
                      className="home-recent"
                      onClick={() => {
                        if (isSameSession(session, activeSession)) return;
                        void startAgent(session.cwd, session.path, true);
                      }}
                    >
                      <div className="home-recent-main">
                        <Icon path="M19 3H5a2 2 0 0 0-2 2v14l4-4h12a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z" size={14} />
                        <span>{session.title || "未命名会话"}</span>
                      </div>
                      <small>{relativeTime(session.updatedAt)}</small>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {groups.length > 0 && (
            <div className="messages">
              {groups.map((group) => group.type === "user" ? (
                <UserTurn
                  key={group.id}
                  anchor={turnAnchorId(group.id)}
                  text={group.message.text}
                  images={group.message.images}
                />
              ) : (
                <AssistantTurn
                  key={group.id}
                  messages={group.messages}
                  onOpenFile={setPreview}
                />
              ))}
              {waiting && (
                <article className="turn">
                  <div className="turn-trace">
                    <Thinking text="" work={[]} tools={[]} live />
                  </div>
                </article>
              )}
              {uiRequest && (
                <ApprovalCard
                  request={uiRequest}
                  lastTurn={[...messages].reverse().find((item) => item.role === "user" && item.text.trim() !== "/undo")?.text}
                  onRespond={uiRequest.id === "harness:undo" ? async (response) => {
                    if (response.confirmed !== true) {
                      pendingUndo.current = undefined;
                      return;
                    }
                    const pending = pendingUndo.current;
                    if (!pending) return;
                    await applyUndo(pending.files);
                    pendingUndo.current = undefined;
                  } : undefined}
                  onDone={() => setUiRequest(undefined)}
                  onError={setToast}
                />
              )}
            </div>
          )}
        </div>
        {preview && <FileDrawer file={preview} workspace={workspace} onClose={() => setPreview(undefined)} />}
        {toast && (
          <button type="button" className="toast" onClick={() => setToast(undefined)}>
            <Icon path="M9 18h6M10 22h4M12 2a7 7 0 0 1 4 12c-.8.8-1 1.5-1 3H9c0-1.5-.2-2.2-1-3A7 7 0 0 1 12 2z" size={16} />
            <span>{/unrestricted host filesystem/i.test(toast) ? "本次命令已允许访问本机文件和网络" : toast}</span>
          </button>
        )}
      </Chat>

      {loginOpen && (
        <Login
          configured={Boolean(connected?.configured)}
          model={model}
          baseUrl={connected?.baseUrl}
          onClose={() => setLoginOpen(false)}
          onSaved={async () => {
            const status = await window.harness.auth.status();
            setProviders(status);
            const current = status.find((item) => item.id === "deepseek");
            if (current?.configured) {
              const nextModel = current.defaultModel;
              modelRef.current = nextModel;
              setModel(nextModel);
              setLoginOpen(false);
              await window.harness.agent.stop().catch(() => undefined);
              if (workspace || agentCwd.current) {
                void startAgent(workspace, sessionRef.current, Boolean(workspace), false, permission);
              }
            }
          }}
        />
      )}
    </div>
  );
}
