import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, parseTheme } from "./theme";

describe("parseTheme", () => {
  it("accepts the three themes", () => {
    expect(parseTheme("white")).toBe("white");
    expect(parseTheme("paper")).toBe("paper");
    expect(parseTheme("dark")).toBe("dark");
  });

  it("falls back to paper", () => {
    expect(parseTheme(null)).toBe(DEFAULT_THEME);
    expect(parseTheme("solarized")).toBe("paper");
  });
});
