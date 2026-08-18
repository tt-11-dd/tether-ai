import { describe, expect, it } from "vitest";
import { parseSkillCommands, sameUserSkillTurn, skillSlashCommand, skillUserDisplay } from "./skills";

describe("skills", () => {
  it("builds slash ids", () => {
    expect(skillSlashCommand("init-long-run")).toBe("/skill:init-long-run");
    expect(skillSlashCommand("skill:plan-then-act")).toBe("/skill:plan-then-act");
  });

  it("parses rpc skill commands", () => {
    expect(
      parseSkillCommands([
        {
          name: "skill:init-long-run",
          description: "Init",
          source: "skill",
          sourceInfo: { baseDir: "/home/.agents/skills/init-long-run", path: "/home/.agents/skills/init-long-run/SKILL.md" },
        },
        { name: "/compact", source: "prompt" },
        { name: "skill:plan-then-act", description: "Plan", source: "skill" },
      ]),
    ).toEqual([
      { name: "init-long-run", description: "Init", path: "/home/.agents/skills/init-long-run/SKILL.md" },
      { name: "plan-then-act", description: "Plan" },
    ]);
  });

  it("collapses skill user text to a tag", () => {
    expect(skillUserDisplay("/skill:frontend-design")).toEqual({ command: "/skill:frontend-design" });
    expect(skillUserDisplay('<skill name="frontend-design" location="/x">\nbody\n</skill>')).toEqual({
      command: "/skill:frontend-design",
    });
    expect(sameUserSkillTurn("/skill:foo", '<skill name="foo" location="/x">\nbody\n</skill>')).toBe(true);
  });
});
