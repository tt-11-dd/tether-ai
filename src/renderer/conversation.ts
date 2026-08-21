import type { AgentEvent } from "../shared/types";
import { sameUserSkillTurn } from "../shared/skills";
import { DEFAULT_LOCALE, t, type Locale, type MessageKey } from "../shared/i18n";
import { isVisionHandoff, mimeFromImagePath, visibleUserText, visionHandoffPaths, visionToolTitle, visionUploadUrl } from "../shared/vision-api";

let activeLocale: Locale = DEFAULT_LOCALE;

/** Keep conversation chrome in sync with the UI language. */
export function setConversationLocale(locale: Locale): void {
  activeLocale = locale;
}

function ct(key: MessageKey, vars?: Record<string, string | number>): string {
  return t(activeLocale, key, vars);
}

export function isTransientStreamError(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : String(error);
  return /stream ended without finish_reason|missing finish_reason/i.test(raw);
}

export function friendlyAgentError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const detail = raw
    .replace(/^Error invoking remote method 'agent:(?:command|start)':\s*/i, "")
    .replace(/^Error:\s*/i, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (isTransientStreamError(detail)) return "";
  if (/context (?:length|window)|maximum context|too many tokens|token limit/i.test(detail)) return ct("toast.errorContext");
  if (/\b401\b|\b403\b|unauthori[sz]ed|forbidden|invalid api.?key|authentication|credential/i.test(detail)) return ct("toast.errorAuth");
  if (/\b402\b|\b429\b|rate.?limit|too many requests|quota|insufficient (?:balance|credit|funds)/i.test(detail)) return ct("toast.errorQuota");
  if (/\b504\b|gateway time-?out|timeout|timed out|ETIMEDOUT|AbortError/i.test(detail)) return ct("toast.errorTimeout");
  if (/model .*(?:not found|unavailable|unknown)|unknown model|invalid model|model.*does not exist/i.test(detail)) return ct("toast.errorModel");
  if (/\b404\b|\/chat\/completions.*not found|endpoint.*not found/i.test(detail)) return ct("toast.errorEndpoint");
  if (/\b502\b|\b503\b|bad gateway|service unavailable|fetch failed|network|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(detail)) {
    return ct("toast.errorNetwork");
  }
  return detail || ct("error.modelFailed");
}

/** Intermittent network/provider hiccups that may recover next turn. */
export function isRecoverableRequestError(error: string | undefined): boolean {
  if (!error) return false;
  return /网络|连接模型服务失败|超时|model timed out|network|timed out|gateway|service unavailable|status code\s*5\d\d/i.test(error);
}

export interface ToolActivity {
  id: string;
  name: string;
  title: string;
  status: "running" | "complete" | "error";
  startedAt?: number;
  endedAt?: number;
  args?: unknown;
  output?: string;
  details?: unknown;
}

export interface ChatImage {
  data: string;
  mimeType: string;
  /** Set instead of `data` for images restored from disk rather than the live paste. */
  src?: string;
}

export type WorkItem =
  | { type: "thinking"; id: string; text: string }
  | { type: "text"; id: string; text: string }
  | { type: "tool"; id: string; toolId: string };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  thinking?: string;
  timestamp?: number;
  streaming?: boolean;
  queued?: boolean;
  images: ChatImage[];
  tools: ToolActivity[];
  work: WorkItem[];
  error?: string;
}

export type ConversationGroup =
  | { type: "user"; id: string; message: ChatMessage }
  | { type: "assistant"; id: string; messages: ChatMessage[] };

export function cacheHitRate(tokens?: {
  input: number;
  cacheRead: number;
  cacheWrite: number;
}): number | undefined {
  if (!tokens) return undefined;
  const prompt = tokens.input + tokens.cacheRead + tokens.cacheWrite;
  return prompt > 0 ? (tokens.cacheRead / prompt) * 100 : undefined;
}

type JsonRecord = Record<string, unknown>;

export function normalizeMessages(messages: unknown[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  for (const value of messages) {
    if (!isRecord(value)) continue;
    if (value.role === "toolResult") {
      attachStoredToolResult(result, value);
      continue;
    }
    if (value.role !== "user" && value.role !== "assistant") continue;
    const parsed = messageFromRecord(value, `history-${result.length}`);
    if (!parsed) continue;
    result.push(isVisionHandoff(parsed.text)
      ? { ...parsed, text: visibleUserText(parsed.text), images: stagedImages(parsed.text) }
      : parsed);
  }
  return result;
}

/**
 * Work ids are numbered inside their own message (`thinking-0`, `text-0`…), so a turn rebuilt
 * from several stored messages must scope them, or every message keeps only the last thought.
 */
export function turnWork(messages: ChatMessage[]): WorkItem[] {
  const slots = new Map<string, WorkItem>();
  for (const message of messages) {
    message.work.forEach((item, index) => {
      slots.set(item.type === "tool" ? item.toolId : `${message.id}:${index}`, item);
    });
  }
  return [...slots.values()];
}

export function dropLastTurn(messages: ChatMessage[]): ChatMessage[] {
  let end = messages.length;
  while (end > 0 && messages[end - 1]!.role === "assistant") end -= 1;
  if (end > 0 && messages[end - 1]!.role === "user") end -= 1;
  return messages.slice(0, end);
}

export function hasNewCheckpointUndo(
  before: Array<{ id?: string }>,
  after: Array<{ id?: string; type?: string; customType?: string }>,
): boolean {
  const seen = new Set(before.map((item) => item.id).filter((id): id is string => Boolean(id)));
  return after.some((entry) => {
    const id = entry.id;
    return entry.type === "custom" && isCheckpointUndo(entry.customType) && typeof id === "string" && !seen.has(id);
  });
}

export interface RestoreFile {
  path: string;
  content: string | null;
  mode?: number;
}

export type SessionEntryLike = {
  type?: string;
  customType?: string;
  data?: unknown;
  message?: { role?: string; content?: unknown };
};

/** Earliest `before` per path after the last real user turn. `/undo` only restores the newest checkpoint. */
export function lastTurnRestoreFiles(entries: SessionEntryLike[]): RestoreFile[] {
  const undone = new Set<string>();
  for (const entry of entries) {
    if (entry.type !== "custom" || !isCheckpointUndo(entry.customType) || !isRecord(entry.data)) continue;
    if (typeof entry.data.checkpointId === "string") undone.add(entry.data.checkpointId);
  }
  let start = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    if (entry.type !== "message" || entry.message?.role !== "user") continue;
    if (entryUserText(entry.message.content).trim() === "/undo") continue;
    start = index + 1;
  }
  const byPath = new Map<string, RestoreFile>();
  for (let index = start; index < entries.length; index += 1) {
    const entry = entries[index]!;
    if (entry.type !== "custom" || !isCheckpoint(entry.customType) || !isRecord(entry.data)) continue;
    if (typeof entry.data.id !== "string" || undone.has(entry.data.id) || !Array.isArray(entry.data.before)) continue;
    for (const file of entry.data.before) {
      if (!isRecord(file) || typeof file.path !== "string" || byPath.has(file.path)) continue;
      if (file.content !== null && typeof file.content !== "string") continue;
      byPath.set(file.path, {
        path: file.path,
        content: file.content,
        ...(typeof file.mode === "number" ? { mode: file.mode } : {}),
      });
    }
  }
  return [...byPath.values()];
}

function isCheckpoint(type: string | undefined): boolean {
  return type === "tether-checkpoint";
}

function isCheckpointUndo(type: string | undefined): boolean {
  return type === "tether-checkpoint-undone";
}

function entryUserText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : "")).join("");
}

export function undoDialogTitle(heading: string | undefined, lastTurn?: string): string | undefined {
  if (!heading || !/^Undo\s/i.test(heading)) return heading;
  const label = lastTurn?.replace(/\s+/g, " ").trim();
  if (!label) return ct("undo.confirm");
  return ct("undo.confirmNamed", {
    label: label.length > 36 ? `${label.slice(0, 36)}…` : label,
  });
}

export function approvalTitle(heading: string | undefined, lastTurn?: string): string {
  const line = heading?.split("\n")[0]?.trim() ?? "";
  if (!line) return ct("approval.needConfirm");
  if (/^run destructive command\??$/i.test(line)) return ct("approval.destructiveTitle");
  if (/^allow network access\??$/i.test(line)) return ct("approval.networkTitle");
  if (/^allow unrestricted host access\??$/i.test(line)) return ct("approval.hostTitle");
  const apply = /^Apply (.+)\?$/.exec(line);
  if (apply?.[1]) return ct("approval.applyFile", { file: apply[1] });
  const tool = /^Allow ([a-z][a-z0-9_]+)\?$/i.exec(line);
  if (tool?.[1]) return ct("approval.allowTool", { tool: tool[1] });
  if (/^Undo\s/i.test(line)) return undoDialogTitle(line, lastTurn) ?? ct("undo.confirm");
  return line;
}

export function groupConversation(messages: ChatMessage[]): ConversationGroup[] {
  const groups: ConversationGroup[] = [];
  for (const message of messages) {
    const previous = groups.at(-1);
    if (message.role === "assistant" && previous?.type === "assistant") {
      previous.messages.push(message);
      continue;
    }
    groups.push(message.role === "user"
      ? { type: "user", id: message.id, message }
      : { type: "assistant", id: message.id, messages: [message] });
  }
  return groups;
}

export function turnAnchorId(id: string): string {
  return `turn-${id}`;
}

/** Jump targets for the conversation navigator: one entry per real user question. */
export function turnAnchors(groups: ConversationGroup[]): Array<{ id: string; label: string }> {
  const anchors: Array<{ id: string; label: string }> = [];
  for (const group of groups) {
    if (group.type !== "user") continue;
    const label = visibleUserText(group.message.text).replace(/\s+/g, " ").trim();
    if (!label || label.startsWith("/")) continue;
    anchors.push({
      id: turnAnchorId(group.id),
      label: label.length > 42 ? `${label.slice(0, 42)}…` : label,
    });
  }
  return anchors;
}

export function applyAgentEvent(messages: ChatMessage[], event: AgentEvent): ChatMessage[] {
  if (event.type === "agent_settled") {
    return messages.map((message) =>
      message.streaming || message.queued ? { ...message, streaming: false, queued: false } : message,
    );
  }

  if (event.type === "agent_end" && event.willRetry !== true) {
    const last = Array.isArray(event.messages) ? event.messages.at(-1) : undefined;
    if (isRecord(last) && last.role === "assistant") {
      const incoming = messageFromRecord(last, `event-${Date.now()}-${messages.length}`);
      if (incoming?.error) {
        const current = messages.at(-1);
        if (current?.role === "assistant") {
          return messages.map((message, index) =>
            index === messages.length - 1 ? { ...message, streaming: false, error: incoming.error } : message,
          );
        }
        return [...messages, { ...incoming, streaming: false }];
      }
    }
  }

  if (event.type === "message_start" || event.type === "message_update" || event.type === "message_end") {
    const raw = isRecord(event.message) ? event.message : undefined;
    if (!raw || (raw.role !== "user" && raw.role !== "assistant")) return messages;
    const incoming = messageFromRecord(raw, `event-${Date.now()}-${messages.length}`);
    if (!incoming) return messages;

    if (incoming.role === "user") {
      if (isVisionHandoff(incoming.text)) {
        if (messages.length > 0) return messages;
        return [{ ...incoming, text: visibleUserText(incoming.text), images: stagedImages(incoming.text) }];
      }
      const last = messages.at(-1);
      if (last?.role === "user" && (last.text === incoming.text || sameUserSkillTurn(last.text, incoming.text))) {
        return messages.map((message, index) =>
          index === messages.length - 1 ? {
            ...message,
            text: incoming.text,
            queued: false,
            timestamp: incoming.timestamp ?? message.timestamp,
            images: incoming.images.length > 0 ? incoming.images : message.images,
          } : message,
        );
      }
      const prev = messages.at(-2);
      if (
        last?.role === "assistant"
        && !last.text.trim()
        && prev?.role === "user"
        && (prev.text === incoming.text || sameUserSkillTurn(prev.text, incoming.text))
      ) {
        return messages;
      }
      if (event.type === "message_start") return [...messages, incoming];
      return messages;
    }

    const last = messages.at(-1);
    if (last?.role === "assistant") {
      const streaming = event.type !== "message_end" || !incoming.text.trim();
      return messages.map((message, index) =>
        index === messages.length - 1 ? mergeAssistant(message, incoming, streaming) : message,
      );
    }

    return [...messages, { ...incoming, streaming: event.type !== "message_end" }];
  }

  if (event.type === "tool_execution_start") {
    return upsertLastAssistantTool(messages, toolFromEvent(event, "running"));
  }
  if (event.type === "tool_execution_update") {
    const activity = toolFromEvent(event, "running");
    activity.output = stringifyToolResult(event.partialResult);
    activity.details = toolDetails(event.partialResult) ?? toolDetails(event);
    if (activity.name === "vision") activity.title = visionToolTitle(activity.details);
    if (activity.name === "delegate") activity.title = delegateToolTitle(activity);
    return upsertLastAssistantTool(messages, activity);
  }
  if (event.type === "tool_execution_end") {
    const activity = toolFromEvent(event, event.isError === true ? "error" : "complete");
    activity.output = stringifyToolResult(event.result)
      ?? stringifyToolResult(event.error)
      ?? stringifyToolResult(event.message);
    activity.details = toolDetails(event.result) ?? toolDetails(event);
    if (activity.name === "vision") activity.title = visionToolTitle(activity.details);
    if (activity.name === "delegate") activity.title = delegateToolTitle(activity);
    return upsertLastAssistantTool(messages, activity);
  }
  return messages;
}

export function optimisticUserMessage(text: string, queued = false, images: ChatImage[] = []): ChatMessage {
  return {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role: "user",
    text,
    timestamp: Date.now(),
    queued,
    images,
    tools: [],
    work: [],
  };
}

export function currentTool(messages: ChatMessage[]): ToolActivity | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const running = messages[index]!.tools.find((tool) => tool.status === "running");
    if (running) return running;
  }
}

function getMessageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(isRecord)
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => String(part.text))
    .join("\n");
}

function messageFromRecord(value: JsonRecord, id: string): ChatMessage | undefined {
  if (value.role !== "user" && value.role !== "assistant") return undefined;
  const content = value.content;
  const raw = getMessageText(content);
  const split = value.role === "assistant" ? splitThinkTags(raw) : { text: raw, thinking: "" };
  const thinking = collapseThinking(getThinking(content), split.thinking);
  const images = getImages(content);
  const timestamp = normalizeTimestamp(value.timestamp);
  const tools = getTools(content, timestamp);
  const work = value.role === "assistant" ? getWork(content) : [];
  const error = value.role === "assistant" && value.stopReason === "error"
    ? friendlyAgentError(value.errorMessage ?? ct("error.modelFailed"))
    : undefined;
  return {
    id,
    role: value.role,
    text: split.text,
    images,
    ...(thinking ? { thinking } : {}),
    ...(timestamp !== undefined ? { timestamp } : {}),
    ...(error ? { error } : {}),
    tools,
    work,
  };
}

/** Pasted bytes never reach the session file, only the staged paths, so rebuild from those. */
function stagedImages(handoff: string): ChatImage[] {
  return visionHandoffPaths(handoff).map((file) => ({
    data: "",
    mimeType: mimeFromImagePath(file),
    src: visionUploadUrl(file),
  }));
}

function getImages(content: unknown): ChatImage[] {
  if (!Array.isArray(content)) return [];
  return content.filter(isRecord).flatMap((part) => {
    if (part.type !== "image" || typeof part.data !== "string" || typeof part.mimeType !== "string") return [];
    if (!part.mimeType.startsWith("image/") || !part.data) return [];
    return [{ data: part.data, mimeType: part.mimeType }];
  });
}

function getThinking(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return collapseThinking(
    ...content
      .filter(isRecord)
      .filter((part) => part.type === "thinking" && typeof part.thinking === "string")
      .map((part) => String(part.thinking)),
  );
}

function getTools(content: unknown, startedAt?: number): ToolActivity[] {
  if (!Array.isArray(content)) return [];
  return content.filter(isRecord).flatMap((part, index) => {
    if (part.type !== "toolCall" || typeof part.name !== "string") return [];
    const id = typeof part.id === "string" ? part.id : `content-tool-${index}`;
    return [{
      id,
      name: part.name,
      title: toolTitle(part.name, part.arguments),
      status: "complete" as const,
      ...(startedAt !== undefined ? { startedAt } : {}),
      args: part.arguments,
    }];
  });
}

function getWork(content: unknown): WorkItem[] {
  if (!Array.isArray(content)) return [];
  const items: WorkItem[] = [];
  content.filter(isRecord).forEach((part, index) => {
    if (part.type === "thinking" && typeof part.thinking === "string" && part.thinking.trim()) {
      const last = items.at(-1);
      if (last?.type === "thinking") last.text = collapseThinking(last.text, part.thinking);
      else items.push({ type: "thinking", id: `thinking-${index}`, text: part.thinking.trim() });
    } else if (part.type === "text" && typeof part.text === "string" && part.text.trim()) {
      const split = splitThinkTags(part.text);
      if (split.thinking) {
        const last = items.at(-1);
        if (last?.type === "thinking") last.text = collapseThinking(last.text, split.thinking);
        else items.push({ type: "thinking", id: `thinking-text-${index}`, text: split.thinking });
      }
      if (split.text) items.push({ type: "text", id: `text-${index}`, text: split.text });
    } else if (part.type === "toolCall" && typeof part.name === "string") {
      const toolId = typeof part.id === "string" ? part.id : `content-tool-${index}`;
      items.push({ type: "tool", id: `tool-${toolId}`, toolId });
    }
  });
  return items;
}

function attachStoredToolResult(messages: ChatMessage[], result: JsonRecord): void {
  if (typeof result.toolCallId !== "string") return;
  const endedAt = normalizeTimestamp(result.timestamp);
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex]!;
    const toolIndex = message.tools.findIndex((tool) => tool.id === result.toolCallId);
    if (toolIndex < 0) continue;
    const tools = [...message.tools];
    const output = stringifyToolResult(result);
    tools[toolIndex] = {
      ...tools[toolIndex]!,
      status: result.isError === true ? "error" : "complete",
      ...(endedAt !== undefined ? { endedAt } : {}),
      ...(output ? { output } : {}),
    };
    messages[messageIndex] = { ...message, tools };
    return;
  }
}

function toolFromEvent(event: AgentEvent, status: ToolActivity["status"]): ToolActivity {
  const name = typeof event.toolName === "string" ? event.toolName : "tool";
  const id = typeof event.toolCallId === "string" ? event.toolCallId : `tool-${Date.now()}`;
  const timestamp = eventTimestamp(event);
  const args = event.args ?? event.input;
  const details = isRecord(event.result) ? event.result.details : undefined;
  return {
    id,
    name,
    title: toolTitle(name, args ?? details),
    status,
    ...(status === "running" ? { startedAt: timestamp } : { endedAt: timestamp }),
    args,
  };
}

function eventTimestamp(event: AgentEvent): number {
  return normalizeTimestamp(event.timestamp) ?? Date.now();
}

function normalizeTimestamp(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value < 10_000_000_000 ? value * 1_000 : value;
}

function preferToolTitle(next: string, previous: string): string {
  if (next.startsWith("MinerU") || next.includes("GLM") || next.includes("OCR")) return next;
  return vagueToolTitle(next) && !vagueToolTitle(previous) ? previous : next;
}

function vagueToolTitle(title: string): boolean {
  return /^(Ran a command|Read files|Wrote a file|Edited files|执行命令|读取文件|写入文件|编辑文件)$/.test(title);
}

function toolTitle(name: string, args: unknown): string {
  const record = isRecord(args) ? args : {};
  const command = stringField(record, "cmd") || stringField(record, "command");
  const target = patchTarget(stringField(record, "input"));
  const file = stringField(record, "path") || stringField(record, "file_path") || target?.path || "";
  if (name.includes("exec") || name.includes("bash") || name.includes("command")) {
    return command ? commandTitle(command) : ct("cmd.ranEmpty");
  }
  if (name.includes("read")) return file ? ct("tool.read", { file }) : ct("tool.readEmpty");
  if (name.includes("write") || target?.action === "add") return file ? ct("tool.wrote", { file }) : ct("tool.wroteEmpty");
  if (name.includes("edit") || name.includes("patch")) return file ? ct("tool.edited", { file }) : ct("tool.editedEmpty");
  if (name.includes("search")) return ct("tool.search");
  if (name === "vision") return ct("tool.vision");
  if (name === "delegate") {
    const progress = delegateProgress({
      id: "preview",
      name: "delegate",
      title: "",
      status: "running",
      args,
    });
    return progress.total > 0
      ? ct("tool.delegate", { done: progress.done, total: progress.total })
      : ct("tool.delegateIdle");
  }
  return name.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function patchTarget(input: string): { action: "add" | "update" | "delete"; path: string } | undefined {
  const match = /\*\*\* (Add File|Update File|Delete File): (.+)/.exec(input);
  if (!match?.[1] || !match[2]) return undefined;
  const action = match[1] === "Add File" ? "add" : match[1] === "Delete File" ? "delete" : "update";
  return { action, path: match[2].trim() };
}

/** Code the model is writing, so the trace can show it instead of a one-line tool title. */
export function toolWritePreview(tool: ToolActivity, limit = 80): string {
  if (tool.status === "error" || !/write|edit|patch/i.test(tool.name)) return "";
  const args = isRecord(tool.args) ? tool.args : {};
  const patch = stringField(args, "input");
  if (patch.trim()) {
    const lines = splitPatch(patch)
      .filter((row) => row.kind !== "meta")
      .map((row) => (row.kind === "add" ? `+${row.next}` : row.kind === "del" ? `-${row.old}` : ` ${row.next}`));
    return clipLines(lines, limit);
  }
  return clipLines((stringField(args, "contents") || stringField(args, "content")).split("\n"), limit);
}

function clipLines(lines: string[], limit: number) {
  const text = lines.join("\n").replace(/\n+$/, "");
  if (!text.trim()) return "";
  return lines.length <= limit ? text : `${lines.slice(0, limit).join("\n")}\n…`;
}

export function toolCommand(tool: ToolActivity): string {
  const args = isRecord(tool.args) ? tool.args : {};
  return stringField(args, "cmd") || stringField(args, "command");
}

export function formatCommand(command: string): string {
  return command
    .replace(/\s*2>\s*\/dev\/null/g, "")
    .split(/\s*(?:&&|;)\s*/)
    .map((part) => part.trim())
    .filter((part) => part && !/^echo\s+["']?-/.test(part))
    .join("\n");
}

export function terminalLabel(command: string): string {
  const lines = formatCommand(command).split("\n").filter(Boolean);
  const action = [...lines].reverse().find((line) => !/^cd\s/.test(line)) ?? lines.at(-1) ?? command;
  return action.replace(/\s+/g, " ").trim();
}

function commandTitle(command: string): string {
  const lines = formatCommand(command).split("\n").filter(Boolean);
  if (lines.length === 0) return ct("cmd.ranEmpty");
  if (lines.length === 1) return ct("cmd.ran", { cmd: crop(lines[0]!, 72) });
  const bin = baseName(lines[0]!.split(/\s+/)[0] ?? "") || "command";
  return ct("cmd.ranN", { bin, n: lines.length });
}

function upsertLastAssistantTool(messages: ChatMessage[], activity: ToolActivity): ChatMessage[] {
  let index = findLastAssistant(messages, false);
  let next = messages;
  if (index < 0) {
    next = [...messages, {
      id: `assistant-${Date.now()}`,
      role: "assistant",
      text: "",
      timestamp: activity.startedAt ?? Date.now(),
      streaming: false,
      images: [],
      tools: [],
      work: [],
    }];
    index = next.length - 1;
  }
  return next.map((message, messageIndex) => {
    if (messageIndex !== index) return message;
    const toolIndex = message.tools.findIndex((tool) => tool.id === activity.id);
    const tools = toolIndex < 0
      ? [...message.tools, activity]
      : message.tools.map((tool, current) => current === toolIndex ? {
        ...tool,
        ...activity,
        title: preferToolTitle(activity.title, tool.title),
        args: activity.args ?? tool.args,
        output: activity.output ?? tool.output,
        details: mergeToolDetails(tool.name || activity.name, tool.details, activity.details),
      } : tool);
    const hasWorkItem = message.work.some((item) => item.type === "tool" && item.toolId === activity.id);
    const work = hasWorkItem
      ? message.work
      : [...message.work, { type: "tool" as const, id: `tool-${activity.id}`, toolId: activity.id }];
    return { ...message, tools, work };
  });
}

function mergeAssistant(message: ChatMessage, incoming: ChatMessage, streaming: boolean): ChatMessage {
  return {
    ...message,
    streaming,
    text: incoming.text || message.text,
    thinking: joinThinking(message.thinking, incoming.thinking),
    timestamp: message.timestamp ?? incoming.timestamp,
    images: incoming.images.length > 0 ? incoming.images : message.images,
    work: mergeWork(message.work, incoming.work, message.tools),
    ...(incoming.error ? { error: incoming.error } : {}),
  };
}

function joinThinking(previous?: string, incoming?: string): string | undefined {
  return collapseThinking(previous, incoming) || undefined;
}

export function collapseThinking(...parts: Array<string | undefined>): string {
  const result: string[] = [];
  for (const part of parts) {
    for (const piece of (part ?? "").split(/\n{2,}/)) {
      const text = piece.trim();
      if (!text) continue;
      const index = result.findIndex((item) => item.startsWith(text) || text.startsWith(item));
      if (index < 0) result.push(text);
      else if (text.length > result[index]!.length) result[index] = text;
    }
  }
  return result.join("\n\n");
}

/** Pull model XML think blocks out of visible assistant text. */
export function splitThinkTags(text: string): { text: string; thinking: string } {
  if (!text) return { text: "", thinking: "" };
  const chunks: string[] = [];
  let rest = text.replace(/<(thinking|think)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_all, _tag: string, inner: string) => {
    if (inner.trim()) chunks.push(inner.trim());
    return "\n";
  });
  rest = rest.replace(/<(thinking|think)\b[^>]*>([\s\S]*)$/i, (_all, _tag: string, inner: string) => {
    if (inner.trim()) chunks.push(inner.trim());
    return "";
  });
  rest = rest.replace(/<\/?(?:thinking|think)\b[^>]*>/gi, "").replace(/\n{3,}/g, "\n\n").trim();
  return { text: rest, thinking: chunks.join("\n\n") };
}

/** Soft-structure model thinking walls so lists/sections are scannable. */
export function formatThinking(text: string): string {
  const split = splitThinkTags(text);
  return formatThinkBody(split.thinking || split.text);
}

function formatThinkBody(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/([^\n])[ \t]+(?=(?:[-*] |\d+\.\s))/g, "$1\n")
    .replace(/([^\n])[ \t]+(?=(?:Key points to report|Files to check))/gi, "$1\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function mergeWork(current: WorkItem[], incoming: WorkItem[], tools: ToolActivity[]): WorkItem[] {
  const merged = incoming.length > 0 ? graftWork(current, incoming) : current;
  const toolIds = new Set(merged.flatMap((item) => item.type === "tool" ? [item.toolId] : []));
  const missingTools = tools
    .filter((tool) => !toolIds.has(tool.id))
    .map((tool) => ({ type: "tool" as const, id: `tool-${tool.id}`, toolId: tool.id }));
  return [...merged, ...missingTools];
}

/**
 * A message snapshot only carries its own parts, so a later thought arrives without the
 * earlier ones. Update the slots the snapshot continues and append the rest, so the turn
 * keeps every thought in the order it happened.
 */
function graftWork(current: WorkItem[], incoming: WorkItem[]): WorkItem[] {
  const used = new Set<number>();
  const kept = current.map((item) => {
    const spot = incoming.findIndex((next, index) => !used.has(index) && sameSlot(item, next));
    if (spot < 0) return item;
    used.add(spot);
    return { ...incoming[spot]!, id: item.id };
  });
  return [...kept, ...incoming.filter((_, index) => !used.has(index))];
}

function sameSlot(previous: WorkItem, next: WorkItem): boolean {
  if (previous.type === "tool" && next.type === "tool") return previous.toolId === next.toolId;
  if (previous.type === "thinking" && next.type === "thinking") return overlaps(previous.text, next.text);
  if (previous.type === "text" && next.type === "text") return overlaps(previous.text, next.text);
  return false;
}

function overlaps(previous: string, next: string): boolean {
  return next.includes(previous) || previous.includes(next);
}

function findLastAssistant(messages: ChatMessage[], streamingOnly: boolean): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role === "assistant" && (!streamingOnly || message.streaming)) return index;
  }
  return -1;
}

export function toolErrorText(tools: ToolActivity[]): string {
  return tools
    .filter((tool) => tool.status === "error")
    .map((tool) => tool.output?.trim() || ct("error.toolFailed", { title: tool.title }))
    .join("\n");
}

function stringifyToolResult(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return crop(value, 12_000);
  if (isRecord(value)) {
    if (typeof value.content === "string") return crop(value.content, 12_000);
    if (Array.isArray(value.content)) {
      const text = getMessageText(value.content);
      if (text) return crop(text, 12_000);
    }
    if (typeof value.error === "string" && value.error.trim()) return crop(value.error, 12_000);
    if (typeof value.message === "string" && value.message.trim()) return crop(value.message, 12_000);
  }
  try {
    return crop(JSON.stringify(value, null, 2), 12_000);
  } catch {
    return String(value);
  }
}

function toolDetails(value: unknown): unknown {
  if (!isRecord(value)) return undefined;
  if (value.details !== undefined) return value.details;
  if (Array.isArray(value.files)) return value;
}

export type DelegateTaskStatus = "pending" | "running" | "completed" | "failed";

export interface DelegateTaskState {
  role: string;
  task: string;
  status: DelegateTaskStatus;
  /** Latest step while the child agent is running (e.g. "正在读取 …"). */
  live?: string;
}

export interface DelegateProgress {
  total: number;
  done: number;
  tasks: DelegateTaskState[];
}

export function delegateProgress(tool: ToolActivity): DelegateProgress {
  const args = isRecord(tool.args) ? tool.args : {};
  const details = isRecord(tool.details) ? tool.details : {};
  const detailTasks = Array.isArray(details.tasks)
    ? details.tasks.map(normalizeDelegateTask).filter(Boolean) as DelegateTaskState[]
    : [];
  if (detailTasks.length > 0) {
    const done = typeof details.done === "number"
      ? details.done
      : detailTasks.filter((item) => item.status === "completed" || item.status === "failed").length;
    return {
      total: typeof details.total === "number" ? details.total : detailTasks.length,
      done,
      tasks: detailTasks,
    };
  }
  const argTasks = Array.isArray(args.tasks) ? args.tasks : [];
  const results = Array.isArray(details.results) ? details.results : [];
  const tasks = argTasks.map((item, index) => {
    const role = isRecord(item) && typeof item.role === "string" ? item.role : "agent";
    const task = isRecord(item) && typeof item.task === "string" ? item.task : "";
    const result = results[index];
    let status: DelegateTaskStatus = tool.status === "running" ? "pending" : "completed";
    if (isRecord(result)) status = result.success === false ? "failed" : "completed";
    else if (tool.status === "running" && index < results.length) status = "completed";
    else if (tool.status === "running" && index === results.length) status = "running";
    return { role, task, status };
  });
  const done = typeof details.done === "number"
    ? details.done
    : tasks.filter((item) => item.status === "completed" || item.status === "failed").length;
  return {
    total: typeof details.total === "number" ? details.total : tasks.length,
    done,
    tasks,
  };
}

export function delegateToolTitle(tool: Pick<ToolActivity, "args" | "details" | "status">): string {
  const progress = delegateProgress({
    id: "delegate",
    name: "delegate",
    title: "",
    status: tool.status ?? "running",
    args: tool.args,
    details: tool.details,
  });
  return progress.total > 0
    ? ct("tool.delegate", { done: progress.done, total: progress.total })
    : ct("tool.delegateIdle");
}

export function delegateStatusLabel(status: DelegateTaskStatus): string {
  if (status === "running") return ct("trace.delegateRunning");
  if (status === "pending") return ct("trace.delegatePending");
  if (status === "failed") return ct("trace.delegateFailed");
  return ct("trace.delegateDone");
}

function normalizeDelegateTask(value: unknown): DelegateTaskState | undefined {
  if (!isRecord(value)) return undefined;
  const role = typeof value.role === "string" ? value.role : "";
  const task = typeof value.task === "string" ? value.task : "";
  const live = typeof value.live === "string" && value.live.trim() ? value.live.trim() : undefined;
  const status = value.status;
  if (status !== "pending" && status !== "running" && status !== "completed" && status !== "failed") {
    return role || task ? { role: role || "agent", task, status: "pending", ...(live ? { live } : {}) } : undefined;
  }
  return { role: role || "agent", task, status, ...(live ? { live } : {}) };
}

function mergeToolDetails(name: string, previous: unknown, incoming: unknown): unknown {
  if (incoming === undefined) return previous;
  if (name !== "delegate") return incoming ?? previous;
  if (!isRecord(incoming)) return incoming ?? previous;
  const prev = isRecord(previous) ? previous : {};
  // New runtime sends cumulative { total, done, tasks, results }.
  // Live ticks may omit `results` to keep payloads small — keep the previous ones.
  if (Array.isArray(incoming.tasks) && incoming.tasks.length > 0) {
    if (!("results" in incoming) && Array.isArray(prev.results)) {
      return {
        ...prev,
        ...incoming,
        results: prev.results,
        done: typeof incoming.done === "number" ? incoming.done : prev.done,
      };
    }
    return incoming;
  }
  const prevResults = Array.isArray(prev.results) ? prev.results : [];
  const nextResults = Array.isArray(incoming.results) ? incoming.results : [];
  if (nextResults.length === 0) return { ...prev, ...incoming };
  const merged = [...prevResults];
  for (const result of nextResults) {
    if (!merged.some((item) => sameDelegateResult(item, result))) merged.push(result);
  }
  return {
    ...prev,
    ...incoming,
    results: merged,
    done: typeof incoming.done === "number" ? incoming.done : merged.length,
    total: typeof incoming.total === "number"
      ? incoming.total
      : typeof prev.total === "number" ? prev.total : merged.length,
  };
}

function sameDelegateResult(left: unknown, right: unknown): boolean {
  if (!isRecord(left) || !isRecord(right)) return left === right;
  return left.role === right.role && left.task === right.task && left.output === right.output;
}

export interface FileChange {
  path: string;
  additions: number;
  deletions: number;
  patch?: string;
}

export interface SessionFile extends FileChange {
  kind: "read" | "edit";
}

export interface SessionTodo {
  id: string;
  text: string;
  done: boolean;
  active?: boolean;
}

export function normalizeFilePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

export function collectFileChanges(tools: ToolActivity[]): FileChange[] {
  const byPath = new Map<string, FileChange>();
  const merge = (change: FileChange) => {
    const path = normalizeFilePath(change.path);
    const next = { ...change, path };
    const current = byPath.get(path);
    if (!current) {
      byPath.set(path, next);
      return;
    }
    byPath.set(path, {
      path,
      additions: next.additions || current.additions,
      deletions: next.deletions || current.deletions,
      patch: next.patch || current.patch,
    });
  };
  for (const tool of tools) {
    if (tool.status === "error" || !/write|edit|patch/i.test(tool.name)) continue;
    const args = isRecord(tool.args) ? tool.args : {};
    const patch = stringField(args, "input");
    if (patch) for (const change of changesFromPatch(patch)) merge(change);
    const details = isRecord(tool.details) ? tool.details : {};
    if (Array.isArray(details.files)) {
      const additions = typeof details.additions === "number" ? details.additions : 0;
      const deletions = typeof details.deletions === "number" ? details.deletions : 0;
      const files = details.files.filter((item): item is string => typeof item === "string");
      if (files.length === 1) merge({ path: files[0]!, additions, deletions });
      else for (const file of files) merge({ path: file, additions: 0, deletions: 0 });
    }
    const file = stringField(args, "path") || stringField(args, "file_path") || stringField(details, "path");
    if (file) merge({ path: file, additions: 0, deletions: 0 });
    for (const change of changesFromOutput(tool.output)) merge(change);
  }
  return [...byPath.values()];
}

export function sessionTools(messages: ChatMessage[]): ToolActivity[] {
  return [...new Map(messages.flatMap((item) => item.tools).map((tool) => [tool.id, tool])).values()];
}

export interface SessionTerminal {
  id: string;
  command: string;
}

/** Background or in-flight shell jobs the user can still see in the inspect rail. */
export function sessionTerminals(messages: ChatMessage[]): SessionTerminal[] {
  const jobs = new Map<string, string>();
  for (const message of messages) {
    for (const tool of message.tools) applySessionTerminal(jobs, tool);
  }
  return [...jobs.entries()].map(([id, command]) => ({ id, command }));
}

function applySessionTerminal(jobs: Map<string, string>, tool: ToolActivity) {
  const args = isRecord(tool.args) ? tool.args : {};
  const output = tool.output ?? "";
  const pid = stringField(args, "process_id") || output.match(/process_id:\s*(\S+)/)?.[1];
  if (/write_stdin/i.test(tool.name)) {
    if (!pid) return;
    if (args.terminate === true || /status:\s*completed|process completed/i.test(output)) jobs.delete(pid);
    return;
  }
  if (!/exec|bash|command/i.test(tool.name)) return;
  const command = stringField(args, "cmd") || stringField(args, "command") || tool.title;
  if (tool.status === "running") {
    jobs.set(pid || tool.id, command);
    return;
  }
  jobs.delete(tool.id);
  if (pid && /status:\s*running/i.test(output)) jobs.set(pid, command);
  else if (pid) jobs.delete(pid);
}

export function collectWorkingFiles(tools: ToolActivity[], mentions: string[] = []): SessionFile[] {
  const byPath = new Map<string, SessionFile>();
  for (const file of collectFileChanges(tools)) {
    byPath.set(file.path, { ...file, kind: "edit" });
  }
  for (const tool of tools) {
    if (tool.status === "error" || !/read|grep|glob|search/i.test(tool.name)) continue;
    const file = normalizeFilePath(toolPath(tool));
    if (!file || byPath.has(file)) continue;
    byPath.set(file, { path: file, kind: "read", additions: 0, deletions: 0 });
  }
  for (const file of mentions) {
    const path = normalizeFilePath(file);
    if (byPath.has(path)) continue;
    byPath.set(path, { path, kind: "read", additions: 0, deletions: 0 });
  }
  return [...byPath.values()];
}

/** Files the user attached with `@` stay openable even when the agent read them through a shell command. */
export function mentionedFiles(messages: ChatMessage[]): string[] {
  const paths = new Set<string>();
  for (const message of messages) {
    if (message.role !== "user") continue;
    for (const match of message.text.matchAll(/(?:^|\s)@(\S+)/g)) {
      const file = match[1]!.replace(/[),.;:、，。]+$/, "");
      if (file && !file.endsWith("/")) paths.add(file);
    }
  }
  return [...paths];
}

export function toolSummary(tools: ToolActivity[], thoughts = 0): string {
  const files = collectWorkingFiles(tools);
  const reads = files.filter((file) => file.kind === "read").length;
  const edits = files.filter((file) => file.kind === "edit").length;
  const commands = tools.filter((tool) => /exec|bash|command/i.test(tool.name)).length;
  const parts: string[] = [];
  if (thoughts) parts.push(ct("summary.thoughts", { n: thoughts }));
  if (reads) parts.push(ct("summary.reads", { n: reads }));
  if (commands) parts.push(ct("summary.commands", { n: commands }));
  if (edits) parts.push(ct("summary.edits", { n: edits }));
  return parts.join(ct("summary.join"));
}

export function writePayloadSize(tool: ToolActivity): number {
  const args = isRecord(tool.args) ? tool.args : {};
  const patch = stringField(args, "input");
  if (patch) {
    const added = splitPatch(patch).filter((row) => row.kind === "add").map((row) => row.next).join("\n");
    return added.length || patch.length;
  }
  return (stringField(args, "contents") || stringField(args, "content") || tool.output || "").length;
}

/** Live status line while tools run: Thinking... / Writing file... · ~N characters */
export function liveStatus(tools: ToolActivity[]): string {
  const running = [...tools].reverse().find((tool) => tool.status === "running");
  if (!running) return ct("live.thinking");
  const bytes = writePayloadSize(running);
  const count = bytes > 0
    ? ct("live.chars", { n: bytes.toLocaleString(activeLocale === "en" ? "en-US" : "zh-CN") })
    : "";
  if (/write|edit|patch/i.test(running.name)) {
    const args = isRecord(running.args) ? running.args : {};
    const file = baseName(toolPath(running) || patchTarget(stringField(args, "input"))?.path || "");
    return file ? ct("live.writing", { file, count }) : ct("live.writingFile", { count });
  }
  if (/read/i.test(running.name)) {
    const file = baseName(toolPath(running));
    return file ? ct("live.reading", { file }) : ct("live.readingFile");
  }
  if (/exec|bash|command/i.test(running.name)) return ct("live.running");
  if (running.name === "delegate") {
    const progress = delegateProgress(running);
    if (progress.total > 0) return ct("live.delegating", { done: progress.done, total: progress.total });
  }
  return ct("live.thinking");
}

export function thoughtSteps(
  work: WorkItem[],
  tools: ToolActivity[],
  fallback = "",
): Array<{ text: string; tools: ToolActivity[] }> {
  const byId = new Map(tools.map((tool) => [tool.id, tool]));
  const steps: Array<{ text: string; tools: ToolActivity[] }> = [];
  let current: { text: string; tools: ToolActivity[] } | undefined;
  for (const item of work) {
    if (item.type === "thinking" || item.type === "text") {
      const segments = thinkingSegments(item.text);
      for (const text of segments) {
        current = { text, tools: [] };
        steps.push(current);
      }
      continue;
    }
    const tool = byId.get(item.toolId);
    if (!tool) continue;
    if (!current) {
      current = { text: "", tools: [] };
      steps.push(current);
    }
    current.tools.push(tool);
  }
  // Tool-only steps carry no narrative, so fall back to the collapsed thinking text.
  if (!steps.some((step) => step.text.trim()) && fallback.trim()) {
    const paragraphs = thinkingSegments(fallback);
    return paragraphs.map((text, index) => ({
      text,
      tools: index === paragraphs.length - 1 ? tools : [],
    }));
  }
  return steps.map((step) => ({ ...step, text: step.text ? formatThinking(step.text) : step.text }));
}

export interface TraceRow {
  id: string;
  kind: "think" | "run" | "write" | "read" | "look" | "tool";
  label: string;
  chip: string;
  /** Chips carrying code, paths or commands read better in the mono face. */
  mono: boolean;
  status?: ToolActivity["status"];
  /** Thinking markdown, for `think` rows. */
  text?: string;
  tool?: ToolActivity;
}

/**
 * Flatten a turn into compact `label + chip` rows: consecutive thinking beats collapse into one
 * row carrying the rest as its detail, and every tool call becomes its own row.
 */
export function traceRows(work: WorkItem[], tools: ToolActivity[], fallback = ""): TraceRow[] {
  const rows: TraceRow[] = [];
  let pending: string[] = [];
  const flushThinking = () => {
    if (pending.length === 0) return;
    rows.push({
      id: `think-${rows.length}`,
      kind: "think",
      label: ct("trace.think"),
      chip: crop(headline(pending[0]!), 72),
      mono: false,
      text: pending.join("\n\n"),
    });
    pending = [];
  };
  for (const step of thoughtSteps(work, tools, fallback)) {
    if (step.text.trim()) pending.push(step.text.trim());
    if (step.tools.length === 0) continue;
    flushThinking();
    for (const tool of step.tools) rows.push(toolRow(tool, rows.length));
  }
  flushThinking();
  return rows;
}

function toolRow(tool: ToolActivity, index: number): TraceRow {
  const base = { id: `row-${index}-${tool.id}`, status: tool.status, tool, mono: true };
  const name = tool.name.toLowerCase();
  if (name === "delegate") {
    const progress = delegateProgress(tool);
    const active = progress.tasks.find((item) => item.status === "running")
      ?? progress.tasks.find((item) => item.status === "pending")
      ?? progress.tasks[0];
    const summary = active?.task.replace(/\s+/g, " ").trim() ?? "";
    const short = summary.length > 48 ? `${summary.slice(0, 48)}…` : summary;
    const chip = [
      progress.total > 0 ? ct("trace.delegateProgress", { done: progress.done, total: progress.total }) : "",
      active?.role,
      short,
    ].filter(Boolean).join(" · ");
    return { ...base, kind: "tool", label: ct("trace.delegate"), chip, mono: false };
  }
  const command = formatCommand(toolCommand(tool));
  if (command) {
    const lines = command.split("\n").filter(Boolean);
    return {
      ...base,
      kind: "run",
      label: lines.length > 1 ? ct("trace.runN", { n: lines.length }) : ct("trace.run"),
      chip: lines[0] ?? "",
    };
  }
  if (tool.name === "vision") return { ...base, kind: "look", label: ct("trace.look"), chip: "", mono: false };
  const args = isRecord(tool.args) ? tool.args : {};
  const file = toolPath(tool) || patchTarget(stringField(args, "input"))?.path || "";
  if (/write|edit|patch/.test(name)) {
    const lines = writtenLines(tool);
    return {
      ...base,
      kind: "write",
      label: lines > 0 ? ct("trace.writeLines", { n: lines }) : ct("trace.write"),
      chip: baseName(file),
    };
  }
  if (/grep|glob|search|find/.test(name)) {
    return {
      ...base,
      kind: "read",
      label: ct("trace.search"),
      chip: stringField(args, "pattern") || stringField(args, "query") || baseName(file) || ct("trace.workspace"),
    };
  }
  if (/read|cat|view/.test(name)) return { ...base, kind: "read", label: ct("trace.read"), chip: baseName(file) || ct("trace.file") };
  return { ...base, kind: "tool", label: tool.title, chip: baseName(file), mono: Boolean(file) };
}

function writtenLines(tool: ToolActivity): number {
  const args = isRecord(tool.args) ? tool.args : {};
  const patch = stringField(args, "input");
  if (patch.trim()) return splitPatch(patch).filter((row) => row.kind === "add").length;
  const body = stringField(args, "contents") || stringField(args, "content");
  return body ? body.split("\n").length : 0;
}

/** Windows hands back `D:\code\app`, so both separators have to count as one. */
export function baseName(file: string): string {
  return file.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
}

/** Markdown thinking reads badly inside a one-line chip, so drop its syntax. */
function headline(text: string): string {
  return text
    .replace(/^[#>\s]*/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/[*`_]/g, "")
    .split("\n")[0]!
    .replace(/\s+/g, " ")
    .trim();
}

function thinkingSegments(text: string): string[] {
  const formatted = formatThinking(text).trim();
  if (!formatted) return [];
  const blocks = formatted.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const lines = blocks.flatMap((block) => {
    const rows = block.split("\n").map((part) => part.trim()).filter(Boolean);
    return rows.length > 1 ? rows : [block];
  });
  if (lines.length > 1) return lines;
  if (formatted.length <= 220) return [formatted];
  return formatted
    .split(/(?<=[。！？.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => part.length > 260 ? part.match(/.{1,220}(?:\s+|$)/g)?.map((item) => item.trim()).filter(Boolean) ?? [part] : [part]);
}

/** Drop the last text beat when it is already the visible reply. */
export function omitFinalReply(work: WorkItem[], reply: string): WorkItem[] {
  const text = reply.trim();
  if (!text) return work;
  let index = -1;
  for (let current = work.length - 1; current >= 0; current -= 1) {
    if (work[current]!.type === "text") {
      index = current;
      break;
    }
  }
  if (index < 0) return work;
  const item = work[index]!;
  if (item.type !== "text") return work;
  if (item.text.includes(text) || text.includes(item.text)) return work.filter((_, current) => current !== index);
  return work;
}

export function repairMarkdownTables(text: string): string {
  return text.split(/(```[\s\S]*?```)/).map((chunk, index) => {
    if (index % 2 === 1 || !/\|[\t ]*:?-{2,}/.test(chunk)) return chunk;
    return chunk.replace(/\|\|/g, "|\n|");
  }).join("");
}

/** Drop blank fenced blocks so the UI does not paint empty gray `pre` boxes. */
export function stripEmptyMarkdown(text: string): string {
  return text
    .replace(/```[^\n]*\r?\n(?:[ \t]*\r?\n)*```/g, "")
    .replace(/```[^\n]*[ \t]*```/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function trimHttpUrl(raw: string): string {
  return raw.trim().replace(/[),.;:!?]+$/g, "");
}

export function isHttpUrl(text: string): boolean {
  return /^https?:\/\/[^\s]+$/i.test(trimHttpUrl(text));
}

export function urlChipLabel(url: string): string {
  try {
    const parsed = new URL(trimHttpUrl(url));
    const path = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "");
    return `${parsed.host}${path}${parsed.search}`;
  } catch {
    return trimHttpUrl(url).replace(/^https?:\/\//i, "");
  }
}

export function takeTrailingUrl(text: string, cursor: number): { next: string; url: string } | undefined {
  const before = text.slice(0, cursor);
  const match = before.match(/https?:\/\/[^\s]+$/i);
  if (!match?.[0]) return;
  const url = trimHttpUrl(match[0]);
  if (!isHttpUrl(url)) return;
  const start = before.length - match[0].length;
  return { url, next: `${text.slice(0, start)}${text.slice(cursor)}` };
}

export function splitHttpUrls(text: string): Array<{ type: "text" | "url"; value: string }> {
  const parts: Array<{ type: "text" | "url"; value: string }> = [];
  const pattern = /https?:\/\/[^\s]+/gi;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const raw = match[0];
    const index = match.index ?? 0;
    if (index > last) parts.push({ type: "text", value: text.slice(last, index) });
    const url = trimHttpUrl(raw);
    if (isHttpUrl(url)) {
      parts.push({ type: "url", value: url });
      if (raw.length > url.length) parts.push({ type: "text", value: raw.slice(url.length) });
    } else {
      parts.push({ type: "text", value: raw });
    }
    last = index + raw.length;
  }
  if (last < text.length) parts.push({ type: "text", value: text.slice(last) });
  return parts.length > 0 ? parts : [{ type: "text", value: text }];
}

export function isFileChipToken(token: string): boolean {
  const path = token.startsWith("@") ? token.slice(1) : token;
  if (!path || path.endsWith("/")) return false;
  return path.includes("/") || path.includes(".");
}

/** URLs and `@path` tokens for restoring chips in the composer. */
export function splitPromptChips(text: string): Array<{ type: "text" | "url" | "file"; value: string }> {
  const parts: Array<{ type: "text" | "url" | "file"; value: string }> = [];
  for (const part of splitHttpUrls(text)) {
    if (part.type === "url") {
      parts.push(part);
      continue;
    }
    const pattern = /@[^\s]+/g;
    let last = 0;
    for (const match of part.value.matchAll(pattern)) {
      const index = match.index ?? 0;
      if (index > last) parts.push({ type: "text", value: part.value.slice(last, index) });
      const raw = match[0];
      if (isFileChipToken(raw)) parts.push({ type: "file", value: raw.slice(1) });
      else parts.push({ type: "text", value: raw });
      last = index + raw.length;
    }
    if (last < part.value.length) parts.push({ type: "text", value: part.value.slice(last) });
  }
  return parts.length > 0 ? parts : [{ type: "text", value: text }];
}

export function parseFeaturesJson(input: string): SessionTodo[] {
  try {
    const data = JSON.parse(input) as unknown;
    const list = Array.isArray(data) ? data : isRecord(data) && Array.isArray(data.features) ? data.features : [];
    const todos: SessionTodo[] = [];
    for (const item of list) {
      if (!isRecord(item)) continue;
      const text = stringField(item, "description") || stringField(item, "text") || stringField(item, "title");
      if (!text) continue;
      todos.push({
        id: stringField(item, "id") || `feature-${todos.length}`,
        text,
        done: item.passes === true,
      });
    }
    return todos;
  } catch {
    return [];
  }
}

export function collectTodos(messages: ChatMessage[]): SessionTodo[] {
  let fromPlan: SessionTodo[] | undefined;
  const fromTools: SessionTodo[] = [];
  for (const tool of sessionTools(messages)) {
    const planned = todosFromPlanTool(tool);
    if (planned) {
      fromPlan = planned;
      continue;
    }
    if (!/todo/i.test(tool.name)) continue;
    const args = isRecord(tool.args) ? tool.args : {};
    const list = [args.todos, args.items, args.tasks].find(Array.isArray);
    if (!Array.isArray(list)) continue;
    list.forEach((item, index) => {
      if (typeof item === "string" && item.trim()) {
        fromTools.push({ id: `${tool.id}-${index}`, text: item.trim(), done: tool.status === "complete" });
        return;
      }
      if (!isRecord(item)) return;
      const text = stringField(item, "content") || stringField(item, "text") || stringField(item, "title");
      if (!text) return;
      fromTools.push({
        id: stringField(item, "id") || `${tool.id}-${index}`,
        text,
        done: item.status === "completed" || item.status === "complete" || item.done === true,
      });
    });
  }
  if (fromPlan?.length) return fromPlan;
  if (fromTools.length) return fromTools;
  const text = messages.filter((item) => item.role === "assistant").map((item) => item.text).join("\n");
  const checks: SessionTodo[] = [];
  for (const match of text.matchAll(/^[\t ]*- \[([ xX])\] (.+)$/gm)) {
    checks.push({ id: `check-${checks.length}`, text: match[2]!.trim(), done: match[1] !== " " });
  }
  if (checks.length) return checks;
  return [];
}

function todosFromPlanTool(tool: ToolActivity): SessionTodo[] | undefined {
  if (!/plan/i.test(tool.name)) return undefined;
  const args = isRecord(tool.args) ? tool.args : {};
  const details = isRecord(tool.details) ? tool.details : {};
  return planStepsFromUnknown(args.plan) ?? planStepsFromUnknown(details.steps) ?? planStepsFromUnknown(details.plan);
}

function planStepsFromUnknown(value: unknown): SessionTodo[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const todos: SessionTodo[] = [];
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) continue;
    const text = stringField(item, "step") || stringField(item, "content") || stringField(item, "text") || stringField(item, "title");
    if (!text) continue;
    const status = stringField(item, "status");
    todos.push({
      id: stringField(item, "id") || `plan-${index}`,
      text,
      done: status === "completed" || status === "complete" || item.done === true,
      ...(status === "in_progress" ? { active: true } : {}),
    });
  }
  return todos.length ? todos : undefined;
}

function toolPath(tool: ToolActivity): string {
  const args = isRecord(tool.args) ? tool.args : {};
  const details = isRecord(tool.details) ? tool.details : {};
  return stringField(args, "path") || stringField(args, "file_path") || stringField(args, "target_file") || stringField(details, "path");
}

export type SplitRow = { kind: "ctx" | "add" | "del" | "chg" | "meta"; old: string; next: string };

/** Turn apply_patch / unified hunks into git-style split rows. */
export function splitPatch(patch: string): SplitRow[] {
  const lines = patch.replaceAll("\r\n", "\n").split("\n");
  const rows: SplitRow[] = [];
  let index = 0;
  const take = (prefix: string) => {
    const chunk: string[] = [];
    while (index < lines.length && lines[index]!.startsWith(prefix) && !lines[index]!.startsWith(`${prefix}${prefix}${prefix}`)) {
      chunk.push(lines[index]!.slice(1));
      index += 1;
    }
    return chunk;
  };
  while (index < lines.length) {
    const line = lines[index]!;
    if (!line || line.startsWith("***") || line.startsWith("@@") || line.startsWith("diff") || line.startsWith("+++") || line.startsWith("---")) {
      if (line) rows.push({ kind: "meta", old: line, next: "" });
      index += 1;
      continue;
    }
    if (line.startsWith("-") || line.startsWith("+")) {
      for (const old of line.startsWith("-") ? take("-") : []) rows.push({ kind: "del", old, next: "" });
      for (const next of take("+")) rows.push({ kind: "add", old: "", next });
      continue;
    }
    rows.push({ kind: "ctx", old: line.startsWith(" ") ? line.slice(1) : line, next: line.startsWith(" ") ? line.slice(1) : line });
    index += 1;
  }
  return rows;
}

function changesFromPatch(input: string): FileChange[] {
  if (!input.trim()) return [];
  const sections: Array<{ path: string; lines: string[] }> = [];
  let current: { path: string; lines: string[] } | undefined;
  for (const line of input.replaceAll("\r\n", "\n").split("\n")) {
    const match = /^\*\*\* (?:Add File|Delete File|Update File|Move to): (.+)$/.exec(line);
    if (match?.[1]) {
      if (current) sections.push(current);
      current = { path: match[1], lines: [line] };
      continue;
    }
    if (!current || line === "*** Begin Patch" || line === "*** End Patch") continue;
    current.lines.push(line);
  }
  if (current) sections.push(current);
  return sections.map((section) => ({
    path: section.path,
    additions: section.lines.filter((line) => line.startsWith("+") && !line.startsWith("+++")).length,
    deletions: section.lines.filter((line) => line.startsWith("-") && !line.startsWith("---") && !line.startsWith("***")).length,
    patch: section.lines.join("\n"),
  }));
}

function changesFromOutput(output?: string): FileChange[] {
  if (!output) return [];
  const diff = /(?:diff: )?\+(\d+)\s+-(\d+)/.exec(output);
  const listed = /files:\s*(.+)/.exec(output);
    const files = listed?.[1]
    ? listed[1].split(",").map((item) => item.trim()).filter(Boolean)
    : output.split("\n").map((line) => line.trim()).filter((line) => /^(?:[\w./-]+\/)+[\w./-]+\.\w{1,12}$/.test(line) || /^(?:[\w./-]+\/)+[\w./-]+$/.test(line));
  if (files.length === 0) return [];
  const additions = diff ? Number(diff[1]) : 0;
  const deletions = diff ? Number(diff[2]) : 0;
  if (files.length === 1) return [{ path: files[0]!, additions, deletions }];
  return files.map((path) => ({ path, additions: 0, deletions: 0 }));
}

function stringField(value: JsonRecord, key: string): string {
  return typeof value[key] === "string" ? value[key] : "";
}

function crop(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function spliceFileMention(text: string, path: string, at: number): { next: string; caret: number } {
  const token = `@${path}`;
  const index = Math.max(0, Math.min(at, text.length));
  const left = text.slice(0, index);
  const right = text.slice(index);
  const glue = left && !/\s$/.test(left) ? " " : "";
  const next = `${left}${glue}${token} ${right}`;
  return { next, caret: left.length + glue.length + token.length + 1 };
}

export function workspaceRelative(abs: string, cwd: string): string | undefined {
  const root = cwd.replace(/\\/g, "/").replace(/\/$/, "");
  const file = abs.replace(/\\/g, "/");
  if (file === root) return "";
  if (file.startsWith(`${root}/`)) return file.slice(root.length + 1);
}

export function filterMentionPaths(files: string[], query: string): string[] {
  const raw = query.toLowerCase();
  // Typing a folder path without trailing slash still browses one level inside it.
  const needle = raw && !raw.endsWith("/") && files.some((file) => file.toLowerCase() === `${raw}/`)
    ? `${raw}/`
    : raw;
  const filtered = files.filter((file) => {
    const lower = file.toLowerCase();
    if (!needle) {
      const trimmed = file.endsWith("/") ? file.slice(0, -1) : file;
      return !trimmed.includes("/");
    }
    // Drill-in: only the folder itself + one level of children.
    if (needle.endsWith("/")) {
      if (lower === needle) return true;
      if (!lower.startsWith(needle)) return false;
      const rest = file.slice(needle.length);
      const trimmed = rest.endsWith("/") ? rest.slice(0, -1) : rest;
      return trimmed.length > 0 && !trimmed.includes("/");
    }
    return lower.startsWith(needle) || lower.includes(`/${needle}`) || lower.includes(needle);
  });
  filtered.sort((left, right) => {
    const dir = Number(right.endsWith("/")) - Number(left.endsWith("/"));
    if (dir) return dir;
    if (needle) {
      const prefix = Number(right.toLowerCase().startsWith(needle)) - Number(left.toLowerCase().startsWith(needle));
      if (prefix) return prefix;
      if (needle.endsWith("/") && left.toLowerCase() === needle) return -1;
      if (needle.endsWith("/") && right.toLowerCase() === needle) return 1;
    }
    return left.localeCompare(right);
  });
  // Folder browse must not hide siblings; fuzzy search can stay capped.
  return needle.endsWith("/") ? filtered : filtered.slice(0, 80);
}
