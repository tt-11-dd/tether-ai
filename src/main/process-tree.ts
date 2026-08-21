import { execFileSync } from "node:child_process";

/** Recursively kill pid's descendants, then pid (and its process group if any). */
export function killProcessTree(pid: number, signal: NodeJS.Signals = "SIGKILL"): void {
  if (!Number.isFinite(pid) || pid <= 0) return;
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill.exe", ["/pid", String(pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
      try {
        process.kill(pid, signal);
      } catch {
        // already gone
      }
    }
    return;
  }
  for (const child of listChildPids(pid)) {
    killProcessTree(child, signal);
  }
  try {
    process.kill(-pid, signal);
  } catch {
    // not a group leader / already gone
  }
  try {
    process.kill(pid, signal);
  } catch {
    // already gone
  }
}

function listChildPids(pid: number): number[] {
  try {
    const out = execFileSync("pgrep", ["-P", String(pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!out) return [];
    return out
      .split("\n")
      .map((line) => Number(line.trim()))
      .filter((value) => Number.isFinite(value) && value > 0);
  } catch {
    return [];
  }
}
