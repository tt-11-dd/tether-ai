import type { SessionSummary, WorkspaceItem } from "../shared/types";
import { baseName, isSamePath } from "./conversation";

export interface ProjectGroup {
  item: WorkspaceItem;
  sessions: SessionSummary[];
  /**
   * True when the folder has no entry in `recent-workspaces.json` and this group was rebuilt
   * from session history. Before 2026-10-03 these sessions were dropped from the sidebar
   * entirely, which made a folder look deleted after its recent-entry was evicted.
   */
  unlisted: boolean;
}

/**
 * Group sessions under their workspace folders.
 *
 * Sessions are matched to `workspaces` by path; anything left over is *not* discarded — it is
 * bucketed by `cwd` into a recovered, `unlisted` group so a folder can never silently vanish
 * from the sidebar just because it fell off the recent list.
 */
export function buildProjectGroups(
  workspaces: readonly WorkspaceItem[],
  sessions: readonly SessionSummary[],
  activeWorkspace?: string,
): ProjectGroup[] {
  const groups: ProjectGroup[] = workspaces.map((item) => ({
    item,
    sessions: [],
    unlisted: false,
  }));
  const active = activeWorkspace
    ? groups.find((group) => isSamePath(group.item.path, activeWorkspace))
    : undefined;
  const orphans = new Map<string, SessionSummary[]>();

  for (const session of sessions) {
    const match = groups.find((group) => isSamePath(group.item.path, session.cwd));
    if (match) {
      match.sessions.push(session);
      continue;
    }
    // Sessions that never recorded a cwd can only be attributed to whatever project is
    // currently open; keep that behaviour instead of inventing an empty folder.
    if (active && (!session.cwd || isSamePath(session.cwd, active.item.path))) {
      active.sessions.push(session);
      continue;
    }
    const key = session.cwd || "";
    const bucket = orphans.get(key);
    if (bucket) bucket.push(session);
    else orphans.set(key, [session]);
  }

  if (orphans.size === 0) return groups;

  const recovered: ProjectGroup[] = [];
  for (const [cwd, list] of orphans) {
    const latest = list.reduce(
      (acc, session) => (session.updatedAt > acc ? session.updatedAt : acc),
      "",
    );
    recovered.push({
      item: {
        path: cwd,
        name: cwd ? baseName(cwd) : "",
        lastOpenedAt: latest,
      },
      sessions: list,
      unlisted: true,
    });
  }
  recovered.sort((a, b) =>
    a.item.lastOpenedAt < b.item.lastOpenedAt ? 1 : a.item.lastOpenedAt > b.item.lastOpenedAt ? -1 : 0,
  );
  return [...groups, ...recovered];
}
