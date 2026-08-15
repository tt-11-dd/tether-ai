export const DEEPSEEK_PRESET = {
  url: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
};

export type ChatKind = "deepseek" | "custom";

export interface ChatProfiles {
  kind: ChatKind;
  deepseek: { model: string; apiKey: string };
  custom: { url: string; model: string; apiKey: string };
}

export function emptyChatProfiles(): ChatProfiles {
  return {
    kind: "deepseek",
    deepseek: { model: DEEPSEEK_PRESET.model, apiKey: "" },
    custom: { url: "", model: "", apiKey: "" },
  };
}

export function isDeepSeekUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed === DEEPSEEK_PRESET.url || trimmed === `${DEEPSEEK_PRESET.url}/v1`;
}

export function activeChat(profiles: ChatProfiles) {
  if (profiles.kind === "custom") {
    return {
      url: profiles.custom.url.trim(),
      model: profiles.custom.model.trim(),
      apiKey: profiles.custom.apiKey.trim(),
    };
  }
  return {
    url: DEEPSEEK_PRESET.url,
    model: profiles.deepseek.model.trim() || DEEPSEEK_PRESET.model,
    apiKey: profiles.deepseek.apiKey.trim(),
  };
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function parseChatProfiles(raw: unknown): ChatProfiles | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  const kind = value.kind === "custom" ? "custom" : value.kind === "deepseek" ? "deepseek" : undefined;
  if (!kind) return undefined;
  const deepseek = value.deepseek && typeof value.deepseek === "object" && !Array.isArray(value.deepseek)
    ? value.deepseek as Record<string, unknown>
    : {};
  const custom = value.custom && typeof value.custom === "object" && !Array.isArray(value.custom)
    ? value.custom as Record<string, unknown>
    : {};
  return {
    kind,
    deepseek: { model: text(deepseek.model) || DEEPSEEK_PRESET.model, apiKey: text(deepseek.apiKey) },
    custom: { url: text(custom.url), model: text(custom.model), apiKey: text(custom.apiKey) },
  };
}

/** One stored URL/key/model → two profiles. Official DeepSeek stays on the preset slot. */
export function migrateChatProfiles(stored: { url?: string; model?: string; apiKey?: string }): ChatProfiles {
  const url = stored.url?.trim() ?? "";
  const model = stored.model?.trim() ?? "";
  const apiKey = stored.apiKey?.trim() ?? "";
  const base = emptyChatProfiles();
  if (url && !isDeepSeekUrl(url)) {
    return { ...base, kind: "custom", custom: { url, model, apiKey } };
  }
  return { ...base, deepseek: { model: model || DEEPSEEK_PRESET.model, apiKey } };
}

export function mergeChatProfiles(previous: ChatProfiles, next: ChatProfiles): ChatProfiles {
  return {
    kind: next.kind,
    deepseek: {
      model: next.deepseek.model.trim() || previous.deepseek.model || DEEPSEEK_PRESET.model,
      apiKey: next.deepseek.apiKey.trim() || previous.deepseek.apiKey,
    },
    custom: {
      url: next.custom.url.trim() || previous.custom.url,
      model: next.custom.model.trim() || previous.custom.model,
      apiKey: next.custom.apiKey.trim() || previous.custom.apiKey,
    },
  };
}
