import { describe, expect, it } from "vitest";
import { listOpenAiModels, modelsUrl, parseOpenAiModels } from "./openai-models";

describe("modelsUrl", () => {
  it("appends /models to an OpenAI-compatible base", () => {
    expect(modelsUrl("https://www.codex5.net/v1")).toBe("https://www.codex5.net/v1/models");
    expect(modelsUrl("https://www.codex5.net/v1/")).toBe("https://www.codex5.net/v1/models");
  });

  it("does not double /models", () => {
    expect(modelsUrl("https://api.example.com/v1/models")).toBe("https://api.example.com/v1/models");
  });

  it("strips chat/completions so vision endpoints still hit /models", () => {
    expect(modelsUrl("https://open.bigmodel.cn/api/paas/v4/chat/completions"))
      .toBe("https://open.bigmodel.cn/api/paas/v4/models");
  });
});

describe("parseOpenAiModels", () => {
  it("reads OpenAI { data: [{ id }] }", () => {
    expect(parseOpenAiModels({
      object: "list",
      data: [{ id: "gpt-5.5" }, { id: "deepseek-v4-flash" }, { id: "gpt-5.5" }],
    })).toEqual(["deepseek-v4-flash", "gpt-5.5"]);
  });

  it("accepts string arrays and { models }", () => {
    expect(parseOpenAiModels(["b", "a"])).toEqual(["a", "b"]);
    expect(parseOpenAiModels({ models: [{ id: "glm-4v-flash" }] })).toEqual(["glm-4v-flash"]);
  });
});

describe("listOpenAiModels", () => {
  it("GETs /models with the bearer key", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ data: [{ id: "gpt-5.5" }] }), { status: 200 });
    };
    await expect(listOpenAiModels("https://api.example.com/v1", "sk-test", fetchImpl))
      .resolves.toEqual(["gpt-5.5"]);
    expect(calls[0]?.url).toBe("https://api.example.com/v1/models");
    expect((calls[0]?.init?.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
  });

  it("surfaces API error text", async () => {
    const fetchImpl: typeof fetch = async () => new Response(
      JSON.stringify({ error: { message: "Incorrect API key" } }),
      { status: 401 },
    );
    await expect(listOpenAiModels("https://api.example.com/v1", "bad", fetchImpl))
      .rejects.toThrow("Incorrect API key");
  });
});
