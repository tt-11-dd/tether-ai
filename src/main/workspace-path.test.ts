import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPathInsideRoot } from "../main/workspace-path";

describe("isPathInsideRoot", () => {
  it("accepts the root and nested files", () => {
    const root = path.resolve("/tmp/tether-ws");
    expect(isPathInsideRoot(root, root)).toBe(true);
    expect(isPathInsideRoot(root, path.join(root, "src", "a.ts"))).toBe(true);
  });

  it("rejects sibling and parent escapes", () => {
    const root = path.resolve("/tmp/tether-ws");
    expect(isPathInsideRoot(root, path.resolve("/tmp/tether-ws-evil/a"))).toBe(false);
    expect(isPathInsideRoot(root, path.resolve("/tmp/other"))).toBe(false);
    expect(isPathInsideRoot(root, path.join(root, "..", "outside"))).toBe(false);
  });
});
