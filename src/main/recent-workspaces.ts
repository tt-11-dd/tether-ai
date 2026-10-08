import fsp from "node:fs/promises";
import path from "node:path";
import type { WorkspaceItem } from "../shared/types";

/**
 * `recent-workspaces.json` feeds the renderer's project sidebar. It used to be capped at 12
 * entries **and** trimmed on every `touch()`, so opening a 13th folder silently evicted an
 * older one and that folder's whole group disappeared from the sidebar even though its
 * sessions were still on disk (2026-10-03 report).
 *
 * Keep the cap generous instead of small: the file is a few KB and the sidebar's cost is
 * dominated by the session list, not by the folder list. Anything older than the cap is still
 * recovered by the renderer from session history (`buildProjectGroups`), so this number is a
 * garbage-collection threshold, not a display limit.
 */
export const RECENT_WORKSPACE_LIMIT = 200;

export interface RecentWorkspaceStore {
  list(): Promise<WorkspaceItem[]>;
  touch(workspacePath: string): Promise<string>;
  forget(workspacePath: string): Promise<WorkspaceItem[]>;
}

export interface RecentWorkspaceStoreOptions {
  /** Absolute path of `recent-workspaces.json`. */
  file: string;
  /** Hard cap on persisted entries; defaults to {@link RECENT_WORKSPACE_LIMIT}. */
  limit?: number;
  /** Localized "not a folder" message. Injected so this module owns no i18n state. */
  notAFolderMessage: () => string;
}

export function isWorkspaceItem(value: unknown): value is WorkspaceItem {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as WorkspaceItem).path === "string" &&
      typeof (value as WorkspaceItem).name === "string" &&
      typeof (value as WorkspaceItem).lastOpenedAt === "string",
  );
}

export function createRecentWorkspaceStore(
  options: RecentWorkspaceStoreOptions,
): RecentWorkspaceStore {
  const { file } = options;
  const limit = options.limit ?? RECENT_WORKSPACE_LIMIT;

  async function list(): Promise<WorkspaceItem[]> {
    try {
      const parsed = JSON.parse(await fsp.readFile(file, "utf8")) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isWorkspaceItem).slice(0, limit);
    } catch {
      return [];
    }
  }

  async function write(items: WorkspaceItem[]): Promise<void> {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, `${JSON.stringify(items, null, 2)}\n`, { mode: 0o600 });
  }

  return {
    list,
    async touch(workspacePath: string): Promise<string> {
      const resolved = path.resolve(workspacePath);
      const stat = await fsp.stat(resolved);
      if (!stat.isDirectory()) throw new Error(options.notAFolderMessage());
      const current = await list();
      const next = [
        {
          path: resolved,
          name: path.basename(resolved) || resolved,
          lastOpenedAt: new Date().toISOString(),
        },
        ...current.filter((item) => item.path !== resolved),
      ].slice(0, limit);
      await write(next);
      return resolved;
    },
    async forget(workspacePath: string): Promise<WorkspaceItem[]> {
      const next = (await list()).filter((item) => item.path !== workspacePath);
      await write(next);
      return next;
    },
  };
}
