import { DEFAULT_LOCALE, t, type Locale } from "./i18n";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** OpenAI-compatible base：去掉末尾 `/` 和误粘贴的 `/chat/completions`。 */
export function apiBaseUrl(base: string): string {
  return base.trim().replace(/\/+$/, "").replace(/\/chat\/completions$/i, "").replace(/\/+$/, "");
}

/** `{base}/models`；base 若是 chat completions 地址则退回到同一前缀。 */
export function modelsUrl(base: string, locale: Locale = DEFAULT_LOCALE): string {
  const root = apiBaseUrl(base);
  if (!root) throw new Error(t(locale, "error.needApiUrl"));
  return root.endsWith("/models") ? root : `${root}/models`;
}

export function parseOpenAiModels(payload: unknown): string[] {
  const rows = isRecord(payload) && Array.isArray(payload.data)
    ? payload.data
    : isRecord(payload) && Array.isArray(payload.models)
      ? payload.models
      : Array.isArray(payload)
        ? payload
        : [];
  const ids = rows.flatMap((item) => {
    if (typeof item === "string" && item.trim()) return [item.trim()];
    if (isRecord(item) && typeof item.id === "string" && item.id.trim()) return [item.id.trim()];
    return [];
  });
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

export async function listOpenAiModels(
  baseUrl: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  locale: Locale = DEFAULT_LOCALE,
): Promise<string[]> {
  if (!apiKey.trim()) throw new Error(t(locale, "error.needApiKey"));
  const url = modelsUrl(baseUrl, locale);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(t(locale, "error.invalidApiUrl"));
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(t(locale, "error.httpOnly"));
  }
  const response = await fetchImpl(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey.trim()}`,
    },
    signal: AbortSignal.timeout(12_000),
  });
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const detail = isRecord(payload)
      ? (isRecord(payload.error) && typeof payload.error.message === "string"
        ? payload.error.message
        : typeof payload.message === "string" ? payload.message : "")
      : "";
    throw new Error(detail || `获取模型失败（${response.status}）`);
  }
  return parseOpenAiModels(payload);
}
