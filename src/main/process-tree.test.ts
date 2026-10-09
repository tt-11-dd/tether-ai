import { describe, expect, it } from "vitest";
import {
  killProcessTree,
  killProcessTreeSync,
  listChildPids,
  listChildPidsSync,
} from "./process-tree";

describe("process-tree", () => {
  it("safely handles invalid and non-positive pids in async mode", async () => {
    await expect(killProcessTree(-1)).resolves.toBeUndefined();
    await expect(killProcessTree(0)).resolves.toBeUndefined();
    await expect(killProcessTree(Number.NaN)).resolves.toBeUndefined();
  });

  it("safely handles invalid and non-positive pids in sync mode", () => {
    expect(() => killProcessTreeSync(-1)).not.toThrow();
    expect(() => killProcessTreeSync(0)).not.toThrow();
    expect(() => killProcessTreeSync(Number.NaN)).not.toThrow();
  });

  it("returns empty array for non-existent pids when listing children", async () => {
    // 99999999 is extraordinarily unlikely to exist as a process
    const childrenAsync = await listChildPids(99999999);
    expect(childrenAsync).toEqual([]);

    const childrenSync = listChildPidsSync(99999999);
    expect(childrenSync).toEqual([]);
  });

  it("returns an array of numbers when querying current process children", async () => {
    const children = await listChildPids(process.pid);
    expect(Array.isArray(children)).toBe(true);
    for (const pid of children) {
      expect(typeof pid).toBe("number");
      expect(pid).toBeGreaterThan(0);
    }
  });
});
