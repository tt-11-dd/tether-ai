import { describe, expect, it } from "vitest";
import { isLocale, resolveLocale, t } from "./i18n";

describe("resolveLocale", () => {
  it("prefers a stored locale", () => {
    expect(resolveLocale("en", ["zh-CN"])).toBe("en");
    expect(resolveLocale("zh", ["en-US"])).toBe("zh");
  });

  it("falls back to system languages then zh", () => {
    expect(resolveLocale(undefined, ["en-US", "zh-CN"])).toBe("en");
    expect(resolveLocale(null, ["zh-Hans-CN"])).toBe("zh");
    expect(resolveLocale("nope", ["fr-FR"])).toBe("zh");
  });
});

describe("isLocale", () => {
  it("accepts only zh/en", () => {
    expect(isLocale("zh")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("ja")).toBe(false);
  });
});

describe("t", () => {
  it("interpolates variables and falls back to zh", () => {
    expect(t("zh", "update.available", { version: "0.2.0" })).toContain("0.2.0");
    expect(t("en", "update.ok")).toBe("OK");
    expect(t("en", "common.minutesAgo", { n: 3 })).toBe("3m ago");
  });
});
