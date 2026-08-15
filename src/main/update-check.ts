const LATEST_RELEASE_API = "https://api.github.com/repos/tt-11-dd/tether-ai/releases/latest";

type Release = {
  tag_name?: unknown;
  html_url?: unknown;
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

export async function getLatestUpdate(
  currentVersion: string,
  fetchImpl: FetchRelease,
): Promise<{ version: string; url: string } | undefined> {
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
  return { version: release.tag_name.replace(/^v/, ""), url: url.toString() };
}
