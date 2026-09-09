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
  ConversationSkeleton,
  Dots,
  FileDrawer,
  Icon,
  InspectPanel,
  Login,
  MAX_STEER_ROWS,
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

function isSamePath(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  try {
    return a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase();
  } catch {
    return false;
  }
}

function isSameSession(session: SessionSummary, active?: string) {
  return Boolean(
    active &&
      (session.id === active ||
        session.path === active ||
        isSamePath(session.path, active) ||
        isSamePath(session.storagePath, active)),
  );
}

function isSessionInSet(session: SessionSummary, set: Set<string>): boolean {
  for (const item of set) {
    if (
      session.id === item ||
      session.path === item ||
      isSamePath(session.path, item) ||
      isSamePath(session.storagePath, item) ||
      (item && (item.endsWith(`/${session.id}.jsonl`) || item.endsWith(`\\${session.id}.jsonl`)))
    ) {
      return true;
    }
  }
  return false;
}

const PIN_ICON =
  "M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 1z";
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
  running,
  onOpen,
  onPin,
  onRename,
  onRemove,
}: {
  session: SessionSummary;
  active: boolean;
  running?: boolean;
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
          <span className="session-title">{session.title || t("common.unnamed")}</span>
          {running && (
            <span className="session-running-badge" title={t("terminal.running")}>
              <span className="session-running-dot" />
            </span>
          )}
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

interface SessionCacheItem {
  messages: ChatMessage[];
  running: boolean;
  stats?: AgentSessionStats;
  queued: Array<{ text: string; images?: string[] }>;
  uiRequest?: ExtensionUiRequest;
  agentSkills?: AgentSkillCommand[];
  cwd?: string;
  queueHeld?: boolean;
  draft?: string;
}

export function App() {
  const { t, locale } = useI18n();
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const diskSessionsRef = useRef<SessionSummary[]>([]);
  const optimisticSessionsRef = useRef<Map<string, SessionSummary>>(new Map());

  const updateSessions = useCallback((diskSessions?: SessionSummary[]) => {
    if (diskSessions) diskSessionsRef.current = diskSessions;
    const disk = diskSessionsRef.current;
    const optimistic = optimisticSessionsRef.current;
    const merged: SessionSummary[] = [];
    for (const [key, opt] of optimistic.entries()) {
      const foundInDisk = disk.some(
        (d) =>
          d.id === key ||
          d.id === opt.id ||
          isSamePath(d.path, opt.path) ||
          isSamePath(d.storagePath, opt.storagePath) ||
          isSamePath(d.path, key) ||
          (opt.path && isSamePath(d.path, opt.path)),
      );
      if (!foundInDisk) {
        merged.push(opt);
      } else {
        optimistic.delete(key);
      }
    }
    setSessions([...merged, ...disk]);
  }, []);
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
  const [queued, setQueued] = useState<Array<{ text: string; images?: string[] }>>([]);
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
  const sessionStates = useRef<Map<string, SessionCacheItem>>(new Map());
  const [runningSessions, setRunningSessions] = useState<Set<string>>(new Set());
  const scroller = useRef<HTMLDivElement>(null);
  const agentCwd = useRef<string | undefined>(undefined);
  const sessionRef = useRef<string | undefined>(undefined);

  const reconcileOptimisticSession = useCallback((tempId: string, realPath: string) => {
    if (!tempId || !realPath || tempId === realPath) return;
    const opt = optimisticSessionsRef.current.get(tempId);
    if (opt) {
      opt.path = realPath;
      opt.storagePath = realPath;
      opt.id = realPath;
      optimisticSessionsRef.current.delete(tempId);
      optimisticSessionsRef.current.set(realPath, opt);
    }
    setRunningSessions((prev) => {
      const next = new Set(prev);
      next.delete(tempId);
      next.add(realPath);
      return next;
    });
    const cached = sessionStates.current.get(tempId);
    if (cached) {
      sessionStates.current.delete(tempId);
      sessionStates.current.set(realPath, cached);
    }
    if (sessionRef.current === tempId) sessionRef.current = realPath;
    setActiveSession((current) => (current === tempId ? realPath : current));
    updateSessions();
  }, [updateSessions]);

  const draftRef = useRef("");
  const saveCurrentSessionToCache = useCallback(() => {
    const key = sessionRef.current || activeSession;
    if (!key) return;
    const existing = sessionStates.current.get(key);
    sessionStates.current.set(key, {
      messages,
      running,
      stats,
      queued,
      uiRequest,
      agentSkills,
      cwd: agentCwd.current,
      queueHeld: existing?.queueHeld ?? queueHeld.current,
      draft: draftRef.current,
    });
  }, [activeSession, agentSkills, messages, queued, running, stats, uiRequest]);
  const sending = useRef(false);
  const queuedRef = useRef(queued);
  queuedRef.current = queued;
  const queueFlush = useRef(false);
  const queueHeld = useRef(false);
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
    const result = workspaces.map((item) => ({ item, sessions: [] as SessionSummary[] }));
    for (const session of sessions) {
      const match = result.find((p) => isSamePath(p.item.path, session.cwd));
      if (match) {
        match.sessions.push(session);
      } else if (workspace) {
        const activeMatch = result.find((p) => isSamePath(p.item.path, workspace));
        if (activeMatch && (!session.cwd || isSamePath(session.cwd, activeMatch.item.path))) {
          activeMatch.sessions.push(session);
        }
      }
    }
    return result;
  }, [sessions, workspaces, workspace]);

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
    updateSessions(threads);
    return status;
  }, [updateSessions]);

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
    targetTempId?: string,
  ) => {
    const seq = ++startSeq.current;
    if (!seedMessage) setLoading(true);
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
        ...(targetTempId ? { tempId: targetTempId } : {}),
      });

      const file = sessionFileOf(snapshot) ?? sessionPath;
      const canonicalPath = file || targetTempId;

      // Always reconcile targetTempId if provided
      if (targetTempId && file) {
        reconcileOptimisticSession(targetTempId, file);
      }

      // Always cache background/foreground session state
      const resolvedTarget = file ?? targetTempId ?? sessionPath;
      if (resolvedTarget) {
        const isActivelyStreaming = Boolean(snapshot.state?.isStreaming || snapshot.state?.isBusy);
        if (seedMessage) {
          const nextMsgs = [...normalizeMessages(snapshot.messages), seedMessage];
          const existingCached = sessionStates.current.get(resolvedTarget);
          sessionStates.current.set(resolvedTarget, {
            messages: nextMsgs,
            running: true,
            stats: snapshot.stats,
            queued: existingCached?.queued ?? [],
            queueHeld: existingCached?.queueHeld,
            draft: existingCached?.draft,
            agentSkills: snapshot.skills ?? [],
            cwd: snapshot.cwd ?? cwd,
          });
          setRunningSessions((prev) => new Set(prev).add(resolvedTarget));
        } else {
          const raw = normalizeMessages(snapshot.messages);
          const hadRunning = Boolean(raw.at(-1)?.tools.some((tool) => tool.status === "running"));
          const sessionStillRunning =
            isActivelyStreaming ||
            isSessionInSet({ path: resolvedTarget, id: resolvedTarget, storagePath: resolvedTarget } as SessionSummary, runningSessions) ||
            Boolean(sessionStates.current.get(resolvedTarget)?.running);
          const isCurrentlyRunning = sessionStillRunning || hadRunning;
          if (isCurrentlyRunning) {
            setRunningSessions((prev) => new Set(prev).add(resolvedTarget));
          } else {
            setRunningSessions((prev) => {
              const s = new Set(prev);
              s.delete(resolvedTarget);
              return s;
            });
          }
          const existingCached = sessionStates.current.get(resolvedTarget);
          sessionStates.current.set(resolvedTarget, {
            messages: (!sessionStillRunning || (existingCached?.messages.length ?? 0) === 0) ? raw : (existingCached?.messages ?? raw),
            running: isCurrentlyRunning,
            stats: snapshot.stats,
            queued: existingCached?.queued ?? queuedRef.current,
            queueHeld: existingCached?.queueHeld,
            draft: existingCached?.draft,
            agentSkills: snapshot.skills ?? [],
            cwd: snapshot.cwd ?? cwd,
          });
        }
      }

      // Check if user is still focused on this session
      const isTargetActive =
        seq === startSeq.current ||
        sessionRef.current === targetTempId ||
        (file && sessionRef.current === file) ||
        (sessionPath && sessionRef.current === sessionPath);

      if (isTargetActive) {
        if (file) {
          sessionRef.current = file;
          setActiveSession(file);
        }
        if (seedMessage) {
          const nextMsgs = [...normalizeMessages(snapshot.messages), seedMessage];
          setMessages(nextMsgs);
          setStats(snapshot.stats);
          setRunning(true);
        } else {
          const raw = normalizeMessages(snapshot.messages);
          const hadRunning = Boolean(raw.at(-1)?.tools.some((tool) => tool.status === "running"));
          const sessionStillRunning =
            Boolean(snapshot.state?.isStreaming || snapshot.state?.isBusy) ||
            Boolean(sessionStates.current.get(resolvedTarget!)?.running);
          const next = (resume && hadRunning && !sessionStillRunning) ? finalizeInterruptedTurn(raw) : raw;
          if (!sessionStillRunning || messages.length === 0) {
            setMessages(next);
          } else {
            setMessages((current) => (current.length >= next.length ? current : next));
          }
          setStats(snapshot.stats);
          setRunning(sessionStillRunning || hadRunning);
          if (resume && hadRunning && !sessionStillRunning) setToast(t("toast.sessionInterrupted"));
          if (sessionPath && next.length === 0) {
            setToast(t("toast.sessionEmpty"));
          }
        }
        setAgentSkills(snapshot.skills ?? []);
        live.current = true;
        agentCwd.current = snapshot.cwd ?? cwd ?? agentCwd.current;
        agentModelsRef.current = snapshot.models ?? [];
        agentModelIdsRef.current = agentModelsRef.current.map((item) => item.id).filter(Boolean);
        if (modelId) {
          setModel(modelId);
          await window.harness.agent.command("set_model", { provider: "deepseek", modelId }, file ?? sessionPath).catch(() => undefined);
        }
        applyThinkingForModel(modelId);
        const nextEffort = effortRef.current;
        await window.harness.agent.command("set_thinking_level", { level: nextEffort }, file ?? sessionPath).catch(() => undefined);
        await window.harness.agent.command("set_auto_compaction", { enabled: true }, file ?? sessionPath).catch(() => undefined);
      }

      void window.harness.sessions.list().then(updateSessions);
      void refreshAgentSkills();
      return true;
    } catch (error) {
      const isTargetActive =
        seq === startSeq.current ||
        sessionRef.current === targetTempId ||
        (sessionPath && sessionRef.current === sessionPath);
      if (!isTargetActive) return false;
      const message = error instanceof Error ? error.message : String(error);
      if (sessionPath) {
        setToast(t("toast.sessionOpenFailed", { error: friendlyAgentError(error) }));
      } else if (!/Agent session closed/.test(message)) {
        setToast(friendlyAgentError(error));
      }
      if (/not configured|credential|login|api key/i.test(message)) setLoginOpen(true);
      return false;
    } finally {
      const isTargetActive =
        seq === startSeq.current ||
        sessionRef.current === targetTempId ||
        (sessionPath && sessionRef.current === sessionPath);
      if (isTargetActive) setLoading(false);
    }
  }, [applyThinkingForModel, permission, reconcileOptimisticSession, refreshAgentSkills, resolveSandbox, t, updateSessions]);

  const openSession = useCallback((session: SessionSummary) => {
    // Allow re-open when the row is highlighted but the transcript failed to load.
    if (isSameSession(session, activeSession) && messages.length > 0 && !loading) return;
    saveCurrentSessionToCache();
    stick.current = true;
    let cached =
      sessionStates.current.get(session.path) ??
      (session.storagePath ? sessionStates.current.get(session.storagePath) : undefined) ??
      (session.id ? sessionStates.current.get(session.id) : undefined);
    if (!cached) {
      for (const [key, item] of sessionStates.current.entries()) {
        if (
          isSamePath(key, session.path) ||
          (session.storagePath && isSamePath(key, session.storagePath)) ||
          key === session.id
        ) {
          cached = item;
          break;
        }
      }
    }
    const isRunning = Boolean(cached?.running) || isSessionInSet(session, runningSessions);
    const targetDraft = cached?.draft ?? "";
    draftRef.current = targetDraft;
    fillPrompt(targetDraft);
    queueHeld.current = Boolean(cached?.queueHeld);
    if (cached) {
      setMessages(cached.messages);
      setRunning(isRunning);
      setStats(cached.stats);
      setQueued(cached.queued ?? []);
      setUiRequest(cached.uiRequest);
      if (cached.agentSkills) setAgentSkills(cached.agentSkills);
      setActiveSession(session.path);
      sessionRef.current = session.path;
      live.current = true;
    } else {
      setMessages([]);
      setRunning(isRunning);
      setStats(undefined);
      setQueued([]);
      setUiRequest(undefined);
      setActiveSession(session.path);
      sessionRef.current = session.path;
      live.current = true;
    }

    if (isRunning) {
      void window.harness.agent.command("get_state", undefined, session.path).catch(() => undefined);
      return;
    }

    void startAgent(session.cwd, session.path, true, true, permission, undefined, session.storagePath);
  }, [activeSession, fillPrompt, isSessionInSet, loading, messages.length, permission, runningSessions, saveCurrentSessionToCache, startAgent]);

  const ensureModelReady = useCallback(async (): Promise<boolean> => {
    if (!agentCwd.current) return true;
    const next = modelRef.current.trim();
    if (!next) return true;
    if (agentModelIdsRef.current.includes(next)) {
      try {
        await window.harness.agent.command("set_model", { provider: "deepseek", modelId: next }, sessionRef.current);
        await syncAgentThinking();
        return true;
      } catch (error) {
        setToast(friendlyAgentError(error));
        return false;
      }
    }
    await window.harness.agent.stop(sessionRef.current).catch(() => undefined);
    return startAgent(workspace, sessionRef.current, Boolean(workspace), true);
  }, [startAgent, syncAgentThinking, workspace]);

  const switchModel = useCallback((next: string) => {
    setModel(next);
    modelRef.current = next;
    applyThinkingForModel(next);
    if (agentCwd.current && agentModelIdsRef.current.includes(next)) {
      void window.harness.agent.command("set_model", { provider: "deepseek", modelId: next }, sessionRef.current)
        .then(() => syncAgentThinking())
        .catch(() => undefined);
    }
    setToast(agentCwd.current ? t("toast.modelNextTurn", { model: next }) : t("toast.modelSwitched", { model: next }));
  }, [applyThinkingForModel, syncAgentThinking, t]);

  const bindProject = useCallback(async (cwd: string): Promise<boolean> => {
    saveCurrentSessionToCache();
    queueHeld.current = false;
    draftRef.current = "";
    stick.current = true;
    live.current = false;
    setWorkspace(cwd);
    setOpenProjects((current) => ({ ...current, [cwd]: true }));
    setMessages([]);
    setStats(undefined);
    fillPrompt("");
    setQueued([]);
    setActiveSession(undefined);
    sessionRef.current = undefined;
    setRunning(false);
    setUiRequest(undefined);
    setPreview(undefined);
    setFeatureTodos([]);
    setAgentSkills([]);
    agentCwd.current = undefined;
    return true;
  }, [fillPrompt, saveCurrentSessionToCache]);

  const openFolder = useCallback(async () => {
    const selected = await window.harness.workspace.choose();
    if (!selected) return;
    if (!(await bindProject(selected))) return null;
    setWorkspaces(await window.harness.workspace.recent());
    return selected;
  }, [bindProject]);

  const newThread = useCallback(async () => {
    saveCurrentSessionToCache();
    queueHeld.current = false;
    draftRef.current = "";
    stick.current = true;
    live.current = false;
    setWorkspace(undefined);
    setMessages([]);
    setStats(undefined);
    fillPrompt("");
    setQueued([]);
    setRunning(false);
    setUiRequest(undefined);
    setPreview(undefined);
    setFeatureTodos([]);
    setAgentSkills([]);
    setActiveSession(undefined);
    sessionRef.current = undefined;
    agentCwd.current = undefined;
  }, [fillPrompt, saveCurrentSessionToCache]);

  const removeSession = useCallback(async (session: SessionSummary) => {
    optimisticSessionsRef.current.delete(session.id);
    optimisticSessionsRef.current.delete(session.path);
    if (session.storagePath) optimisticSessionsRef.current.delete(session.storagePath);
    await window.harness.agent.stop(session.path).catch(() => undefined);
    sessionStates.current.delete(session.path);
    if (session.storagePath) sessionStates.current.delete(session.storagePath);
    setRunningSessions((prev) => {
      const next = new Set(prev);
      next.delete(session.path);
      next.delete(session.id);
      if (session.storagePath) next.delete(session.storagePath);
      return next;
    });
    if (isSameSession(session, activeSession)) {
      live.current = false;
      agentCwd.current = undefined;
      setMessages([]);
      setStats(undefined);
      setQueued([]);
      setActiveSession(undefined);
      sessionRef.current = undefined;
      setRunning(false);
      setUiRequest(undefined);
      setStoppedJobs([]);
    }
    try {
      await window.harness.sessions.remove(session.id);
      updateSessions(await window.harness.sessions.list());
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error));
    }
  }, [activeSession, updateSessions]);

  const pinSession = useCallback(async (session: SessionSummary) => {
    try {
      await window.harness.sessions.pin(session.id, !session.pinned);
      updateSessions(await window.harness.sessions.list());
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error));
    }
  }, [updateSessions]);

  const renameSession = useCallback(async (session: SessionSummary, title: string) => {
    try {
      await window.harness.sessions.rename(session.id, title);
      updateSessions(await window.harness.sessions.list());
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error));
    }
  }, [updateSessions]);

  const removeProject = useCallback(async (path: string) => {
    try {
      setWorkspaces(await window.harness.workspace.forget(path));
      updateSessions(await window.harness.sessions.list());
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
  }, [updateSessions, workspace]);

  const applyUndo = useCallback(async (files: RestoreFile[]) => {
    await window.harness.workspace.restore(files, workspace);
    setMessages((current) => dropLastTurn(current));
    const stats = await window.harness.agent.command<{ sessionFile?: string }>("get_session_stats").catch(() => undefined);
    if (typeof stats?.sessionFile === "string") {
      sessionRef.current = stats.sessionFile;
      setActiveSession(stats.sessionFile);
    }
    void window.harness.sessions.list().then(updateSessions);
  }, [updateSessions, workspace]);

  const stopJobs = useCallback(async (message: string) => {
    const data = await window.harness.agent.command<{ commands: Array<{ name: string }> }>("get_commands", undefined, sessionRef.current);
    const names = new Set((data.commands ?? []).map((item) => item.name.replace(/^\//, "")));
    if (!names.has("stop-job") && !names.has("stop-jobs")) throw new Error(t("toast.needJobCommands"));
    await window.harness.agent.command("prompt", { message }, sessionRef.current);
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
      const log = await window.harness.agent.command<{ entries: Parameters<typeof lastTurnRestoreFiles>[0] }>("get_entries", undefined, sessionRef.current);
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
      const result = await window.harness.agent.command<{ tokensBefore?: number; summary?: string }>("compact", undefined, sessionRef.current);
      const [history, nextStats] = await Promise.all([
        window.harness.agent.command<{ messages: unknown[] }>("get_messages", undefined, sessionRef.current),
        window.harness.agent.command<AgentSessionStats>("get_session_stats", undefined, sessionRef.current),
      ]);
      setMessages(normalizeMessages(history.messages));
      setStats(nextStats);
      setToast(
        result.tokensBefore
          ? t("toast.compactDoneTokens", { tokens: result.tokensBefore.toLocaleString(locale === "en" ? "en-US" : "zh-CN") })
          : t("toast.compactDone"),
      );
      void window.harness.sessions.list().then(updateSessions);
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
      await window.harness.agent.command("prompt", { message: "/plan execute" }, sessionRef.current);
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
      }, sessionRef.current);
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
    if (running) {
      if ((!text && !images?.length) || text.startsWith("/")) return;
      if (queued.length >= MAX_STEER_ROWS) {
        setToast(t("toast.steerLimit", { n: MAX_STEER_ROWS }));
        return;
      }
      const followup = text || t("toast.defaultImagePrompt");
      fillPrompt("");
      setQueued((current) => {
        const next = [...current, { text: followup, images }];
        const target = sessionRef.current || activeSession;
        if (target) {
          const cached = sessionStates.current.get(target);
          if (cached) cached.queued = next;
        }
        return next;
      });
      setToast(t("toast.steered"));
      return;
    }
    let question = text;
    let attached = images;
    if (!question && !attached?.length) {
      const next = queuedRef.current[0];
      if (!next || loading || sending.current) return;
      queueHeld.current = false;
      setQueued((current) => {
        const nextQ = current.slice(1);
        const target = sessionRef.current || activeSession;
        if (target) {
          const cached = sessionStates.current.get(target);
          if (cached) cached.queued = nextQ;
        }
        return nextQ;
      });
      question = next.text;
      attached = next.images;
    }
    if ((!question && !attached?.length) || loading || sending.current) return;
    sending.current = true;
    queueHeld.current = false;
    draftRef.current = "";
    const activeKey = sessionRef.current || activeSession;
    if (activeKey) {
      const c = sessionStates.current.get(activeKey);
      if (c) {
        c.queueHeld = false;
        c.draft = "";
      }
    }
    question = question || t("toast.defaultImagePrompt");
    const thumbs = (attached ?? []).map((item) => {
      const match = item.match(/^data:([^;]+);base64,(.+)$/);
      return {
        mimeType: match?.[1] ?? "image/png",
        data: match?.[2] ?? item.replace(/^data:[^;]+;base64,/, ""),
      };
    });
    let optimistic: ChatMessage | undefined;
    let optimisticSessionId: string | undefined;
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

      // If starting a brand new conversation without an active session file:
      // IMMEDIATELY create an optimistic session in sidebar so user sees it right away!
      if (!sessionRef.current) {
        const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        optimisticSessionId = tempId;
        const optimisticSession: SessionSummary = {
          id: tempId,
          path: tempId,
          storagePath: tempId,
          cwd,
          title: question.slice(0, 96),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messageCount: 1,
          preview: question.slice(0, 240),
          pinned: false,
          archived: false,
        };
        sessionRef.current = tempId;
        setActiveSession(tempId);
        setRunningSessions((prev) => new Set([...prev, tempId]));
        optimisticSessionsRef.current.set(tempId, optimisticSession);
        updateSessions();
        setOpenProjects((current) => ({ ...current, [cwd]: true }));
        sessionStates.current.set(tempId, {
          messages: [optimistic!],
          running: true,
          stats: undefined,
          queued: [],
          agentSkills: [],
          cwd,
        });
      } else {
        setRunningSessions((prev) => new Set([...prev, sessionRef.current!]));
      }

      if (!agentCwd.current || (optimisticSessionId && sessionRef.current === optimisticSessionId)) {
        const started = await startAgent(cwd, undefined, true, false, permission, optimistic, undefined, optimisticSessionId);
        if (!started) {
          setMessages((current) => current.filter((item) => item.id !== optimistic!.id));
          fillPrompt(question);
          setRunning(false);
          if (optimisticSessionId) {
            optimisticSessionsRef.current.delete(optimisticSessionId);
            setRunningSessions((prev) => {
              const next = new Set(prev);
              next.delete(optimisticSessionId!);
              return next;
            });
            if (sessionRef.current === optimisticSessionId) {
              sessionRef.current = undefined;
              setActiveSession(undefined);
            }
            updateSessions();
          }
          return;
        }
      } else if (!(await ensureModelReady())) {
        setMessages((current) => current.filter((item) => item.id !== optimistic!.id));
        fillPrompt(question);
        setRunning(false);
        if (optimisticSessionId) {
          optimisticSessionsRef.current.delete(optimisticSessionId);
          setRunningSessions((prev) => {
            const next = new Set(prev);
            next.delete(optimisticSessionId!);
            return next;
          });
          if (sessionRef.current === optimisticSessionId) {
            sessionRef.current = undefined;
            setActiveSession(undefined);
          }
          updateSessions();
        }
        return;
      }

      const targetSession = sessionRef.current || optimisticSessionId;

      if (!attached?.length) {
        await window.harness.agent.command("prompt", { message: question }, targetSession);
      } else if (modelSupportsVision(modelRef.current)) {
        try {
          await window.harness.agent.command("prompt", {
            message: question,
            images: toPromptImages(attached),
          }, targetSession);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          // Model declared vision but API rejected images — fall back to dedicated vision tool.
          if (!/does not support image|image input|unsupported.*image|invalid.*image|image_url|multimodal|vision/i.test(detail)) {
            throw error;
          }
          const message = visionAgentPrompt(question, await window.harness.vision.stage(attached));
          await window.harness.agent.command("prompt", { message }, targetSession);
        }
      } else {
        const message = visionAgentPrompt(question, await window.harness.vision.stage(attached));
        await window.harness.agent.command("prompt", { message }, targetSession);
      }

      void (async () => {
        try {
          const state = await window.harness.agent.command<{ sessionFile?: string }>("get_state", undefined, targetSession);
          if (state?.sessionFile) {
            const realFile = state.sessionFile;
            if (optimisticSessionId) {
              reconcileOptimisticSession(optimisticSessionId, realFile);
            }
            if (sessionRef.current === optimisticSessionId) {
              sessionRef.current = realFile;
              setActiveSession(realFile);
            }
            setRunningSessions((prev) => new Set([...prev, realFile]));
          }
        } catch {
          // Ignore
        }
        void window.harness.sessions.list().then(updateSessions);
      })();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const optimisticId = optimistic?.id;
      if (optimisticId) setMessages((current) => current.filter((item) => item.id !== optimisticId));
      if (optimisticSessionId) {
        optimisticSessionsRef.current.delete(optimisticSessionId);
        setRunningSessions((prev) => {
          const next = new Set(prev);
          next.delete(optimisticSessionId!);
          return next;
        });
        if (sessionRef.current === optimisticSessionId) {
          sessionRef.current = undefined;
          setActiveSession(undefined);
        }
        updateSessions();
      }
      fillPrompt(question);
      setRunning(false);
      if (!/Agent session closed/.test(detail)) setToast(friendlyAgentError(error));
    } finally {
      sending.current = false;
    }
  }, [ensureModelReady, fillPrompt, loading, openFolder, permission, reconcileOptimisticSession, running, startAgent, queued.length, t, undoLastTurn, updateSessions, workspace]);

  useEffect(() => {
    if (running || loading || sending.current || queueFlush.current || queueHeld.current) return;
    const next = queuedRef.current[0];
    if (!next) return;
    queueFlush.current = true;
    setQueued((current) => {
      const nextQ = current.slice(1);
      const target = sessionRef.current || activeSession;
      if (target) {
        const cached = sessionStates.current.get(target);
        if (cached) cached.queued = nextQ;
      }
      return nextQ;
    });
    void sendMessage(next.text, next.images).finally(() => {
      queueFlush.current = false;
    });
  }, [loading, running, sendMessage]);

  useEffect(() => {
    void refresh().then((status) => {
      const current = status.find((item) => item.id === "deepseek");
      if (current?.configured) setModel(current.defaultModel);
      if (!current?.configured) setLoginOpen(true);
    });
    void window.harness.agent.runningSessions?.().then((sessions) => {
      if (sessions?.length) setRunningSessions(new Set(sessions));
    }).catch(() => undefined);
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
      const eventSession = (event as { sessionPath?: string }).sessionPath;
      const isCurrent = Boolean(live.current && (!eventSession || (sessionRef.current ? isSamePath(eventSession, sessionRef.current) : true)));

      if (event.type === "session_created" && typeof (event as { sessionPath?: string }).sessionPath === "string") {
        const createdPath = (event as { sessionPath: string }).sessionPath;
        const eventTempId = (event as { tempId?: string }).tempId;
        const eventCwd = (event as { cwd?: string }).cwd;
        if (eventTempId && optimisticSessionsRef.current.has(eventTempId)) {
          reconcileOptimisticSession(eventTempId, createdPath);
        } else {
          for (const [tempId, opt] of optimisticSessionsRef.current.entries()) {
            if (tempId.startsWith("temp_") && (!eventCwd || isSamePath(opt.cwd, eventCwd) || optimisticSessionsRef.current.size === 1)) {
              reconcileOptimisticSession(tempId, createdPath);
              break;
            }
          }
        }
        const currentSession = sessionRef.current;
        const isTargetingCurrent = Boolean(
          currentSession &&
          (isSamePath(currentSession, createdPath) ||
           (eventTempId && currentSession === eventTempId) ||
           (!eventTempId && (currentSession.includes("unknown_") || currentSession.startsWith("temp_"))))
        );
        if (currentSession && isTargetingCurrent) {
          sessionRef.current = createdPath;
          setActiveSession(createdPath);
        }
        setRunningSessions((prev) => new Set([...prev, createdPath]));
        void window.harness.sessions.list().then(updateSessions);
      }

      if (event.type === "agent_start") {
        if (eventSession) {
          setRunningSessions((prev) => new Set([...prev, eventSession]));
        } else if (sessionRef.current) {
          setRunningSessions((prev) => new Set([...prev, sessionRef.current!]));
        }
        if (isCurrent) setRunning(true);
        void window.harness.sessions.list().then(updateSessions);
      }

      // Maintain background / cached session state
      if (eventSession) {
        let targetKey: string | undefined;
        for (const key of sessionStates.current.keys()) {
          if (isSamePath(key, eventSession)) {
            targetKey = key;
            break;
          }
        }
        if (!targetKey) {
          targetKey = eventSession;
          sessionStates.current.set(targetKey, {
            messages: [],
            running: false,
            stats: undefined,
            queued: [],
            uiRequest: undefined,
          });
        }
        const cached = sessionStates.current.get(targetKey)!;
        cached.messages = applyAgentEvent(cached.messages, event);
        if (event.type === "agent_start") cached.running = true;
        if (event.type === "agent_settled") {
          cached.running = false;
          cached.uiRequest = undefined;
          // Auto-consume background session queue if not paused/held
          if (cached.queued?.length && !isCurrent && !cached.queueHeld) {
            const next = cached.queued[0];
            cached.queued = cached.queued.slice(1);
            cached.running = true;
            const optimistic = optimisticUserMessage(next.text, false);
            cached.messages = [...cached.messages, optimistic];
            setRunningSessions((prev) => new Set(prev).add(eventSession));
            void window.harness.agent.command("prompt", { message: next.text }, eventSession)
              .catch(() => {
                cached.running = false;
                setRunningSessions((prev) => {
                  const s = new Set(prev);
                  s.delete(eventSession);
                  return s;
                });
              });
          }
        }
        if (event.type === "extension_ui_request") {
          const request = event as ExtensionUiRequest;
          if (["select", "confirm", "input", "editor"].includes(request.method)) {
            cached.uiRequest = request;
          }
        }
        if (event.type === "desktop_snapshot_meta" && event.stats && typeof event.stats === "object") {
          cached.stats = event.stats as AgentSessionStats;
        }
      }

      if (isCurrent) {
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
          void window.harness.agent.command<AgentSessionStats>("get_session_stats", undefined, sessionRef.current).then((nextStats) => {
            if (!live.current) return;
            setStats(nextStats);
            if (typeof nextStats?.sessionFile !== "string") return;
            const realFile = nextStats.sessionFile;
            const currentSession = sessionRef.current;
            sessionRef.current = realFile;
            setActiveSession(realFile);
            if (currentSession && currentSession.startsWith("temp_")) {
              reconcileOptimisticSession(currentSession, realFile);
            }
          }).catch(() => undefined);
          void window.harness.sessions.list().then(updateSessions);
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
      } else {
        if (event.type === "agent_settled") {
          void window.harness.sessions.list().then(updateSessions);
        }
      }

      if (event.type === "agent_settled") {
        const eventTempId = (event as { tempId?: string }).tempId;
        if (eventTempId) {
          setRunningSessions((prev) => {
            const next = new Set(prev);
            next.delete(eventTempId);
            return next;
          });
        }
        if (eventSession) {
          const cached = sessionStates.current.get(eventSession);
          if (!cached?.running) {
            setRunningSessions((prev) => {
              const next = new Set(prev);
              for (const s of prev) {
                if (isSamePath(s, eventSession)) next.delete(s);
              }
              return next;
            });
          }
        } else if (isCurrent && sessionRef.current) {
          setRunningSessions((prev) => {
            const next = new Set(prev);
            for (const s of prev) {
              if (isSamePath(s, sessionRef.current)) next.delete(s);
            }
            return next;
          });
        }
      }
    });
    const offError = window.harness.agent.onError((message, errorSession) => {
      if (/Agent session closed/.test(message) || isTransientStreamError(message)) return;
      const isCurrent = Boolean(live.current && (!errorSession || (sessionRef.current ? isSamePath(errorSession, sessionRef.current) : true)));
      if (errorSession) {
        setRunningSessions((prev) => {
          const next = new Set(prev);
          for (const s of prev) {
            if (isSamePath(s, errorSession)) next.delete(s);
          }
          return next;
        });
        for (const [key, cached] of sessionStates.current.entries()) {
          if (isSamePath(key, errorSession)) {
            cached.running = false;
            cached.queueHeld = true;
            cached.uiRequest = undefined;
            cached.messages = finalizeInterruptedTurn(cached.messages);
          }
        }
      }
      if (isCurrent) {
        queueHeld.current = true;
        setRunning(false);
        setUiRequest(undefined);
        setMessages((current) => finalizeInterruptedTurn(current));
        const text = friendlyAgentError(message);
        if (text) setToast(text);
      }
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
  }, [home, queued.length]);

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
        queueHeld.current = true;
        const target = sessionRef.current || activeSession;
        if (target) {
          const cached = sessionStates.current.get(target);
          if (cached) {
            cached.queueHeld = true;
            cached.running = false;
          }
        }
        setToast(t("toast.stopping"));
        void window.harness.agent.command("abort", undefined, sessionRef.current)
          .catch(() => undefined)
          .finally(() => {
            setRunning(false);
          });
      }}
      steering={queued.map((item) => item.text)}
      onQueuedEdit={(index) => {
        const item = queued[index];
        if (!item) return;
        setQueued((current) => {
          const next = current.filter((_, i) => i !== index);
          const target = sessionRef.current || activeSession;
          if (target) {
            const cached = sessionStates.current.get(target);
            if (cached) cached.queued = next;
          }
          return next;
        });
        fillPrompt(item.text);
      }}
      onQueuedRemove={(index) => setQueued((current) => {
        const next = current.filter((_, i) => i !== index);
        const target = sessionRef.current || activeSession;
        if (target) {
          const cached = sessionStates.current.get(target);
          if (cached) cached.queued = next;
        }
        return next;
      })}
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
            await window.harness.agent.command("prompt", { message: `/permissions ${mode}` }, sessionRef.current);
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
      onChange={(text) => {
        draftRef.current = text;
        const target = sessionRef.current || activeSession;
        if (target) {
          const cached = sessionStates.current.get(target);
          if (cached) cached.draft = text;
        }
      }}
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
          const open = openProjects[item.path] === true;
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
                      running={isSessionInSet(session, runningSessions) || (isSameSession(session, activeSession) && running)}
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
                  {homeRecents.map((session) => {
                    const isRunning = isSessionInSet(session, runningSessions) || (isSameSession(session, activeSession) && running);
                    return (
                      <button
                        key={session.id}
                        type="button"
                        className="home-recent"
                        onClick={() => openSession(session)}
                      >
                        <div className="home-recent-main">
                          <Icon path="M19 3H5a2 2 0 0 0-2 2v14l4-4h12a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z" size={14} />
                          <span>{session.title || t("common.unnamedSession")}</span>
                          {isRunning && (
                            <span className="session-running-badge" title="Running">
                              <span className="session-running-dot" />
                            </span>
                          )}
                        </div>
                        <small>{relativeTime(session.updatedAt, t)}</small>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {!home && groups.length === 0 && (
            loading ? (
              <ConversationSkeleton
                title={sessions.find((session) => isSameSession(session, activeSession))?.title}
              />
            ) : (
              <div className="session-pane">
                <p className="session-pane-empty">{t("chat.emptySession")}</p>
              </div>
            )
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
                  sessionPath={sessionRef.current}
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
                    const target = sessionRef.current || activeSession;
                    if (target) {
                      const cached = sessionStates.current.get(target);
                      if (cached) cached.uiRequest = undefined;
                    }
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
              await window.harness.agent.stop(sessionRef.current).catch(() => undefined);
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
