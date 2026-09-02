export const WEB_SEARCH_KEY_FIELDS = [
  "braveApiKey",
  "tavilyApiKey",
  "jinaApiKey",
  "exaApiKey",
] as const;

export type WebSearchKeyField = (typeof WEB_SEARCH_KEY_FIELDS)[number];

export type WebSearchConfig = {
  workflow: "auto-summary";
} & Partial<Record<WebSearchKeyField, string>>;

export interface McpServerRow {
  name: string;
  kind: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  disabled?: boolean;
}

export interface WebSource {
  title: string;
  url: string;
}

export interface WebSearchCard {
  query: string;
  sources: WebSource[];
  summary?: string;
  count?: number;
  url?: string;
}

export interface DeepSeekBalance {
  available: boolean;
  items: Array<{ currency: string; total: string }>;
}

const MARKDOWN_LINK = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

export function parseWebSearchConfig(raw: unknown): WebSearchConfig {
  const value = isRecord(raw) ? raw : {};
  const next: WebSearchConfig = { workflow: "auto-summary" };
  for (const field of WEB_SEARCH_KEY_FIELDS) {
    const text = stringField(value, field);
    if (text) next[field] = text;
  }
  return next;
}

export function mergeWebSearchConfig(previous: unknown, next: WebSearchConfig): Record<string, unknown> {
  const base = isRecord(previous) ? { ...previous } : {};
  base.workflow = "auto-summary";
  for (const field of WEB_SEARCH_KEY_FIELDS) {
    const text = next[field]?.trim() ?? "";
    if (text) base[field] = text;
    else delete base[field];
  }
  return base;
}

export function parseMcpServers(raw: unknown): McpServerRow[] {
  const servers = isRecord(raw) && isRecord(raw.mcpServers) ? raw.mcpServers : {};
  const rows: McpServerRow[] = [];
  for (const [name, config] of Object.entries(servers)) {
    if (!name.trim() || !isRecord(config)) continue;
    if (typeof config.url === "string" && config.url.trim()) {
      rows.push({
        name,
        kind: "http",
        url: config.url.trim(),
        ...(config.disabled === true ? { disabled: true } : {}),
      });
      continue;
    }
    if (typeof config.command === "string" && config.command.trim()) {
      const args = Array.isArray(config.args)
        ? config.args.filter((item): item is string => typeof item === "string")
        : [];
      rows.push({
        name,
        kind: "stdio",
        command: config.command.trim(),
        ...(args.length ? { args } : {}),
        ...(config.disabled === true ? { disabled: true } : {}),
      });
    }
  }
  return rows;
}

export function serializeMcpServers(rows: McpServerRow[]): { mcpServers: Record<string, Record<string, unknown>> } {
  const mcpServers: Record<string, Record<string, unknown>> = {};
  for (const row of rows) {
    const name = row.name.trim();
    if (!name) continue;
    if (row.kind === "http" && row.url?.trim()) {
      mcpServers[name] = {
        url: row.url.trim(),
        ...(row.disabled ? { disabled: true } : {}),
      };
      continue;
    }
    if (row.command?.trim()) {
      mcpServers[name] = {
        command: row.command.trim(),
        ...(row.args?.length ? { args: row.args } : {}),
        ...(row.disabled ? { disabled: true } : {}),
      };
    }
  }
  return { mcpServers };
}

export function mcpServerFromLine(name: string, value: string): McpServerRow | undefined {
  const label = name.trim();
  const spec = value.trim();
  if (!label || !spec) return undefined;
  if (/^https?:\/\//i.test(spec)) return { name: label, kind: "http", url: spec };
  const [command, ...args] = spec.split(/\s+/).filter(Boolean);
  if (!command) return undefined;
  return { name: label, kind: "stdio", command, ...(args.length ? { args } : {}) };
}

export function parseDeepSeekBalance(raw: unknown): DeepSeekBalance | undefined {
  if (!isRecord(raw)) return undefined;
  const items = Array.isArray(raw.balance_infos)
    ? raw.balance_infos.flatMap((item) => {
      if (!isRecord(item)) return [];
      const currency = stringField(item, "currency") || "CNY";
      const total = stringField(item, "total_balance");
      return total ? [{ currency, total }] : [];
    })
    : [];
  if (items.length === 0 && raw.is_available !== true && raw.is_available !== false) return undefined;
  return { available: raw.is_available !== false, items };
}

export function parseWebSearchCard(
  name: string,
  args: unknown,
  details: unknown,
  output?: string,
): WebSearchCard | undefined {
  if (!/web_search|fetch_content|get_search_content/.test(name)) return undefined;
  const record = isRecord(args) ? args : {};
  const info = isRecord(details) ? details : {};
  const query = stringField(record, "query")
    || firstString(record.queries)
    || firstString(info.queries)
    || stringField(info, "currentQuery")
    || "";
  const url = stringField(record, "url")
    || firstString(record.urls)
    || firstString(info.urls)
    || stringField(info, "url")
    || "";
  const sources = [
    ...sourcesFromDetails(info),
    ...markdownLinks(output ?? ""),
  ].filter((item, index, list) => list.findIndex((other) => other.url === item.url) === index);
  const summary = isRecord(info.summary) ? stringField(info.summary, "text") : "";
  const count = typeof info.totalResults === "number" ? info.totalResults : sources.length;
  if (!query && !url && sources.length === 0 && !summary) return undefined;
  return {
    query,
    sources: sources.slice(0, 8),
    ...(summary ? { summary: summary.slice(0, 280) } : {}),
    ...(count > 0 ? { count } : {}),
    ...(url ? { url } : {}),
  };
}

function sourcesFromDetails(info: Record<string, unknown>): WebSource[] {
  const curated = Array.isArray(info.curatedQueries) ? info.curatedQueries : [];
  const fromCurated = curated.flatMap((entry) => {
    if (!isRecord(entry) || !Array.isArray(entry.sources)) return [];
    return entry.sources.flatMap((source) => {
      if (!isRecord(source)) return [];
      const url = stringField(source, "url");
      if (!url) return [];
      return [{ title: stringField(source, "title") || url, url }];
    });
  });
  if (fromCurated.length > 0) return fromCurated;
  const results = Array.isArray(info.results) ? info.results : [];
  return results.flatMap((source) => {
    if (!isRecord(source)) return [];
    const url = stringField(source, "url");
    if (!url) return [];
    return [{ title: stringField(source, "title") || url, url }];
  });
}

function markdownLinks(text: string): WebSource[] {
  const sources: WebSource[] = [];
  for (const match of text.matchAll(MARKDOWN_LINK)) {
    const title = match[1]?.trim();
    const url = match[2]?.trim();
    if (title && url) sources.push({ title, url });
  }
  return sources;
}

function firstString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";
  const item = value.find((entry) => typeof entry === "string" && entry.trim());
  return typeof item === "string" ? item.trim() : "";
}

function stringField(value: Record<string, unknown>, key: string): string {
  const text = value[key];
  return typeof text === "string" ? text.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
