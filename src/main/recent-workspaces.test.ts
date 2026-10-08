import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  RECENT_WORKSPACE_LIMIT,
  createRecentWorkspaceStore,
} from "./recent-workspaces";

describe("createRecentWorkspaceStore", () => {
  let dir: string;
  let file: string;

  const store = (limit?: number) =>
    createRecentWorkspaceStore({
      file,
      limit,
      notAFolderMessage: () => "not a folder",
    });

  const folders = async (count: number, from = 0): Promise<string[]> => {
    const out: string[] = [];
    for (let i = from; i < from + count; i += 1) {
      const folder = path.join(dir, `p${i}`);
      await mkdir(folder, { recursive: true });
      out.push(folder);
    }
    return out;
  };

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "tether-recent-"));
    file = path.join(dir, "recent-workspaces.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("keeps folders past the twelfth touch", async () => {
    // Regression: the old 12-entry cap trimmed on every touch, so the 13th folder evicted the
    // first one and its whole sidebar group disappeared while its sessions stayed on disk.
    const recent = store();
    const opened = await folders(20);
    for (const folder of opened) await recent.touch(folder);

    const list = await recent.list();
    expect(list).toHaveLength(20);
    expect([...list.map((item) => item.path)].sort()).toEqual([...opened].sort());
    expect(list[0].path).toBe(opened[19]);
  });

  it("re-touching moves a folder to the front without duplicating it", async () => {
    const recent = store();
    const [a, b, c] = await folders(3);
    await recent.touch(a);
    await recent.touch(b);
    await recent.touch(c);
    await recent.touch(a);

    const list = await recent.list();
    expect(list.map((item) => item.path)).toEqual([a, c, b]);
  });

  it("still enforces an explicit hard cap on disk", async () => {
    const recent = store(3);
    const opened = await folders(5);
    for (const folder of opened) await recent.touch(folder);

    const list = await recent.list();
    expect(list.map((item) => item.path)).toEqual([
      opened[4],
      opened[3],
      opened[2],
    ]);
    expect(JSON.parse(await readFile(file, "utf8"))).toHaveLength(3);
  });

  it("defaults to the generous cap", () => {
    expect(RECENT_WORKSPACE_LIMIT).toBeGreaterThan(12);
  });

  it("rejects a path that is not a folder", async () => {
    const recent = store();
    const notAFolder = path.join(dir, "notes.txt");
    await writeFile(notAFolder, "hello");
    await expect(recent.touch(notAFolder)).rejects.toThrow("not a folder");
  });

  it("resolves relative paths and keeps the last name component", async () => {
    const recent = store();
    const [folder] = await folders(1);
    const resolved = await recent.touch(folder);
    expect(resolved).toBe(folder);
    expect((await recent.list())[0].name).toBe(path.basename(folder));
  });

  it("survives a missing or corrupt file", async () => {
    const recent = store();
    expect(await recent.list()).toEqual([]);
    await writeFile(file, "{not json");
    expect(await recent.list()).toEqual([]);
    await writeFile(file, JSON.stringify([{ path: 1 }, null, "nope"]));
    expect(await recent.list()).toEqual([]);
  });

  it("forgets a folder and persists the shorter list", async () => {
    const recent = store();
    const [a, b] = await folders(2);
    await recent.touch(a);
    await recent.touch(b);

    const next = await recent.forget(a);
    expect(next.map((item) => item.path)).toEqual([b]);
    expect((await recent.list()).map((item) => item.path)).toEqual([b]);
    // Forgetting something that was never there is a no-op, not an error.
    expect((await recent.forget(a)).map((item) => item.path)).toEqual([b]);
  });
});
