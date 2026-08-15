import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PREVIEW_HOST, PREVIEW_SCHEME, type ExtensionUiRequest, type PermissionMode } from "../shared/types";
import { DEFAULT_VISION_CONFIG, visibleUserText } from "../shared/vision-api";
import { DEEPSEEK_PRESET, type ChatKind } from "../shared/chat-profiles";
import { collectFileChanges, collapseThinking, filterMentionPaths, formatCommand, formatThinking, liveStatus, omitFinalReply, repairMarkdownTables, splitPatch, thoughtSteps, toolCommand, toolSummary, turnWork, undoDialogTitle, workspaceRelative, type ChatMessage, type FileChange, type SessionFile, type SessionTodo, type ToolActivity, type WorkItem } from "./conversation";
import { tokenizeCode } from "./highlight";
import logo from "./logo.svg";

const MAX_UPLOAD_IMAGES = 4;

export function Icon({ path, size = 16, className }: { path: string; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

export function UserTurn({ text, images = [] }: { text: string; images?: Array<{ data: string; mimeType: string }> }) {
  const shown = visibleUserText(text);
  const [view, setView] = useState<string>();
  return (
    <div className="user-turn">
      <article className="user">
        {images.length > 0 && (
          <div className="user-images">
            {images.map((image, index) => {
              const src = `data:${image.mimeType};base64,${image.data}`;
              return (
                <button key={`${image.mimeType}-${index}`} type="button" className="user-image" onClick={() => setView(src)}>
                  <img src={src} alt="" />
                </button>
              );
            })}
          </div>
        )}
        {shown}
      </article>
      <div className="bubble-actions">
        <CopyAction text={shown} />
      </div>
      {view && (
        <div className="modal" onClick={() => setView(undefined)} onKeyDown={(event) => { if (event.key === "Escape") setView(undefined); }}>
          <img className="lightbox" src={view} alt="" />
        </div>
      )}
    </div>
  );
}

function CopyAction({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  if (!text.trim()) return null;
  return (
    <button
      type="button"
      className="bubble-action"
      aria-label={copied ? "已复制" : "复制"}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      <Icon path={copied ? "M5 12.5l4 4 10-10" : "M8 8h12v12H8zM4 16V4h12"} size={14} />
    </button>
  );
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
          新对话
        </button>
        <button type="button" className="nav-btn" onClick={onOpen}>
          <Icon path="M3 7h6l2 2h10v10H3z" />
          项目
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
  title,
}: {
  children: ReactNode;
  composer?: ReactNode;
  home?: boolean;
  inspect?: ReactNode;
  title?: string;
}) {
  const [drawer, setDrawer] = useState(true);
  return (
    <section className={home ? "chat home" : "chat"}>
      <header className="chat-bar">
        {!home && title && <h1 className="chat-title">{title}</h1>}
        {inspect && (
          <button
            type="button"
            className={drawer ? "inspect-toggle on" : "inspect-toggle"}
            aria-label={drawer ? "收起右侧抽屉" : "打开右侧抽屉"}
            onClick={() => setDrawer((current) => !current)}
          >
            <Icon path="M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M15.5 4v16" />
          </button>
        )}
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

export function Thinking({
  text,
  work,
  tools,
  live,
  startedAt,
  endedAt,
}: {
  text: string;
  work: WorkItem[];
  tools: ToolActivity[];
  live: boolean;
  startedAt?: number;
  endedAt?: number;
}) {
  const [open, setOpen] = useState(true);
  const [born] = useState(() => Date.now());
  const steps = thoughtSteps(work, tools, text);
  const start = startedAt ?? (live ? born : undefined);
  const summary = toolSummary(tools);
  const current = liveStatus(tools);
  const header = summary || (live ? "思考中…" : "思考过程");
  const showLive = live && current !== header;
  const hasBody = steps.length > 0 || showLive;
  if (!hasBody && !live) return null;
  return (
    <div className={live ? (open ? "trace live open" : "trace live") : open ? "trace open" : "trace"}>
      <button type="button" className="trace-toggle" onClick={() => hasBody && setOpen((value) => !value)}>
        {live ? <Dots /> : <Icon className="trace-done" path="M5 12.5l4 4 10-10" size={16} />}
        <span className={live ? "shimmer trace-label" : "trace-label"}>
          {header}
        </span>
        <Elapsed start={start} end={endedAt} live={live} />
        {hasBody ? <Icon className="chevron" path="M6 9l6 6 6-6" size={14} /> : null}
      </button>
      {open && hasBody && (
        <ThoughtList live={live}>
          {steps.flatMap((step, index) => [
            ...(step.text ? [(
              <div key={`t${index}`} className="thought">
                <Mark kind="think" />
                <div className="thought-body markdown">
                  <Markdown>{formatThinking(step.text)}</Markdown>
                </div>
              </div>
            )] : []),
            ...(step.tools.length > 0 ? [(
              <div key={`w${index}`} className="thought">
                <Mark kind="tool" />
                <div className="thought-tools">
                  {step.tools.map((tool) => {
                    const command = formatCommand(toolCommand(tool));
                    return (
                      <div key={tool.id} className="thought-tool-item">
                        {command ? (
                          <TerminalBlock command={command} tool={tool} />
                        ) : (
                          <div className={`thought-tool-chip ${tool.status}`}>
                            <Icon
                              path={
                                tool.status === "error"
                                  ? "M6 6l12 12M18 6L6 18"
                                  : tool.status === "running"
                                    ? "M12 2a10 10 0 1 0 10 10"
                                    : "M5 12.5l4 4 10-10"
                              }
                              size={13}
                            />
                            <span>{tool.title}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )] : []),
          ])}
          {showLive && (
            <div className="thought">
              <Mark kind="think" />
              <span className="thought-done shimmer">{current}</span>
            </div>
          )}
          {!live && steps.length > 0 && (
            <div className="thought">
              <Mark kind="done" />
              <span className="thought-done">回答完成</span>
            </div>
          )}
        </ThoughtList>
      )}
    </div>
  );
}

function TerminalBlock({ command, tool }: { command: string; tool: ToolActivity }) {
  const [copied, setCopied] = useState(false);
  const [showOutput, setShowOutput] = useState(tool.status === "error");
  const [expandedAll, setExpandedAll] = useState(false);
  const rawOutput = tool.output?.trim() ?? "";
  const hasOutput = Boolean(rawOutput);
  const isRunning = tool.status === "running";
  const isError = tool.status === "error";

  const lines = rawOutput ? rawOutput.split("\n") : [];
  const isTooLong = lines.length > 40;
  const displayOutput = isTooLong && !expandedAll ? `${lines.slice(0, 40).join("\n")}\n…` : rawOutput;

  const onCopy = () => {
    void navigator.clipboard.writeText(command).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <div className={`terminal-box ${tool.status}`}>
      <div className="terminal-bar">
        <div className="terminal-dots">
          <span className="terminal-dot red" />
          <span className="terminal-dot yellow" />
          <span className="terminal-dot green" />
          <span className="terminal-title">{tool.title || "命令执行"}</span>
        </div>
        <div className="terminal-actions">
          {isRunning && <span className="terminal-badge running"><i />运行中</span>}
          {isError && <span className="terminal-badge error">失败</span>}
          {!isRunning && !isError && tool.endedAt && tool.startedAt && (
            <span className="terminal-time">{formatDuration(tool.startedAt, tool.endedAt)}</span>
          )}
          {hasOutput && (
            <button
              type="button"
              className={`terminal-toggle-btn ${showOutput ? "on" : ""}`}
              onClick={() => setShowOutput((v) => !v)}
            >
              {showOutput ? "收起输出" : "输出"}
            </button>
          )}
          <button
            type="button"
            className="terminal-copy-btn"
            aria-label={copied ? "已复制" : "复制命令"}
            onClick={onCopy}
          >
            <Icon path={copied ? "M5 12.5l4 4 10-10" : "M8 8h12v12H8zM4 16V4h12"} size={12} />
            {copied && <span className="terminal-copied">已复制</span>}
          </button>
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
              {expandedAll ? "折叠长输出" : `展开全部 (${lines.length} 行)`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Mark({ kind }: { kind: "think" | "tool" | "done" }) {
  const path = kind === "tool"
    ? "M4 17l6-6-6-6M12 19h8"
    : kind === "done"
      ? "M5 12.5l4 4 10-10"
      : "M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18";
  return (
    <span className={`thought-mark ${kind}`} aria-hidden="true">
      <Icon path={path} size={13} />
    </span>
  );
}

function ThoughtList({ live, children }: { live: boolean; children: ReactNode }) {
  const [expanded, setExpanded] = useState(live);
  const [overflow, setOverflow] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setExpanded(live);
  }, [live]);

  useEffect(() => {
    const node = box.current;
    if (!node) return;
    const measure = () => {
      if (expanded) {
        setOverflow(false);
        return;
      }
      setOverflow(node.scrollHeight > node.clientHeight + 8);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [children, expanded, live]);

  return (
    <div className="thoughts-wrap">
      <div ref={box} className={expanded || live ? "thoughts" : "thoughts clamped"}>
        {children}
      </div>
      {!live && overflow && !expanded && (
        <button type="button" className="thought-more" onClick={() => setExpanded(true)}>
          展开全部
        </button>
      )}
      {!live && expanded && (
        <button type="button" className="thought-more" onClick={() => setExpanded(false)}>
          收起
        </button>
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

function Markdown({ children }: { children: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{repairMarkdownTables(children)}</ReactMarkdown>;
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
      {text && (
        <div className="markdown">
          <Markdown>{text}</Markdown>
          {streaming && <span className="caret" />}
        </div>
      )}
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
  const thinking = collapseThinking(...messages.map((item) => item.thinking));
  const tools = [...new Map(messages.flatMap((item) => item.tools).map((tool) => [tool.id, tool])).values()];
  const work = turnWork(messages);
  const text = messages.map((item) => item.text).filter(Boolean).join("\n\n");
  const error = messages.map((item) => item.error).find(Boolean);
  const live = messages.some((item) => item.streaming) || tools.some((item) => item.status === "running");
  const started = messages.find((item) => item.timestamp)?.timestamp ?? tools[0]?.startedAt;
  const ended = Math.max(0, ...messages.map((item) => item.timestamp ?? 0), ...tools.map((item) => item.endedAt ?? 0));
  const changes = collectFileChanges(tools);
  return (
    <article className="turn">
      {(live || thinking || work.length > 0 || tools.length > 0) && (
        <div className="turn-trace">
          <Thinking text={thinking} work={omitFinalReply(work, live ? "" : text)} tools={tools} live={live} startedAt={started} endedAt={ended || undefined} />
        </div>
      )}
      <ChangeSummary files={changes} onOpen={onOpenFile} />
      <StreamingText text={live ? "" : text} streaming={false} />
      {!live && text.trim() && (
        <div className="bubble-actions assistant">
          <CopyAction text={text} />
        </div>
      )}
      {error && (
        <div className="turn-error">
          <p>{error}</p>
          {onRetry && <button type="button" className="ghost" onClick={onRetry}>继续</button>}
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
        <Fold title="任务规划" open={progress} onToggle={() => setProgress((current) => !current)}>
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
        <Fold title="本轮改动" open={changesOpen} onToggle={() => setChangesOpen((current) => !current)}>
          <div className="inspect-changes">
            {edits.map((file) => (
              <button key={file.path} type="button" className="inspect-file edit" onClick={() => onOpen(file)}>
                <Icon path={fileGlyph(file.path)} size={14} />
                <span>{file.path.split("/").pop()}</span>
                <small>
                  {file.additions > 0 ? <b className="add">+{file.additions}</b> : null}
                  {file.deletions > 0 ? <b className="del">-{file.deletions}</b> : null}
                  {file.additions === 0 && file.deletions === 0 ? "改" : null}
                </small>
              </button>
            ))}
            {onUndo && !running && (
              <button type="button" className="inspect-undo" onClick={onUndo}>撤回上一轮改动</button>
            )}
          </div>
        </Fold>
      )}
      {workspace && (
        <Fold title="文件" open={working} onToggle={() => setWorking((current) => !current)}>
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
              {prefix ? prefix.replace(/\/$/, "") : folder ?? "工作区"}
            </button>
            {treeOpen && visible.length === 0 && <p className="sidebar-empty">没有文件</p>}
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
          {file.path.split("/").pop()}
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
  const [body, setBody] = useState("读取中…");
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
    void window.harness.workspace.read(file.path, workspace).then(
      (result) => {
        if (!gone) setBody(result.binary ? "二进制文件" : result.content);
      },
      (error: unknown) => {
        if (!gone) setBody(error instanceof Error ? error.message : String(error));
      },
    );
    return () => {
      gone = true;
    };
  }, [file.path, workspace]);
  const preview = rendered && (markdown || html);
  const diff = Boolean(file.patch && diffOpen && !preview);
  return (
    <aside className={wide ? "drawer wide" : "drawer"}>
      <header>
        <div>
          <strong>{file.path.split("/").pop()}</strong>
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
            {diffOpen ? "当前文件" : "查看改动"}
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
            aria-label={preview ? "查看源码" : "预览"}
            onClick={() => setRendered((current) => !current)}
          >
            <Icon path={preview ? "M16 18l6-6-6-6M8 6l-6 6 6 6" : "M2 12s4-8 10-8 10 8 10 8-4 8-10 8-10-8-10-8M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6"} size={16} />
          </button>
        )}
        <button type="button" className="drawer-btn" aria-label="复制" onClick={() => void navigator.clipboard.writeText(body)}>
          <Icon path="M8 8h12v12H8zM4 16V4h12" size={16} />
        </button>
        <button type="button" className="drawer-btn" aria-label="打开" onClick={() => void window.harness.workspace.open(file.path, workspace)}>
          <Icon path="M14 4h6v6M20 4l-8 8M10 4H5v16h14v-5" size={16} />
        </button>
        <button type="button" className="drawer-btn" aria-label={wide ? "还原" : "放大"} onClick={() => setWide((current) => !current)}>
          <Icon path={wide ? "M4 14h6v6M20 10h-6V4M14 20v-6h6M10 4v6H4" : "M15 3h6v6M9 21H3v-6M21 15v6h-6M3 9V3h6"} size={16} />
        </button>
        <button type="button" className="drawer-close" aria-label="关闭" onClick={onClose}>
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
          title={`${file.path} 预览`}
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
  placement = "dock",
}: {
  value: string;
  onChange(value: string): void;
  onSubmit(text?: string, images?: string[]): void;
  onStop(): void;
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
  placement?: "dock" | "hero";
}) {
  const [cursor, setCursor] = useState(value.length);
  const [files, setFiles] = useState<string[]>([]);
  const [listing, setListing] = useState(false);
  const [picked, setPicked] = useState(0);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [uploads, setUploads] = useState<Array<{ id: string; name: string; dataUri: string }>>([]);
  const [dropOver, setDropOver] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const mention = workspace ? mentionAt(value, cursor) : undefined;
  const matches = mention ? filterMentionPaths(files, mention.query) : [];

  useEffect(() => {
    setAttachments([]);
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

  const compose = (text = value) => {
    const prefix = attachments.map((file) => `@${file}`).join(" ");
    return [prefix, text.trim()].filter(Boolean).join(" ");
  };

  const addUploads = async (list: FileList | File[]) => {
    const next: Array<{ id: string; name: string; dataUri: string }> = [];
    for (const file of [...list]) {
      if (!file.type.startsWith("image/")) continue;
      next.push({
        id: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`,
        name: file.name,
        dataUri: await readDataUri(file),
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

  const slash = value === "/" || /^\/[^\s]*$/.test(value);
  const commands = [
    { id: "/undo", label: "撤回上一轮改动" },
    { id: "/new", label: "新对话" },
    { id: "/open", label: "打开仓库" },
    { id: "/login", label: "设置" },
  ].filter((item) => item.id.startsWith(value || "/"));

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
        if (cmd) {
          onChange("");
          onCommand(cmd.id);
        }
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
    }
    if (slash && event.key === "Enter" && commands[0] && !event.shiftKey) {
      event.preventDefault();
      onChange("");
      onCommand(commands[0].id);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      const text = compose();
      if (!text && uploads.length === 0) return;
      const refs = uploads.map((item) => item.dataUri);
      setAttachments([]);
      setUploads([]);
      onChange("");
      onSubmit(text, refs.length ? refs : undefined);
    }
  };

  const hero = placement === "hero";
  const folder = workspace?.split("/").pop();
  return (
    <div className={hero ? "prompt-wrap hero" : "prompt-wrap"}>
      <div className="prompt-shell">
        <div className="prompt-topbar">
          <button
            type="button"
            className={folder ? "prompt-folder on" : "prompt-folder"}
            onClick={onPickWorkspace}
            title={workspace ?? "选择或打开本地项目"}
          >
            <Icon path="M3 7h6l2 2h10v10H3z" size={13} />
            <span>{folder ?? "选择项目"}</span>
          </button>
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
            if (slash && commands[0]) {
              onChange("");
              onCommand(commands[0].id);
              return;
            }
            const text = compose();
            if (!text && uploads.length === 0) return;
            const refs = uploads.map((item) => item.dataUri);
            setAttachments([]);
            setUploads([]);
            onChange("");
            onSubmit(text, refs.length ? refs : undefined);
          }}
        >
          {(attachments.length > 0 || uploads.length > 0) && (
          <div className="prompt-tags">
            {attachments.map((file) => (
              <button
                key={file}
                type="button"
                className="prompt-tag"
                onClick={() => setAttachments((current) => current.filter((item) => item !== file))}
                aria-label={`移除 ${file}`}
              >
                <span>@{file}</span>
                <Icon path="M18 6L6 18M6 6l12 12" size={12} />
              </button>
            ))}
            {uploads.map((item) => (
              <button
                key={item.id}
                type="button"
                className="prompt-upload"
                aria-label={`移除 ${item.name}`}
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
            if (images.length === 0) return;
            event.preventDefault();
            void addUploads(images);
          }}
          placeholder={workspace ? "输入你的需求或问题，输入 @ 可选择文件…" : "输入你的想法或指令，或从上方选择项目开始…"}
          rows={hero ? 3 : 1}
        />
        {slash && (
          <div className="slash-menu">
            {commands.length === 0 && <p className="slash-empty">无匹配命令</p>}
            {commands.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className={index === picked ? "on" : ""}
                onClick={() => {
                  onChange("");
                  onCommand(item.id);
                }}
              >
                <code>{item.id}</code>
                {item.label}
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
            {matches.length === 0 && <p className="slash-empty">{listing ? "正在列出文件…" : "没有匹配的文件"}</p>}
            {matches.map((file, index) => (
              <button
                key={file}
                type="button"
                className={index === picked ? "on" : ""}
                onClick={() => insertFile(file)}
              >
                <span>{file}</span>
                {file.endsWith("/") && mention.query === file && <small>选中此目录</small>}
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
            aria-label="上传图片"
            disabled={uploads.length >= MAX_UPLOAD_IMAGES}
            onClick={() => picker.current?.click()}
          >
            <Icon path="M12 5v14M5 12h14" size={15} />
          </button>
          <Combo value={model} options={models} searchable placeholder="筛选模型" down={hero} onChange={onModel} />
          <PermissionPicker value={permission} down={hero} onChange={onPermission} />
          {running ? (
            <button type="button" className="send stop" onClick={onStop} aria-label="中止">
              <i />
            </button>
          ) : (
            <button type="submit" className="send" disabled={disabled || (!compose().trim() && uploads.length === 0)} aria-label="发送">
              <Icon path="M12 19V5M5 12l7-7 7 7" size={15} />
            </button>
          )}
        </div>
      </form>
      </div>
    </div>
  );
}

function readDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`无法读取 ${file.name}`));
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

export const PERMISSION_OPTIONS: PermissionOptionConfig[] = [
  {
    value: "plan",
    label: "仅规划",
    desc: "只分析和规划，不修改文件或运行命令。",
    icon: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  },
  {
    value: "ask",
    label: "编辑时询问",
    desc: "编辑外部文件或使用互联网时始终询问。",
    icon: "M12 22a10 10 0 1 0-10-10 10 10 0 0 0 10 10zm0-14v5m0 3h.01",
  },
  {
    value: "auto",
    label: "工作区权限",
    desc: "仅对检测到的风险操作请求批准。",
    icon: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  },
  {
    value: "full",
    label: "完全访问",
    desc: "可不受限制地访问互联网和这台电脑上的任何文件。",
    icon: "M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 0c2.5 0 4.5 4.5 4.5 10s-2 10-4.5 10-4.5-4.5-4.5-10 2-10 4.5-10z M2 12h20",
    danger: true,
  },
];

export function PermissionPicker({
  value,
  onChange,
  down,
}: {
  value: PermissionMode | string;
  onChange(value: string): void;
  down?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const selected = PERMISSION_OPTIONS.find((item) => item.value === value) ?? PERMISSION_OPTIONS[2];

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
          {PERMISSION_OPTIONS.map((item) => {
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
  placeholder = "筛选…",
  down,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange(value: string): void;
  searchable?: boolean;
  placeholder?: string;
  down?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const selected = options.find((item) => item.value === value);
  const filtered = searchable && query
    ? options.filter((item) => item.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={box} className={`combo${open ? " open" : ""}${down ? " down" : ""}`}>
      {open && searchable ? (
        <input
          className="combo-input"
          value={query}
          autoFocus
          placeholder={placeholder}
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
      {open && (
        <div className="combo-menu" role="listbox">
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
            <div className="combo-empty">没有匹配项</div>
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
        </div>
      )}
    </div>
  );
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
  // The agent packs question, command and sandbox state into one newline-separated title.
  const [heading, ...detail] = (request.title ?? (request.method === "confirm" ? "需要批准" : "需要选择"))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const title = undoDialogTitle(heading, lastTurn);
  return (
    <div className="approval">
      <strong>{title}</strong>
      {detail.length > 0 && <pre className="approval-detail">{detail.join("\n")}</pre>}
      {request.message && <p>{request.message}</p>}
      {request.method === "select" && (
        <div className="choices">
          {request.options?.map((option) => (
            <button key={option} type="button" onClick={() => void respond({ value: option })}>{option}</button>
          ))}
        </div>
      )}
      {(request.method === "input" || request.method === "editor") && (
        <textarea value={value} onChange={(event) => setValue(event.target.value)} rows={3} />
      )}
      <div className="row-actions">
        <button type="button" className="ghost" onClick={() => void respond({ cancelled: true })}>取消</button>
        {request.method === "confirm" && (
          <>
            <button type="button" className="ghost" onClick={() => void respond({ confirmed: false })}>拒绝</button>
            <button type="button" className="primary" onClick={() => void respond({ confirmed: true })}>允许</button>
          </>
        )}
        {(request.method === "input" || request.method === "editor") && (
          <button type="button" className="primary" onClick={() => void respond({ value })}>继续</button>
        )}
      </div>
    </div>
  );
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
  const options = [...new Set([value, ...models].filter(Boolean))].map((id) => ({ value: id, label: id }));
  return (
    <label>
      模型
      <span className="settings-model">
        <Combo
          value={value}
          options={options}
          searchable
          down
          placeholder={placeholder ?? "筛选模型"}
          onChange={onChange}
        />
        <button type="button" className="ghost" disabled={!canList || listing} onClick={onList}>
          {listing ? "获取中…" : "获取模型"}
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
        <button type="button" className="secret-toggle" aria-label={show ? "隐藏密钥" : "显示密钥"} onClick={() => setShow((open) => !open)}>
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

type SettingsPane = "chat" | "vision" | "shortcuts" | "about";

const SETTINGS_NAV: Array<{ label: string; items: Array<{ id: SettingsPane; label: string; icon: string }> }> = [
  {
    label: "模型与服务",
    items: [
      { id: "chat", label: "对话模型", icon: "M4 6h16v10H8l-4 4V6z" },
      { id: "vision", label: "图片识别", icon: "M4 6h16v12H4zM8 14l3-3 2 2 3-4 4 5" },
    ],
  },
  {
    label: "帮助与系统",
    items: [
      {
        id: "shortcuts",
        label: "快捷键指南",
        icon: "M2 5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5zm3 3h2v2H5V8zm4 0h2v2H9V8zm4 0h2v2h-2V8zm4 0h2v2h-2V8zm-12 4h2v2H5v-2zm4 0h6v2H9v-2zm8 0h2v2h-2v-2z",
      },
      {
        id: "about",
        label: "关于应用",
        icon: "M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 14a1.2 1.2 0 1 1 1.2-1.2A1.2 1.2 0 0 1 12 16zm1.2-5.5h-2.4V7h2.4z",
      },
    ],
  },
];

export function Login({
  configured,
  model,
  baseUrl,
  onClose,
  onSaved,
}: {
  configured: boolean;
  model: string;
  baseUrl?: string;
  onClose(): void;
  onSaved(): Promise<void>;
}) {
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
  const [testStatus, setTestStatus] = useState<{ target: "chat" | "vision"; ok: boolean; message: string } | null>(null);

  const chatUrl = kind === "deepseek" ? DEEPSEEK_PRESET.url : customUrl;
  const chatKey = kind === "deepseek" ? deepseekKey : customKey;
  const chatModel = kind === "deepseek" ? deepseekModel : customModel;

  const listModels = async (target: "chat" | "vision") => {
    const base = target === "chat" ? chatUrl : visionEndpoint;
    const secret = target === "chat" ? chatKey : visionKey;
    if (!base.trim() || !secret.trim()) {
      setTestStatus({ target, ok: false, message: "请先填写 API URL 与 Key" });
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
        setTestStatus({ target, ok: true, message: `连通正常 (${elapsed}ms)，但未返回模型列表` });
      } else {
        setTestStatus({ target, ok: true, message: `连通成功 (${elapsed}ms) · 发现 ${ids.length} 个模型` });
      }
    } catch (error) {
      setTestStatus({
        target,
        ok: false,
        message: error instanceof Error ? error.message : "连接失败，请检查 URL 与 Key",
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
          {SETTINGS_NAV.map((group) => (
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
                ? "对话模型"
                : pane === "vision"
                  ? "图片识别"
                  : pane === "shortcuts"
                    ? "快捷键指南"
                    : "关于应用"}
            </h2>
            <button type="button" className="settings-close" aria-label="关闭" onClick={onClose}>
              <Icon path="M6 6l12 12M18 6L6 18" />
            </button>
          </header>
          <div className="settings-body">
            {pane === "chat" && (
              <>
                <div className="settings-seg">
                  {([["deepseek", "DeepSeek 预设"], ["custom", "自定义 API"]] as const).map(([id, label]) => (
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
                      <p className="settings-hint">
                        直连 DeepSeek 官方接口（<code>https://api.deepseek.com</code>）。只需填入 API Key 即可开始对话。
                      </p>
                    ) : (
                      <p className="settings-hint">
                        兼容任意符合 OpenAI Chat Completions 规范的服务（如 OneAPI、Ollama、NewAPI 或第三方聚合商）。
                      </p>
                    )}

                    {kind === "custom" && (
                      <label>
                        接口地址 (Base URL)
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
                    <strong>GLM-4V-Flash 视觉分析</strong>
                    <span className="settings-card-badge">主视觉</span>
                  </div>
                  <div className="settings-card-body">
                    <p className="settings-hint">
                      用于对话中贴图识别、截图还原与 UI 布局解析。填入智谱开放平台 API Key 即可。
                    </p>
                    <label>
                      接口地址 (Endpoint)
                      <input
                        value={visionEndpoint}
                        onChange={(event) => setVisionEndpoint(event.target.value)}
                        placeholder={DEFAULT_VISION_CONFIG.endpoint}
                      />
                    </label>
                    <SecretField value={visionKey} onChange={setVisionKey} placeholder="智谱 API Key" />
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
                    <strong>MinerU OCR 识别引擎</strong>
                    <span className="settings-card-badge free">免配内置</span>
                  </div>
                  <div className="settings-card-body">
                    <p className="settings-hint">
                      高精度开源文档与截图 OCR 引擎已预置就绪，上传图片时自动提取文字，无需单独配置密钥。
                    </p>
                  </div>
                </div>
              </>
            )}

            {pane === "shortcuts" && (
              <div className="settings-card">
                <div className="settings-card-body">
                  <div className="shortcut-list">
                    <div className="shortcut-item">
                      <span className="shortcut-label">发送当前消息</span>
                      <kbd>Enter</kbd>
                    </div>
                    <div className="shortcut-item">
                      <span className="shortcut-label">输入框内换行</span>
                      <span className="kbd-group"><kbd>Shift</kbd> + <kbd>Enter</kbd></span>
                    </div>
                    <div className="shortcut-item">
                      <span className="shortcut-label">快速引用工作区文件</span>
                      <kbd>@文件名</kbd>
                    </div>
                    <div className="shortcut-item">
                      <span className="shortcut-label">撤回上一轮修改</span>
                      <kbd>/undo</kbd>
                    </div>
                    <div className="shortcut-item">
                      <span className="shortcut-label">新建对话会话</span>
                      <kbd>/new</kbd>
                    </div>
                    <div className="shortcut-item">
                      <span className="shortcut-label">切换 / 打开项目</span>
                      <kbd>/open</kbd>
                    </div>
                    <div className="shortcut-item">
                      <span className="shortcut-label">关闭弹窗与抽屉</span>
                      <kbd>Esc</kbd>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {pane === "about" && (
              <div className="settings-card">
                <div className="settings-card-body">
                  <div className="about-hero">
                    <div className="about-logo">
                      <img src={logo} alt="" width={32} height={18} />
                    </div>
                    <div>
                      <h3>Tether 工作台</h3>
                      <p>面向代码仓库的本地 Agent 编程工作流环境</p>
                    </div>
                  </div>
                  <div className="about-grid">
                    <div className="about-cell">
                      <span className="about-key">应用版本</span>
                      <span className="about-val">v{appVersion || "0.1.0"}</span>
                    </div>
                    <div className="about-cell">
                      <span className="about-key">Agent 内核</span>
                      <span className="about-val">Tether Agent Core (0.1.0 · 本地)</span>
                    </div>
                    <div className="about-cell">
                      <span className="about-key">运行架构</span>
                      <span className="about-val">Electron · React 19 · Node 22</span>
                    </div>
                    <div className="about-cell">
                      <span className="about-key">沙箱状态</span>
                      <span className="about-val">已就绪 (本地隔离防护)</span>
                    </div>
                  </div>
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
                清除配置
              </button>
            )}
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
              保存配置
            </button>
          </footer>
        </div>
      </form>
    </div>
  );
}
