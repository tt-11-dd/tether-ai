import { describe, expect, it } from "vitest";
import {
  getLatestUpdate,
  isNewerVersion,
  pickReleaseAsset,
  releaseAssetName,
  type ReleaseAsset,
} from "./update-check";

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
      assets: [
        { name: "Tether-Setup-0.1.1.exe", browser_download_url: "https://example.test/setup.exe", size: 120 },
        { name: "Tether-Setup-0.1.1.exe.blockmap", browser_download_url: "https://example.test/setup.exe.blockmap" },
        { name: "notes", browser_download_url: 42 },
        { name: "Tether-Setup-0.1.1-insecure.exe", browser_download_url: "http://insecure.test/setup.exe" },
      ],
    }));

    await expect(getLatestUpdate("0.1.0", fetchImpl)).resolves.toEqual({
      version: "0.1.1",
      url: "https://github.com/tt-11-dd/tether-ai/releases/tag/v0.1.1",
      assets: [
        { name: "Tether-Setup-0.1.1.exe", url: "https://example.test/setup.exe", size: 120 },
        { name: "Tether-Setup-0.1.1.exe.blockmap", url: "https://example.test/setup.exe.blockmap" },
      ],
    });
  });
});

describe("pickReleaseAsset", () => {
  const assets: ReleaseAsset[] = [
    { name: "Tether-Setup-0.1.1.exe", url: "https://example.test/setup.exe", size: 120 },
    { name: "Tether-Setup-0.1.1.exe.blockmap", url: "https://example.test/setup.exe.blockmap" },
    { name: "Tether-0.1.1-arm64.dmg", url: "https://example.test/arm64.dmg" },
    { name: "Tether-0.1.1-x64.dmg", url: "https://example.test/x64.dmg" },
  ];

  it("matches the artifact names electron-builder publishes", () => {
    expect(releaseAssetName("win32", "x64", "0.1.1")).toBe("Tether-Setup-0.1.1.exe");
    expect(releaseAssetName("darwin", "arm64", "0.1.1")).toBe("Tether-0.1.1-arm64.dmg");
    expect(releaseAssetName("linux", "x64", "0.1.1")).toBeUndefined();
  });

  it("prefers the installer for this platform and never the blockmap", () => {
    expect(pickReleaseAsset(assets, "win32", "x64", "0.1.1")?.url).toBe("https://example.test/setup.exe");
    expect(pickReleaseAsset(assets, "darwin", "arm64", "0.1.1")?.url).toBe("https://example.test/arm64.dmg");
  });

  it("falls back to a renamed build for the same version", () => {
    const renamed: ReleaseAsset[] = [{ name: "Tether-0.1.1-universal.dmg", url: "https://example.test/universal.dmg" }];
    expect(pickReleaseAsset(renamed, "darwin", "arm64", "0.1.1")?.name).toBe("Tether-0.1.1-universal.dmg");
    expect(pickReleaseAsset(assets, "darwin", "arm64", "0.1.2")).toBeUndefined();
  });

  it("has nothing to install on platforms without a published installer", () => {
    expect(pickReleaseAsset(assets, "linux", "x64", "0.1.1")).toBeUndefined();
  });
});
