const LATEST_RELEASE_API = "https://api.github.com/repos/tt-11-dd/tether-ai/releases/latest";

export interface ReleaseAsset {
  name: string;
  url: string;
  size?: number;
}

type Release = {
  tag_name?: unknown;
  html_url?: unknown;
  assets?: unknown;
};

type FetchRelease = (url: string, init?: RequestInit) => Promise<Response>;

function versionParts(version: string): number[] | undefined {
  const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  return match?.slice(1).map(Number);
}

export function isNewerVersion(latest: string, current: string): boolean {
  const next = versionParts(latest);
  const installed = versionParts(current);
  if (!next || !installed) return false;
  for (let index = 0; index < next.length; index += 1) {
    if (next[index] !== installed[index]) return next[index]! > installed[index]!;
  }
  return false;
}

/**
 * The artifact names this app publishes, mirroring electron-builder.yml: the Windows installer sets
 * `artifactName` explicitly, the macOS dmg keeps the builder default. Change both together.
 */
export function releaseAssetName(
  platform: NodeJS.Platform,
  arch: string,
  version: string,
): string | undefined {
  if (platform === "win32") return `Tether-Setup-${version}.exe`;
  if (platform === "darwin") return `Tether-${version}-${arch}.dmg`;
  return undefined;
}

/**
 * Picks this machine's installer out of a release. The exact artifact name wins; a renamed build for
 * the same platform and version still updates instead of silently reporting nothing to install.
 * `.exe.blockmap` never matches because the suffix check runs against the whole name.
 */
export function pickReleaseAsset(
  assets: readonly ReleaseAsset[],
  platform: NodeJS.Platform,
  arch: string,
  version: string,
): ReleaseAsset | undefined {
  const exact = releaseAssetName(platform, arch, version);
  if (exact) {
    const match = assets.find((asset) => asset.name === exact);
    if (match) return match;
  }
  const suffix = platform === "win32" ? ".exe" : platform === "darwin" ? ".dmg" : undefined;
  if (!suffix) return undefined;
  return assets.find((asset) => asset.name.endsWith(suffix) && asset.name.includes(version));
}

function parseAssets(raw: unknown): ReleaseAsset[] {
  if (!Array.isArray(raw)) return [];
  const assets: ReleaseAsset[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const { name, browser_download_url: url, size } = record;
    // The download URL comes from the release index, so only plain https assets are accepted.
    if (typeof name !== "string" || !name.trim()) continue;
    if (typeof url !== "string" || !url.startsWith("https://")) continue;
    assets.push({
      name,
      url,
      ...(typeof size === "number" && Number.isFinite(size) ? { size } : {}),
    });
  }
  return assets;
}

export async function getLatestUpdate(
  currentVersion: string,
  fetchImpl: FetchRelease,
): Promise<{ version: string; url: string; assets: ReleaseAsset[] } | undefined> {
  const response = await fetchImpl(LATEST_RELEASE_API, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": `Tether/${currentVersion}`,
    },
  });
  if (!response.ok) return;

  const release = await response.json() as Release;
  if (typeof release.tag_name !== "string" || typeof release.html_url !== "string") return;
  if (!isNewerVersion(release.tag_name, currentVersion)) return;

  const url = new URL(release.html_url);
  if (url.protocol !== "https:" || url.hostname !== "github.com") return;
  return {
    version: release.tag_name.replace(/^v/, ""),
    url: url.toString(),
    assets: parseAssets(release.assets),
  };
}
