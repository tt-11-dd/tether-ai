/** Redirects to /releases/tag/vX.Y.Z. The website, not api.github.com, so it skips the API quota. */
const LATEST_RELEASE_PAGE = "https://github.com/tt-11-dd/tether-ai/releases/latest";

export interface ReleaseAsset {
  name: string;
  url: string;
  size?: number;
}

type FetchRelease = (url: string, init?: RequestInit) => Promise<Response>;

/** Pulls X.Y.Z out of https://github.com/tt-11-dd/tether-ai/releases/tag/vX.Y.Z. */
export function versionFromTagUrl(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") return;
  const match = parsed.pathname.match(/^\/tt-11-dd\/tether-ai\/releases\/tag\/v(\d+\.\d+\.\d+)\/?$/);
  return match?.[1];
}

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

export async function getLatestUpdate(
  currentVersion: string,
  fetchImpl: FetchRelease,
): Promise<{ version: string; url: string } | undefined> {
  // Electron net.fetch drops the redirected URL, so the caller must use Node fetch
  // and stop at the 302. The Location header is the tag page.
  const response = await fetchImpl(LATEST_RELEASE_PAGE, {
    redirect: "manual",
    headers: { "User-Agent": `Tether/${currentVersion}` },
  });
  const location = response.headers.get("location");
  const version = location ? versionFromTagUrl(new URL(location, LATEST_RELEASE_PAGE).toString()) : undefined;
  if (!version) throw new Error(`GitHub releases responded ${response.status}`);
  if (!isNewerVersion(version, currentVersion)) return;
  return { version, url: new URL(location!, LATEST_RELEASE_PAGE).toString() };
}
