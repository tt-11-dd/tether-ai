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
import {
  DEFAULT_EFFORT,
  levelsForModel,
  normalizeEffort,
  readStoredEffort,
  writeStoredEffort,
} from "../shared/thinking";
import { modelSupportsVision, toPromptImages, visionAgentPrompt } from "../shared/vision-api";
import {
  applyAgentEvent,
  baseName,
  collectTodos,
  collectWorkingFiles,
  dropLastTurn,
  finalizeInterruptedTurn,
  friendlyAgentError,
  isTransientStreamError,
  assistantErrorRecovered,
  assistantGroupHasRecoverableError,
  assistantGroupSucceeded,
  assistantReplyText,
  groupConversation,
  recoverableFailStreaks,
  lastTurnRestoreFiles,
  mentionedFiles,
  normalizeMessages,
  optimisticUserMessage,
  parseFeaturesJson,
  planAwaitingApproval,
  sessionTools,
  sessionTerminals,
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
  Dots,
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
function rememberUnsandboxed(cwd: string): void {
  const remembered = allowedProjects();
  if (remembered.has(cwd)) return;
  localStorage.setItem(SANDBOX_OK_KEY, JSON.stringify([...remembered, cwd]));
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
  const [effort, setEffort] = useState(readStoredEffort);
  const [thinkingLevels, setThinkingLevels] = useState<string[]>(["low", "medium", "high", "max"]);
  const [permission, setPermission] = useState<PermissionMode>("auto");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [stats, setStats] = useState<AgentSessionStats>();
  const [promptFill, setPromptFill] = useState({ text: "", token: 0 });
  const fillPrompt = useCallback((text: string) => {
    setPromptFill((current) => ({ text, token: current.token + 1 }));
  }, []);
  const [steering, setSteering] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [sandboxAsk, setSandboxAsk] = useState<{ cwd: string; message: string }>();
  const sandboxWaiter = useRef<((ok: boolean) => void) | undefined>(undefined);
  const [toast, setToast] = useState<string>();
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(undefined), 5000);
    return () => window.clearTimeout(id);
  }, [toast]);
  const [uiRequest, setUiRequest] = useState<ExtensionUiRequest>();
  const [fullscreen, setFullscreen] = useState(false);
  const [openProjects, setOpenProjects] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<FileChange>();
  const [featureTodos, setFeatureTodos] = useState<SessionTodo[]>([]);
  const [agentSkills, setAgentSkills] = useState<AgentSkillCommand[]>([]);
  const [stoppedJobs, setStoppedJobs] = useState<string[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const agentCwd = useRef<string | undefined>(undefined);
  const sessionRef = useRef<string | undefined>(undefined);
  const sending = useRef(false);
  const stick = useRef(true);
  const dock = useRef<HTMLDivElement>(null);
  const live = useRef(false);
  const pendingUndo = useRef<{ files: RestoreFile[] } | undefined>(
    undefined,
  );
  const modelRef = useRef(model);
  modelRef.current = model;
  const chatModelsRef = useRef(chatModels);
  chatModelsRef.current = chatModels;
  const effortRef = useRef(effort);
  effortRef.current = effort;
  const agentModelIdsRef = useRef<string[]>([]);
  const agentModelsRef = useRef<AgentSnapshot["models"]>([]);
  const startSeq = useRef(0);
  const permissionBeforePlan = useRef<Exclude<PermissionMode, "plan">>("auto");

  const applyThinkingForModel = useCallback((modelId: string) => {
    const levels = levelsForModel(modelId, agentModelsRef.current);
    setThinkingLevels(levels);
    const next = normalizeEffort(effortRef.current, levels);
    effortRef.current = next;
    setEffort(next);
    writeStoredEffort(next);
  }, []);

  const syncAgentThinking = useCallback(async () => {
    if (!agentCwd.current) return;
    try {
      const [levelsResp, stateResp] = await Promise.all([
        window.harness.agent.command<{ levels: string[] }>("get_available_thinking_levels"),
        window.harness.agent.command<{ thinkingLevel?: string; model?: { id?: string } }>("get_state"),
      ]);
      const levels = Array.isArray(levelsResp?.levels) ? levelsResp.levels : ["off"];
      setThinkingLevels(levels);
      const activeLevel = typeof stateResp?.thinkingLevel === "string"
        ? stateResp.thinkingLevel
        : effortRef.current;
      const next = normalizeEffort(activeLevel, levels);
      effortRef.current = next;
      setEffort(next);
      writeStoredEffort(next);
      if (typeof stateResp?.model?.id === "string" && stateResp.model.id) {
        setModel(stateResp.model.id);
        modelRef.current = stateResp.model.id;
      }
      await window.harness.agent.command("set_thinking_level", { level: next }).catch(() => undefined);
    } catch {
      // Agent may not be ready yet.
    }
  }, []);

  const applyEffort = useCallback((next: string) => {
    effortRef.current = next;
    setEffort(next);
    writeStoredEffort(next);
    void window.harness.agent.command("set_thinking_level", { level: next }).catch(() => undefined);
  }, []);

  const groups = useMemo(() => groupConversation(messages), [messages]);
  const recoverableStreaks = useMemo(() => recoverableFailStreaks(groups), [groups]);
  const anchors = useMemo(() => turnAnchors(groups), [groups]);
  const tools = useMemo(() => sessionTools(messages), [messages]);
  const terminals = useMemo(
    () => sessionTerminals(messages).filter((job) => !stoppedJobs.includes(job.id)),
    [messages, stoppedJobs],
  );
  const workingFiles = useMemo(() => collectWorkingFiles(tools, mentionedFiles(messages)), [messages, tools]);
  const chatTodos = useMemo(() => collectTodos(messages), [messages]);
  const todos = chatTodos.length ? chatTodos : featureTodos;
  const planApproval = planAwaitingApproval(permission, running, todos);
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

  const refreshAgentSkills = useCallback(async () => {
    const loadDisk = () => window.harness.app.listSkills().catch(() => [] as AgentSkillCommand[]);
    if (!agentCwd.current) {
      setAgentSkills(await loadDisk());
      return;
    }
    try {
      const data = await window.harness.agent.command<{
        commands: Array<{
          name: string;
          description?: string;
          source?: string;
          sourceInfo?: { path?: string; baseDir?: string };
        }>;
      }>("get_commands");
      const fromAgent = parseSkillCommands(data.commands);
      if (fromAgent.length) {
        setAgentSkills(fromAgent);
        return;
      }
      setAgentSkills(await loadDisk());
    } catch {
      setAgentSkills(await loadDisk());
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

  const resolveSandbox = useCallback(async (asProject: boolean, mode: PermissionMode, cwd?: string) => {
    if (!asProject) return "read-only" as const;
    if (mode === "full") return "danger-full-access" as const;
    if (window.harness.platform === "darwin" || !cwd) return "workspace-write" as const;
    if (allowedProjects().has(cwd)) return "danger-full-access" as const;
    const ok = await new Promise<boolean>((resolve) => {
      sandboxWaiter.current = resolve;
      setSandboxAsk({ cwd, message: t("confirm.unsandboxed", { cwd }) });
    });
    setSandboxAsk(undefined);
    sandboxWaiter.current = undefined;
    if (ok) rememberUnsandboxed(cwd);
    return ok ? "danger-full-access" as const : "workspace-write" as const;
  }, [t]);

  const startAgent = useCallback(async (
    cwd?: string,
    sessionPath?: string,
    asProject = false,
    resume = false,
    mode = permission,
    seedMessage?: ChatMessage,
    storagePath?: string,
  ) => {
    const seq = ++startSeq.current;
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
    if (seq !== startSeq.current) return false;
    setProviders(accounts);
    const chat = accounts.find((item) => item.id === "deepseek");
    if (!chat?.configured) {
      setLoginOpen(true);
      setToast(t("toast.fillConfig"));
      setLoading(false);
      return false;
    }
    if (!seedMessage && !resume) {
      setSteering([]);
      // Opening a thread: clear the pane so we don't keep showing the welcome/home shell.
      if (sessionPath) {
        setMessages([]);
        setActiveSession(sessionPath);
        sessionRef.current = sessionPath;
      }
    }
    const modelId = modelRef.current.trim() || chat.defaultModel;
    const extraModels = [...new Set([modelId, ...chatModelsRef.current].filter(Boolean))];
    if (!resume) {
      if (cwd) {
        setWorkspace(cwd);
        setOpenProjects((current) => ({ ...current, [cwd]: true }));
      } else {
        setWorkspace(undefined);
      }
    }
    const sandbox = await resolveSandbox(asProject, mode, cwd);
    if (seq !== startSeq.current) return false;
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
        effort: effortRef.current || DEFAULT_EFFORT,
        permission: mode,
        sandbox,
        ...(mode === "auto" || mode === "full" ? { network: true } : {}),
        ...(sessionPath ? { sessionPath } : {}),
        ...(storagePath ? { storagePath } : {}),
        ...(resume ? { resume: true } : {}),
        ...(extraModels.length ? { extraModels } : {}),
      });
      if (seq !== startSeq.current) return false;
      if (seedMessage) {
        setMessages([...normalizeMessages(snapshot.messages), seedMessage]);
        setStats(snapshot.stats);
        setAgentSkills(snapshot.skills ?? []);
        setRunning(true);
      } else {
        const raw = normalizeMessages(snapshot.messages);
        const hadRunning = Boolean(raw.at(-1)?.tools.some((tool) => tool.status === "running"));
        const next = resume ? finalizeInterruptedTurn(raw) : raw;
        setMessages(next);
        setStats(snapshot.stats);
        setRunning(Boolean(snapshot.state.isStreaming) && !hadRunning);
        setAgentSkills(snapshot.skills ?? []);
        if (resume && hadRunning) setToast(t("toast.sessionInterrupted"));
        if (sessionPath && next.length === 0) {
          setToast(t("toast.sessionEmpty"));
        }
      }
      live.current = true;
      agentCwd.current = snapshot.cwd ?? cwd ?? agentCwd.current;
      agentModelsRef.current = snapshot.models ?? [];
      agentModelIdsRef.current = agentModelsRef.current.map((item) => item.id).filter(Boolean);
      if (modelId) {
        setModel(modelId);
        await window.harness.agent.command("set_model", { provider: "deepseek", modelId }).catch(() => undefined);
      }
      applyThinkingForModel(modelId);
      const nextEffort = effortRef.current;
      await window.harness.agent.command("set_thinking_level", { level: nextEffort }).catch(() => undefined);
      await window.harness.agent.command("set_auto_compaction", { enabled: true }).catch(() => undefined);
      if (seq !== startSeq.current) return false;
      const file = sessionFileOf(snapshot) ?? sessionPath;
      if (file) {
        sessionRef.current = file;
        setActiveSession(file);
      }
      void window.harness.sessions.list().then(setSessions);
      void refreshAgentSkills();
      return true;
    } catch (error) {
      if (seq !== startSeq.current) return false;
      const message = error instanceof Error ? error.message : String(error);
      // Session switch kills the previous agent; still tell the user when open failed.
      if (sessionPath) {
        setToast(t("toast.sessionOpenFailed", { error: friendlyAgentError(error) }));
      } else if (!/Agent session closed/.test(message)) {
        setToast(friendlyAgentError(error));
      }
      if (/not configured|credential|login|api key/i.test(message)) setLoginOpen(true);
      return false;
    } finally {
      if (seq === startSeq.current) setLoading(false);
    }
  }, [applyThinkingForModel, permission, refreshAgentSkills, resolveSandbox, t]);

  const openSession = useCallback((session: SessionSummary) => {
    // Allow re-open when the row is highlighted but the transcript failed to load.
    if (isSameSession(session, activeSession) && messages.length > 0 && !loading) return;
    void startAgent(session.cwd, session.path, true, false, permission, undefined, session.storagePath);
  }, [activeSession, loading, messages.length, permission, startAgent]);

  const ensureModelReady = useCallback(async (): Promise<boolean> => {
    if (!agentCwd.current) return true;
    const next = modelRef.current.trim();
    if (!next) return true;
    if (agentModelIdsRef.current.includes(next)) {
      try {
        await window.harness.agent.command("set_model", { provider: "deepseek", modelId: next });
        await syncAgentThinking();
        return true;
      } catch (error) {
        setToast(friendlyAgentError(error));
        return false;
      }
    }
    await window.harness.agent.stop().catch(() => undefined);
    return startAgent(workspace, sessionRef.current, Boolean(workspace), true);
  }, [startAgent, syncAgentThinking, workspace]);

  const switchModel = useCallback((next: string) => {
    setModel(next);
    modelRef.current = next;
    applyThinkingForModel(next);
    if (agentCwd.current && agentModelIdsRef.current.includes(next)) {
      void window.harness.agent.command("set_model", { provider: "deepseek", modelId: next })
        .then(() => syncAgentThinking())
        .catch(() => undefined);
    }
    setToast(agentCwd.current ? t("toast.modelNextTurn", { model: next }) : t("toast.modelSwitched", { model: next }));
  }, [applyThinkingForModel, syncAgentThinking, t]);

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
    fillPrompt("");
    setSteering([]);
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
  }, [fillPrompt, running, t]);
  const openFolder = useCallback(async () => {
    const selected = await window.harness.workspace.choose();
    if (!selected) return;
    if (!(await bindProject(selected))) return null;
    setWorkspaces(await window.harness.workspace.recent());
    return selected;
  }, [bindProject]);

  const newThread = useCallback(async () => {
    live.current = false;
    setWorkspace(undefined);
    setMessages([]);
    setStats(undefined);
    fillPrompt("");
    setSteering([]);
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
  }, [fillPrompt]);

  const removeSession = useCallback(async (session: SessionSummary) => {
    if (isSameSession(session, activeSession)) {
      live.current = false;
      // Abort + stop the RPC tree so Seatbelt shells / background jobs die with the thread.
      if (agentCwd.current) {
        await window.harness.agent.command("abort").catch(() => undefined);
        await window.harness.agent.stop().catch(() => undefined);
        agentCwd.current = undefined;
      }
      setMessages([]);
      setStats(undefined);
      setSteering([]);
      setActiveSession(undefined);
      sessionRef.current = undefined;
      setRunning(false);
      setUiRequest(undefined);
      setStoppedJobs([]);
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
    setSteering([]);
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

  const stopJobs = useCallback(async (message: string) => {
    const data = await window.harness.agent.command<{ commands: Array<{ name: string }> }>("get_commands");
    const names = new Set((data.commands ?? []).map((item) => item.name.replace(/^\//, "")));
    if (!names.has("stop-job") && !names.has("stop-jobs")) throw new Error(t("toast.needJobCommands"));
    await window.harness.agent.command("prompt", { message });
  }, [t]);

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

  const approvePlan = useCallback(async () => {
    if (loading || running) return;
    const target = permissionBeforePlan.current;
    setLoading(true);
    try {
      await window.harness.agent.command("prompt", { message: "/plan execute" });
      setPermission(target);
      setToast(t("plan.approved"));
    } catch (error) {
      setToast(friendlyAgentError(error));
    } finally {
      setLoading(false);
    }
  }, [loading, running, t]);

  const refinePlan = useCallback(async (changes: string) => {
    const text = changes.trim();
    if (!text || loading || running) return;
    setLoading(true);
    try {
      await window.harness.agent.command("prompt", {
        message: `Refine the current plan using update_plan. Requested changes:\n${text}`,
      });
    } catch (error) {
      setToast(friendlyAgentError(error));
    } finally {
      setLoading(false);
    }
  }, [loading, running]);

  const sendMessage = useCallback(async (preset?: string, images?: string[]) => {
    const text = (preset ?? "").trim();
    if (text === "/undo") {
      if (running) return;
      fillPrompt("");
      void undoLastTurn();
      return;
    }
    if ((!text && !images?.length) || loading || sending.current) return;
    if (running) {
      if (text.startsWith("/")) return;
      const followup = text || t("toast.defaultImagePrompt");
      fillPrompt("");
      try {
        const payload: Record<string, unknown> = { message: followup };
        if (images?.length) payload.images = toPromptImages(images);
        await window.harness.agent.command("steer", payload);
        setSteering((current) => (current.includes(followup) ? current : [...current, followup]));
        setToast(t("toast.steered"));
      } catch (error) {
        fillPrompt(text);
        setToast(friendlyAgentError(error));
      }
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
      fillPrompt("");
      setMessages((current) => [...current, optimistic!]);
      setRunning(true);

      if (!agentCwd.current) {
        const started = await startAgent(cwd, undefined, true, false, permission, optimistic);
        if (!started) {
          setMessages((current) => current.filter((item) => item.id !== optimistic!.id));
          fillPrompt(text);
          setRunning(false);
          return;
        }
      } else if (!(await ensureModelReady())) {
        setMessages((current) => current.filter((item) => item.id !== optimistic!.id));
        fillPrompt(text);
        setRunning(false);
        return;
      }

      if (!images?.length) {
        await window.harness.agent.command("prompt", { message: question });
      } else if (modelSupportsVision(modelRef.current)) {
        try {
          await window.harness.agent.command("prompt", {
            message: question,
            images: toPromptImages(images),
          });
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          // Model declared vision but API rejected images — fall back to dedicated vision tool.
          if (!/does not support image|image input|unsupported.*image|invalid.*image/i.test(detail)) {
            throw error;
          }
          const message = visionAgentPrompt(question, await window.harness.vision.stage(images));
          await window.harness.agent.command("prompt", { message });
        }
      } else {
        const message = visionAgentPrompt(question, await window.harness.vision.stage(images));
        await window.harness.agent.command("prompt", { message });
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const optimisticId = optimistic?.id;
      if (optimisticId) setMessages((current) => current.filter((item) => item.id !== optimisticId));
      fillPrompt(text);
      setRunning(false);
      if (!/Agent session closed/.test(detail)) setToast(friendlyAgentError(error));
    } finally {
      sending.current = false;
    }
  }, [ensureModelReady, fillPrompt, loading, openFolder, permission, running, startAgent, t, undoLastTurn, workspace]);

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
      if (event.type === "desktop_snapshot_meta") {
        if (Array.isArray(event.models)) {
          agentModelsRef.current = event.models as typeof agentModelsRef.current;
          agentModelIdsRef.current = agentModelsRef.current.map((item) => item.id).filter(Boolean);
        }
        if (Array.isArray(event.skills)) setAgentSkills(event.skills as AgentSkillCommand[]);
        if (event.stats && typeof event.stats === "object") setStats(event.stats as AgentSessionStats);
      }
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
      if (event.type === "queue_update") {
        const nextSteering = Array.isArray(event.steering)
          ? event.steering.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
          : [];
        setSteering(nextSteering);
      }
      if (event.type === "extension_error" && typeof event.error === "string" && !isTransientStreamError(event.error)) {
        const text = friendlyAgentError(event.error);
        if (text) setToast(text);
      }
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
      if (/Agent session closed/.test(message) || isTransientStreamError(message)) return;
      setRunning(false);
      setMessages((current) => finalizeInterruptedTurn(current));
      const text = friendlyAgentError(message);
      if (text) setToast(text);
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
    const timer = window.setTimeout(() => {
      void window.harness.workspace.read(".agents/features.json", workspace).then(
        (result) => {
          if (!gone) setFeatureTodos(result.binary ? [] : parseFeaturesJson(result.content));
        },
        () => {
          if (!gone) setFeatureTodos([]);
        },
      );
    }, running ? 800 : 0);
    return () => {
      gone = true;
      window.clearTimeout(timer);
    };
  }, [workspace, running, workingFiles.length]);

  const home = groups.length === 0 && !activeSession && !loading;

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
  }, [home, steering.length]);

  const homeRecents = (
    workspace
      ? projects.find((item) => item.item.path === workspace)?.sessions ?? []
      : projects.flatMap((item) => item.sessions).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  ).slice(0, 5);
  const composer = (
    <PromptBar
      fillText={promptFill.text}
      fillToken={promptFill.token}
      onSubmit={(text, images) => void sendMessage(text, images)}
      onStop={() => {
        setToast(t("toast.stopping"));
        void window.harness.agent.command("abort")
          .catch(() => undefined)
          .finally(() => {
            setRunning(false);
          });
      }}
      steering={steering}
      rootRef={dock}
      running={running}
      disabled={loading}
      workspace={workspace}
      onPickWorkspace={() => void openFolder()}
      model={model}
      models={[...new Set([model, ...chatModels].filter(Boolean))].map((id) => ({ value: id, label: id }))}
      onModel={switchModel}
      effort={effort}
      effortLevels={thinkingLevels}
      onEffort={applyEffort}
      permission={permission}
      onPermission={(next) => {
        const mode = next as PermissionMode;
        if (mode === "plan" && permission !== "plan") {
          permissionBeforePlan.current = permission;
        }
        setPermission(mode);
        if (!agentCwd.current) return;
        void (async () => {
          try {
            await window.harness.agent.command("prompt", { message: `/permissions ${mode}` });
            setToast(mode === "full" ? t("toast.sandboxOff") : t("toast.permissionChanged"));
          } catch (error) {
            setToast(friendlyAgentError(error));
          }
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
      onCompact={() => void compactContext()}
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
                      onOpen={() => openSession(session)}
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
            terminals={terminals}
            folder={baseName(workspace)}
            workspace={workspace}
            refresh={running}
            running={running}
            planApproval={planApproval}
            onApprovePlan={() => void approvePlan()}
            onRefinePlan={(text) => void refinePlan(text)}
            onOpen={setPreview}
            onUndo={() => void undoLastTurn()}
            onStopTerminal={(id) => {
              setStoppedJobs((current) => current.includes(id) ? current : [...current, id]);
              void stopJobs(`/stop-job ${id}`).catch((error) => {
                setStoppedJobs((current) => current.filter((item) => item !== id));
                setToast(error instanceof Error ? error.message : String(error));
              });
            }}
            onStopAllTerminals={() => {
              const ids = terminals.map((job) => job.id);
              setStoppedJobs((current) => [...new Set([...current, ...ids])]);
              void stopJobs("/stop-jobs").catch((error) => {
                setStoppedJobs((current) => current.filter((item) => !ids.includes(item)));
                setToast(error instanceof Error ? error.message : String(error));
              });
            }}
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
                      onClick={() => openSession(session)}
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
          {!home && groups.length === 0 && (
            <div className={loading ? "session-pane loading" : "session-pane"}>
              {loading ? (
                <div className="session-loading" role="status" aria-live="polite">
                  <Dots />
                  <span className="shimmer">{t("chat.loadingSession")}</span>
                </div>
              ) : (
                <p className="session-pane-empty">{t("chat.emptySession")}</p>
              )}
            </div>
          )}
          {groups.length > 0 && (
            <div className="messages">
              {groups.map((group, index) => {
                if (group.type === "user") {
                  return (
                    <UserTurn
                      key={group.id}
                      anchor={turnAnchorId(group.id)}
                      text={group.message.text}
                      images={group.message.images}
                    />
                  );
                }
                const recovered = assistantErrorRecovered(group.messages, groups, index);
                const isLastGroup = index === groups.length - 1;
                const showRetry = !running && isLastGroup
                  && assistantGroupHasRecoverableError(group.messages)
                  && !recovered
                  && !assistantGroupSucceeded(group.messages);
                return (
                  <AssistantTurn
                    key={group.id}
                    messages={group.messages}
                    errorRecovered={recovered}
                    recoverableFailStreak={recoverableStreaks[index] ?? 0}
                    onOpenFile={setPreview}
                    onRetry={showRetry ? () => {
                      void sendMessage(t("composer.retryContinue"));
                    } : undefined}
                  />
                );
              })}
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
                  }}
                  onError={setToast}
                />
              )}
            </div>
          )}
        </div>
        {toast && (
          <button type="button" className="toast" onClick={() => setToast(undefined)}>
            <Icon path="M9 18h6M10 22h4M12 2a7 7 0 0 1 4 12c-.8.8-1 1.5-1 3H9c0-1.5-.2-2.2-1-3A7 7 0 0 1 12 2z" size={16} />
            <span>{/unrestricted host filesystem/i.test(toast) ? t("toast.hostAccessAllowed") : toast}</span>
          </button>
        )}
      </Chat>
      {preview && <FileDrawer file={preview} workspace={workspace} onClose={() => setPreview(undefined)} />}

      {sandboxAsk && (
        <div
          className="modal"
          onClick={(event) => {
            if (event.target !== event.currentTarget) return;
            sandboxWaiter.current?.(false);
          }}
        >
          <div className="panel" role="dialog">
            <h2>{t("confirm.unsandboxedTitle")}</h2>
            <p>{sandboxAsk.message}</p>
            <div className="row-actions">
              <button type="button" className="ghost" onClick={() => sandboxWaiter.current?.(false)}>{t("common.cancel")}</button>
              <button type="button" className="primary" onClick={() => sandboxWaiter.current?.(true)}>{t("common.allow")}</button>
            </div>
          </div>
        </div>
      )}
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
              applyThinkingForModel(nextModel);
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
