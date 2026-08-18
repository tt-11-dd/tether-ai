import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listLocalSkills, resolveSkillRevealPath } from "./skills-fs";

describe("skills-fs", () => {
  const home = path.join(os.tmpdir(), `tether-skills-test-${process.pid}`);
  const skillRoot = path.join(home, ".agents/skills/demo-skill");

  afterEach(async () => {
    await fsp.rm(home, { recursive: true, force: true });
  });

  it("finds skills under ~/.agents/skills", async () => {
    await fsp.mkdir(skillRoot, { recursive: true });
    await fsp.writeFile(path.join(skillRoot, "SKILL.md"), "# demo\n");

    const original = process.env.HOME;
    process.env.HOME = home;
    try {
      expect(await listLocalSkills()).toEqual([{ name: "demo-skill", path: skillRoot }]);
      await expect(resolveSkillRevealPath("demo-skill")).resolves.toBe(path.join(skillRoot, "SKILL.md"));
    } finally {
      process.env.HOME = original;
    }
  });
});
