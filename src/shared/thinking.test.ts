import { describe, expect, it } from "vitest";
import { inferModelReasoning, levelsForModel, levelsFromThinkingMap, normalizeEffort, pickEffortOptions, reasoningLevelsAvailable } from "./thinking";

describe("thinking effort helpers", () => {
  it("keeps the four UI tiers when the model supports them", () => {
    expect(pickEffortOptions(["off", "low", "medium", "high", "xhigh"])).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
  });

  it("maps the top tier to max when xhigh is unavailable", () => {
    expect(pickEffortOptions(["low", "medium", "high", "max"])).toEqual([
      "low",
      "medium",
      "high",
      "max",
    ]);
  });

  it("hides the picker when only off is available", () => {
    expect(reasoningLevelsAvailable(["off"])).toBe(false);
  });

  it("falls back to medium when the stored level is unsupported", () => {
    expect(normalizeEffort("xhigh", ["low", "medium", "high"])).toBe("medium");
  });

  it("drops the top tier for flash models", () => {
    expect(levelsForModel("deepseek-v4-flash")).toEqual(["low", "medium", "high"]);
    expect(levelsForModel("deepseek-v4-pro")).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });

  it("hides reasoning for plain chat models", () => {
    expect(levelsForModel("deepseek-chat")).toEqual(["off"]);
    expect(inferModelReasoning("deepseek-chat")).toBe(false);
  });

  it("hides reasoning for relay GPT models", () => {
    expect(levelsForModel("gpt-4o")).toEqual(["off"]);
    expect(levelsForModel("gpt-4o-mini")).toEqual(["off"]);
    expect(inferModelReasoning("gpt-4o")).toBe(false);
  });
});
