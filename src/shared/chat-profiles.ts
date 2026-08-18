export const DEEPSEEK_PRESET = {
  url: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
};

export type ChatKind = "deepseek" | "custom";

export interface CustomApiProfile {
  id: string;
  name: string;
  url: string;
  model: string;
  apiKey: string;
  maxTokens?: number;
}

export interface ChatProfiles {
  kind: ChatKind;
  deepseek: { model: string; apiKey: string };
  customProfiles: CustomApiProfile[];
  activeCustomId: string;
}

export function newCustomProfileId(): string {
  return `custom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function defaultCustomProfile(partial: Partial<CustomApiProfile> = {}): CustomApiProfile {
  return {
    id: partial.id ?? newCustomProfileId(),
    name: partial.name?.trim() || "未命名",
    url: partial.url?.trim() ?? "",
    model: partial.model?.trim() ?? "",
    apiKey: partial.apiKey?.trim() ?? "",
    ...(partial.maxTokens ? { maxTokens: partial.maxTokens } : {}),
  };
}

export function emptyChatProfiles(): ChatProfiles {
  const profile = defaultCustomProfile({ name: "默认" });
  return {
    kind: "deepseek",
    deepseek: { model: DEEPSEEK_PRESET.model, apiKey: "" },
    customProfiles: [profile],
    activeCustomId: profile.id,
  };
}

export function isDeepSeekUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed === DEEPSEEK_PRESET.url || trimmed === `${DEEPSEEK_PRESET.url}/v1`;
}

export function activeCustomProfile(profiles: ChatProfiles): CustomApiProfile | undefined {
  return profiles.customProfiles.find((item) => item.id === profiles.activeCustomId)
    ?? profiles.customProfiles[0];
}

export function activeChat(profiles: ChatProfiles) {
  if (profiles.kind === "custom") {
    const profile = activeCustomProfile(profiles);
    if (!profile) return { url: "", model: "", apiKey: "" };
    return {
      url: profile.url.trim(),
      model: profile.model.trim(),
      apiKey: profile.apiKey.trim(),
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

function tokenCount(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value.trim()) : Number.NaN;
  if (!Number.isFinite(n) || n < 1) return undefined;
  return Math.min(Math.floor(n), 2_000_000);
}

function parseCustomProfile(raw: unknown): CustomApiProfile | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  const id = text(value.id);
  if (!id) return undefined;
  const maxTokens = tokenCount(value.maxTokens);
  return defaultCustomProfile({
    id,
    name: text(value.name) || "未命名",
    url: text(value.url),
    model: text(value.model),
    apiKey: text(value.apiKey),
    ...(maxTokens ? { maxTokens } : {}),
  });
}

function profilesFromLegacyCustom(
  custom: Record<string, unknown>,
  activeCustomId: string,
): { customProfiles: CustomApiProfile[]; activeCustomId: string } {
  const url = text(custom.url);
  const model = text(custom.model);
  const apiKey = text(custom.apiKey);
  const maxTokens = tokenCount(custom.maxTokens);
  if (!url && !model && !apiKey) {
    const profile = defaultCustomProfile({ name: "默认" });
    return { customProfiles: [profile], activeCustomId: profile.id };
  }
  const id = activeCustomId || newCustomProfileId();
  const profile = defaultCustomProfile({
    id,
    name: "默认",
    url,
    model,
    apiKey,
    ...(maxTokens ? { maxTokens } : {}),
  });
  return { customProfiles: [profile], activeCustomId: profile.id };
}

export function parseChatProfiles(raw: unknown): ChatProfiles | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  const kind = value.kind === "custom" ? "custom" : value.kind === "deepseek" ? "deepseek" : undefined;
  if (!kind) return undefined;
  const deepseek = value.deepseek && typeof value.deepseek === "object" && !Array.isArray(value.deepseek)
    ? value.deepseek as Record<string, unknown>
    : {};
  const activeCustomId = text(value.activeCustomId);
  let customProfiles = Array.isArray(value.customProfiles)
    ? value.customProfiles.map(parseCustomProfile).filter((item): item is CustomApiProfile => Boolean(item))
    : [];
  let resolvedActiveId = activeCustomId;
  if (!customProfiles.length) {
    const custom = value.custom && typeof value.custom === "object" && !Array.isArray(value.custom)
      ? value.custom as Record<string, unknown>
      : {};
    const legacy = profilesFromLegacyCustom(custom, activeCustomId);
    customProfiles = legacy.customProfiles;
    resolvedActiveId = legacy.activeCustomId;
  }
  const resolvedActive = customProfiles.some((item) => item.id === resolvedActiveId)
    ? resolvedActiveId
    : customProfiles[0]?.id ?? "";
  return {
    kind,
    deepseek: { model: text(deepseek.model) || DEEPSEEK_PRESET.model, apiKey: text(deepseek.apiKey) },
    customProfiles,
    activeCustomId: resolvedActive,
  };
}

/** One stored URL/key/model → two profiles. Official DeepSeek stays on the preset slot. */
export function migrateChatProfiles(stored: { url?: string; model?: string; apiKey?: string }): ChatProfiles {
  const url = stored.url?.trim() ?? "";
  const model = stored.model?.trim() ?? "";
  const apiKey = stored.apiKey?.trim() ?? "";
  const base = emptyChatProfiles();
  if (url && !isDeepSeekUrl(url)) {
    const profile = defaultCustomProfile({ name: "默认", url, model, apiKey });
    return { ...base, kind: "custom", customProfiles: [profile], activeCustomId: profile.id };
  }
  return { ...base, deepseek: { model: model || DEEPSEEK_PRESET.model, apiKey } };
}

function mergeCustomProfile(previous: CustomApiProfile | undefined, next: CustomApiProfile): CustomApiProfile {
  const maxTokens = next.maxTokens ?? previous?.maxTokens;
  return defaultCustomProfile({
    id: next.id,
    name: next.name.trim() || previous?.name || "未命名",
    url: next.url.trim() || previous?.url || "",
    model: next.model.trim() || previous?.model || "",
    apiKey: next.apiKey.trim() || previous?.apiKey || "",
    ...(maxTokens ? { maxTokens } : {}),
  });
}

export function mergeChatProfiles(previous: ChatProfiles, next: ChatProfiles): ChatProfiles {
  const previousById = new Map(previous.customProfiles.map((item) => [item.id, item]));
  const mergedProfiles = next.customProfiles.length
    ? next.customProfiles.map((item) => mergeCustomProfile(previousById.get(item.id), item))
    : previous.customProfiles;
  const activeCustomId = mergedProfiles.some((item) => item.id === next.activeCustomId)
    ? next.activeCustomId
    : mergedProfiles[0]?.id ?? previous.activeCustomId;
  return {
    kind: next.kind,
    deepseek: {
      model: next.deepseek.model.trim() || previous.deepseek.model || DEEPSEEK_PRESET.model,
      apiKey: next.deepseek.apiKey.trim() || previous.deepseek.apiKey,
    },
    customProfiles: mergedProfiles.length ? mergedProfiles : previous.customProfiles,
    activeCustomId,
  };
}

export function buildCustomProfilesPayload(
  profiles: CustomApiProfile[],
  activeCustomId: string,
  draft: Pick<CustomApiProfile, "name" | "url" | "model" | "apiKey" | "maxTokens">,
): { customProfiles: CustomApiProfile[]; activeCustomId: string } {
  const nextProfiles = profiles.map((item) => (
    item.id === activeCustomId
      ? defaultCustomProfile({
        id: item.id,
        name: draft.name,
        url: draft.url,
        model: draft.model,
        apiKey: draft.apiKey,
        ...(draft.maxTokens ? { maxTokens: draft.maxTokens } : {}),
      })
      : item
  ));
  return {
    customProfiles: nextProfiles,
    activeCustomId: nextProfiles.some((item) => item.id === activeCustomId)
      ? activeCustomId
      : nextProfiles[0]?.id ?? activeCustomId,
  };
}
