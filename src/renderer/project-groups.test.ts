import { describe, expect, it } from "vitest";
import type { SessionSummary, WorkspaceItem } from "../shared/types";
import { buildProjectGroups } from "./project-groups";

const workspace = (folder: string): WorkspaceItem => ({
  path: folder,
  name: folder.split("/").pop() ?? folder,
  lastOpenedAt: "2026-10-01T00:00:00.000Z",
});

const session = (
  cwd: string,
  id: string,
  updatedAt = "2026-10-01T00:00:00.000Z",
): SessionSummary => ({
  path: `/sessions/${id}.jsonl`,
  storagePath: `/sessions/${id}.jsonl`,
  id,
  cwd,
  title: id,
  createdAt: updatedAt,
  updatedAt,
  messageCount: 1,
  pinned: false,
  archived: false,
});

describe("buildProjectGroups", () => {
  it("keeps sessions whose folder is missing from the recent list", () => {
    // Regression: these sessions were dropped, so the folder looked deleted.
    const groups = buildProjectGroups(
      [workspace("/Users/me/proj")],
      [session("/Users/me/proj", "a"), session("/tmp/ghost", "b")],
      undefined,
    );

    expect(groups).toHaveLength(2);
    expect(groups[0].unlisted).toBe(false);
    expect(groups[0].sessions.map((item) => item.id)).toEqual(["a"]);

    const recovered = groups[1];
    expect(recovered.unlisted).toBe(true);
    expect(recovered.item.path).toBe("/tmp/ghost");
    expect(recovered.item.name).toBe("ghost");
    expect(recovered.sessions.map((item) => item.id)).toEqual(["b"]);
  });

  it("buckets orphan sessions by folder and orders them by latest activity", () => {
    const groups = buildProjectGroups(
      [],
      [
        session("/tmp/old", "o1", "2026-09-01T00:00:00.000Z"),
        session("/tmp/new", "n1", "2026-10-02T00:00:00.000Z"),
        session("/tmp/new", "n2", "2026-09-30T00:00:00.000Z"),
      ],
      undefined,
    );

    expect(groups.map((group) => group.item.path)).toEqual(["/tmp/new", "/tmp/old"]);
    expect(groups[0].sessions.map((item) => item.id)).toEqual(["n1", "n2"]);
    expect(groups[0].item.lastOpenedAt).toBe("2026-10-02T00:00:00.000Z");
  });

  it("matches folders case-insensitively and through trailing slashes", () => {
    const groups = buildProjectGroups(
      [workspace("/Users/Me/Proj/")],
      [session("/users/me/proj", "a")],
      undefined,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].sessions.map((item) => item.id)).toEqual(["a"]);
  });

  it("attributes cwd-less sessions to the active project", () => {
    const groups = buildProjectGroups(
      [workspace("/Users/me/proj")],
      [session("", "ghost-cwd")],
      "/Users/me/proj",
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].sessions.map((item) => item.id)).toEqual(["ghost-cwd"]);
  });

  it("still surfaces cwd-less sessions when no project is active", () => {
    const groups = buildProjectGroups(
      [workspace("/Users/me/proj")],
      [session("", "ghost-cwd")],
      undefined,
    );
    expect(groups).toHaveLength(2);
    expect(groups[1].unlisted).toBe(true);
    expect(groups[1].item.path).toBe("");
    expect(groups[1].sessions.map((item) => item.id)).toEqual(["ghost-cwd"]);
  });

  it("returns one empty group per known folder when there are no sessions", () => {
    const groups = buildProjectGroups(
      [workspace("/a"), workspace("/b")],
      [],
      undefined,
    );
    expect(groups.map((group) => group.sessions)).toEqual([[], []]);
    expect(groups.every((group) => group.unlisted === false)).toBe(true);
  });
});
