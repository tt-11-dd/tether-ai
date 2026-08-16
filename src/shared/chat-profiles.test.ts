import { describe, expect, it } from "vitest";
import { activeChat, DEEPSEEK_PRESET, mergeChatProfiles, migrateChatProfiles, parseChatProfiles } from "./chat-profiles";

describe("migrateChatProfiles", () => {
  it("keeps a custom gateway on the custom slot", () => {
    expect(migrateChatProfiles({
      url: "https://www.codex5.net/v1",
      model: "gpt-5.5",
      apiKey: "sk-custom",
    })).toEqual({
      kind: "custom",
      deepseek: { model: DEEPSEEK_PRESET.model, apiKey: "" },
      custom: { url: "https://www.codex5.net/v1", model: "gpt-5.5", apiKey: "sk-custom" },
    });
  });

  it("puts the official DeepSeek URL on the preset slot", () => {
    expect(migrateChatProfiles({
      url: "https://api.deepseek.com",
      model: "deepseek-chat",
      apiKey: "sk-ds",
    }).deepseek).toEqual({ model: "deepseek-chat", apiKey: "sk-ds" });
  });
});

describe("mergeChatProfiles", () => {
  it("does not let a DeepSeek save wipe the custom slot", () => {
    const previous = migrateChatProfiles({
      url: "https://www.codex5.net/v1",
      model: "gpt-5.5",
      apiKey: "sk-custom",
    });
    const merged = mergeChatProfiles(previous, {
      kind: "deepseek",
      deepseek: { model: DEEPSEEK_PRESET.model, apiKey: "sk-ds" },
      custom: { url: "", model: "", apiKey: "" },
    });
    expect(merged.kind).toBe("deepseek");
    expect(merged.custom).toEqual({ url: "https://www.codex5.net/v1", model: "gpt-5.5", apiKey: "sk-custom" });
    expect(activeChat(merged)).toEqual({
      url: DEEPSEEK_PRESET.url,
      model: DEEPSEEK_PRESET.model,
      apiKey: "sk-ds",
    });
  });
});

describe("parseChatProfiles", () => {
  it("keeps a custom maxTokens on the custom slot", () => {
    expect(parseChatProfiles({
      kind: "custom",
      deepseek: { model: DEEPSEEK_PRESET.model, apiKey: "" },
      custom: { url: "https://agnes.example.com/v1", model: "gpt", apiKey: "sk", maxTokens: 65536 },
    })?.custom.maxTokens).toBe(65536);
  });

  it("rejects junk", () => {
    expect(parseChatProfiles(null)).toBeUndefined();
    expect(parseChatProfiles({ kind: "other" })).toBeUndefined();
  });
});
