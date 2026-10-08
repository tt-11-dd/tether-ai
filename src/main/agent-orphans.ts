import { execFileSync } from "node:child_process";

/**
 * Reap agent runtimes left behind by a previous main process.
 *
 * Why this exists: `AgentHost.start()` spawns the rpc-entry with `detached: true`
 * (macOS has no PDEATHSIG, so the parent must kill it explicitly, and detaching lets
 * us signal the whole process group). The normal exit path goes through
 * `before-quit` -> `stopAll()`, which is fine. But when the Electron main process is
 * killed with **SIGKILL** (Jetsam does exactly that under memory pressure),
 * `before-quit` never runs and the rpc-entry is reparented to launchd (`ppid=1`) and
 * **stays alive**: it still holds session.jsonl, appends to it, and keeps its model
 * connection open.
 *
 * Opening that same session afterwards makes the freshly spawned rpc-entry and this
 * orphan write the same jsonl at the same time (pi's SessionManager uses
 * `openSync(file,"wx")` for the first write and `"w"` truncation for rewrites). The
 * result is interleaved appends / EEXIST throws / clobbered writes, which the user
 * sees as "clicking send does nothing until I quit and reopen" - and quitting and
 * reopening works only because that `before-quit` also kills the new one (the orphan
 * is still there, it just did not collide that time).
 *
 * We only reap **proven orphans**: `ppid === 1` AND a command line that contains this
 * app's rpc-entry path. Both checks are required - the ppid check avoids killing a
 * worker a different Tether instance is actively using (its worker's ppid is that
 * instance's pid, not 1), and the path check avoids touching anything this app did
 * not start.
 */

export interface OrphanAgentProcess {
  pid: number;
  pgid: number;
  sessionPath?: string;
}

export interface OrphanReapReport {
  scanned: number;
  reaped: OrphanAgentProcess[];
  failed: number[];
}

function parsePsLine(line: string): OrphanAgentProcess | undefined {
  // pid ppid pgid command...
  const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line);
  if (!match) return undefined;
  const pid = Number(match[1]);
  const ppid = Number(match[2]);
  const pgid = Number(match[3]);
  const command = match[4];
  if (!Number.isFinite(pid) || pid <= 0) return undefined;
  // Only adopt processes whose parent is gone.
  if (ppid !== 1) return undefined;
  const sessionMatch = /--session\s+(\S+)/.exec(command);
  return {
    pid,
    pgid: Number.isFinite(pgid) && pgid > 0 ? pgid : pid,
    sessionPath: sessionMatch?.[1],
  };
}

export function listOrphanAgentProcesses(rpcEntryPath: string): OrphanAgentProcess[] {
  if (process.platform === "win32") return [];
  let out: string;
  try {
    out = execFileSync("ps", ["-Ao", "pid=,ppid=,pgid=,command="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch {
    return [];
  }
  const orphans: OrphanAgentProcess[] = [];
  for (const line of out.split("\n")) {
    const parsed = parsePsLine(line);
    if (!parsed) continue;
    // The command line must contain both this app's rpc-entry path and our own
    // executable; otherwise leave it alone (missing one reap is cheaper than killing
    // a user process).
    const raw = line;
    if (!raw.includes(rpcEntryPath)) continue;
    if (!raw.includes(process.execPath)) continue;
    if (parsed.pid === process.pid) continue;
    orphans.push(parsed);
  }
  return orphans;
}

function signalTree(pid: number, pgid: number, signal: NodeJS.Signals): boolean {
  let delivered = false;
  // A detached worker is its own process-group leader, so signalling the group takes
  // its spawned descendants with it (sh -lc, find, rg, ...). Only safe when pgid === pid.
  if (pgid === pid) {
    try {
      process.kill(-pgid, signal);
      delivered = true;
    } catch {
      /* group gone - fall back to a single pid */
    }
  }
  try {
    process.kill(pid, signal);
    delivered = true;
  } catch {
    /* already gone */
  }
  return delivered;
}

/**
 * Run once at startup: reap orphan runtimes left by a previous session.
 * SIGTERM first, then SIGKILL whatever is still alive after a short grace period.
 */
export async function reapOrphanedAgentHosts(
  rpcEntryPath: string,
  options: { signalGraceMs?: number } = {},
): Promise<OrphanReapReport> {
  const orphans = listOrphanAgentProcesses(rpcEntryPath);
  if (orphans.length === 0) return { scanned: 0, reaped: [], failed: [] };

  for (const orphan of orphans) signalTree(orphan.pid, orphan.pgid, "SIGTERM");

  const grace = options.signalGraceMs ?? 1_000;
  await new Promise((resolve) => setTimeout(resolve, grace));

  const failed: number[] = [];
  for (const orphan of orphans) {
    let alive = true;
    try {
      process.kill(orphan.pid, 0);
    } catch {
      alive = false;
    }
    if (!alive) continue;
    signalTree(orphan.pid, orphan.pgid, "SIGKILL");
    try {
      process.kill(orphan.pid, 0);
      failed.push(orphan.pid);
    } catch {
      /* dead */
    }
  }

  return { scanned: orphans.length, reaped: orphans, failed };
}
