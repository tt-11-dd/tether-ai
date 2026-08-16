import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import type { AgentSkillCommand } from "../shared/skills";
import { parseSkillCommands, skillSlashCommand } from "../shared/skills";
import { visionAgentPrompt } from "../shared/vision-api";
import {
  applyAgentEvent,
  baseName,
  collectTodos,
  collectWorkingFiles,
  dropLastTurn,
  friendlyAgentError,
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
import { useI18n } from "./i18n";
import type { MessageKey } from "../shared/i18n";

const PERMISSIONS: PermissionMode[] = ["plan", "ask", "auto", "full"];

function relativeTime(iso: string, t: (key: MessageKey, vars?: Record<string, string | number>) => string) {
  const delta = Date.now() - Date.parse(iso);
  const minutes = Math.round(delta / 60_000);
  if (minutes < 1) return t("common.justNow");
  if (minutes < 60) return t("common.minutesAgo", { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t("common.hoursAgo", { n: hours });
  const days = Math.round(hours / 24);
  if (days === 1) return t("common.yesterday");
  if (days < 7) return t("common.daysAgo", { n: days });
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
  const { t } = useI18n();
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
          <span>{session.title || t("common.unnamed")}</span>
        </button>
      )}
      <button
        type="button"
        className="session-del session-more"
        aria-label={t("nav.sessionMenu")}
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
            <span>{session.pinned ? t("common.unpin") : t("common.pin")}</span>
          </button>
          <button type="button" role="menuitem" onClick={() => action(() => setEditing(true))}>
            <Icon path={PENCIL_ICON} size={16} />
            <span>{t("common.rename")}</span>
          </button>
          <div className="session-menu-separator" />
          <button type="button" role="menuitem" className="danger" onClick={() => action(onRemove)}>
            <Icon path={TRASH_ICON} size={16} />
            <span>{t("common.remove")}</span>
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
function confirmUnsandboxedProject(cwd: string | undefined, message: string): boolean {
  if (window.harness.platform === "darwin" || !cwd) return false;
  const remembered = allowedProjects();
  if (remembered.has(cwd)) return true;
  const ok = window.confirm(message);
  if (ok) localStorage.setItem(SANDBOX_OK_KEY, JSON.stringify([...remembered, cwd]));
  return ok;
}

function AccountMenu({
  model,
  configured,
  onOpenSettings,
}: {
  model: string;
  configured: boolean;
  onOpenSettings(): void;
}) {
  const { t, locale, setLocale } = useI18n();
  const [menu, setMenu] = useState<{ left: number; bottom: number }>();
  const [langOpen, setLangOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => {
      setMenu(undefined);
      setLangOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, [menu]);

  const open = () => {
    const node = root.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    setLangOpen(false);
    setMenu({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 220)),
      bottom: Math.max(8, window.innerHeight - rect.top + 6),
    });
  };

  return (
    <div ref={root} className={menu ? "account-wrap open" : "account-wrap"}>
      <button type="button" className="account" title={t("nav.settingsTitle")} onClick={open}>
        <div className="account-icon">
          <Icon path="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15H2.8a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.2 8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4V3.8a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.6 1z" size={15} />
        </div>
        <div className="account-meta">
          <strong>{configured ? model : t("nav.modelUnset")}</strong>
          <small>{configured ? t("nav.manageKeys") : t("nav.configureKeys")}</small>
        </div>
      </button>
      {menu && createPortal(
        <div
          className="account-menu"
          style={{ left: menu.left, bottom: menu.bottom }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              setMenu(undefined);
              onOpenSettings();
            }}
          >
            <Icon path="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15H2.8a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.2 8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4V3.8a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.6 1z" size={15} />
            <span>{t("menu.settings")}</span>
          </button>
          <div
            className={langOpen ? "account-menu-item has-sub open" : "account-menu-item has-sub"}
            onMouseEnter={() => setLangOpen(true)}
            onMouseLeave={() => setLangOpen(false)}
          >
            <button type="button" className={langOpen ? "on" : ""} onClick={() => setLangOpen((open) => !open)}>
              <Icon path="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z M2 12h20 M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" size={15} />
              <span>{t("menu.language")}</span>
              <Icon className="account-chevron" path="M9 18l6-6-6-6" size={14} />
            </button>
            {langOpen && (
              <div className="account-submenu">
                <button
                  type="button"
                  onClick={() => {
                    void setLocale("zh");
                    setMenu(undefined);
                    setLangOpen(false);
                  }}
                >
                  <span>{t("menu.langZh")}</span>
                  {locale === "zh" && <Icon className="account-check" path="M20 6L9 17l-5-5" size={15} />}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void setLocale("en");
                    setMenu(undefined);
                    setLangOpen(false);
                  }}
                >
                  <span>{t("menu.langEn")}</span>
                  {locale === "en" && <Icon className="account-check" path="M20 6L9 17l-5-5" size={15} />}
                </button>
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

export function App() {
  const { t, locale } = useI18n();
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
  const [queued, setQueued] = useState<Array<{ id: string; text: string; images?: string[] }>>([]);
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [toast, setToast] = useState<string>();
  const [uiRequest, setUiRequest] = useState<ExtensionUiRequest>();
  const [fullscreen, setFullscreen] = useState(false);
  const [openProjects, setOpenProjects] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<FileChange>();
  const [featureTodos, setFeatureTodos] = useState<SessionTodo[]>([]);
  const [agentSkills, setAgentSkills] = useState<AgentSkillCommand[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const agentCwd = useRef<string | undefined>(undefined);
  const sessionRef = useRef<string | undefined>(undefined);
  const sending = useRef(false);
  const holdQueue = useRef(false);
  const queuedRef = useRef(queued);
  queuedRef.current = queued;
  const stick = useRef(true);
  const dock = useRef<HTMLDivElement>(null);
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
  const suggestions = workspace
    ? [
        { label: t("suggest.explainRepo"), hint: t("suggest.hintStructure") },
        { label: t("suggest.findRiskiest"), hint: t("suggest.hintRiskFirst") },
        { label: t("suggest.addTests"), hint: t("suggest.hintCoverage") },
        { label: t("suggest.taskList"), hint: t("suggest.hintFeatures") },
      ]
    : [
        { label: t("suggest.openProject"), icon: "M3 7h6l2 2h10v10H3z", action: "open" as const },
        { label: t("suggest.explainArch"), hint: t("suggest.hintStructure") },
        { label: t("suggest.findBugs"), hint: t("suggest.hintRisk") },
        { label: t("suggest.writeTests"), hint: t("suggest.hintCoverage") },
      ];

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
    setAgentSkills(snapshot.skills ?? []);
  }, []);

  const refreshAgentSkills = useCallback(async () => {
    if (!agentCwd.current) {
      setAgentSkills([]);
      return;
    }
    try {
      const data = await window.harness.agent.command<{ commands: Array<{ name: string; description?: string; source?: string }> }>("get_commands");
      setAgentSkills(parseSkillCommands(data.commands));
    } catch {
      setAgentSkills([]);
    }
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

  const startAgent = useCallback(async (
    cwd?: string,
    sessionPath?: string,
    asProject = false,
    resume = false,
    mode = permission,
    seedMessage?: ChatMessage,
  ) => {
    setLoading(true);
    setUiRequest(undefined);
    let accounts: ProviderStatus[];
    try {
      accounts = await window.harness.auth.status();
    } catch (error) {
      setToast(friendlyAgentError(error));
      setLoading(false);
      return false;
    }
    setProviders(accounts);
    const chat = accounts.find((item) => item.id === "deepseek");
    if (!chat?.configured) {
      setLoginOpen(true);
      setToast(t("toast.fillConfig"));
      setLoading(false);
      return false;
    }
    if (!seedMessage && !resume) {
      setQueued([]);
      holdQueue.current = false;
    }
    const modelId = modelRef.current.trim() || chat.defaultModel;
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
      ? (mode === "full" || confirmUnsandboxedProject(cwd, t("confirm.unsandboxed", { cwd: cwd ?? "" })) ? "danger-full-access" : "workspace-write")
      : "read-only";
    if (asProject && sandbox !== "danger-full-access" && window.harness.platform !== "darwin") {
      setLoading(false);
      setToast(t("toast.sandboxCancelled"));
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
      setAgentSkills(snapshot.skills ?? []);
      if (seedMessage) {
        setMessages([...normalizeMessages(snapshot.messages), seedMessage]);
        setStats(snapshot.stats);
        setRunning(true);
      } else {
        hydrate(snapshot);
      }
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
      void refreshAgentSkills();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/Agent session closed/.test(message)) setToast(friendlyAgentError(error));
      if (/not configured|credential|login|api key/i.test(message)) setLoginOpen(true);
      return false;
    } finally {
      setLoading(false);
    }
  }, [hydrate, permission, refreshAgentSkills, t]);

  const bindProject = useCallback(async (cwd: string): Promise<boolean> => {
    if (running && agentCwd.current && agentCwd.current !== cwd) {
      setToast(t("toast.agentBusySwitch"));
      return false;
    }
    if (running && agentCwd.current === cwd) return true;
    live.current = false;
    setWorkspace(cwd);
    setOpenProjects((current) => ({ ...current, [cwd]: true }));
    setMessages([]);
    setStats(undefined);
    setDraft("");
    setQueued([]);
    setActiveSession(undefined);
    sessionRef.current = undefined;
    setRunning(false);
    setUiRequest(undefined);
    setPreview(undefined);
    setFeatureTodos([]);
    setAgentSkills([]);
    if (!agentCwd.current) return true;
    agentCwd.current = undefined;
    if (!running) await window.harness.agent.stop().catch(() => undefined);
    return true;
  }, [running, t]);
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
    setQueued([]);
    setRunning(false);
    setUiRequest(undefined);
    setPreview(undefined);
    setFeatureTodos([]);
    setAgentSkills([]);
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
      setQueued([]);
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
    setQueued([]);
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
        setToast(t("toast.noActiveSession"));
        return;
      }
    }
    try {
      const log = await window.harness.agent.command<{ entries: Parameters<typeof lastTurnRestoreFiles>[0] }>("get_entries");
      const files = lastTurnRestoreFiles(log.entries ?? []);
      if (files.length === 0) {
        setToast(t("toast.nothingToUndo"));
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
  }, [running, startAgent, t, workspace]);

  const compactContext = useCallback(async () => {
    if (running) {
      setToast(t("toast.waitBeforeCompact"));
      return;
    }
    if (!agentCwd.current && !workspace && !sessionRef.current) {
      setToast(t("toast.nothingToCompact"));
      return;
    }
    if (!agentCwd.current) {
      const started = await startAgent(workspace, sessionRef.current, true, true);
      if (!started) {
        setToast(t("toast.noCompactSession"));
        return;
      }
    }
    setLoading(true);
    setToast(t("toast.compacting"));
    try {
      const result = await window.harness.agent.command<{ tokensBefore?: number; summary?: string }>("compact");
      const [history, nextStats] = await Promise.all([
        window.harness.agent.command<{ messages: unknown[] }>("get_messages"),
        window.harness.agent.command<AgentSessionStats>("get_session_stats"),
      ]);
      setMessages(normalizeMessages(history.messages));
      setStats(nextStats);
      setToast(
        result.tokensBefore
          ? t("toast.compactDoneTokens", { tokens: result.tokensBefore.toLocaleString(locale === "en" ? "en-US" : "zh-CN") })
          : t("toast.compactDone"),
      );
      void window.harness.sessions.list().then(setSessions);
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      if (/nothing to compact|session too small/i.test(raw)) {
        setToast(t("toast.compactTooShort"));
      } else if (/no workspace session|not active|no agent/i.test(raw)) {
        setToast(t("toast.noCompactSession"));
      } else {
        setToast(t("toast.compactFailed", {
          error: raw.replace(/^Error invoking remote method 'agent:command':\s*/i, "").replace(/^Error:\s*/i, ""),
        }));
      }
    } finally {
      setLoading(false);
    }
  }, [locale, running, startAgent, t, workspace]);

  const sendMessage = useCallback(async (preset?: string, images?: string[]) => {
    const text = (preset ?? draft).trim();
    if (text === "/undo") {
      if (running) return;
      setDraft("");
      void undoLastTurn();
      return;
    }
    if ((!text && !images?.length) || loading || sending.current) return;
    holdQueue.current = false;
    if (running) {
      if (text.startsWith("/")) return;
      if (queuedRef.current.length >= 5) {
        setToast(t("composer.queueFull"));
        return;
      }
      setQueued((current) => [...current, {
        id: `q-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        text: text || t("toast.defaultImagePrompt"),
        images,
      }]);
      setDraft("");
      return;
    }
    sending.current = true;
    const question = text || t("toast.defaultImagePrompt");
    const thumbs = (images ?? []).map((item) => {
      const match = item.match(/^data:([^;]+);base64,(.+)$/);
      return {
        mimeType: match?.[1] ?? "image/png",
        data: match?.[2] ?? item.replace(/^data:[^;]+;base64,/, ""),
      };
    });
    let optimistic: ChatMessage | undefined;
    try {
      let cwd = workspace ?? agentCwd.current;
      if (!cwd) {
        const opened = await openFolder();
        if (!opened) return;
        cwd = opened;
      }

      // Paint the user turn immediately so first-send doesn't sit on the home screen.
      optimistic = optimisticUserMessage(question, false, thumbs);
      setDraft("");
      setMessages((current) => [...current, optimistic!]);
      setRunning(true);

      if (!agentCwd.current) {
        const started = await startAgent(cwd, undefined, true, false, permission, optimistic);
        if (!started) {
          setMessages((current) => current.filter((item) => item.id !== optimistic!.id));
          setDraft(text);
          setRunning(false);
          return;
        }
      }

      const message = images?.length
        ? visionAgentPrompt(question, await window.harness.vision.stage(images))
        : question;
      await window.harness.agent.command("prompt", { message });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const optimisticId = optimistic?.id;
      if (optimisticId) setMessages((current) => current.filter((item) => item.id !== optimisticId));
      setDraft(text);
      setRunning(false);
      if (!/Agent session closed/.test(detail)) setToast(friendlyAgentError(error));
    } finally {
      sending.current = false;
    }
  }, [draft, loading, openFolder, permission, running, startAgent, t, undoLastTurn, workspace]);

  useEffect(() => {
    if (holdQueue.current || running || loading || queued.length === 0 || sending.current) return;
    const [job, ...rest] = queued;
    if (!job) return;
    setQueued(rest);
    void sendMessage(job.text, job.images);
  }, [loading, queued, running, sendMessage]);

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
      if (event.type === "extension_error" && typeof event.error === "string") setToast(friendlyAgentError(event.error));
      if (event.type === "tool_execution_end" && event.isError === true) {
        const detail = typeof event.result === "string" ? event.result : JSON.stringify(event.result ?? "");
        if (/read-only|permission denied|not permitted|sandbox/i.test(detail)) {
          setToast(t("toast.readOnlySession"));
        }
      }
      if (event.type === "extension_ui_request") {
        const request = event as ExtensionUiRequest;
        if (request.method === "notify") setToast(request.message ?? t("toast.notify"));
        else if (["select", "confirm", "input", "editor"].includes(request.method)) setUiRequest(request);
      }
      setMessages((current) => (live.current ? applyAgentEvent(current, event) : current));
    });
    const offError = window.harness.agent.onError((message) => {
      if (!live.current) return;
      if (/Agent session closed/.test(message)) return;
      setRunning(false);
      setToast(friendlyAgentError(message));
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
  }, [newThread, openFolder, t, workspace]);

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

  const home = groups.length === 0;

  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node || home) return;

    const pin = () => {
      const overlay = dock.current?.offsetHeight ?? 0;
      if (overlay > 0) node.style.setProperty("--dock-clearance", `${overlay + 24}px`);
      if (stick.current) node.scrollTop = node.scrollHeight;
    };

    const content = node.querySelector(".messages");
    const ro = new ResizeObserver(pin);
    if (content) ro.observe(content);
    if (dock.current) ro.observe(dock.current);
    pin();
    return () => ro.disconnect();
  }, [home, queued.length]);

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
        holdQueue.current = true;
        void window.harness.agent.command("abort").catch(() => undefined);
      }}
      queued={queued}
      onEditQueue={(id) => {
        const item = queued.find((entry) => entry.id === id);
        if (!item) return;
        setDraft(item.text);
        setQueued((current) => current.filter((entry) => entry.id !== id));
      }}
      onDropQueue={(id) => setQueued((current) => current.filter((entry) => entry.id !== id))}
      onSendQueue={(id) => {
        const item = queued.find((entry) => entry.id === id);
        if (!item) return;
        if (running || sending.current) {
          setQueued((current) => [item, ...current.filter((entry) => entry.id !== id)]);
          return;
        }
        holdQueue.current = false;
        setQueued((current) => current.filter((entry) => entry.id !== id));
        void sendMessage(item.text, item.images);
      }}
      rootRef={dock}
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
          if (ok) setToast(mode === "full" ? t("toast.sandboxOff") : t("toast.sessionRestarted"));
        })();
      }}
      onCommand={(command) => {
        if (command === "/new") void newThread();
        if (command === "/open") void openFolder();
        if (command === "/undo") void undoLastTurn();
        if (command === "/compact") void compactContext();
        if (command === "/login") setLoginOpen(true);
      }}
      skillCommands={agentSkills}
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
          <AccountMenu
            model={model}
            configured={Boolean(connected?.configured)}
            onOpenSettings={() => setLoginOpen(true)}
          />
        )}
      >
        <div className="section-label">{t("nav.sectionProjects")}</div>
        {projects.length === 0 && <p className="sidebar-empty">{t("nav.noProjects")}</p>}
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
                aria-label={t("nav.removeProject")}
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
                  {threads.length === 0 && <p className="task-empty">{t("nav.noThreads")}</p>}
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
        title={sessions.find((session) => isSameSession(session, activeSession))?.title || (workspace ? baseName(workspace) : undefined)}
        composer={home ? undefined : composer}
        nav={<TurnNav items={anchors} />}
        inspect={workspace ? (
          <InspectPanel
            files={workingFiles}
            todos={todos}
            folder={baseName(workspace)}
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
                <h1>{workspace ? baseName(workspace) : t("home.greeting")}</h1>
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
                    <span>{t("nav.recentActive")}</span>
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
                        <span>{session.title || t("common.unnamedSession")}</span>
                      </div>
                      <small>{relativeTime(session.updatedAt, t)}</small>
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
                    <Thinking
                      text=""
                      work={[]}
                      tools={[]}
                      live
                      label={loading ? t("think.starting") : t("think.waiting")}
                    />
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
                  onDone={() => {
                    setUiRequest(undefined);
                    void refreshAgentSkills();
                  }}
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
            <span>{/unrestricted host filesystem/i.test(toast) ? t("toast.hostAccessAllowed") : toast}</span>
          </button>
        )}
      </Chat>

      {loginOpen && (
        <Login
          configured={Boolean(connected?.configured)}
          model={model}
          baseUrl={connected?.baseUrl}
          agentSkills={agentSkills}
          onRefreshSkills={() => void refreshAgentSkills()}
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
