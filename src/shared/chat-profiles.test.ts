import { describe, expect, it } from "vitest";
import {
  activeChat,
  activeCustomProfile,
  buildCustomProfilesPayload,
  DEEPSEEK_PRESET,
  defaultCustomProfile,
  foldOfficialDeepSeek,
  mergeChatProfiles,
  migrateChatProfiles,
  officialDeepSeekKey,
  parseChatProfiles,
} from "./chat-profiles";

describe("migrateChatProfiles", () => {
  it("keeps a custom gateway on the profile list", () => {
    const migrated = migrateChatProfiles({
      url: "https://www.codex5.net/v1",
      model: "gpt-5.5",
      apiKey: "sk-custom",
    });
    expect(migrated.kind).toBe("custom");
    expect(activeCustomProfile(migrated)).toMatchObject({
      url: "https://www.codex5.net/v1",
      model: "gpt-5.5",
      apiKey: "sk-custom",
    });
  });

  it("folds the official DeepSeek URL into an enableable profile", () => {
    const migrated = migrateChatProfiles({
      url: "https://api.deepseek.com",
      model: "deepseek-chat",
      apiKey: "sk-ds",
    });
    expect(migrated.kind).toBe("custom");
    expect(activeChat(migrated)).toEqual({
      url: DEEPSEEK_PRESET.url,
      model: "deepseek-chat",
      apiKey: "sk-ds",
    });
  });
});

describe("foldOfficialDeepSeek", () => {
  it("turns the DeepSeek preset into the active profile and keeps gateways", () => {
    const gateway = defaultCustomProfile({
      name: "中转 A",
      url: "https://www.codex5.net/v1",
      model: "gpt-5.5",
      apiKey: "sk-custom",
    });
    const folded = foldOfficialDeepSeek({
      kind: "deepseek",
      deepseek: { model: DEEPSEEK_PRESET.model, apiKey: "sk-ds" },
      customProfiles: [gateway],
      activeCustomId: gateway.id,
    });
    expect(folded.kind).toBe("custom");
    expect(folded.customProfiles).toHaveLength(2);
    expect(activeChat(folded)).toMatchObject({
      url: DEEPSEEK_PRESET.url,
      apiKey: "sk-ds",
    });
    expect(folded.customProfiles.some((item) => item.url.includes("codex5"))).toBe(true);
  });
});

describe("mergeChatProfiles", () => {
  it("does not let a DeepSeek save wipe saved custom profiles", () => {
    const gateway = defaultCustomProfile({
      name: "中转 A",
      url: "https://www.codex5.net/v1",
      model: "gpt-5.5",
      apiKey: "sk-custom",
    });
    const previous = {
      kind: "custom" as const,
      deepseek: { model: DEEPSEEK_PRESET.model, apiKey: "" },
      customProfiles: [gateway],
      activeCustomId: gateway.id,
    };
    const merged = mergeChatProfiles(previous, {
      kind: "deepseek",
      deepseek: { model: DEEPSEEK_PRESET.model, apiKey: "sk-ds" },
      customProfiles: [defaultCustomProfile({ id: gateway.id, name: "", url: "", model: "", apiKey: "" })],
      activeCustomId: gateway.id,
    });
    expect(merged.kind).toBe("custom");
    expect(activeCustomProfile(merged)).toMatchObject({
      url: DEEPSEEK_PRESET.url,
      apiKey: "sk-ds",
    });
    expect(merged.customProfiles.find((item) => item.id === gateway.id)).toMatchObject({
      url: "https://www.codex5.net/v1",
      model: "gpt-5.5",
      apiKey: "sk-custom",
    });
    expect(officialDeepSeekKey(merged)).toBe("sk-ds");
  });

  it("keeps an explicitly empty profile list", () => {
    const gateway = defaultCustomProfile({
      name: "中转 A",
      url: "https://www.codex5.net/v1",
      model: "gpt-5.5",
      apiKey: "sk-custom",
    });
    const merged = mergeChatProfiles({
      kind: "custom",
      deepseek: { model: DEEPSEEK_PRESET.model, apiKey: "sk-ds" },
      customProfiles: [gateway],
      activeCustomId: gateway.id,
    }, {
      kind: "custom",
      deepseek: { model: DEEPSEEK_PRESET.model, apiKey: "" },
      customProfiles: [],
      activeCustomId: "",
    });
    expect(merged.customProfiles).toEqual([]);
  });
});

describe("parseChatProfiles", () => {
  it("migrates legacy single custom into profiles", () => {
    const parsed = parseChatProfiles({
      kind: "custom",
      deepseek: { model: DEEPSEEK_PRESET.model, apiKey: "" },
      custom: { url: "https://agnes.example.com/v1", model: "gpt", apiKey: "sk", maxTokens: 65536 },
    });
    expect(activeCustomProfile(parsed!)?.maxTokens).toBe(65536);
    expect(parsed?.customProfiles).toHaveLength(1);
  });

  it("keeps multiple custom profiles", () => {
    const a = defaultCustomProfile({ name: "A", url: "https://a.example/v1", model: "gpt-4o", apiKey: "a" });
    const b = defaultCustomProfile({ name: "B", url: "https://b.example/v1", model: "gpt-5", apiKey: "b" });
    const parsed = parseChatProfiles({
      kind: "custom",
      deepseek: { model: DEEPSEEK_PRESET.model, apiKey: "" },
      customProfiles: [a, b],
      activeCustomId: b.id,
    });
    expect(parsed?.customProfiles).toHaveLength(2);
    expect(parsed?.activeCustomId).toBe(b.id);
    expect(activeChat(parsed!)).toEqual({
      url: "https://b.example/v1",
      model: "gpt-5",
      apiKey: "b",
    });
  });

  it("folds a stored DeepSeek kind into the list", () => {
    const parsed = parseChatProfiles({
      kind: "deepseek",
      deepseek: { model: "deepseek-v4-flash", apiKey: "sk-ds" },
      customProfiles: [],
    });
    expect(parsed?.kind).toBe("custom");
    expect(activeChat(parsed!)).toMatchObject({
      url: DEEPSEEK_PRESET.url,
      apiKey: "sk-ds",
    });
  });

  it("rejects junk", () => {
    expect(parseChatProfiles(null)).toBeUndefined();
    expect(parseChatProfiles({ kind: "other" })).toBeUndefined();
  });

  it("keeps an empty stored list", () => {
    const parsed = parseChatProfiles({
      kind: "custom",
      deepseek: { model: DEEPSEEK_PRESET.model, apiKey: "" },
      customProfiles: [],
    });
    expect(parsed?.customProfiles).toEqual([]);
  });
});

describe("buildCustomProfilesPayload", () => {
  it("updates only the active profile draft", () => {
    const a = defaultCustomProfile({ name: "A", url: "https://a/v1", model: "a", apiKey: "a" });
    const b = defaultCustomProfile({ name: "B", url: "https://b/v1", model: "b", apiKey: "b" });
    const built = buildCustomProfilesPayload([a, b], b.id, {
      name: "B2",
      url: "https://b/v1",
      model: "gpt-5",
      apiKey: "b2",
    });
    expect(built.customProfiles.find((item) => item.id === a.id)).toMatchObject({ model: "a" });
    expect(built.customProfiles.find((item) => item.id === b.id)).toMatchObject({
      name: "B2",
      model: "gpt-5",
      apiKey: "b2",
    });
  });
});
