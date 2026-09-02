import { memo, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PREVIEW_HOST, PREVIEW_SCHEME, type AgentSessionStats, type ExtensionUiRequest, type PermissionMode } from "../shared/types";
import { skillUserDisplay } from "../shared/skills";
import { visibleUserText, visionResultSections, visionToolChips } from "../shared/vision-api";
import { DEEPSEEK_PRESET, activeCustomProfile, defaultCustomProfile, isDeepSeekUrl, type CustomApiProfile } from "../shared/chat-profiles";
import { applyTheme, readStoredTheme, THEMES, type ThemeId } from "../shared/theme";
import { effortLabelKey, pickEffortOptions, reasoningLevelsAvailable } from "../shared/thinking";
import { approvalTitle, baseName, cacheHitRate, collectFileChanges, collapseThinking, delegateProgress, delegateStatusLabel, filterMentionPaths, formatCommand, isRecoverableRequestError, liveStatus, omitFinalReply, repairMarkdownTables, splitHttpUrls, splitPatch, stripEmptyMarkdown, spliceFileMention, terminalLabel, toolCommand, toolSummary, toolWritePreview, traceRows, turnWork, assistantReplyText, webSearchCard, workspaceRelative, type ChatImage, type ChatMessage, type FileChange, type SessionFile, type SessionTerminal, type SessionTodo, type ToolActivity, type TraceRow, type WorkItem } from "./conversation";
import { tokenizeCode } from "./highlight";
import type { AgentSkillCommand } from "../shared/skills";
import { PROJECT_SKILL_ROOTS, USER_SKILL_ROOTS, skillSlashCommand } from "../shared/skills";
import { useI18n } from "./i18n";
import type { MessageKey } from "../shared/i18n";
import logo from "./logo.svg";

const MAX_UPLOAD_IMAGES = 4;
const PATH_MIME = "text/tether-path";
let treeDragPath = "";

function isPromptFileDrag(transfer: DataTransfer): boolean {
  if (treeDragPath) return true;
  const types = [...transfer.types];
  return types.includes(PATH_MIME) || types.includes("Files");
}

function setDragGhost(transfer: DataTransfer, label: string) {
  const ghost = document.createElement("div");
  ghost.className = "drag-ghost";
  ghost.textContent = label;
  document.body.appendChild(ghost);
  transfer.setDragImage(ghost, 16, 14);
  requestAnimationFrame(() => ghost.remove());
}

function beginTreeDrag(event: DragEvent<HTMLElement>, path: string, label: string) {
  treeDragPath = path;
  event.dataTransfer.effectAllowed = "copy";
  // Override the button's default text/html; otherwise contenteditable clones the row.
  event.dataTransfer.setData("text/html", "<span></span>");
  event.dataTransfer.setData(PATH_MIME, path);
  setDragGhost(event.dataTransfer, label);
}

export function Icon({ path, size = 16, className }: { path: string; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {path.split("\n").map((d) => <path key={d} d={d} />)}
    </svg>
  );
}

function UserText({ text }: { text: string }) {
  return (
    <>
      {splitHttpUrls(text).map((part, index) =>
        part.type === "url" ? (
          <a
            key={`${part.value}-${index}`}
            className="user-url"
            href={part.value}
            onClick={(event) => {
              event.preventDefault();
              void window.harness.app.openExternal(part.value);
            }}
          >
            {part.value}
          </a>
        ) : (
          <span key={index}>{part.value}</span>
        ),
      )}
    </>
  );
}

export function UserTurn({ text, images = [], anchor }: { text: string; images?: ChatImage[]; anchor?: string }) {
  const skill = skillUserDisplay(text);
  const shown = skill ? skill.command : visibleUserText(text);
  const [view, setView] = useState<string>();
  return (
    <div className="user-turn" id={anchor}>
      <article className="user">
        {images.length > 0 && (
          <div className="user-images">
            {images.map((image, index) => {
              const src = image.src ?? `data:${image.mimeType};base64,${image.data}`;
              return (
                <button key={`${image.mimeType}-${index}`} type="button" className="user-image" onClick={() => setView(src)}>
                  <img src={src} alt="" />
                </button>
              );
            })}
          </div>
        )}
        {skill ? <code className="user-skill-tag">{shown}</code> : <UserText text={shown} />}
      </article>
      <div className="bubble-actions">
        <CopyAction text={shown} />
      </div>
      {view && createPortal(
        <div className="modal" onClick={() => setView(undefined)} onKeyDown={(event) => { if (event.key === "Escape") setView(undefined); }}>
          <img className="lightbox" src={view} alt="" />
        </div>,
        document.body,
      )}
    </div>
  );
}

export function CopyButton({
  text,
  className = "bubble-action",
  size = 14,
  label,
}: {
  text: string;
  className?: string;
  size?: number;
  label?: string;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const copy = async (host: HTMLElement) => {
    const markdown = host.closest(".turn")?.querySelector(".stream .markdown");
    const plain = markdown instanceof HTMLElement
      ? markdown.innerText.replace(/\n{3,}/g, "\n\n").trim()
      : "";
    try {
      await navigator.clipboard.writeText(plain || text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* silent: icon-only affordance already covers the happy path */
    }
  };
  return (
    <button type="button" className={className} aria-label={copied ? t("common.copied") : label ?? t("common.copy")} onClick={(event) => void copy(event.currentTarget)}>
      <Icon path={copied ? "M5 12.5l4 4 10-10" : "M8 8h12v12H8zM4 16V4h12"} size={size} />
    </button>
  );
}

function CopyAction({ text }: { text: string }) {
  if (!text.trim()) return null;
  return <CopyButton text={text} />;
}

export function Dots() {
  return (
    <span className="dots" aria-hidden="true">
      {Array.from({ length: 9 }, (_, index) => <i key={index} />)}
    </span>
  );
}

function formatDuration(start?: number, end?: number) {
  if (!start) return "";
  const seconds = Math.max(0, ((end ?? Date.now()) - start) / 1000);
  if (seconds < 0.05) return "";
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
}

export function Elapsed({ start, end, live }: { start?: number; end?: number; live?: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!live || !start) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [live, start]);
  const label = formatDuration(start, live ? now : end);
  if (!label) return null;
  return <time>{label}</time>;
}

export function SidebarNav({
  onNew,
  onOpen,
  account,
  children,
}: {
  onNew(): void;
  onOpen(): void;
  account: ReactNode;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <aside className="sidebar">
      <header className="sidebar-titlebar">
        <div className="sidebar-brand">
          <img className="brand-mark" src={logo} alt="" width={24} height={14} />
          <strong>Tether</strong>
        </div>
      </header>
      <div className="sidebar-primary">
        <button type="button" className="nav-btn new" onClick={onNew}>
          <Icon path="M12 5v14M5 12h14" />
          {t("nav.newThread")}
        </button>
        <button type="button" className="nav-btn" onClick={onOpen}>
          <Icon path="M3 7h6l2 2h10v10H3z" />
          {t("nav.projects")}
        </button>
      </div>
      <div className="thread-list">{children}</div>
      <footer className="sidebar-footer">{account}</footer>
    </aside>
  );
}

export function Chat({
  children,
  composer,
  home,
  inspect,
  nav,
  title,
}: {
  children: ReactNode;
  composer?: ReactNode;
  home?: boolean;
  inspect?: ReactNode;
  nav?: ReactNode;
  title?: string;
}) {
  const { t } = useI18n();
  const [drawer, setDrawer] = useState(true);
  const [inspectWidth, setInspectWidth] = useState(readInspectWidth);
  const widthRef = useRef(inspectWidth);
  widthRef.current = inspectWidth;

  const startInspectResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = widthRef.current;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (move: PointerEvent) => {
      const next = clampInspectWidth(startWidth + startX - move.clientX);
      widthRef.current = next;
      setInspectWidth(next);
    };
    const onUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      writeInspectWidth(widthRef.current);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  return (
    <section className={home ? "chat home" : "chat"}>
      <header className="chat-bar">
        {!home && title && <h1 className="chat-title">{title}</h1>}
        {!home && nav}
        {inspect && (
          <button
            type="button"
            className={drawer ? "inspect-toggle on" : "inspect-toggle"}
            aria-label={drawer ? t("nav.closeDrawer") : t("nav.openDrawer")}
            onClick={() => setDrawer((current) => !current)}
          >
            <Icon path="M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M15.5 4v16" />
          </button>
        )}
        <WindowControls />
      </header>
      <div className="chat-body">
        <div className="chat-main">
          {children}
          {composer}
        </div>
        {drawer && inspect && (
          <div className="inspect-shell" style={{ width: inspectWidth }}>
            <div
              className="inspect-resize"
              role="separator"
              aria-orientation="vertical"
              aria-label={t("inspect.resize")}
              onPointerDown={startInspectResize}
            />
            {inspect}
          </div>
        )}
      </div>
    </section>
  );
}

const INSPECT_WIDTH_KEY = "tether.inspectWidth";
const INSPECT_MIN = 220;
const INSPECT_MAX = 480;
const INSPECT_DEFAULT = 268;

function clampInspectWidth(width: number): number {
  return Math.min(INSPECT_MAX, Math.max(INSPECT_MIN, Math.round(width)));
}

function readInspectWidth(): number {
  try {
    const raw = Number(localStorage.getItem(INSPECT_WIDTH_KEY));
    if (!Number.isFinite(raw)) return INSPECT_DEFAULT;
    return clampInspectWidth(raw);
  } catch {
    return INSPECT_DEFAULT;
  }
}

function writeInspectWidth(width: number): void {
  try {
    localStorage.setItem(INSPECT_WIDTH_KEY, String(clampInspectWidth(width)));
  } catch {
    // Ignore private mode / quota failures.
  }
}

/** Caption buttons for the frameless window on Windows/Linux; macOS keeps its traffic lights. */
function WindowControls() {
  const { t } = useI18n();
  if (window.harness.platform === "darwin") return null;
  return (
    <div className="win-controls">
      <button type="button" aria-label={t("nav.minimize")} onClick={() => void window.harness.window.minimize()}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
      <button type="button" aria-label={t("nav.maximize")} onClick={() => void window.harness.window.toggleMaximize()}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <rect x=".5" y=".5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
      <button type="button" className="close" aria-label={t("nav.closeWindow")} onClick={() => void window.harness.window.close()}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
    </div>
  );
}

export function ContextStats({
  stats,
  model,
  effort,
  effortLevels,
  up,
  running = false,
  busy = false,
  onCompact,
}: {
  stats?: AgentSessionStats;
  model?: string;
  effort?: string;
  effortLevels?: string[];
  up?: boolean;
  running?: boolean;
  busy?: boolean;
  onCompact?(): void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const percent = stats?.contextUsage?.percent !== null && stats?.contextUsage?.percent !== undefined
    ? Math.round(stats.contextUsage.percent * 10) / 10
    : undefined;
  const contextTokens = stats?.contextUsage?.tokens ?? (stats?.tokens?.total ? stats.tokens.total : undefined);
  const contextWindow = stats?.contextUsage?.contextWindow ?? 128_000;
  const rate = cacheHitRate(stats?.tokens);
  const canCompact = Boolean(onCompact) && !running && !busy;
  const showCompact = Boolean(onCompact) && percent !== undefined;

  return (
    <div ref={box} className={`context-stats-wrap${open ? " open" : ""}${up ? " up" : ""}`}>
      <button
        type="button"
        className={`stats-toggle${open ? " on" : ""}${
          percent !== undefined && percent >= 90 ? " hot" : percent !== undefined && percent >= 80 ? " warm" : ""
        }`}
        aria-label={t("context.monitor")}
        title={t("context.monitor")}
        onClick={() => setOpen((was) => !was)}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" className="stats-dial" aria-hidden="true">
          <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeOpacity="0.22" strokeWidth="2" />
          {percent !== undefined && (
            <circle
              cx="7"
              cy="7"
              r="5.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeDasharray={34.56}
              strokeDashoffset={34.56 - (Math.min(100, Math.max(0, percent)) / 100) * 34.56}
              strokeLinecap="round"
              transform="rotate(-90 7 7)"
            />
          )}
        </svg>
        <span>{percent !== undefined ? `${percent}%` : t("context.label")}</span>
      </button>

      {open && (
        <div className="context-popover" role="dialog">
          <div className="context-popover-head">
            <span className="context-popover-title">{t("context.title")}</span>
            {rate !== undefined && (
              <span className="context-badge-hit">
                <i /> {t("context.cacheRate", { rate: rate.toFixed(0) })}
              </span>
            )}
          </div>

          <div className="context-section context-capacity">
            <div className="context-ring-wrap">
              <svg width="48" height="48" viewBox="0 0 48 48" className="context-ring-svg" aria-hidden="true">
                <circle cx="24" cy="24" r="20" fill="none" stroke="var(--line)" strokeWidth="3" />
                {percent !== undefined && (
                  <circle
                    cx="24"
                    cy="24"
                    r="20"
                    fill="none"
                    stroke={percent >= 90 ? "var(--red)" : percent >= 80 ? "var(--accent)" : "var(--green)"}
                    strokeWidth="3"
                    strokeDasharray={125.66}
                    strokeDashoffset={125.66 - (Math.min(100, Math.max(0, percent)) / 100) * 125.66}
                    strokeLinecap="round"
                    transform="rotate(-90 24 24)"
                  />
                )}
              </svg>
              <div className="context-ring-label">
                <strong>{percent !== undefined ? `${percent}%` : "—"}</strong>
                <small>{percent !== undefined ? t("context.used") : t("context.untracked")}</small>
              </div>
            </div>
            <div className="context-capacity-info">
              <span className="context-label">{t("context.capacity")}</span>
              <span className="context-ratio">
                {contextTokens !== undefined ? formatCompactNumber(contextTokens) : "—"} / {formatCompactNumber(contextWindow)}
              </span>
              <small className={`context-hint ${percent && percent >= 80 ? "warn" : ""}`}>
                {percent === undefined
                  ? t("context.waitFirst")
                  : percent >= 90
                    ? t("context.critical")
                    : percent >= 75
                      ? t("context.high")
                      : t("context.ok")}
              </small>
            </div>
            {showCompact && (
              <button
                type="button"
                className="context-compact-btn"
                disabled={!canCompact}
                title={running ? t("toast.waitBeforeCompact") : undefined}
                onClick={() => {
                  if (!canCompact) return;
                  onCompact?.();
                }}
              >
                {busy ? t("context.compacting") : t("context.compact")}
              </button>
            )}
          </div>

          <div className="context-section">
            <div className="context-section-head">
              <span>{t("context.tokenTotal")}</span>
              {stats?.tokens?.total ? (
                <span className="context-token-sum">{t("context.tokenSum", { n: formatCompactNumber(stats.tokens.total) })}</span>
              ) : null}
            </div>
            <div className="context-stat-row">
              <span>{t("context.input")} <b>{stats?.tokens?.input !== undefined ? formatCompactNumber(stats.tokens.input) : "—"}</b></span>
              <span>{t("context.output")} <b>{stats?.tokens?.output !== undefined ? formatCompactNumber(stats.tokens.output) : "—"}</b></span>
            </div>
          </div>

          <div className="context-section">
            <div className="context-section-head">
              <span>{t("context.cacheTitle")}</span>
              <strong className="context-rate-text">{rate !== undefined ? `${rate.toFixed(1)}%` : "—"}</strong>
            </div>
            <div className="context-bar-track">
              <div
                className="context-bar-fill"
                style={{ width: `${Math.min(100, Math.max(0, rate ?? 0))}%` }}
              />
            </div>
            <div className="context-cache-meta">
              <span>{t("context.cacheHit")} <b>{stats?.tokens?.cacheRead ? formatCompactNumber(stats.tokens.cacheRead) : "0"}</b></span>
              {Boolean(stats?.tokens?.cacheWrite) ? (
                <span>{t("context.cacheWrite")} <b>{formatCompactNumber(stats!.tokens.cacheWrite)}</b></span>
              ) : (
                <span>{t("context.cacheMiss")} <b>{stats?.tokens?.input !== undefined ? formatCompactNumber(stats.tokens.input) : "—"}</b></span>
              )}
            </div>
          </div>

          <div className="context-popover-foot">
            <div className="context-foot-item context-foot-item-model">
              <span className="context-foot-label">{t("common.model")}</span>
              <code className="context-model-tag">{model || t("context.defaultModel")}</code>
            </div>
            <div className="context-foot-row">
              {reasoningLevelsAvailable(effortLevels ?? []) && effort && (
                <div className="context-foot-item">
                  <span className="context-foot-label">{t("composer.effort")}</span>
                  <span className="context-effort-val">{t(effortLabelKey(effort))}</span>
                </div>
              )}
              <div className="context-foot-item context-foot-item-cost">
                <span className="context-foot-label">{t("context.cost")}</span>
                <span className="context-cost-val">
                  {stats?.cost ? `$${stats.cost.toFixed(4)}` : "—"}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatCompactNumber(value: number) {
  if (value < 1_000) return String(value);
  if (value < 1_000_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

export function TurnNav({ items }: { items: Array<{ id: string; label: string }> }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string>();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (items.length < 2) return null;

  /** Last question whose card already scrolled past the top of the reading area. */
  const visibleTurn = () => items
    .filter((item) => (document.getElementById(item.id)?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY) < 160)
    .at(-1)?.id;

  return (
    <div ref={box} className={`combo down turn-nav${open ? " open" : ""}`}>
      <button
        type="button"
        className="combo-trigger turn-nav-trigger"
        aria-label={t("context.jumpTurn")}
        onClick={() => {
          setActive(visibleTurn());
          setOpen((was) => !was);
        }}
      >
        <Icon path="M4 6h16M4 12h10M4 18h6" size={14} />
        <span>{t("context.turns", { n: items.length })}</span>
      </button>
      {open && (
        <div className="combo-menu turn-nav-menu" role="listbox">
          {items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              className={item.id === active ? "combo-item selected" : "combo-item"}
              onClick={() => {
                document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
                setActive(item.id);
                setOpen(false);
              }}
            >
              <small>{index + 1}</small>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Thinking({
  text,
  work,
  tools,
  live,
  label,
  startedAt,
  endedAt,
  error,
  errorTone = "strong",
  onRetry,
}: {
  text: string;
  work: WorkItem[];
  tools: ToolActivity[];
  live: boolean;
  label?: string;
  startedAt?: number;
  endedAt?: number;
  error?: string;
  errorTone?: "strong" | "weak";
  onRetry?(): void;
}) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(() => Boolean(error && errorTone === "strong"));
  const [dismissedError, setDismissedError] = useState(false);
  const [born] = useState(() => Date.now());
  useEffect(() => {
    if (error && errorTone === "strong") setOpen(true);
  }, [error, errorTone]);
  useEffect(() => {
    setDismissedError(false);
  }, [error]);
  useEffect(() => {
    if (!error || errorTone !== "weak" || live || dismissedError) return;
    const timer = window.setTimeout(() => setDismissedError(true), 4000);
    return () => window.clearTimeout(timer);
  }, [error, errorTone, live, dismissedError]);
  const showError = error && !dismissedError;
  const rows = useMemo(() => traceRows(work, tools, text), [work, tools, text, locale]);
  const start = startedAt ?? (live ? born : undefined);
  const summary = useMemo(
    () => toolSummary(tools, rows.filter((row) => row.kind === "think").length),
    [tools, rows, locale],
  );
  const current = useMemo(() => liveStatus(tools), [tools, locale]);
  const header = live ? label ?? t("think.live") : t("think.done");
  const showLive = live && current !== header;
  const hasBody = rows.length > 0 || showLive || Boolean(showError);
  const expandable = live || hasBody;
  if (!expandable && !live) return null;
  return (
    <div className={live ? (open ? "trace live open" : "trace live") : open ? "trace open" : "trace"}>
      <button type="button" className="trace-toggle" onClick={() => expandable && setOpen((value) => !value)}>
        {live ? <Dots /> : <img className="trace-logo" src={logo} alt="" width={18} height={10} />}
        <span className={live ? "shimmer trace-label" : "trace-label"}>
          {header}
        </span>
        {summary && <span className="trace-subtle">{summary}</span>}
        {!open && showError && (
          <span className={errorTone === "weak" ? "trace-subtle trace-failed weak" : "trace-subtle trace-failed"}>
            {t("trace.requestFailed")}
          </span>
        )}
        <Elapsed start={start} end={endedAt} live={live} />
        {expandable ? <Icon className="chevron" path="M6 9l6 6 6-6" size={14} /> : null}
      </button>
      {open && expandable && (
        <div className="trace-rows">
          {rows.map((row) => <TraceRowView key={row.id} row={row} />)}
          {(showLive || (live && rows.length === 0)) && (
            <div className="trace-row-live">
              <span className="shimmer">{rows.length === 0 ? header : current}</span>
            </div>
          )}
          {showError && (
            <div className={errorTone === "weak" ? "trace-row-wrap weak-error" : "trace-row-wrap error"}>
              <div className="trace-row">
                <button
                  type="button"
                  className="trace-row-dismiss"
                  aria-label={t("common.close")}
                  onClick={() => setDismissedError(true)}
                >
                  <Icon className="trace-row-glyph" path="M18 6L6 18M6 6l12 12" size={13} />
                </button>
                <span className="trace-row-label">{t("trace.requestFailed")}</span>
                <span className="trace-row-chip">{error}</span>
                {onRetry && errorTone === "weak" && (
                  <button type="button" className="ghost" onClick={onRetry}>{t("common.continue")}</button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const TRACE_GLYPHS: Record<TraceRow["kind"], string> = {
  think: "M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z",
  write: "M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z",
  run: "M4 17l6-5-6-5M12 19h8",
  read: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
  look: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z",
  tool: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 8v4l2.5 1.5",
};

function TraceRowView({ row }: { row: TraceRow }) {
  const isDelegate = row.tool?.name === "delegate";
  const [open, setOpen] = useState(false);
  const detail = traceDetail(row);
  const chip = row.tool?.name === "vision" ? visionToolChips(row.tool.details).join(" · ") : row.chip;
  return (
    <div className={`trace-row-wrap ${row.status ?? ""}${open ? " open" : ""}`}>
      <button
        type="button"
        className="trace-row"
        aria-expanded={open}
        disabled={!detail}
        onClick={() => setOpen((was) => !was)}
      >
        <span className="trace-row-mark">
          <Icon className="trace-row-glyph" path={TRACE_GLYPHS[row.kind]} size={13} />
        </span>
        <span className="trace-row-label">{row.label}</span>
        {chip && <span className={row.mono ? "trace-row-chip mono" : "trace-row-chip"}>{chip}</span>}
        {detail ? <Icon className="trace-row-chevron chevron" path="M6 9l6 6 6-6" size={12} /> : null}
      </button>
      {open && detail && <div className="trace-row-detail">{detail}</div>}
    </div>
  );
}

function traceDetail(row: TraceRow): ReactNode {
  if (row.kind === "think") {
    return row.text ? <div className="trace-detail-text markdown"><Markdown>{row.text}</Markdown></div> : null;
  }
  const tool = row.tool;
  if (!tool) return null;
  if (tool.name === "delegate") {
    return <DelegateDetail tool={tool} />;
  }
  const command = formatCommand(toolCommand(tool));
  if (command) return <TerminalBlock command={command} tool={tool} />;
  if (tool.name === "vision") {
    const sections = tool.status === "running" ? [] : visionResultSections(tool.output);
    if (sections.length === 0) return null;
    return (
      <div className="vision-tool">
        {sections.map((section) => (
          <div key={section.label} className="vision-section">
            <strong>{section.label}</strong>
            <p>{section.text.length > 280 ? `${section.text.slice(0, 280)}…` : section.text}</p>
          </div>
        ))}
      </div>
    );
  }
  const web = webSearchCard(tool);
  if (web && (web.sources.length > 0 || web.summary)) {
    return <WebSearchDetail card={web} />;
  }
  const preview = toolWritePreview(tool, 24);
  const body = preview || tool.output?.trim() || "";
  if (!body) return null;
  return (
    <pre className="trace-detail-code">
      {body.split("\n").slice(0, 24).map((line, index) => (
        <span key={index} className={line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : ""}>{line}</span>
      ))}
    </pre>
  );
}

function WebSearchDetail({ card }: { card: NonNullable<ReturnType<typeof webSearchCard>> }) {
  return (
    <div className="web-tool">
      {card.summary ? <p className="web-tool-summary">{card.summary}</p> : null}
      {card.sources.map((source) => (
        <button
          key={source.url}
          type="button"
          className="web-source"
          onClick={() => void window.harness.app.openExternal(source.url)}
        >
          <span>{source.title}</span>
          <span className="web-source-host">{source.url.replace(/^https?:\/\//, "")}</span>
        </button>
      ))}
    </div>
  );
}

function DelegateDetail({ tool }: { tool: ToolActivity }) {
  const progress = delegateProgress(tool);
  const details = tool.details && typeof tool.details === "object" ? tool.details as Record<string, unknown> : {};
  const results = Array.isArray(details.results) ? details.results : [];
  if (progress.tasks.length === 0) return null;
  return (
    <div className="delegate-tool">
      {progress.tasks.map((item, index) => {
        const result = results.find((entry) => (
          entry
          && typeof entry === "object"
          && (entry as { role?: string }).role === item.role
          && (entry as { task?: string }).task === item.task
        )) as { output?: string; success?: boolean; diff?: string } | undefined;
        const output = typeof result?.output === "string" ? result.output : undefined;
        const diff = typeof result?.diff === "string" && result.diff.trim() ? result.diff.trim() : undefined;
        return (
          <DelegateTaskRow
            key={`${item.role}-${index}`}
            role={item.role}
            status={item.status}
            task={item.task}
            live={item.live}
            startedAt={tool.startedAt}
            output={diff ? [output, "```diff", diff, "```"].filter(Boolean).join("\n\n") : output}
          />
        );
      })}
    </div>
  );
}

function DelegateTaskRow({
  role,
  status,
  task,
  live,
  output,
  startedAt,
  defaultOpen = false,
}: {
  role: string;
  status: string;
  task: string;
  live?: string;
  output?: string;
  startedAt?: number;
  defaultOpen?: boolean;
}) {
  const { t } = useI18n();
  const summary = task.replace(/\s+/g, " ").trim();
  const [open, setOpen] = useState(defaultOpen);
  const [stale, setStale] = useState(false);
  const lastActivity = useRef(Date.now());
  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);
  useEffect(() => {
    if (status === "running") lastActivity.current = Date.now();
    else setStale(false);
  }, [status]);
  useEffect(() => {
    if (live?.trim()) lastActivity.current = Date.now();
  }, [live]);
  useEffect(() => {
    if (status !== "running") return;
    const timer = setInterval(() => {
      const anchor = startedAt ?? lastActivity.current;
      const quietFor = Date.now() - Math.max(anchor, lastActivity.current);
      setStale(quietFor >= 120_000);
    }, 15_000);
    return () => clearInterval(timer);
  }, [startedAt, status]);
  const showLive = status === "running" && Boolean(live?.trim());
  const body = [summary, showLive ? live : undefined, output?.trim()].filter(Boolean).join("\n\n");
  const canOpen = body.length > 0;
  return (
    <div className={`delegate-task ${status}${stale ? " stale" : ""}${open ? " open" : ""}`}>
      <button
        type="button"
        className="delegate-task-head"
        aria-expanded={open}
        disabled={!canOpen}
        onClick={() => canOpen && setOpen((was) => !was)}
      >
        <span className="delegate-role">{role}</span>
        <span className="delegate-status">
          {stale ? t("trace.delegateStale") : delegateStatusLabel(status as "pending" | "running" | "completed" | "failed")}
        </span>
        {!open && (showLive ? live : summary) && (
          <span className="delegate-summary">{showLive ? live : summary}</span>
        )}
        {canOpen && <Icon className="delegate-chevron chevron" path="M6 9l6 6 6-6" size={12} />}
      </button>
      {open && (
        <div className="delegate-task-body">
          {summary && <p className="delegate-task-text">{summary}</p>}
          {showLive && <p className="delegate-task-live">{live}</p>}
          {output?.trim() && (
            <div className="delegate-task-output markdown">
              <Markdown>{output.trim()}</Markdown>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TerminalBlock({ command, tool }: { command: string; tool: ToolActivity }) {
  const { t } = useI18n();
  const [showOutput, setShowOutput] = useState(tool.status === "error");
  const [expandedAll, setExpandedAll] = useState(false);
  const rawOutput = tool.output?.trim() ?? "";
  const hasOutput = Boolean(rawOutput);
  const isRunning = tool.status === "running";
  const isError = tool.status === "error";

  const lines = rawOutput ? rawOutput.split("\n") : [];
  const isTooLong = lines.length > 40;
  const displayOutput = isTooLong && !expandedAll ? `${lines.slice(0, 40).join("\n")}\n…` : rawOutput;

  return (
    <div className={`terminal-box ${tool.status}`}>
      <div className="terminal-bar">
        <div className="terminal-dots">
          <span className="terminal-dot red" />
          <span className="terminal-dot yellow" />
          <span className="terminal-dot green" />
          <span className="terminal-title">{tool.title || t("terminal.command")}</span>
        </div>
        <div className="terminal-actions">
          {isRunning && <span className="terminal-badge running"><i />{t("terminal.running")}</span>}
          {isError && <span className="terminal-badge error">{t("terminal.failed")}</span>}
          {!isRunning && !isError && tool.endedAt && tool.startedAt && (
            <span className="terminal-time">{formatDuration(tool.startedAt, tool.endedAt)}</span>
          )}
          {hasOutput && (
            <button
              type="button"
              className={`terminal-toggle-btn ${showOutput ? "on" : ""}`}
              onClick={() => setShowOutput((v) => !v)}
            >
              {showOutput ? t("terminal.hideOutput") : t("terminal.output")}
            </button>
          )}
        </div>
      </div>
      <div className="terminal-body">
        <div className="terminal-cmd-row">
          <span className="terminal-prompt">$</span>
          <pre className="terminal-cmd-text">{command}</pre>
        </div>
      </div>
      {showOutput && hasOutput && (
        <div className={`terminal-output ${isError ? "error" : ""}`}>
          <pre>{displayOutput}</pre>
          {isTooLong && (
            <button
              type="button"
              className="terminal-expand-btn"
              onClick={() => setExpandedAll((v) => !v)}
            >
              {expandedAll ? t("terminal.collapse") : t("terminal.expandAll", { n: lines.length })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Fold({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle(): void;
  children: ReactNode;
}) {
  return (
    <section className={open ? "fold open" : "fold"}>
      <button type="button" className="fold-head" onClick={onToggle}>
        {title}
        <Icon className="chevron" path="M6 9l6 6 6-6" size={14} />
      </button>
      {open && <div className="fold-body">{children}</div>}
    </section>
  );
}

function copyMarkdownPlain(event: { preventDefault(): void; clipboardData: DataTransfer | null }) {
  const selected = window.getSelection()?.toString();
  if (!selected) return;
  event.preventDefault();
  event.clipboardData?.setData("text/plain", selected);
}

function Markdown({ children, streaming }: { children: string; streaming?: boolean }) {
  const source = compactFencedCode(
    stripEmptyMarkdown(repairMarkdownTables(streaming ? closeOpenFences(children) : children)),
  );
  if (!source) return null;
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        pre({ children }) {
          const plain = extractNodeText(children).trim();
          if (!plain) return null;
          return <pre>{children}</pre>;
        },
        code({ children, className, ...props }) {
          const plain = extractNodeText(children).trim();
          if (!plain && !className) return null;
          return <code className={className} {...props}>{children}</code>;
        },
      }}
    >
      {source}
    </ReactMarkdown>
  );
}

/** Drop blank lines inside fenced code so SVG/XML dumps don't look double-spaced. */
function compactFencedCode(text: string): string {
  return text.replace(/```([^\n`]*)\n([\s\S]*?)```/g, (_full, lang: string, body: string) => {
    const tight = body.replace(/\n{2,}/g, "\n").replace(/^\n+|\n+$/g, "");
    return `\`\`\`${lang}\n${tight}\n\`\`\``;
  });
}

function closeOpenFences(text: string): string {
  const fences = text.match(/^```/gm)?.length ?? 0;
  return fences % 2 ? `${text}\n\`\`\`` : text;
}

function extractNodeText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractNodeText).join("");
  if (typeof node === "object" && "props" in node) {
    return extractNodeText((node as { props?: { children?: ReactNode } }).props?.children);
  }
  return "";
}

export function StreamingText({
  text,
  streaming,
}: {
  text: string;
  streaming?: boolean;
}) {
  if (!text && !streaming) return null;
  return (
    <div className={streaming ? "stream live" : "stream"}>
      {text ? (
        <div className="markdown">
          <Markdown streaming={streaming}>{text}</Markdown>
        </div>
      ) : null}
      {streaming ? <span className="caret" aria-hidden="true" /> : null}
    </div>
  );
}

export const AssistantTurn = memo(function AssistantTurn({
  messages,
  onOpenFile,
  errorRecovered = false,
  recoverableFailStreak = 0,
  onRetry,
}: {
  messages: ChatMessage[];
  onOpenFile?(file: FileChange): void;
  errorRecovered?: boolean;
  recoverableFailStreak?: number;
  onRetry?(): void;
}) {
  const thinking = collapseThinking(...messages.map((item) => item.thinking));
  const tools = [...new Map(messages.flatMap((item) => item.tools).map((tool) => [tool.id, tool])).values()];
  const work = turnWork(messages);
  const text = assistantReplyText(messages);
  const rawError = messages.map((item) => item.error).find(Boolean);
  const recoverable = isRecoverableRequestError(rawError);
  const errorTone = rawError
    ? (recoverable
      ? (errorRecovered ? "hidden" : recoverableFailStreak >= 2 ? "strong" : "weak")
      : "strong")
    : "hidden";
  const error = errorTone === "hidden" ? undefined : rawError;
  const live = messages.some((item) => item.streaming) || tools.some((item) => item.status === "running");
  const started = messages.find((item) => item.timestamp)?.timestamp ?? tools[0]?.startedAt;
  const ended = Math.max(0, ...messages.map((item) => item.timestamp ?? 0), ...tools.map((item) => item.endedAt ?? 0));
  const changes = collectFileChanges(tools);
  // Keep inter-tool text inside the trace (same as a live merged turn); only the last reply is outside.
  const traceWork = thinking || tools.length > 0
    ? omitFinalReply(work, text)
    : work.filter((item) => item.type !== "text");
  return (
    <article className="turn" onCopy={copyMarkdownPlain}>
      {(live || thinking || error || traceWork.length > 0 || tools.length > 0) && (
        <div className="turn-trace">
          <Thinking
            text={thinking}
            work={traceWork}
            tools={tools}
            live={live}
            startedAt={started}
            endedAt={ended || undefined}
            error={error}
            errorTone={errorTone === "weak" ? "weak" : "strong"}
            onRetry={onRetry}
          />
        </div>
      )}
      <ChangeSummary files={changes} onOpen={onOpenFile} />
      <StreamingText text={text} streaming={live} />
      {!live && text.trim() && (
        <div className="bubble-actions assistant">
          <CopyAction text={text} />
        </div>
      )}
    </article>
  );
});

function fileGlyph(path: string) {
  return /\.(tsx?|jsx?|mjs|cjs|css|json|ya?ml)$/i.test(path) ? "M8 8l-4 4 4 4M16 8l4 4-4 4" : "M6 3h9l5 5v13H6z";
}

function treeChange(path: string, changes: SessionFile[]) {
  return changes.find((item) => item.path === path || item.path.endsWith(`/${path}`) || path.endsWith(`/${item.path}`));
}

export function InspectPanel({
  files = [],
  todos,
  terminals = [],
  folder,
  workspace,
  refresh,
  running,
  planApproval = false,
  onApprovePlan,
  onRefinePlan,
  onOpen,
  onUndo,
  onStopTerminal,
  onStopAllTerminals,
}: {
  files?: SessionFile[];
  todos: SessionTodo[];
  terminals?: SessionTerminal[];
  folder?: string;
  workspace?: string;
  refresh?: number | boolean;
  running?: boolean;
  planApproval?: boolean;
  onApprovePlan?(): void;
  onRefinePlan?(text: string): void;
  onOpen(file: FileChange): void;
  onUndo?(): void;
  onStopTerminal?(id: string): void;
  onStopAllTerminals?(): void;
}) {
  const { t } = useI18n();
  const [progress, setProgress] = useState(true);
  const [refineOpen, setRefineOpen] = useState(false);
  const [refineText, setRefineText] = useState("");
  const [changesOpen, setChangesOpen] = useState(true);
  const [termsOpen, setTermsOpen] = useState(false);
  const [openTerm, setOpenTerm] = useState<string>();
  const [working, setWorking] = useState(true);
  const [treeOpen, setTreeOpen] = useState(true);
  const [entries, setEntries] = useState<string[]>([]);
  const [prefix, setPrefix] = useState("");
  const [tick, setTick] = useState(0);
  const dragging = useRef(false);
  const edits = files.filter((file) => file.kind === "edit");
  useEffect(() => window.harness.workspace.onChanged(() => {
    if (workspace) setTick((value) => value + 1);
  }), [workspace]);
  useEffect(() => {
    if (!workspace) {
      setEntries([]);
      setPrefix("");
      return;
    }
    let gone = false;
    void window.harness.workspace.list(workspace).then((next) => {
      if (!gone) setEntries(next);
    }).catch(() => {
      if (!gone) setEntries([]);
    });
    return () => {
      gone = true;
    };
  }, [workspace, refresh, tick]);
  const visible = filterMentionPaths(entries, prefix).filter((file) => file !== prefix);
  if (!workspace && todos.length === 0 && !planApproval) return null;
  return (
    <aside className="inspect">
      {planApproval && onApprovePlan && (
        <div className="plan-approval">
          <p>{t("plan.approvalHint")}</p>
          <div className="plan-approval-actions">
            <button type="button" className="primary" onClick={onApprovePlan}>{t("plan.approve")}</button>
            <button
              type="button"
              className="ghost"
              onClick={() => setRefineOpen((current) => !current)}
            >
              {t("plan.refine")}
            </button>
          </div>
          {refineOpen && onRefinePlan && (
            <div className="plan-refine">
              <textarea
                value={refineText}
                onChange={(event) => setRefineText(event.target.value)}
                placeholder={t("plan.refinePlaceholder")}
                rows={3}
              />
              <button
                type="button"
                className="ghost"
                disabled={!refineText.trim()}
                onClick={() => {
                  const text = refineText.trim();
                  if (!text) return;
                  onRefinePlan(text);
                  setRefineText("");
                  setRefineOpen(false);
                }}
              >
                {t("plan.refineSubmit")}
              </button>
            </div>
          )}
        </div>
      )}
      {todos.length > 0 && (
        <Fold
          title={`${t("inspect.progress")} ${todos.filter((item) => item.done).length}/${todos.length}`}
          open={progress}
          onToggle={() => setProgress((current) => !current)}
        >
          <ol className="inspect-todos">
            {todos.map((todo, index) => (
              <li key={todo.id} className={todo.done ? "done" : todo.active ? "active" : ""}>
                <i>{todo.done ? <Icon path="M5 12.5l4 4 10-10" size={11} /> : index + 1}</i>
                <span>{todo.text}</span>
              </li>
            ))}
          </ol>
        </Fold>
      )}
      {edits.length > 0 && (
        <Fold title={t("inspect.changes")} open={changesOpen} onToggle={() => setChangesOpen((current) => !current)}>
          <div className="inspect-changes">
            {edits.map((file) => (
              <button
                key={file.path}
                type="button"
                className="inspect-file edit"
                draggable
                onDragStart={(event) => {
                  dragging.current = true;
                  beginTreeDrag(event, file.path, baseName(file.path));
                }}
                onDragEnd={() => {
                  treeDragPath = "";
                  requestAnimationFrame(() => { dragging.current = false; });
                }}
                onClick={() => {
                  if (dragging.current) return;
                  onOpen(file);
                }}
              >
                <Icon path={fileGlyph(file.path)} size={14} />
                <span>{baseName(file.path)}</span>
                <small>
                  {file.additions > 0 ? <b className="add">+{file.additions}</b> : null}
                  {file.deletions > 0 ? <b className="del">-{file.deletions}</b> : null}
                  {file.additions === 0 && file.deletions === 0 ? t("inspect.changed") : null}
                </small>
              </button>
            ))}
            {onUndo && !running && (
              <button type="button" className="inspect-undo" onClick={onUndo}>{t("inspect.undo")}</button>
            )}
          </div>
        </Fold>
      )}
      {workspace && (
        <Fold title={t("inspect.terminals", { n: terminals.length })} open={termsOpen} onToggle={() => setTermsOpen((current) => !current)}>
          {terminals.length === 0 ? (
            <p className="sidebar-empty">{t("inspect.noTerminals")}</p>
          ) : (
            <div className="inspect-changes">
              {terminals.map((job) => {
                const label = terminalLabel(job.command);
                return (
                  <div key={job.id} className={openTerm === job.id ? "inspect-term open" : "inspect-term"}>
                    <button
                      type="button"
                      className="inspect-file"
                      onClick={() => setOpenTerm((current) => current === job.id ? undefined : job.id)}
                    >
                      <i className="inspect-live" />
                      <span title={job.command}>{label}</span>
                      <small>{t("inspect.terminalLive")}</small>
                    </button>
                    {openTerm === job.id && <pre className="inspect-cmd">{job.command}</pre>}
                    {onStopTerminal && (
                      <button type="button" className="inspect-stop" onClick={() => onStopTerminal(job.id)}>
                        {t("inspect.stop")}
                      </button>
                    )}
                  </div>
                );
              })}
              {onStopAllTerminals && terminals.length > 1 && (
                <button type="button" className="inspect-undo" onClick={onStopAllTerminals}>{t("inspect.stopAll")}</button>
              )}
            </div>
          )}
        </Fold>
      )}
      {workspace && (
        <Fold title={t("inspect.files")} open={working} onToggle={() => setWorking((current) => !current)}>
          <div className="tree">
            <button
              type="button"
              className={treeOpen ? "tree-dir open" : "tree-dir"}
              onContextMenu={(event) => {
                event.preventDefault();
                void window.harness.workspace.reveal(prefix || ".", workspace);
              }}
              onClick={() => {
                if (prefix) setPrefix(prefix.replace(/[^/]+\/$/, ""));
                else setTreeOpen((current) => !current);
              }}
            >
              <Icon className="chevron" path="M6 9l6 6 6-6" size={12} />
              <Icon path="M3 7h6l2 2h10v10H3z" size={14} />
              {prefix ? prefix.replace(/\/$/, "") : folder ?? t("inspect.workspace")}
            </button>
            {treeOpen && visible.length === 0 && <p className="sidebar-empty">{t("inspect.noFiles")}</p>}
            {treeOpen && visible.map((file) => {
              const dir = file.endsWith("/");
              const name = (prefix ? file.slice(prefix.length) : file).replace(/\/$/, "");
              const change = dir ? undefined : treeChange(file, files);
              const dirty = change?.kind === "edit" || (dir && files.some((item) => item.kind === "edit" && item.path.startsWith(file)));
              return (
                <button
                  key={file}
                  type="button"
                  className={dirty ? "inspect-file edit" : "inspect-file"}
                  draggable
                  onDragStart={(event) => {
                    dragging.current = true;
                    beginTreeDrag(event, file, name);
                  }}
                  onDragEnd={() => {
                    treeDragPath = "";
                    requestAnimationFrame(() => { dragging.current = false; });
                  }}
                  onClick={() => {
                    if (dragging.current) return;
                    if (dir) setPrefix(file);
                    else onOpen(change ?? { path: file, additions: 0, deletions: 0 });
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    void window.harness.workspace.reveal(file, workspace);
                  }}
                >
                  <Icon path={dir ? "M3 7h6l2 2h10v10H3z" : fileGlyph(file)} size={14} />
                  <span>{name}</span>
                </button>
              );
            })}
          </div>
        </Fold>
      )}
    </aside>
  );
}

function ChangeSummary({ files, onOpen }: { files: FileChange[]; onOpen?(file: FileChange): void }) {
  if (files.length === 0) return null;
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  return (
    <div className="changes">
      {(additions > 0 || deletions > 0) && (
        <>
          <span className="add">+{additions}</span>
          <span className="del">-{deletions}</span>
        </>
      )}
      {files.map((file) => (
        <button key={file.path} type="button" className="change-file" onClick={() => onOpen?.(file)}>
          {baseName(file.path)}
          {(file.additions > 0 || file.deletions > 0) && (
            <small>
              {file.additions > 0 ? `+${file.additions}` : ""}
              {file.deletions > 0 ? ` -${file.deletions}` : ""}
            </small>
          )}
        </button>
      ))}
    </div>
  );
}

export function FileDrawer({ file, workspace, onClose }: { file: FileChange; workspace?: string; onClose(): void }) {
  const { t } = useI18n();
  const [body, setBody] = useState(() => t("preview.reading"));
  const [wide, setWide] = useState(false);
  const markdown = /\.(md|markdown)$/i.test(file.path);
  const html = /\.html?$/i.test(file.path);
  const [rendered, setRendered] = useState(markdown);
  const [diffOpen, setDiffOpen] = useState(false);
  useEffect(() => {
    setDiffOpen(false);
    setRendered(markdown);
  }, [file.path, markdown]);
  useEffect(() => {
    let gone = false;
    setBody(t("preview.reading"));
    void window.harness.workspace.read(file.path, workspace).then(
      (result) => {
        if (!gone) setBody(result.binary ? t("preview.binary") : result.content);
      },
      (error: unknown) => {
        if (!gone) setBody(error instanceof Error ? error.message : String(error));
      },
    );
    return () => {
      gone = true;
    };
  }, [file.path, workspace, t]);
  const preview = rendered && (markdown || html);
  const diff = Boolean(file.patch && diffOpen && !preview);
  return (
    <aside className={wide ? "drawer wide" : "drawer"}>
      <header>
        <div>
          <strong>{baseName(file.path)}</strong>
          <small>{file.path}</small>
        </div>
        {file.patch ? (
          <button
            type="button"
            className={diffOpen ? "diff-toggle on" : "diff-toggle"}
            onClick={() => {
              setDiffOpen((open) => !open);
              setRendered(false);
            }}
          >
            {diffOpen ? t("preview.currentFile") : t("preview.viewDiff")}
            {file.additions > 0 && <b className="add">+{file.additions}</b>}
            {file.deletions > 0 && <b className="del">-{file.deletions}</b>}
          </button>
        ) : (
          <span>
            {file.additions > 0 && <b className="add">+{file.additions}</b>}
            {file.deletions > 0 && <b className="del">-{file.deletions}</b>}
          </span>
        )}
        {(markdown || html) && (
          <button
            type="button"
            className={preview ? "drawer-btn on" : "drawer-btn"}
            aria-label={preview ? t("preview.source") : t("preview.preview")}
            onClick={() => setRendered((current) => !current)}
          >
            <Icon
              path={
                preview
                  ? "M15 7l5 5-5 5M9 17l-5-5 5-5"
                  : "M3.5 12s3.2-6.5 8.5-6.5S20.5 12 20.5 12 17.3 18.5 12 18.5 3.5 12 3.5 12M12 9.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5"
              }
              size={15}
            />
          </button>
        )}
        <CopyButton text={body} className="drawer-btn" size={15} />
        <button type="button" className="drawer-btn" aria-label={t("preview.open")} onClick={() => void window.harness.workspace.open(file.path, workspace)}>
          <Icon path="M13.5 5.5H18.5V10.5M18.5 5.5L11 13M10 5.5H6.5V18.5H18.5V14" size={15} />
        </button>
        <button type="button" className="drawer-btn" aria-label={wide ? t("preview.restore") : t("preview.expand")} onClick={() => setWide((current) => !current)}>
          <Icon
            path={
              wide
                ? "M5 13.5h5.5V19M19 10.5h-5.5V5M13.5 19v-5.5H19M10.5 5v5.5H5"
                : "M14.5 5H19V9.5M9.5 19H5V14.5M19 14.5V19H14.5M5 9.5V5H9.5"
            }
            size={15}
          />
        </button>
        <button type="button" className="drawer-btn drawer-close" aria-label={t("common.close")} onClick={onClose}>
          <Icon path="M7 7l10 10M17 7L7 17" size={15} />
        </button>
      </header>
      {diff && (
        <div className="file-diff">
          {splitView(file.patch!).map((row, index) => (
            <div key={index} className={`diff-line ${row.kind}`}>
              <i>{row.left ?? ""}</i>
              <i>{row.right ?? ""}</i>
              <b>{row.kind === "add" ? "+" : row.kind === "del" ? "-" : " "}</b>
              <pre>{(row.kind === "del" ? row.old : row.next) || " "}</pre>
            </div>
          ))}
        </div>
      )}
      {diff ? null : preview && html ? (
        <iframe
          className="file-frame"
          title={t("preview.title", { path: file.path })}
          src={previewUrl(file.path)}
          sandbox="allow-scripts allow-same-origin allow-forms"
        />
      ) : preview ? (
        <div className="file-preview markdown">
          <Markdown>{body}</Markdown>
        </div>
      ) : (
        <pre className="file-code" key={file.path}>
          {tokenizeCode(body, file.path).map((tokens, index) => (
            <span key={index} className="code-line">
              <i>{index + 1}</i>
              <span>
                {tokens.length === 0
                  ? " "
                  : tokens.map((token, spot) => token.kind
                    ? <em key={spot} className={token.kind}>{token.text}</em>
                    : <span key={spot}>{token.text}</span>)}
              </span>
            </span>
          ))}
        </pre>
      )}
    </aside>
  );
}

function splitView(patch: string) {
  let oldNo = 0;
  let nextNo = 0;
  return splitPatch(patch).filter((row) => row.kind !== "meta").map((row) => ({
    ...row,
    left: row.kind === "add" ? undefined : ++oldNo,
    right: row.kind === "del" ? undefined : ++nextNo,
  }));
}

/** Served by the main process from the workspace, so relative assets and page storage both work. */
function previewUrl(file: string): string {
  const path = file.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
  return `${PREVIEW_SCHEME}://${PREVIEW_HOST}/${path}`;
}

function mentionAt(text: string, cursor: number): { start: number; query: string } | undefined {
  const before = text.slice(0, cursor);
  const start = before.lastIndexOf("@");
  if (start < 0) return;
  if (start > 0 && !/\s/.test(before[start - 1]!)) return;
  const query = before.slice(start + 1);
  if (/[\s@]/.test(query)) return;
  return { start, query };
}

function promptTokenLength(el: HTMLElement): number {
  if (el.dataset.url) return el.dataset.url.length;
  if (el.dataset.file) return `@${el.dataset.file}`.length;
  return 0;
}

function serializePrompt(root: HTMLElement): string {
  let out = "";
  const push = (chunk: string) => {
    if (!chunk) return;
    if (out && !/\s$/.test(out) && !/^\s/.test(chunk)) out += " ";
    out += chunk;
  };
  const walk = (parent: Node) => {
    for (const node of parent.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        out += (node.textContent ?? "").replace(/\u00a0/g, " ");
        continue;
      }
      if (!(node instanceof HTMLElement)) continue;
      if (node.dataset.url) push(node.dataset.url);
      else if (node.dataset.file) push(`@${node.dataset.file}`);
      else if (node.tagName === "BR") out += "\n";
      else if (!node.dataset.image) walk(node);
    }
  };
  walk(root);
  return out;
}

function collectPromptImages(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLElement>("[data-image]")].map((node) => node.dataset.image!).filter(Boolean);
}

function caretOffset(root: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.anchorNode || !root.contains(sel.anchorNode)) return serializePrompt(root).length;
  const endNode = sel.anchorNode;
  const endOff = sel.anchorOffset;
  let offset = 0;
  const visit = (node: Node): boolean => {
    if (node === endNode && node.nodeType === Node.TEXT_NODE) {
      offset += endOff;
      return true;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      offset += node.textContent?.length ?? 0;
      return false;
    }
    if (node instanceof HTMLElement && (node.dataset.url || node.dataset.file || node.dataset.image)) {
      offset += promptTokenLength(node);
      return node === endNode || node.contains(endNode);
    }
    for (const child of node.childNodes) {
      if (visit(child)) return true;
    }
    return false;
  };
  for (const child of root.childNodes) {
    if (visit(child)) break;
  }
  return offset;
}

function placeCaret(root: HTMLElement, offset: number): void {
  const sel = window.getSelection();
  if (!sel) return;
  let left = offset;
  const range = document.createRange();
  const visit = (node: Node): boolean => {
    if (node.nodeType === Node.TEXT_NODE) {
      const size = node.textContent?.length ?? 0;
      if (left <= size) {
        range.setStart(node, Math.max(0, left));
        range.collapse(true);
        return true;
      }
      left -= size;
      return false;
    }
    if (node instanceof HTMLElement && (node.dataset.url || node.dataset.file || node.dataset.image)) {
      const size = promptTokenLength(node);
      if (left <= size) {
        range.setStartAfter(node);
        range.collapse(true);
        return true;
      }
      left -= size;
      return false;
    }
    for (const child of node.childNodes) {
      if (visit(child)) return true;
    }
    return false;
  };
  for (const child of root.childNodes) {
    if (visit(child)) {
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
  }
  range.selectNodeContents(root);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

function promptSvg(path: string, size: number): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.75");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const item = document.createElementNS("http://www.w3.org/2000/svg", "path");
  item.setAttribute("d", path);
  svg.append(item);
  return svg;
}

function makeUploadChip(item: { id: string; name: string; dataUri: string }): HTMLSpanElement {
  const chip = document.createElement("span");
  chip.className = "prompt-upload";
  chip.contentEditable = "false";
  chip.dataset.image = item.dataUri;
  chip.dataset.uploadId = item.id;
  chip.tabIndex = -1;
  chip.setAttribute("role", "button");
  const img = document.createElement("img");
  img.src = item.dataUri;
  img.alt = "";
  chip.append(img);
  const close = document.createElement("span");
  close.dataset.remove = "1";
  close.append(promptSvg("M18 6L6 18M6 6l12 12", 11));
  chip.append(close);
  return chip;
}

function insertNodeAtCaret(root: HTMLElement, node: Node): void {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !root.contains(sel.anchorNode)) {
    root.append(node);
    return;
  }
  const range = sel.getRangeAt(0);
  range.deleteContents();
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

function droppedAbsPath(file: File): string {
  const path = (file as File & { path?: string }).path;
  return typeof path === "string" ? path : "";
}

function hydratePrompt(root: HTMLElement, text: string): void {
  const images = [...root.querySelectorAll<HTMLElement>("[data-image]")];
  root.replaceChildren();
  if (text) root.append(document.createTextNode(text));
  for (const image of images) root.append(image);
}

function flattenPromptBlocks(root: HTMLElement): void {
  for (const el of [...root.querySelectorAll(".inspect-file")]) el.remove();
  for (const block of [...root.querySelectorAll<HTMLElement>("div, p")]) {
    if (block.dataset.url || block.dataset.file || block.dataset.image) continue;
    block.replaceWith(...block.childNodes);
  }
}

function isPromptEmpty(root: HTMLElement): boolean {
  return !serializePrompt(root).trim() && collectPromptImages(root).length === 0;
}

export function PromptBar({
  fillText,
  fillToken = 0,
  onSubmit,
  onStop,
  steering,
  rootRef,
  running,
  disabled,
  workspace,
  onPickWorkspace,
  model,
  models,
  onModel,
  effort,
  effortLevels,
  onEffort,
  permission,
  onPermission,
  onCommand,
  stats,
  onCompact,
  skillCommands = [],
  placement = "dock",
}: {
  /** Parent bumps fillToken when it wants to inject/clear the composer (edit queue, restore, reset). */
  fillText?: string;
  fillToken?: number;
  onSubmit(text?: string, images?: string[]): void;
  onStop(): void;
  steering?: string[];
  rootRef?: Ref<HTMLDivElement>;
  running: boolean;
  disabled?: boolean;
  workspace?: string;
  onPickWorkspace(): void;
  model: string;
  models: { value: string; label: string }[];
  onModel(value: string): void;
  effort: string;
  effortLevels: string[];
  onEffort(value: string): void;
  permission: string;
  onPermission(value: string): void;
  onCommand(command: string): void;
  stats?: AgentSessionStats;
  onCompact?(): void;
  skillCommands?: AgentSkillCommand[];
  placement?: "dock" | "hero";
}) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const [cursor, setCursor] = useState(0);
  const [files, setFiles] = useState<string[]>([]);
  const [listing, setListing] = useState(false);
  const [picked, setPicked] = useState(0);
  const [dropOver, setDropOver] = useState(false);
  const [blank, setBlank] = useState(true);
  const skipHydrate = useRef(false);
  const area = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const mention = workspace ? mentionAt(value, cursor) : undefined;
  const matches = mention ? filterMentionPaths(files, mention.query) : [];

  useEffect(() => {
    setValue(fillText ?? "");
  }, [fillToken]);

  useEffect(() => {
    const root = area.current;
    if (!root) return;
    const lock = (event: Event) => {
      const drag = event as globalThis.DragEvent;
      if (!drag.dataTransfer || !isPromptFileDrag(drag.dataTransfer)) return;
      event.preventDefault();
      drag.dataTransfer.dropEffect = "copy";
      root.contentEditable = "false";
    };
    const hosts: EventTarget[] = [root];
    if (root.parentElement) hosts.push(root.parentElement);
    for (const host of hosts) host.addEventListener("dragover", lock, true);
    return () => {
      for (const host of hosts) host.removeEventListener("dragover", lock, true);
    };
  }, []);

  const emit = () => {
    const root = area.current;
    if (!root) return "";
    flattenPromptBlocks(root);
    if (isPromptEmpty(root) && !root.querySelector("[data-url], [data-file], [data-image]")) root.replaceChildren();
    const next = serializePrompt(root);
    setBlank(isPromptEmpty(root));
    setCursor(caretOffset(root));
    skipHydrate.current = true;
    if (next !== value) setValue(next);
    return next;
  };

  const [tick, setTick] = useState(0);
  useEffect(() => window.harness.workspace.onChanged(() => {
    if (workspace) setTick((value) => value + 1);
  }), [workspace]);
  useEffect(() => {
    if (!workspace) {
      setFiles([]);
      return;
    }
    let gone = false;
    setListing(true);
    void window.harness.workspace.list(workspace).then((next) => {
      if (!gone) setFiles(next);
    }).catch(() => {
      if (!gone) setFiles([]);
    }).finally(() => {
      if (!gone) setListing(false);
    });
    return () => {
      gone = true;
    };
  }, [workspace, tick]);

  useEffect(() => {
    setPicked(0);
  }, [mention?.query, value]);

  useEffect(() => {
    menu.current?.querySelector(".on")?.scrollIntoView({ block: "nearest" });
  }, [picked]);

  useEffect(() => {
    const root = area.current;
    if (!root) return;
    if (skipHydrate.current) {
      skipHydrate.current = false;
      return;
    }
    if (serializePrompt(root) === value) return;
    hydratePrompt(root, value);
    setBlank(isPromptEmpty(root));
  }, [value]);

  const addUploads = async (list: FileList | File[]) => {
    const root = area.current;
    if (!root) return;
    const next: Array<{ id: string; name: string; dataUri: string }> = [];
    for (const file of [...list]) {
      if (!file.type.startsWith("image/")) continue;
      next.push({
        id: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`,
        name: file.name,
        dataUri: await readDataUri(file, t),
      });
    }
    if (next.length === 0) return;
    const room = MAX_UPLOAD_IMAGES - collectPromptImages(root).length;
    root.focus();
    for (const item of next.slice(0, Math.max(0, room))) {
      insertNodeAtCaret(root, makeUploadChip(item));
    }
    emit();
  };

  const insertFile = (file: string, confirm = false) => {
    const root = area.current;
    if (!mention || !root) return;
    const folder = file.endsWith("/");
    const seal = confirm || !folder || mention.query === file;
    if (seal) {
      const next = `${value.slice(0, mention.start)}@${file} ${value.slice(cursor)}`;
      const caret = mention.start + file.length + 2;
      setValue(next);
      setCursor(caret);
      requestAnimationFrame(() => {
        root.focus();
        placeCaret(root, caret);
      });
      return;
    }
    const next = `${value.slice(0, mention.start)}@${file}${value.slice(cursor)}`;
    setValue(next);
    const caret = mention.start + file.length + 1;
    setCursor(caret);
    requestAnimationFrame(() => {
      root.focus();
      placeCaret(root, caret);
    });
  };

  const slash = skillCommands.length > 0 && (value === "/" || /^\/[^\s]*$/.test(value));
  const commands = skillCommands
    .map((skill) => ({ id: skillSlashCommand(skill.name) }))
    .filter((item) => item.id.startsWith(value || "/"));

  const insertSkillCommand = (command: string) => {
    const next = `${command} `;
    setValue(next);
    const caret = next.length;
    setCursor(caret);
    setPicked(0);
    requestAnimationFrame(() => {
      area.current?.focus();
      if (area.current) placeCaret(area.current, caret);
    });
  };

  const sendNow = () => {
    const root = area.current;
    if (!root || disabled) return;
    const text = serializePrompt(root).trim();
    const refs = collectPromptImages(root);
    if (!text && refs.length === 0) return;
    root.replaceChildren();
    setBlank(true);
    setValue("");
    onSubmit(text, refs.length ? refs : undefined);
  };

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const root = area.current;
    if (!root) return;
    setCursor(caretOffset(root));
    if (slash && commands.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setPicked((current) => (current + 1) % commands.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setPicked((current) => (current - 1 + commands.length) % commands.length);
        return;
      }
      if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey) {
        event.preventDefault();
        const cmd = commands[picked] ?? commands[0];
        if (cmd) insertSkillCommand(cmd.id);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setValue("");
        return;
      }
    }
    if (matches.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setPicked((current) => (current + 1) % matches.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setPicked((current) => (current - 1 + matches.length) % matches.length);
        return;
      }
      if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey) {
        event.preventDefault();
        insertFile(matches[picked] ?? matches[0]!, event.key === "Enter");
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (mention?.query) {
          setValue(`${value.slice(0, cursor)} ${value.slice(cursor)}`);
          setCursor(cursor + 1);
        } else {
          setValue(`${value.slice(0, mention?.start ?? cursor)}${value.slice(cursor)}`);
        }
        return;
      }
    }
    if (slash && event.key === "Enter" && commands[0] && !event.shiftKey) {
      event.preventDefault();
      insertSkillCommand((commands[picked] ?? commands[0]).id);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      sendNow();
      return;
    }
  };

  const dropIntoPrompt = (event: DragEvent<HTMLElement>) => {
    if (!isPromptFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    const root = area.current;
    if (root) root.contentEditable = "false";
    setDropOver(false);
    if (!root) return;
    const paths: string[] = [];
    const treePath = treeDragPath || event.dataTransfer.getData(PATH_MIME);
    const dropped = [...event.dataTransfer.files];
    const images = dropped.filter((file) => file.type.startsWith("image/"));
    if (images.length) void addUploads(images);
    if (treePath) {
      paths.push(treePath);
    } else if (workspace) {
      for (const file of dropped) {
        if (file.type.startsWith("image/")) continue;
        const rel = workspaceRelative(droppedAbsPath(file), workspace);
        if (!rel) continue;
        paths.push(files.includes(`${rel}/`) ? `${rel}/` : rel);
      }
    }
    if (paths.length === 0) {
      root.contentEditable = "true";
      return;
    }
    let next = serializePrompt(root);
    let caret = Math.min(cursor, next.length);
    for (const path of paths) {
      const inserted = spliceFileMention(next, path, caret);
      next = inserted.next;
      caret = inserted.caret;
    }
    setValue(next);
    setCursor(caret);
    requestAnimationFrame(() => {
      const node = area.current;
      if (!node) return;
      node.contentEditable = "true";
      node.focus();
      placeCaret(node, caret);
    });
  };
  const hero = placement === "hero";
  const folder = workspace ? baseName(workspace) : undefined;
  return (
    <div ref={rootRef} className={hero ? "prompt-wrap hero" : "prompt-wrap"}>
      <div className="prompt-shell">
        <div className="prompt-topbar">
          <div className="prompt-topbar-row">
            <button
              type="button"
              className={folder ? "prompt-folder on" : "prompt-folder"}
              onClick={onPickWorkspace}
              title={workspace ?? t("composer.selectOrOpen")}
            >
              <Icon path="M3 7h6l2 2h10v10H3z" size={13} />
              <span>{folder ?? t("composer.selectProject")}</span>
            </button>
            {steering && steering.length > 0 && (
              <div className="prompt-queue-meta">
                <span className="prompt-steer-count">{t("composer.steering", { n: steering.length })}</span>
              </div>
            )}
          </div>
          {steering && steering.length > 0 && (
            <div className="prompt-steer">
              {steering.map((item, index) => (
                <div key={`${index}-${item}`} className="prompt-steer-row">
                  <Icon path="M12 19V5M5 12l7-7 7 7" size={12} />
                  <p className="prompt-steer-text">{item}</p>
                </div>
              ))}
            </div>
          )}
        </div>
        <form
          className={dropOver ? "prompt drop" : "prompt"}
          onDragOverCapture={(event) => {
            if (!isPromptFileDrag(event.dataTransfer)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            if (area.current) area.current.contentEditable = "false";
            setDropOver(true);
          }}
          onDragLeave={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node)) return;
            setDropOver(false);
            if (area.current) area.current.contentEditable = "true";
          }}
          onDropCapture={dropIntoPrompt}
          onSubmit={(event) => {
            event.preventDefault();
            if (slash && commands[0]) {
              insertSkillCommand((commands[picked] ?? commands[0]).id);
              return;
            }
            sendNow();
          }}
        >
        <div
          ref={area}
          className={blank ? "prompt-input empty" : "prompt-input"}
          contentEditable={!dropOver}
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          data-placeholder={running ? t("composer.placeholderFollowup") : workspace ? t("composer.placeholderWorkspace") : t("composer.placeholderEmpty")}
          onDragOverCapture={(event) => {
            if (!isPromptFileDrag(event.dataTransfer)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            event.currentTarget.contentEditable = "false";
          }}
          onMouseDown={(event) => {
            if ((event.target as HTMLElement).closest(".prompt-upload")) event.preventDefault();
          }}
          onInput={emit}
          onKeyUp={() => area.current && setCursor(caretOffset(area.current))}
          onClick={(event) => {
            const remove = (event.target as HTMLElement).closest("[data-remove]");
            if (!remove) return;
            event.preventDefault();
            remove.closest(".prompt-upload")?.remove();
            emit();
            area.current?.focus();
          }}
          onKeyDown={onKey}
          onPaste={(event) => {
            const images = [...event.clipboardData.files].filter((file) => file.type.startsWith("image/"));
            if (images.length > 0) {
              event.preventDefault();
              void addUploads(images);
              return;
            }
          }}
        />
        {slash && (
          <div className="slash-menu">
            {commands.length === 0 && <p className="slash-empty">{t("composer.noCommands")}</p>}
            {commands.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className={index === picked ? "on" : ""}
                onClick={() => insertSkillCommand(item.id)}
              >
                <code>{item.id}</code>
              </button>
            ))}
          </div>
        )}
        {mention && !slash && (
          <div
            className="slash-menu files"
            ref={menu}
            onMouseDown={(event) => event.preventDefault()}
            onWheel={(event) => event.stopPropagation()}
          >
            {matches.length === 0 && <p className="slash-empty">{listing ? t("composer.listingFiles") : t("composer.noFiles")}</p>}
            {matches.map((file, index) => (
              <button
                key={file}
                type="button"
                className={index === picked ? "on" : ""}
                onClick={() => insertFile(file)}
              >
                <span>{file}</span>
                {file.endsWith("/") && mention.query === file && <small>{t("composer.selectDir")}</small>}
              </button>
            ))}
          </div>
        )}
        <div className="prompt-bar">
          <input
            ref={picker}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            hidden
            onChange={(event) => {
              if (event.target.files) void addUploads(event.target.files);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            className="prompt-attach"
            aria-label={t("composer.uploadImage")}
            disabled={(area.current ? collectPromptImages(area.current).length : 0) >= MAX_UPLOAD_IMAGES}
            onClick={() => picker.current?.click()}
          >
            <Icon path="M12 5v14M5 12h14" size={15} />
          </button>
          <Combo value={model} options={models} searchable placeholder={t("composer.filterModels")} down={hero} onChange={onModel} />
          {reasoningLevelsAvailable(effortLevels) && (
            <EffortPicker value={effort} levels={effortLevels} down={hero} onChange={onEffort} />
          )}
          <PermissionPicker value={permission} down={hero} onChange={onPermission} />
          {!hero && (
            <ContextStats
              stats={stats}
              model={model}
              effort={effort}
              effortLevels={effortLevels}
              up
              running={running}
              busy={disabled}
              onCompact={onCompact}
            />
          )}
          {running ? (
            <button type="button" className="send stop" onClick={onStop} aria-label={t("composer.abort")}>
              <i />
            </button>
          ) : (
            <button type="submit" className="send" disabled={disabled || blank} aria-label={t("composer.send")}>
              <Icon path="M12 19V5M5 12l7-7 7 7" size={15} />
            </button>
          )}
        </div>
      </form>
      </div>
    </div>
  );
}

function readDataUri(file: File, t: ReturnType<typeof useI18n>["t"]): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(t("readError", { name: file.name })));
    reader.readAsDataURL(file);
  });
}

export interface PermissionOptionConfig {
  value: PermissionMode;
  label: string;
  desc: string;
  icon: string;
  danger?: boolean;
}

function permissionOptions(t: ReturnType<typeof useI18n>["t"]): PermissionOptionConfig[] {
  return [
  {
    value: "plan",
    label: t("perm.plan"),
    desc: t("perm.planDesc"),
    icon: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  },
  {
    value: "ask",
    label: t("perm.ask"),
    desc: t("perm.askDesc"),
    icon: "M12 22a10 10 0 1 0-10-10 10 10 0 0 0 10 10zm0-14v5m0 3h.01",
  },
  {
    value: "auto",
    label: t("perm.auto"),
    desc: t("perm.autoDesc"),
    icon: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  },
  {
    value: "full",
    label: t("perm.full"),
    desc: t("perm.fullDesc"),
    icon: "M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 0c2.5 0 4.5 4.5 4.5 10s-2 10-4.5 10-4.5-4.5-4.5-10 2-10 4.5-10z M2 12h20",
    danger: true,
  },
  ];
}

export function PermissionPicker({
  value,
  onChange,
  down,
}: {
  value: PermissionMode | string;
  onChange(value: string): void;
  down?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const options = permissionOptions(t);
  const selected = options.find((item) => item.value === value) ?? options[2]!;

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={box} className={`combo permission-combo${open ? " open" : ""}${down ? " down" : ""}`}>
      <button
        type="button"
        className={`combo-trigger permission-trigger${selected.danger ? " danger" : ""}`}
        onClick={() => setOpen((was) => !was)}
        title={selected.desc}
      >
        <Icon path={selected.icon} size={14} className="permission-trigger-icon" />
        <span>{selected.label}</span>
        <Icon path="M6 9l6 6 6-6" size={12} />
      </button>

      {open && (
        <div className="permission-menu" role="listbox">
          {options.map((item) => {
            const isSelected = item.value === value;
            return (
              <button
                key={item.value}
                type="button"
                className={`permission-item${isSelected ? " selected" : ""}${item.danger ? " danger" : ""}`}
                onClick={() => {
                  onChange(item.value);
                  setOpen(false);
                }}
              >
                <div className="permission-icon">
                  <Icon path={item.icon} size={17} />
                </div>
                <div className="permission-content">
                  <div className="permission-title">{item.label}</div>
                  <div className="permission-desc">{item.desc}</div>
                </div>
                {isSelected && (
                  <div className="permission-check">
                    <Icon path="M20 6L9 17l-5-5" size={16} />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function EffortPicker({
  value,
  levels,
  onChange,
  down,
}: {
  value: string;
  levels: string[];
  onChange(value: string): void;
  down?: boolean;
}) {
  const { t } = useI18n();
  const options = pickEffortOptions(levels).map((level) => ({
    value: level,
    label: t(effortLabelKey(level)),
  }));
  if (options.length === 0) return null;
  return (
    <div className="effort-combo" title={t("composer.effort")}>
      <Combo value={value} options={options} down={down} onChange={onChange} />
    </div>
  );
}

export function Combo({
  value,
  options,
  onChange,
  searchable,
  placeholder,
  down,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange(value: string): void;
  searchable?: boolean;
  placeholder?: string;
  down?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [anchor, setAnchor] = useState<DOMRect>();
  const box = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const selected = options.find((item) => item.value === value);
  const filtered = searchable && query
    ? options.filter((item) => item.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  useEffect(() => {
    if (!open) {
      setAnchor(undefined);
      return;
    }
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (box.current?.contains(target) || menu.current?.contains(target)) return;
      setOpen(false);
      setQuery("");
    };
    // The menu lives in a body portal so panels can scroll without clipping it, which means its
    // position has to follow the trigger instead of being laid out next to it.
    const place = () => setAnchor(box.current?.getBoundingClientRect());
    place();
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  const dropDown = (() => {
    if (!anchor) return Boolean(down);
    const below = window.innerHeight - anchor.bottom - 14;
    const above = anchor.top - 14;
    if (down) return below >= 140 || below >= above;
    return below >= above && below >= 140;
  })();
  const maxHeight = anchor
    ? Math.min(320, Math.max(120, dropDown ? window.innerHeight - anchor.bottom - 14 : anchor.top - 14))
    : 320;
  const placement = anchor
    ? {
      left: Math.min(anchor.left, Math.max(8, window.innerWidth - Math.max(anchor.width, 220) - 8)),
      minWidth: Math.max(anchor.width, 220),
      maxHeight,
      ...(dropDown
        ? { top: anchor.bottom + 6 }
        : { bottom: window.innerHeight - anchor.top + 6 }),
    }
    : undefined;

  return (
    <div ref={box} className={`combo${open ? " open" : ""}${down ? " down" : ""}`}>
      {open && searchable ? (
        <input
          className="combo-input"
          value={query}
          autoFocus
          placeholder={placeholder ?? t("combo.filter")}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
              setQuery("");
            }
            if (event.key === "Enter") {
              event.preventDefault();
              const typed = query.trim();
              const next = filtered[0]?.value ?? typed;
              if (next) onChange(next);
              setOpen(false);
              setQuery("");
            }
          }}
        />
      ) : (
        <button type="button" className="combo-trigger" onClick={() => { setOpen((was) => !was); setQuery(""); }}>
          <span>{selected?.label ?? value}</span>
          <Icon path="M6 9l6 6 6-6" size={12} />
        </button>
      )}
      {open && placement && createPortal(
        <div ref={menu} className="combo-menu floating" role="listbox" style={placement}>
          {filtered.length === 0 && (query.trim() ? (
            <button
              type="button"
              className="combo-item selected"
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onChange(query.trim());
                setOpen(false);
                setQuery("");
              }}
            >
              {query.trim()}
            </button>
          ) : (
            <div className="combo-empty">{t("combo.empty")}</div>
          ))}
          {filtered.map((item) => (
            <button
              key={item.value}
              type="button"
              className={item.value === value ? "combo-item selected" : "combo-item"}
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onChange(item.value);
                setOpen(false);
                setQuery("");
              }}
            >
              {item.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

function splitApprovalCopy(title: string, message?: string) {
  const lines = title.split("\n").map((line) => line.trim()).filter(Boolean);
  const heading = lines[0] ?? "";
  const detail = lines.slice(1).join("\n");
  const rest = [detail, message?.trim()].filter(Boolean).join("\n\n");
  const destructive = /run destructive command/i.test(heading);
  if (!destructive) return { heading, detail, message: message?.trim() ?? "", command: "", destructive: false };
  return {
    heading,
    detail: "",
    message: "",
    command: rest.replace(/this may delete data or alter system\/process state\.?/gi, "").trim(),
    destructive: true,
  };
}

export function ApprovalCard({
  request,
  lastTurn,
  onDone,
  onError,
  onRespond,
}: {
  request: ExtensionUiRequest;
  lastTurn?: string;
  onDone(): void;
  onError(message: string): void;
  onRespond?(response: Record<string, unknown>): void | Promise<void>;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(request.prefill ?? "");
  const respond = async (response: Record<string, unknown>) => {
    try {
      if (onRespond) await onRespond(response);
      else await window.harness.agent.respondToUi(request.id, response);
      onDone();
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  };
  const copy = splitApprovalCopy(
    request.title ?? (request.method === "confirm" ? t("approval.needConfirm") : t("approval.needSelect")),
    request.message,
  );
  const title = copy.destructive ? t("approval.destructiveTitle") : approvalTitle(copy.heading, lastTurn);
  const folded = copy.command || copy.detail;
  return (
    <div className="approval">
      <strong>{title}</strong>
      {copy.destructive && <p>{t("approval.destructiveBody")}</p>}
      {!copy.destructive && copy.message && <p>{copy.message}</p>}
      {folded && (
        <details className="approval-cmd">
          <summary>{t("approval.showCommand")}</summary>
          <pre className="approval-detail">{folded}</pre>
        </details>
      )}
      {request.method === "select" && (
        <div className="choices">
          {request.options?.map((option) => (
            <button key={option} type="button" onClick={() => void respond({ value: option })}>
              {accessChoiceLabel(option, t)}
            </button>
          ))}
        </div>
      )}
      {(request.method === "input" || request.method === "editor") && (
        <textarea value={value} onChange={(event) => setValue(event.target.value)} rows={3} />
      )}
      <div className="row-actions">
        <button type="button" className="ghost" onClick={() => void respond({ cancelled: true })}>{t("common.cancel")}</button>
        {request.method === "confirm" && (
          <>
            <button type="button" className="ghost" onClick={() => void respond({ confirmed: false })}>{t("common.reject")}</button>
            <button type="button" className="primary" onClick={() => void respond({ confirmed: true })}>{t("common.allow")}</button>
          </>
        )}
        {(request.method === "input" || request.method === "editor") && (
          <button type="button" className="primary" onClick={() => void respond({ value })}>{t("common.continue")}</button>
        )}
      </div>
    </div>
  );
}

function accessChoiceLabel(option: string, t: (key: MessageKey) => string): string {
  if (option === "Execute the plan") return t("plan.approve");
  if (option === "Stay in plan mode") return t("perm.plan");
  if (option === "Refine the plan") return t("plan.refine");
  if (option === "Allow once") return t("approval.allowOnce");
  if (option === "Allow for this conversation" || option === "Allow this command for this session") {
    return t("approval.allowConversation");
  }
  if (option === "Deny") return t("common.reject");
  if (/^allow\b/i.test(option)) return t("common.allow");
  return option;
}

function ModelField({
  value,
  onChange,
  models,
  listing,
  canList,
  onList,
  placeholder,
}: {
  value: string;
  onChange(value: string): void;
  models: string[];
  listing: boolean;
  canList: boolean;
  onList(): void;
  placeholder?: string;
}) {
  const { t } = useI18n();
  const options = [...new Set([value, ...models].filter(Boolean))].map((id) => ({ value: id, label: id }));
  return (
    <label>
      {t("common.model")}
      <span className="settings-model">
        <Combo
          value={value}
          options={options}
          searchable
          placeholder={placeholder ?? t("composer.filterModels")}
          onChange={onChange}
        />
        <button type="button" className="ghost" disabled={!canList || listing} onClick={onList}>
          {listing ? t("combo.fetching") : t("combo.fetchModels")}
        </button>
      </span>
    </label>
  );
}

function SecretField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange(value: string): void;
  placeholder?: string;
}) {
  const { t } = useI18n();
  const [show, setShow] = useState(false);
  return (
    <label>
      API key
      <span className="secret">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
        />
        <button type="button" className="secret-toggle" aria-label={show ? t("secret.hide") : t("secret.show")} onClick={() => setShow((open) => !open)}>
          <Icon
            path={show
              ? "M3 3l18 18M10.7 10.7a3 3 0 0 0 4.2 4.2M9.9 5.1A11 11 0 0 1 12 5c6 0 10 7 10 7a18 18 0 0 1-3.3 3.9M6.1 6.1A16 16 0 0 0 2 12s4 8 10 8a10 10 0 0 0 4.3-.9"
              : "M2 12s4-8 10-8 10 8 10 8-4 8-10 8-10-8-10-8M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6"}
            size={15}
          />
        </button>
      </span>
    </label>
  );
}

function ApiProfilesEditor({
  profiles,
  activeId,
  onProfiles,
  onActiveId,
  models,
  listing,
  onList,
  urlPlaceholder,
  showMaxTokens,
  testStatus,
}: {
  profiles: CustomApiProfile[];
  activeId: string;
  onProfiles(next: CustomApiProfile[]): void;
  onActiveId(id: string): void;
  models: string[];
  listing: boolean;
  onList(): void;
  urlPlaceholder: string;
  showMaxTokens?: boolean;
  testStatus?: { ok: boolean; message: string } | null;
}) {
  const { t } = useI18n();
  const active = profiles.find((item) => item.id === activeId) ?? profiles[0];
  const update = (fields: Partial<CustomApiProfile>) => {
    if (!active) return;
    onProfiles(profiles.map((item) => (item.id === active.id ? { ...item, ...fields } : item)));
  };
  return (
    <div className="custom-api-layout">
      <div className="custom-api-sidebar">
        <div className="custom-api-sidebar-head">
          <span className="custom-api-sidebar-title">{t("settings.profilesList")}</span>
          <button
            type="button"
            className="custom-api-add-btn"
            onClick={() => {
              const profile = defaultCustomProfile({
                name: `${t("settings.customProfile")} ${profiles.length + 1}`,
              });
              onProfiles([...profiles, profile]);
              onActiveId(profile.id);
            }}
          >
            <Icon path="M12 5v14M5 12h14" size={12} />
            <span>{t("settings.addCustomProfile")}</span>
          </button>
        </div>
        <div className="custom-api-card-list">
          {profiles.map((profile) => {
            const isActive = profile.id === activeId;
            return (
              <div
                key={profile.id}
                className={`custom-api-card ${isActive ? "active" : ""}`}
                onClick={() => {
                  if (profile.id === activeId) return;
                  onActiveId(profile.id);
                }}
              >
                <div className="custom-api-card-head">
                  <span className="custom-api-card-radio">
                    {isActive && <span className="custom-api-card-dot" />}
                  </span>
                  <span className="custom-api-card-title">
                    {profile.name || t("settings.profileUntitled")}
                  </span>
                  {isActive && <small className="custom-api-card-use">{t("settings.profileInUse")}</small>}
                  <button
                    type="button"
                    className="custom-api-card-del"
                    title={t("settings.removeCustomProfile")}
                    onClick={(event) => {
                      event.stopPropagation();
                      const remaining = profiles.filter((item) => item.id !== profile.id);
                      onProfiles(remaining);
                      if (activeId === profile.id) onActiveId(remaining[0]?.id ?? "");
                    }}
                  >
                    <Icon path="M6 6l12 12M18 6L6 18" size={13} />
                  </button>
                </div>
                <div className="custom-api-card-meta">
                  {profile.url || t("settings.customApi")}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="custom-api-form">
        {active ? (
          <>
            <label>
              {t("settings.profileName")}
              <input
                value={active.name}
                onChange={(event) => update({ name: event.target.value })}
                placeholder={t("settings.profileUntitled")}
              />
            </label>
            <label>
              {t("settings.baseUrl")}
              <input
                value={active.url}
                onChange={(event) => update({ url: event.target.value, model: "" })}
                placeholder={urlPlaceholder}
              />
            </label>
            <SecretField value={active.apiKey} onChange={(apiKey) => update({ apiKey })} />
            <ModelField
              value={active.model}
              onChange={(model) => update({ model })}
              models={models}
              listing={listing}
              canList={Boolean(active.url.trim() && active.apiKey.trim())}
              onList={onList}
            />
            {showMaxTokens && (
              <details className="settings-advanced">
                <summary>{t("settings.advanced")}</summary>
                <label>
                  {t("settings.maxTokens")}
                  <input
                    inputMode="numeric"
                    value={active.maxTokens ? String(active.maxTokens) : ""}
                    onChange={(event) => {
                      const digits = event.target.value.replace(/[^\d]/g, "");
                      update({ maxTokens: digits ? Number(digits) : undefined });
                    }}
                    placeholder={t("settings.maxTokensPlaceholder")}
                  />
                </label>
              </details>
            )}
            {testStatus && (
              <div className={`settings-feedback ${testStatus.ok ? "ok" : "err"}`}>
                <Icon path={testStatus.ok ? "M5 12.5l4 4 10-10" : "M12 8v4m0 4h.01M22 12A10 10 0 1 1 2 12a10 10 0 0 1 22 0z"} size={14} />
                <span>{testStatus.message}</span>
              </div>
            )}
          </>
        ) : (
          <p className="settings-hint">{t("settings.customEmpty")}</p>
        )}
      </div>
    </div>
  );
}

type SettingsPane = "chat" | "vision" | "appearance" | "shortcuts" | "skills" | "about";

const THEME_LABEL: Record<ThemeId, MessageKey> = {
  white: "settings.themeWhite",
  paper: "settings.themePaper",
  dark: "settings.themeDark",
};

const THEME_DESC: Record<ThemeId, MessageKey> = {
  white: "settings.themeWhiteDesc",
  paper: "settings.themePaperDesc",
  dark: "settings.themeDarkDesc",
};

function settingsNav(t: ReturnType<typeof useI18n>["t"]): Array<{ label: string; items: Array<{ id: SettingsPane; label: string; icon: string }> }> {
  return [
  {
    label: t("settings.groupModels"),
    items: [
      { id: "chat", label: t("settings.chat"), icon: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" },
      { id: "vision", label: t("settings.vision"), icon: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z\nM11 9a2 2 0 1 1-4 0 2 2 0 0 1 4 0\nm21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" },
    ],
  },
  {
    label: t("settings.groupAppearance"),
    items: [
      { id: "appearance", label: t("settings.appearance"), icon: "M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z" },
    ],
  },
  {
    label: t("settings.groupHelp"),
    items: [
      {
        id: "skills",
        label: t("settings.skills"),
        icon: "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z",
      },
      {
        id: "shortcuts",
        label: t("settings.shortcuts"),
        icon: "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z\nM6 8h.01\nM10 8h.01\nM14 8h.01\nM18 8h.01\nM8 12h.01\nM12 12h.01\nM16 12h.01\nM7 16h10",
      },
      {
        id: "about",
        label: t("settings.about"),
        icon: "M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20z\nM12 16v-4\nM12 8h.01",
      },
    ],
  },
  ];
}

export function Login({
  configured,
  model,
  baseUrl,
  agentSkills = [],
  onRefreshSkills,
  onClose,
  onSaved,
}: {
  configured: boolean;
  model: string;
  baseUrl?: string;
  agentSkills?: AgentSkillCommand[];
  onRefreshSkills?: () => void;
  onClose(): void;
  onSaved(): Promise<void>;
}) {
  const { t } = useI18n();
  const [pane, setPane] = useState<SettingsPane>("chat");
  const [theme, setTheme] = useState<ThemeId>(readStoredTheme);
  const [customProfiles, setCustomProfiles] = useState<CustomApiProfile[]>([]);
  const [activeCustomId, setActiveCustomId] = useState("");
  const [visionProfiles, setVisionProfiles] = useState<CustomApiProfile[]>([]);
  const [activeVisionId, setActiveVisionId] = useState("");
  const [busy, setBusy] = useState(false);
  const [chatModels, setChatModels] = useState<string[]>([]);
  const [visionModels, setVisionModels] = useState<string[]>([]);
  const [listing, setListing] = useState<"chat" | "vision" | null>(null);
  const [appVersion, setAppVersion] = useState("");
  const [skillRevealError, setSkillRevealError] = useState<string>();
  const [testStatus, setTestStatus] = useState<{ target: "chat" | "vision"; ok: boolean; message: string } | null>(null);

  const activeCustom = customProfiles.find((item) => item.id === activeCustomId) ?? customProfiles[0];
  const activeVision = visionProfiles.find((item) => item.id === activeVisionId) ?? visionProfiles[0];
  const chatUrl = activeCustom?.url ?? "";
  const chatKey = activeCustom?.apiKey ?? "";
  const visionUrl = activeVision?.url ?? "";
  const visionKey = activeVision?.apiKey ?? "";
  const modKey = window.harness.platform === "darwin" ? "⌘" : "Ctrl";

  const listModels = async (target: "chat" | "vision") => {
    const base = target === "chat" ? chatUrl : visionUrl;
    const secret = target === "chat" ? chatKey : visionKey;
    if (!base.trim() || !secret.trim()) {
      setTestStatus({ target, ok: false, message: t("settings.fillUrlKey") });
      return;
    }
    setListing(target);
    setTestStatus(null);
    const start = Date.now();
    try {
      const ids = await window.harness.auth.listModels(base.trim(), secret.trim());
      const elapsed = Date.now() - start;
      if (target === "chat") setChatModels(ids);
      else setVisionModels(ids);
      if (ids.length === 0) {
        setTestStatus({ target, ok: true, message: t("settings.okNoModels", { ms: elapsed }) });
      } else {
        setTestStatus({ target, ok: true, message: t("settings.okModels", { ms: elapsed, n: ids.length }) });
      }
    } catch (error) {
      setTestStatus({
        target,
        ok: false,
        message: error instanceof Error ? error.message : t("settings.connectFailed"),
      });
    } finally {
      setListing(null);
    }
  };

  useEffect(() => {
    void Promise.all([
      window.harness.auth.profiles(),
      window.harness.vision.config(),
      window.harness.app.version().catch(() => "0.1.0"),
    ]).then(async ([profiles, config, ver]) => {
      setCustomProfiles(profiles.customProfiles);
      setActiveCustomId(profiles.activeCustomId);
      setVisionProfiles(config.profiles);
      setActiveVisionId(config.activeProfileId);
      if (ver) setAppVersion(ver);
      const url = activeCustomProfile(profiles)?.url ?? "";
      const key = activeCustomProfile(profiles)?.apiKey ?? "";
      if (url.trim() && key.trim()) {
        void window.harness.auth.listModels(url, key).then(setChatModels).catch(() => undefined);
      }
      const vision = config.profiles.find((item) => item.id === config.activeProfileId) ?? config.profiles[0];
      if (vision?.url.trim() && vision.apiKey.trim()) {
        void window.harness.auth.listModels(vision.url, vision.apiKey).then(setVisionModels).catch(() => undefined);
      }
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (pane !== "skills") return;
    onRefreshSkills?.();
  }, [pane, onRefreshSkills]);

  return (
    <div
      className="modal"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}
    >
      <form
        className="settings"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          try {
            if (customProfiles.length === 0 || Boolean(activeCustom?.url && activeCustom.model && activeCustom.apiKey)) {
              const official = customProfiles.find((item) => isDeepSeekUrl(item.url));
              await window.harness.auth.saveProfiles({
                kind: "custom",
                deepseek: {
                  model: official?.model || DEEPSEEK_PRESET.model,
                  apiKey: official?.apiKey || "",
                },
                customProfiles,
                activeCustomId: activeCustom?.id ?? "",
              });
            }
            await window.harness.vision.saveConfig({
              profiles: visionProfiles,
              activeProfileId: activeVision?.id ?? activeVisionId,
            });
            await onSaved();
          } catch (error) {
            window.alert(error instanceof Error ? error.message : String(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        <nav className="settings-nav">
          {settingsNav(t).map((group) => (
            <div key={group.label} className="settings-group">
              <div className="settings-group-label">{group.label}</div>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={pane === item.id ? "settings-nav-item active" : "settings-nav-item"}
                  onClick={() => setPane(item.id)}
                >
                  <Icon path={item.icon} size={15} />
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="settings-main">
          <header className="settings-head">
            <h2>
              {pane === "chat"
                ? t("settings.chat")
                : pane === "vision"
                  ? t("settings.vision")
                  : pane === "appearance"
                    ? t("settings.appearance")
                    : pane === "skills"
                      ? t("settings.skills")
                      : pane === "shortcuts"
                        ? t("settings.shortcuts")
                        : t("settings.about")}
            </h2>
            <button type="button" className="settings-close" aria-label={t("common.close")} onClick={onClose}>
              <Icon path="M6 6l12 12M18 6L6 18" />
            </button>
          </header>
          <div className="settings-body">
            {pane === "chat" && (
              <>
                <p className="settings-hint">{t("settings.customHint")}</p>
                <ApiProfilesEditor
                  profiles={customProfiles}
                  activeId={activeCustomId}
                  onProfiles={setCustomProfiles}
                  onActiveId={(id) => {
                    setActiveCustomId(id);
                    setChatModels([]);
                    setTestStatus((current) => current?.target === "chat" ? null : current);
                    const profile = customProfiles.find((item) => item.id === id);
                    if (profile?.url.trim() && profile.apiKey.trim()) {
                      void window.harness.auth.listModels(profile.url, profile.apiKey).then(setChatModels).catch(() => undefined);
                    }
                  }}
                  models={chatModels}
                  listing={listing === "chat"}
                  onList={() => void listModels("chat")}
                  urlPlaceholder="https://api.example.com/v1"
                  showMaxTokens
                  testStatus={testStatus?.target === "chat" ? testStatus : null}
                />
              </>
            )}

            {pane === "vision" && (
              <>
                <p className="settings-hint">{t("settings.visionHint")}</p>
                <ApiProfilesEditor
                  profiles={visionProfiles}
                  activeId={activeVisionId}
                  onProfiles={setVisionProfiles}
                  onActiveId={(id) => {
                    setActiveVisionId(id);
                    setVisionModels([]);
                    setTestStatus((current) => current?.target === "vision" ? null : current);
                    const profile = visionProfiles.find((item) => item.id === id);
                    if (profile?.url.trim() && profile.apiKey.trim()) {
                      void window.harness.auth.listModels(profile.url, profile.apiKey).then(setVisionModels).catch(() => undefined);
                    }
                  }}
                  models={visionModels}
                  listing={listing === "vision"}
                  onList={() => void listModels("vision")}
                  urlPlaceholder="https://api.example.com/v1/chat/completions"
                  testStatus={testStatus?.target === "vision" ? testStatus : null}
                />
                <p className="settings-hint">{t("settings.mineruHint")}</p>
              </>
            )}
            {pane === "appearance" && (
              <div className="theme-page">
                <p className="settings-hint">{t("settings.themeHint")}</p>
                <div className="theme-picks">
                  {THEMES.map((id) => (
                    <button
                      key={id}
                      type="button"
                      className={`theme-pick theme-pick-${id}${theme === id ? " on" : ""}`}
                      onClick={() => setTheme(applyTheme(id))}
                    >
                      <span className="theme-pick-preview" aria-hidden>
                        <span className="theme-pick-side" />
                        <span className="theme-pick-main">
                          <span className="theme-pick-bar" />
                          <span className="theme-pick-bubble user" />
                          <span className="theme-pick-bubble" />
                        </span>
                      </span>
                      <span className="theme-pick-meta">
                        <b>{t(THEME_LABEL[id])}</b>
                        <small>{t(THEME_DESC[id])}</small>
                      </span>
                    </button>
                  ))}
                </div>
                <div className="theme-live">
                  <div className="theme-live-label">{t("settings.themePreview")}</div>
                  <div className="theme-live-frame">
                    <aside>
                      <i /><i /><i />
                    </aside>
                    <main>
                      <div className="user-turn">
                        <article className="user">{t("settings.themePreviewUser")}</article>
                      </div>
                      <article className="turn">{t("settings.themePreviewBot")}</article>
                      <div className="theme-live-input">{t("settings.themePreviewInput")}</div>
                    </main>
                  </div>
                </div>
              </div>
            )}

            {pane === "skills" && (
              <>
                <p className="settings-hint">{t("settings.skillsUse")}</p>

                <div className="skills-section">
                  <h3 className="skills-section-title">{t("settings.skillsPaths")}</h3>
                  <div className="skills-paths">
                    <div className="skills-path-block">
                      <div className="skills-path-label">{t("settings.skillsPathProject")}</div>
                      <ul className="skills-path-list">
                        {PROJECT_SKILL_ROOTS.map((root) => (
                          <li key={root}><code>{root}/&lt;name&gt;/SKILL.md</code></li>
                        ))}
                      </ul>
                    </div>
                    <div className="skills-path-block">
                      <div className="skills-path-label">{t("settings.skillsPathUser")}</div>
                      <ul className="skills-path-list">
                        {USER_SKILL_ROOTS.map((root) => (
                          <li key={root}><code>{root}/&lt;name&gt;/SKILL.md</code></li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>

                <div className="skills-section">
                  <div className="skills-section-head">
                    <h3 className="skills-section-title">{t("settings.skillsTitle")}</h3>
                    <button type="button" className="ghost" onClick={() => onRefreshSkills?.()}>
                      {t("settings.skillsRefresh")}
                    </button>
                  </div>
                  {skillRevealError ? (
                    <p className="settings-hint settings-error">{skillRevealError}</p>
                  ) : null}
                  {agentSkills.length === 0 ? (
                    <p className="settings-hint">{t("settings.skillsEmpty")}</p>
                  ) : (
                    <div className="skills-list">
                      {agentSkills.map((skill) => {
                        const command = skillSlashCommand(skill.name);
                        return (
                          <button
                            key={skill.name}
                            type="button"
                            className="skills-row"
                            title={skill.path ?? command}
                            onClick={() => {
                              void window.harness.app.revealPath(skill.name, skill.path).catch((error) => {
                                const message = error instanceof Error ? error.message : t("settings.skillsRevealFailed");
                                setSkillRevealError(message);
                                window.setTimeout(() => setSkillRevealError((current) => (current === message ? undefined : current)), 2200);
                              });
                            }}
                          >
                            <code className="skills-row-name">{command}</code>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}

            {pane === "shortcuts" && (
              <div className="shortcut-list">
                <div className="shortcut-item">
                  <span className="shortcut-label">{t("shortcut.send")}</span>
                  <kbd>Enter</kbd>
                </div>
                <div className="shortcut-item">
                  <span className="shortcut-label">{t("shortcut.newline")}</span>
                  <span className="kbd-group"><kbd>Shift</kbd> + <kbd>Enter</kbd></span>
                </div>
                <div className="shortcut-item">
                  <span className="shortcut-label">{t("shortcut.mention")}</span>
                  <kbd>{t("shortcut.mentionKey")}</kbd>
                </div>
                <div className="shortcut-item">
                  <span className="shortcut-label">{t("shortcut.skills")}</span>
                  <kbd>/</kbd>
                </div>
                <div className="shortcut-item">
                  <span className="shortcut-label">{t("shortcut.skillInvoke")}</span>
                  <kbd>{t("shortcut.skillKey")}</kbd>
                </div>
                <div className="shortcut-item">
                  <span className="shortcut-label">{t("shortcut.new")}</span>
                  <span className="kbd-group"><kbd>{modKey}</kbd> + <kbd>N</kbd></span>
                </div>
                <div className="shortcut-item">
                  <span className="shortcut-label">{t("shortcut.open")}</span>
                  <span className="kbd-group"><kbd>{modKey}</kbd> + <kbd>O</kbd></span>
                </div>
                <div className="shortcut-item">
                  <span className="shortcut-label">{t("shortcut.undo")}</span>
                  <kbd>/undo</kbd>
                </div>
                <div className="shortcut-item">
                  <span className="shortcut-label">{t("shortcut.escape")}</span>
                  <kbd>Esc</kbd>
                </div>
              </div>
            )}

            {pane === "about" && (
              <div className="about-body">
                <div className="about-hero">
                  <img src={logo} alt="" className="about-logo" width={40} height={23} />
                  <h3>
                    {t("about.title")}
                    <span className="about-version">v{appVersion || "0.1.3"}</span>
                  </h3>
                  <p className="about-tagline">{t("about.subtitle")}</p>
                  <button
                    type="button"
                    className="about-site"
                    onClick={() => void window.harness.app.openExternal("https://tether-code.xyz/")}
                  >
                    tether-code.xyz
                  </button>
                </div>
                <p className="about-intro">{t("about.intro")}</p>
                <p className="about-origin-name">{t("about.originName")}</p>
                <p className="about-origin">{t("about.origin")}</p>
              </div>
            )}
          </div>
          <footer className="settings-foot">
            {configured && pane === "chat" && (
              <button
                type="button"
                className="ghost danger"
                onClick={async () => {
                  await window.harness.auth.logout("deepseek");
                  await onSaved();
                }}
              >
                {t("settings.clearConfig")}
              </button>
            )}
            {pane === "about" && (
              <>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => void window.harness.app.checkUpdate()}
                >
                  <Icon path="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" size={14} />
                  <span>{t("about.checkUpdate")}</span>
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => void window.harness.app.openExternal("https://github.com/tt-11-dd/tether-ai/issues")}
                >
                  <Icon path="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" size={14} />
                  <span>{t("about.feedback")}</span>
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => void window.harness.app.openExternal("https://tether-code.xyz/")}
                >
                  <Icon path="M10 13a5 5 0 0 0 7.54.54l1.42-1.42a5 5 0 0 0-7.07-7.07L10.5 6.5M14 11a5 5 0 0 0-7.54-.54L5.04 11.88a5 5 0 0 0 7.07 7.07L13.5 17.5" size={14} />
                  <span>{t("about.site")}</span>
                </button>
              </>
            )}
            {pane !== "chat" && pane !== "vision" ? (
              <button type="button" className="primary" onClick={onClose}>
                {t("settings.close")}
              </button>
            ) : (
              <button
                type="submit"
                className="primary"
                disabled={
                  busy ||
                  (activeCustom
                    ? !activeCustom.url.trim() || !activeCustom.model.trim() || !activeCustom.apiKey.trim()
                    : false) ||
                  (activeVision
                    ? !activeVision.url.trim() || !activeVision.model.trim() || !activeVision.apiKey.trim()
                    : false)
                }
              >
                {t("settings.save")}
              </button>
            )}
          </footer>
        </div>
      </form>
    </div>
  );
}
