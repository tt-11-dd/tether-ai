import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Recursively kill pid's descendants, then pid (and its process group if any) asynchronously. */
export async function killProcessTree(pid: number, signal: NodeJS.Signals = "SIGKILL"): Promise<void> {
  if (!Number.isFinite(pid) || pid <= 0) return;
  if (process.platform === "win32") {
    try {
      await execFileAsync("taskkill.exe", ["/pid", String(pid), "/t", "/f"], {
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
  const children = await listChildPids(pid);
  await Promise.all(children.map((child) => killProcessTree(child, signal)));
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

/** Synchronous version kept for crash handlers or emergency shutdown. */
export function killProcessTreeSync(pid: number, signal: NodeJS.Signals = "SIGKILL"): void {
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
  for (const child of listChildPidsSync(pid)) {
    killProcessTreeSync(child, signal);
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

export async function listChildPids(pid: number): Promise<number[]> {
  try {
    const { stdout } = await execFileAsync("pgrep", ["-P", String(pid)], {
      encoding: "utf8",
    });
    const out = stdout.trim();
    if (!out) return [];
    return out
      .split("\n")
      .map((line) => Number(line.trim()))
      .filter((value) => Number.isFinite(value) && value > 0);
  } catch {
    return [];
  }
}

export function listChildPidsSync(pid: number): number[] {
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
