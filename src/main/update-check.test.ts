import { describe, expect, it } from "vitest";
import { getLatestUpdate, isNewerVersion } from "./update-check";

describe("isNewerVersion", () => {
  it("compares release versions in semantic order", () => {
    expect(isNewerVersion("v0.1.1", "0.1.0")).toBe(true);
    expect(isNewerVersion("v0.2.0", "0.10.0")).toBe(false);
    expect(isNewerVersion("v1.0.0", "0.10.0")).toBe(true);
    expect(isNewerVersion("v0.1.0", "0.1.0")).toBe(false);
  });
});

describe("getLatestUpdate", () => {
  it("returns a newer GitHub release", async () => {
    const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
      tag_name: "v0.1.1",
      html_url: "https://github.com/tt-11-dd/tether-ai/releases/tag/v0.1.1",
    }));

    await expect(getLatestUpdate("0.1.0", fetchImpl)).resolves.toEqual({
      version: "0.1.1",
      url: "https://github.com/tt-11-dd/tether-ai/releases/tag/v0.1.1",
    });
  });
});
