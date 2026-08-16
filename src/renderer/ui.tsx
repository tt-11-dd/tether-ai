import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PREVIEW_HOST, PREVIEW_SCHEME, type AgentSessionStats, type ExtensionUiRequest, type PermissionMode } from "../shared/types";
import { skillUserDisplay } from "../shared/skills";
import { DEFAULT_VISION_CONFIG, visibleUserText, visionResultSections, visionToolChips } from "../shared/vision-api";
import { DEEPSEEK_PRESET, type ChatKind } from "../shared/chat-profiles";
import { baseName, cacheHitRate, collectFileChanges, collapseThinking, filterMentionPaths, formatCommand, isHttpUrl, liveStatus, omitFinalReply, repairMarkdownTables, splitHttpUrls, splitPatch, stripEmptyMarkdown, takeTrailingUrl, toolCommand, toolSummary, toolWritePreview, traceRows, trimHttpUrl, turnWork, undoDialogTitle, urlChipLabel, workspaceRelative, type ChatImage, type ChatMessage, type FileChange, type SessionFile, type SessionTodo, type ToolActivity, type TraceRow, type WorkItem } from "./conversation";
import { tokenizeCode } from "./highlight";
import type { AgentSkillCommand } from "../shared/skills";
import { PROJECT_SKILL_ROOTS, USER_SKILL_ROOTS, skillSlashCommand } from "../shared/skills";
import { useI18n } from "./i18n";
import logo from "./logo.svg";

const MAX_UPLOAD_IMAGES = 4;
const LINK_ICON = "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71";

export function Icon({ path, size = 16, className }: { path: string; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
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
            className="user-link"
            href={part.value}
            onClick={(event) => {
              event.preventDefault();
              void window.harness.app.openExternal(part.value);
            }}
          >
            <Icon path={LINK_ICON} size={12} />
            <span>{urlChipLabel(part.value)}</span>
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
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* silent: icon-only affordance already covers the happy path */
    }
  };
  return (
    <button type="button" className={className} aria-label={copied ? t("common.copied") : label ?? t("common.copy")} onClick={() => void copy()}>
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
        {drawer && inspect}
      </div>
    </section>
  );
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
  up,
}: {
  stats?: AgentSessionStats;
  model?: string;
  up?: boolean;
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

  return (
    <div ref={box} className={`context-stats-wrap${open ? " open" : ""}${up ? " up" : ""}`}>
      <button
        type="button"
        className={`stats-toggle${open ? " on" : ""}${
          percent !== undefined && percent >= 90 ? " hot" : percent !== undefined && percent >= 75 ? " warm" : ""
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
            <div className="context-popover-title">
              <span>{t("context.title")}</span>
            </div>
            {rate !== undefined && (
              <span className="context-badge-hit">
                <i /> {t("context.cacheRate", { rate: rate.toFixed(0) })}
              </span>
            )}
          </div>

          <div className="context-popover-body">
            {/* 上下文容量 */}
            <div className="context-card">
              <div className="context-capacity">
                <div className="context-ring-wrap">
                  <svg width="48" height="48" viewBox="0 0 48 48" className="context-ring-svg">
                    <circle cx="24" cy="24" r="20" fill="none" stroke="var(--hover-2)" strokeWidth="4" />
                    {percent !== undefined && (
                      <circle
                        cx="24"
                        cy="24"
                        r="20"
                        fill="none"
                        stroke={percent >= 90 ? "var(--red)" : percent >= 75 ? "var(--accent)" : "var(--green)"}
                        strokeWidth="4"
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
              </div>
            </div>

            {/* Token 总量 */}
            <div className="context-card">
              <div className="context-section-head">
                <span>{t("context.tokenTotal")}</span>
                {stats?.tokens?.total ? (
                  <span className="context-token-sum">{t("context.tokenSum", { n: formatCompactNumber(stats.tokens.total) })}</span>
                ) : null}
              </div>
              <div className="context-token-grid">
                <div className="context-token-box">
                  <span className="context-token-sub">{t("context.input")}</span>
                  <strong>{stats?.tokens?.input !== undefined ? formatCompactNumber(stats.tokens.input) : "—"}</strong>
                </div>
                <div className="context-token-box">
                  <span className="context-token-sub">{t("context.output")}</span>
                  <strong>{stats?.tokens?.output !== undefined ? formatCompactNumber(stats.tokens.output) : "—"}</strong>
                </div>
              </div>
            </div>

            {/* 缓存率 */}
            <div className="context-card">
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

            {/* 底部模型与费用 */}
            <div className="context-popover-foot">
              <div className="context-foot-item">
                <span className="context-foot-label">{t("common.model")}</span>
                <code className="context-model-tag">{model || t("context.defaultModel")}</code>
              </div>
              <div className="context-foot-item right">
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
}: {
  text: string;
  work: WorkItem[];
  tools: ToolActivity[];
  live: boolean;
  label?: string;
  startedAt?: number;
  endedAt?: number;
}) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [born] = useState(() => Date.now());
  const rows = useMemo(() => traceRows(work, tools, text), [work, tools, text, locale]);
  const start = startedAt ?? (live ? born : undefined);
  const summary = useMemo(
    () => toolSummary(tools, rows.filter((row) => row.kind === "think").length),
    [tools, rows, locale],
  );
  const current = useMemo(() => liveStatus(tools), [tools, locale]);
  const header = live ? label ?? t("think.live") : t("think.done");
  const showLive = live && current !== header;
  const hasBody = rows.length > 0 || showLive;
  if (!hasBody && !live) return null;
  return (
    <div className={live ? (open ? "trace live open" : "trace live") : open ? "trace open" : "trace"}>
      <button type="button" className="trace-toggle" onClick={() => hasBody && setOpen((value) => !value)}>
        {live ? <Dots /> : <img className="trace-logo" src={logo} alt="" width={18} height={10} />}
        <span className={live ? "shimmer trace-label" : "trace-label"}>
          {header}
        </span>
        {summary && <span className="trace-subtle">{summary}</span>}
        <Elapsed start={start} end={endedAt} live={live} />
        {hasBody ? <Icon className="chevron" path="M6 9l6 6 6-6" size={14} /> : null}
      </button>
      {open && hasBody && (
        <div className="trace-rows">
          {rows.map((row) => <TraceRowView key={row.id} row={row} />)}
          {showLive && (
            <div className="trace-row-live">
              <Dots />
              <span className="shimmer">{current}</span>
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
  look: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z",
  tool: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 8v4l2.5 1.5",
};

function TraceRowView({ row }: { row: TraceRow }) {
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
          <Icon className="trace-row-chevron chevron" path="M6 9l6 6 6-6" size={12} />
        </span>
        <span className="trace-row-label">{row.label}</span>
        {chip && <span className={row.mono ? "trace-row-chip mono" : "trace-row-chip"}>{chip}</span>}
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
          <CopyButton text={command} className="terminal-copy-btn" size={12} label={t("terminal.copyCommand")} />
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

function Markdown({ children, streaming }: { children: string; streaming?: boolean }) {
  const source = stripEmptyMarkdown(repairMarkdownTables(streaming ? closeOpenFences(children) : children));
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

export function AssistantTurn({
  messages,
  onOpenFile,
  onRetry,
}: {
  messages: ChatMessage[];
  onOpenFile?(file: FileChange): void;
  onRetry?(): void;
}) {
  const { t } = useI18n();
  const thinking = collapseThinking(...messages.map((item) => item.thinking));
  const tools = [...new Map(messages.flatMap((item) => item.tools).map((tool) => [tool.id, tool])).values()];
  const work = turnWork(messages);
  const text = messages.map((item) => item.text).filter(Boolean).join("\n\n");
  const error = messages.map((item) => item.error).find(Boolean);
  const live = messages.some((item) => item.streaming) || tools.some((item) => item.status === "running");
  const started = messages.find((item) => item.timestamp)?.timestamp ?? tools[0]?.startedAt;
  const ended = Math.max(0, ...messages.map((item) => item.timestamp ?? 0), ...tools.map((item) => item.endedAt ?? 0));
  const changes = collectFileChanges(tools);
  const traceWork = thinking
    ? omitFinalReply(work, text)
    : work.filter((item) => item.type !== "text");
  return (
    <article className="turn">
      {(live || thinking || traceWork.length > 0 || tools.length > 0) && (
        <div className="turn-trace">
          <Thinking text={thinking} work={traceWork} tools={tools} live={live} startedAt={started} endedAt={ended || undefined} />
        </div>
      )}
      <ChangeSummary files={changes} onOpen={onOpenFile} />
      <StreamingText text={text} streaming={live} />
      {!live && text.trim() && (
        <div className="bubble-actions assistant">
          <CopyAction text={text} />
        </div>
      )}
      {error && (
        <div className="turn-error">
          <p>{error}</p>
          {onRetry && <button type="button" className="ghost" onClick={onRetry}>{t("common.continue")}</button>}
        </div>
      )}
    </article>
  );
}

function fileGlyph(path: string) {
  return /\.(tsx?|jsx?|mjs|cjs|css|json|ya?ml)$/i.test(path) ? "M8 8l-4 4 4 4M16 8l4 4-4 4" : "M6 3h9l5 5v13H6z";
}

function setDragGhost(event: { dataTransfer: DataTransfer }, label: string) {
  const ghost = document.createElement("div");
  ghost.className = "drag-ghost";
  ghost.textContent = label;
  document.body.appendChild(ghost);
  event.dataTransfer.setDragImage(ghost, 16, 14);
  requestAnimationFrame(() => ghost.remove());
}

function treeChange(path: string, changes: SessionFile[]) {
  return changes.find((item) => item.path === path || item.path.endsWith(`/${path}`) || path.endsWith(`/${item.path}`));
}

export function InspectPanel({
  files = [],
  todos,
  folder,
  workspace,
  refresh,
  running,
  onOpen,
  onUndo,
}: {
  files?: SessionFile[];
  todos: SessionTodo[];
  folder?: string;
  workspace?: string;
  refresh?: number | boolean;
  running?: boolean;
  onOpen(file: FileChange): void;
  onUndo?(): void;
}) {
  const { t } = useI18n();
  const [progress, setProgress] = useState(true);
  const [changesOpen, setChangesOpen] = useState(true);
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
  if (!workspace && todos.length === 0) return null;
  return (
    <aside className="inspect">
      {todos.length > 0 && (
        <Fold title={t("inspect.progress")} open={progress} onToggle={() => setProgress((current) => !current)}>
          <ol className="inspect-todos">
            {todos.map((todo, index) => (
              <li key={todo.id} className={todo.done ? "done" : ""}>
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
              <button key={file.path} type="button" className="inspect-file edit" onClick={() => onOpen(file)}>
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
                  draggable
                  className={dirty ? "inspect-file edit" : "inspect-file"}
                  onDragStart={(event) => {
                    dragging.current = true;
                    event.dataTransfer.setData("text/harness-path", file);
                    event.dataTransfer.setData("text/plain", file);
                    event.dataTransfer.effectAllowed = "copy";
                    setDragGhost(event, name);
                  }}
                  onDragEnd={() => {
                    window.setTimeout(() => {
                      dragging.current = false;
                    }, 0);
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
            <Icon path={preview ? "M16 18l6-6-6-6M8 6l-6 6 6 6" : "M2 12s4-8 10-8 10 8 10 8-4 8-10 8-10-8-10-8M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6"} size={16} />
          </button>
        )}
        <CopyButton text={body} className="drawer-btn" size={16} />
        <button type="button" className="drawer-btn" aria-label={t("preview.open")} onClick={() => void window.harness.workspace.open(file.path, workspace)}>
          <Icon path="M14 4h6v6M20 4l-8 8M10 4H5v16h14v-5" size={16} />
        </button>
        <button type="button" className="drawer-btn" aria-label={wide ? t("preview.restore") : t("preview.expand")} onClick={() => setWide((current) => !current)}>
          <Icon path={wide ? "M4 14h6v6M20 10h-6V4M14 20v-6h6M10 4v6H4" : "M15 3h6v6M9 21H3v-6M21 15v6h-6M3 9V3h6"} size={16} />
        </button>
        <button type="button" className="drawer-close" aria-label={t("common.close")} onClick={onClose}>
          <Icon path="M6 6l12 12M18 6L6 18" size={16} />
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

export function PromptBar({
  value,
  onChange,
  onSubmit,
  onStop,
  queued,
  onEditQueue,
  onDropQueue,
  onSendQueue,
  rootRef,
  running,
  disabled,
  workspace,
  onPickWorkspace,
  model,
  models,
  onModel,
  permission,
  onPermission,
  onCommand,
  stats,
  skillCommands = [],
  placement = "dock",
}: {
  value: string;
  onChange(value: string): void;
  onSubmit(text?: string, images?: string[]): void;
  onStop(): void;
  queued?: Array<{ id: string; text: string }>;
  onEditQueue?(id: string): void;
  onDropQueue?(id: string): void;
  onSendQueue?(id: string): void;
  rootRef?: Ref<HTMLDivElement>;
  running: boolean;
  disabled?: boolean;
  workspace?: string;
  onPickWorkspace(): void;
  model: string;
  models: { value: string; label: string }[];
  onModel(value: string): void;
  permission: string;
  onPermission(value: string): void;
  onCommand(command: string): void;
  stats?: AgentSessionStats;
  skillCommands?: AgentSkillCommand[];
  placement?: "dock" | "hero";
}) {
  const { t } = useI18n();
  const [cursor, setCursor] = useState(value.length);
  const [files, setFiles] = useState<string[]>([]);
  const [listing, setListing] = useState(false);
  const [picked, setPicked] = useState(0);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [links, setLinks] = useState<string[]>([]);
  const [uploads, setUploads] = useState<Array<{ id: string; name: string; dataUri: string }>>([]);
  const [dropOver, setDropOver] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const mention = workspace ? mentionAt(value, cursor) : undefined;
  const matches = mention ? filterMentionPaths(files, mention.query) : [];

  useEffect(() => {
    setAttachments([]);
    setLinks([]);
    setUploads([]);
  }, [workspace]);

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

  const compose = (text = value, extraLinks = links) => {
    const prefix = [...attachments.map((file) => `@${file}`), ...extraLinks].join(" ");
    return [prefix, text.trim()].filter(Boolean).join(" ");
  };

  const addLink = (url: string) => {
    setLinks((current) => current.includes(url) ? current : [...current, url]);
  };

  const addUploads = async (list: FileList | File[]) => {
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
    setUploads((current) => [...current, ...next].slice(0, MAX_UPLOAD_IMAGES));
  };

  const insertFile = (file: string, confirm = false) => {
    if (!mention) return;
    const folder = file.endsWith("/");
    // Folder click drills in; Enter / second click on the same folder seals it.
    const seal = confirm || !folder || mention.query === file;
    if (seal) {
      setAttachments((current) => current.includes(file) ? current : [...current, file]);
      const next = `${value.slice(0, mention.start)}${value.slice(cursor)}`;
      onChange(next);
      setCursor(mention.start);
      requestAnimationFrame(() => {
        area.current?.focus();
        area.current?.setSelectionRange(mention.start, mention.start);
      });
      return;
    }
    const next = `${value.slice(0, mention.start)}@${file}${value.slice(cursor)}`;
    onChange(next);
    const caret = mention.start + file.length + 1;
    setCursor(caret);
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(caret, caret);
    });
  };

  const slash = skillCommands.length > 0 && (value === "/" || /^\/[^\s]*$/.test(value));
  const commands = skillCommands
    .map((skill) => ({ id: skillSlashCommand(skill.name) }))
    .filter((item) => item.id.startsWith(value || "/"));

  const insertSkillCommand = (command: string) => {
    const next = `${command} `;
    onChange(next);
    const caret = next.length;
    setCursor(caret);
    setPicked(0);
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(caret, caret);
    });
  };

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    setCursor(event.currentTarget.selectionStart);
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
        onChange("");
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
          onChange(`${value.slice(0, cursor)} ${value.slice(cursor)}`);
          setCursor(cursor + 1);
        } else {
          onChange(`${value.slice(0, mention?.start ?? cursor)}${value.slice(cursor)}`);
        }
        return;
      }
    }
    if (
      event.key === "Backspace"
      && event.currentTarget.selectionStart === 0
      && event.currentTarget.selectionEnd === 0
    ) {
      if (uploads.length > 0) {
        event.preventDefault();
        setUploads((current) => current.slice(0, -1));
        return;
      }
      if (attachments.length > 0) {
        event.preventDefault();
        setAttachments((current) => current.slice(0, -1));
        return;
      }
      if (links.length > 0) {
        event.preventDefault();
        setLinks((current) => current.slice(0, -1));
        return;
      }
    }
    if (event.key === " " && !event.nativeEvent.isComposing) {
      const pos = event.currentTarget.selectionStart;
      const taken = takeTrailingUrl(value, pos);
      if (taken) {
        event.preventDefault();
        addLink(taken.url);
        onChange(taken.next);
        setCursor(taken.next.length);
        requestAnimationFrame(() => {
          area.current?.focus();
          area.current?.setSelectionRange(taken.next.length, taken.next.length);
        });
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
      if (disabled) return;
      const trailing = takeTrailingUrl(value, value.length);
      const nextLinks = trailing && !links.includes(trailing.url) ? [...links, trailing.url] : links;
      const text = compose(trailing?.next ?? value, nextLinks);
      if (!text && uploads.length === 0) return;
      const refs = uploads.map((item) => item.dataUri);
      setAttachments([]);
      setLinks([]);
      setUploads([]);
      onChange("");
      onSubmit(text, refs.length ? refs : undefined);
    }
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
            {queued && queued.length > 0 && (
              <div className="prompt-queue-meta">
                <span className="prompt-queue-count">{t("composer.queued", { n: queued.length })}</span>
                {!running && (
                  <button type="button" className="prompt-queue-flush" onClick={() => onSendQueue?.(queued[0]!.id)}>
                    {t("composer.sendQueue")}
                  </button>
                )}
              </div>
            )}
          </div>
          {queued && queued.length > 0 && (
            <div className="prompt-queue">
              {queued.map((item, index) => (
                <div key={item.id} className="prompt-queue-row">
                  <span className="prompt-queue-index">{index + 1}</span>
                  <p className="prompt-queue-text">{item.text}</p>
                  <div className="prompt-queue-actions">
                    <button
                      type="button"
                      className="bubble-action"
                      aria-label={running ? t("composer.bumpQueue") : t("composer.sendQueue")}
                      onClick={() => onSendQueue?.(item.id)}
                    >
                      <Icon path="M12 19V5M5 12l7-7 7 7" size={13} />
                    </button>
                    <button type="button" className="bubble-action" aria-label={t("composer.editQueue")} onClick={() => onEditQueue?.(item.id)}>
                      <Icon path="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" size={13} />
                    </button>
                    <button type="button" className="bubble-action" aria-label={t("composer.dropQueue")} onClick={() => onDropQueue?.(item.id)}>
                      <Icon path="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <form
          className={dropOver ? "prompt drop" : "prompt"}
          onDragOver={(event) => {
            const types = [...event.dataTransfer.types];
            if (!types.includes("text/harness-path") && !types.includes("Files")) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            setDropOver(true);
          }}
          onDragLeave={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node)) return;
            setDropOver(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDropOver(false);
            const internal = event.dataTransfer.getData("text/harness-path").trim();
            if (internal) {
              setAttachments((current) => current.includes(internal) ? current : [...current, internal]);
              area.current?.focus();
              return;
            }
            const dropped = [...event.dataTransfer.files];
            if (dropped.length === 0) return;
            const images = dropped.filter((file) => file.type.startsWith("image/"));
            if (images.length) void addUploads(images);
            if (!workspace) return;
            const extras: string[] = [];
            for (const file of dropped) {
              if (file.type.startsWith("image/")) continue;
              const abs = "path" in file && typeof file.path === "string" ? file.path : "";
              const rel = abs ? workspaceRelative(abs, workspace) : undefined;
              if (!rel) continue;
              extras.push(files.includes(`${rel}/`) ? `${rel}/` : rel);
            }
            if (extras.length === 0) return;
            setAttachments((current) => [...current, ...extras.filter((file) => !current.includes(file))]);
            area.current?.focus();
          }}
          onSubmit={(event) => {
            event.preventDefault();
            if (disabled) return;
            if (slash && commands[0]) {
              insertSkillCommand((commands[picked] ?? commands[0]).id);
              return;
            }
            const trailing = takeTrailingUrl(value, value.length);
            const nextLinks = trailing && !links.includes(trailing.url) ? [...links, trailing.url] : links;
            const text = compose(trailing?.next ?? value, nextLinks);
            if (!text && uploads.length === 0) return;
            const refs = uploads.map((item) => item.dataUri);
            setAttachments([]);
            setLinks([]);
            setUploads([]);
            onChange("");
            onSubmit(text, refs.length ? refs : undefined);
          }}
        >
          {(attachments.length > 0 || links.length > 0 || uploads.length > 0) && (
          <div className="prompt-tags">
            {attachments.map((file) => (
              <button
                key={file}
                type="button"
                className="prompt-tag"
                onClick={() => setAttachments((current) => current.filter((item) => item !== file))}
                aria-label={t("composer.removeFile", { name: file })}
              >
                <span>@{file}</span>
                <Icon path="M18 6L6 18M6 6l12 12" size={12} />
              </button>
            ))}
            {links.map((url) => (
              <button
                key={url}
                type="button"
                className="prompt-tag link"
                onClick={() => setLinks((current) => current.filter((item) => item !== url))}
                aria-label={url}
              >
                <Icon path={LINK_ICON} size={12} />
                <span>{urlChipLabel(url)}</span>
                <Icon path="M18 6L6 18M6 6l12 12" size={12} />
              </button>
            ))}
            {uploads.map((item) => (
              <button
                key={item.id}
                type="button"
                className="prompt-upload"
                aria-label={t("composer.removeFile", { name: item.name })}
                onClick={() => setUploads((current) => current.filter((entry) => entry.id !== item.id))}
              >
                <img src={item.dataUri} alt="" />
                <Icon path="M18 6L6 18M6 6l12 12" size={11} />
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={area}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            setCursor(event.target.selectionStart);
          }}
          onSelect={(event) => setCursor(event.currentTarget.selectionStart)}
          onKeyDown={onKey}
          onPaste={(event) => {
            const images = [...event.clipboardData.files].filter((file) => file.type.startsWith("image/"));
            if (images.length > 0) {
              event.preventDefault();
              void addUploads(images);
              return;
            }
            const pasted = event.clipboardData.getData("text").trim();
            if (!isHttpUrl(pasted)) return;
            event.preventDefault();
            addLink(trimHttpUrl(pasted));
          }}
          placeholder={running ? t("composer.placeholderFollowup") : workspace ? t("composer.placeholderWorkspace") : t("composer.placeholderEmpty")}
          rows={hero && !value ? 2 : 1}
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
            disabled={uploads.length >= MAX_UPLOAD_IMAGES}
            onClick={() => picker.current?.click()}
          >
            <Icon path="M12 5v14M5 12h14" size={15} />
          </button>
          <Combo value={model} options={models} searchable placeholder={t("composer.filterModels")} down={hero} onChange={onModel} />
          <PermissionPicker value={permission} down={hero} onChange={onPermission} />
          {!hero && <ContextStats stats={stats} model={model} up />}
          {running ? (
            <button type="button" className="send stop" onClick={onStop} aria-label={t("composer.abort")}>
              <i />
            </button>
          ) : (
            <button type="submit" className="send" disabled={disabled || (!compose().trim() && uploads.length === 0)} aria-label={t("composer.send")}>
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

  const dropDown = Boolean(down) || (anchor ? anchor.top < 260 : false);
  const placement = anchor
    ? {
      left: anchor.left,
      minWidth: Math.max(anchor.width, 220),
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
  const title = undoDialogTitle(copy.heading, lastTurn);
  return (
    <div className="approval">
      <strong>{copy.destructive ? t("approval.destructiveTitle") : title}</strong>
      {copy.destructive ? (
        <>
          <p>{t("approval.destructiveBody")}</p>
          {copy.command && (
            <details className="approval-cmd">
              <summary>{t("approval.showCommand")}</summary>
              <pre className="approval-detail">{copy.command}</pre>
            </details>
          )}
        </>
      ) : (
        <>
          {copy.detail && <pre className="approval-detail">{copy.detail}</pre>}
          {copy.message && <p>{copy.message}</p>}
        </>
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

function accessChoiceLabel(option: string, t: (key: string) => string): string {
  if (option === "Allow once") return t("approval.allowOnce");
  if (option === "Allow for this conversation" || option === "Allow this command for this session") {
    return t("approval.allowConversation");
  }
  if (option === "Deny") return t("common.reject");
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

type SettingsPane = "chat" | "vision" | "shortcuts" | "skills" | "about";

function settingsNav(t: ReturnType<typeof useI18n>["t"]): Array<{ label: string; items: Array<{ id: SettingsPane; label: string; icon: string }> }> {
  return [
  {
    label: t("settings.groupModels"),
    items: [
      { id: "chat", label: t("settings.chat"), icon: "M4 6h16v10H8l-4 4V6z" },
      { id: "vision", label: t("settings.vision"), icon: "M4 6h16v12H4zM8 14l3-3 2 2 3-4 4 5" },
    ],
  },
  {
    label: t("settings.groupHelp"),
    items: [
      {
        id: "skills",
        label: t("settings.skills"),
        icon: "M12 2l3 7h7l-5.5 4 2 7L12 16l-6.5 4 2-7L2 9h7z",
      },
      {
        id: "shortcuts",
        label: t("settings.shortcuts"),
        icon: "M2 5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5zm3 3h2v2H5V8zm4 0h2v2H9V8zm4 0h2v2h-2V8zm4 0h2v2h-2V8zm-12 4h2v2H5v-2zm4 0h6v2H9v-2zm8 0h2v2h-2v-2z",
      },
      {
        id: "about",
        label: t("settings.about"),
        icon: "M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 14a1.2 1.2 0 1 1 1.2-1.2A1.2 1.2 0 0 1 12 16zm1.2-5.5h-2.4V7h2.4z",
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
  const [kind, setKind] = useState<ChatKind>("deepseek");
  const [deepseekKey, setDeepseekKey] = useState("");
  const [deepseekModel, setDeepseekModel] = useState(DEEPSEEK_PRESET.model);
  const [customUrl, setCustomUrl] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [customKey, setCustomKey] = useState("");
  const [visionEndpoint, setVisionEndpoint] = useState(DEFAULT_VISION_CONFIG.endpoint);
  const [visionModel, setVisionModel] = useState(DEFAULT_VISION_CONFIG.model);
  const [visionKey, setVisionKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [chatModels, setChatModels] = useState<string[]>([]);
  const [visionModels, setVisionModels] = useState<string[]>([]);
  const [listing, setListing] = useState<"chat" | "vision" | null>(null);
  const [appVersion, setAppVersion] = useState("");
  const [skillCopied, setSkillCopied] = useState<string>();
  const [testStatus, setTestStatus] = useState<{ target: "chat" | "vision"; ok: boolean; message: string } | null>(null);

  const chatUrl = kind === "deepseek" ? DEEPSEEK_PRESET.url : customUrl;
  const chatKey = kind === "deepseek" ? deepseekKey : customKey;
  const chatModel = kind === "deepseek" ? deepseekModel : customModel;
  const modKey = window.harness.platform === "darwin" ? "⌘" : "Ctrl";

  const listModels = async (target: "chat" | "vision") => {
    const base = target === "chat" ? chatUrl : visionEndpoint;
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
    ]).then(([profiles, config, ver]) => {
      setKind(profiles.kind);
      setDeepseekKey(profiles.deepseek.apiKey);
      setDeepseekModel(profiles.deepseek.model || DEEPSEEK_PRESET.model);
      setCustomUrl(profiles.custom.url);
      setCustomModel(profiles.custom.model);
      setCustomKey(profiles.custom.apiKey);
      setVisionEndpoint(config.endpoint);
      setVisionModel(config.model);
      if (config.apiKey) setVisionKey(config.apiKey);
      if (ver) setAppVersion(ver);
      const url = profiles.kind === "custom" ? profiles.custom.url : DEEPSEEK_PRESET.url;
      const key = profiles.kind === "custom" ? profiles.custom.apiKey : profiles.deepseek.apiKey;
      if (url.trim() && key.trim()) {
        void window.harness.auth.listModels(url, key).then(setChatModels).catch(() => undefined);
      }
      if (config.endpoint.trim() && config.apiKey.trim()) {
        void window.harness.auth.listModels(config.endpoint, config.apiKey).then(setVisionModels).catch(() => undefined);
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
            if (kind === "deepseek" ? deepseekKey.trim() || deepseekModel.trim() : customKey.trim() || customUrl.trim() || customModel.trim()) {
              await window.harness.auth.saveProfiles({
                kind,
                deepseek: { model: deepseekModel, apiKey: deepseekKey },
                custom: { url: customUrl, model: customModel, apiKey: customKey },
              });
            }
            await window.harness.vision.saveConfig({
              endpoint: visionEndpoint.trim(),
              model: visionModel.trim(),
              ...(visionKey.trim() ? { apiKey: visionKey.trim() } : {}),
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
                <div className="settings-seg">
                  {([["deepseek", t("settings.deepseekPreset")], ["custom", t("settings.customApi")]] as const).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      className={kind === id ? "on" : ""}
                      onClick={() => {
                        if (id === kind) return;
                        setKind(id);
                        setChatModels([]);
                        setTestStatus(null);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="settings-card">
                  <div className="settings-card-body">
                    {kind === "deepseek" ? (
                      <p className="settings-hint">{t("settings.deepseekHint")}</p>
                    ) : (
                      <p className="settings-hint">{t("settings.customHint")}</p>
                    )}

                    {kind === "custom" && (
                      <label>
                        {t("settings.baseUrl")}
                        <input
                          value={customUrl}
                          onChange={(event) => setCustomUrl(event.target.value)}
                          placeholder="https://api.example.com/v1"
                        />
                      </label>
                    )}

                    <SecretField value={chatKey} onChange={kind === "deepseek" ? setDeepseekKey : setCustomKey} />

                    <ModelField
                      value={chatModel}
                      onChange={kind === "deepseek" ? setDeepseekModel : setCustomModel}
                      models={chatModels}
                      listing={listing === "chat"}
                      canList={Boolean(chatUrl.trim() && chatKey.trim())}
                      onList={() => void listModels("chat")}
                    />

                    {testStatus?.target === "chat" && (
                      <div className={`settings-feedback ${testStatus.ok ? "ok" : "err"}`}>
                        <Icon path={testStatus.ok ? "M5 12.5l4 4 10-10" : "M12 8v4m0 4h.01M22 12A10 10 0 1 1 2 12a10 10 0 0 1 22 0z"} size={14} />
                        <span>{testStatus.message}</span>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {pane === "vision" && (
              <>
                <div className="settings-card">
                  <div className="settings-card-head">
                    <strong>{t("settings.visionTitle")}</strong>
                    <span className="settings-card-badge">{t("settings.visionBadge")}</span>
                  </div>
                  <div className="settings-card-body">
                    <p className="settings-hint">{t("settings.visionHint")}</p>
                    <label>
                      {t("settings.endpoint")}
                      <input
                        value={visionEndpoint}
                        onChange={(event) => setVisionEndpoint(event.target.value)}
                        placeholder={DEFAULT_VISION_CONFIG.endpoint}
                      />
                    </label>
                    <SecretField value={visionKey} onChange={setVisionKey} placeholder={t("settings.zhipuKey")} />
                    <ModelField
                      value={visionModel}
                      onChange={setVisionModel}
                      models={visionModels}
                      listing={listing === "vision"}
                      canList={Boolean(visionEndpoint.trim() && visionKey.trim())}
                      onList={() => void listModels("vision")}
                      placeholder={DEFAULT_VISION_CONFIG.model}
                    />

                    {testStatus?.target === "vision" && (
                      <div className={`settings-feedback ${testStatus.ok ? "ok" : "err"}`}>
                        <Icon path={testStatus.ok ? "M5 12.5l4 4 10-10" : "M12 8v4m0 4h.01M22 12A10 10 0 1 1 2 12a10 10 0 0 1 22 0z"} size={14} />
                        <span>{testStatus.message}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="settings-card muted">
                  <div className="settings-card-head">
                    <strong>{t("settings.mineruTitle")}</strong>
                    <span className="settings-card-badge free">{t("settings.mineruBadge")}</span>
                  </div>
                  <div className="settings-card-body">
                    <p className="settings-hint">{t("settings.mineruHint")}</p>
                  </div>
                </div>
              </>
            )}

            {pane === "skills" && (
              <div className="settings-card">
                <div className="settings-card-body">
                  <p className="settings-hint">{t("settings.skillsHint")}</p>
                  <p className="settings-hint">{t("settings.skillsUse")}</p>

                  <div className="skills-section">
                    <h3 className="skills-section-title">{t("settings.skillsPaths")}</h3>
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

                  <div className="skills-section">
                    <div className="skills-section-head">
                      <h3 className="skills-section-title">{t("settings.skillsTitle")}</h3>
                      <button type="button" className="ghost" onClick={() => onRefreshSkills?.()}>
                        {t("settings.skillsRefresh")}
                      </button>
                    </div>
                    {agentSkills.length === 0 ? (
                      <p className="settings-hint">{t("settings.skillsEmpty")}</p>
                    ) : (
                      <div className="skills-list">
                        {agentSkills.map((skill) => {
                          const command = skillSlashCommand(skill.name);
                          return (
                            <div key={skill.name} className="skills-row">
                              <div className="skills-row-main">
                                <code className="skills-row-name">{command}</code>
                                {skill.description ? <p className="skills-row-desc">{skill.description}</p> : null}
                              </div>
                              <button
                                type="button"
                                className="ghost"
                                onClick={() => {
                                  void navigator.clipboard.writeText(command).then(() => {
                                    setSkillCopied(skill.name);
                                    window.setTimeout(() => setSkillCopied((current) => (current === skill.name ? undefined : current)), 1200);
                                  });
                                }}
                              >
                                {skillCopied === skill.name ? t("settings.skillsCopied") : t("settings.skillsCopy")}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {pane === "shortcuts" && (
              <div className="settings-card">
                <div className="settings-card-body">
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
                </div>
              </div>
            )}

            {pane === "about" && (
              <div className="settings-card">
                <div className="settings-card-body about-body">
                  <div className="about-hero">
                    <img src={logo} alt="" className="about-logo" width={40} height={23} />
                    <h3>
                      {t("about.title")}
                      <span className="about-version">v{appVersion || "0.1.3"}</span>
                    </h3>
                    <p className="about-tagline">{t("about.subtitle")}</p>
                  </div>

                  <p className="about-desc">{t("about.desc")}</p>
                  <p className="about-credit">{t("about.piCredit")}</p>

                  <dl className="about-meta">
                    <div className="about-meta-row">
                      <dt>{t("about.core")}</dt>
                      <dd>{t("about.coreVal")}</dd>
                    </div>
                    <div className="about-meta-row">
                      <dt>{t("about.arch")}</dt>
                      <dd>Electron 37 · React 19 · Node 22</dd>
                    </div>
                    <div className="about-meta-row">
                      <dt>{t("about.sandbox")}</dt>
                      <dd>{t("about.sandboxVal")}</dd>
                    </div>
                    <div className="about-meta-row">
                      <dt>{t("about.dataDir")}</dt>
                      <dd>{t("about.dataDirVal")}</dd>
                    </div>
                    <div className="about-meta-row">
                      <dt>{t("about.license")}</dt>
                      <dd>MIT License</dd>
                    </div>
                  </dl>
                </div>
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
                  onClick={() => void window.harness.app.openExternal("https://github.com/tt-11-dd/tether-ai")}
                >
                  <Icon path="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" size={14} />
                  <span>{t("about.github")}</span>
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
                  !visionEndpoint.trim() ||
                  !visionModel.trim() ||
                  (kind === "deepseek"
                    ? !deepseekModel.trim() || !deepseekKey.trim()
                    : !customUrl.trim() || !customModel.trim() || !customKey.trim())
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
