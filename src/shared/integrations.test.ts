import { describe, expect, it } from "vitest";
import {
  mcpServerFromLine,
  mergeWebSearchConfig,
  parseDeepSeekBalance,
  parseMcpServers,
  parseWebSearchCard,
  parseWebSearchConfig,
  serializeMcpServers,
} from "./integrations";

describe("web search config", () => {
  it("keeps unknown keys and forces auto-summary", () => {
    const merged = mergeWebSearchConfig(
      { workflow: "summary-review", openaiApiKey: "keep", braveApiKey: "old" },
      { workflow: "auto-summary", braveApiKey: "new", tavilyApiKey: "tv" },
    );
    expect(merged).toMatchObject({
      workflow: "auto-summary",
      openaiApiKey: "keep",
      braveApiKey: "new",
      tavilyApiKey: "tv",
    });
    expect(parseWebSearchConfig(merged).braveApiKey).toBe("new");
  });
});

describe("mcp config", () => {
  it("round-trips stdio and http servers", () => {
    const rows = parseMcpServers({
      mcpServers: {
        docs: { command: "npx", args: ["-y", "docs"] },
        linear: { url: "https://mcp.linear.app/sse" },
      },
    });
    expect(rows.map((item) => item.kind)).toEqual(["stdio", "http"]);
    expect(serializeMcpServers(rows).mcpServers.linear).toEqual({ url: "https://mcp.linear.app/sse" });
    expect(mcpServerFromLine("gh", "npx -y github")).toEqual({
      name: "gh",
      kind: "stdio",
      command: "npx",
      args: ["-y", "github"],
    });
  });
});

describe("deepseek balance", () => {
  it("reads total_balance rows", () => {
    expect(parseDeepSeekBalance({
      is_available: true,
      balance_infos: [{ currency: "CNY", total_balance: "12.50" }],
    })).toEqual({
      available: true,
      items: [{ currency: "CNY", total: "12.50" }],
    });
  });
});

describe("web search card", () => {
  it("prefers curated sources then markdown links", () => {
    const card = parseWebSearchCard(
      "web_search",
      { query: "vite rolldown" },
      {
        totalResults: 2,
        curatedQueries: [{
          sources: [{ title: "Vite", url: "https://vite.dev" }],
        }],
      },
      "[Other](https://example.com)",
    );
    expect(card).toMatchObject({
      query: "vite rolldown",
      count: 2,
      sources: [
        { title: "Vite", url: "https://vite.dev" },
        { title: "Other", url: "https://example.com" },
      ],
    });
  });
});
