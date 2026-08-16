/** Project-relative dirs scanned by Pi when the workspace is trusted. */
export const PROJECT_SKILL_ROOTS = [".agents/skills", ".pi/skills"] as const;

/** User-global dirs (always available; not listed in workspace @ picker). */
export const USER_SKILL_ROOTS = ["~/.tether/skills", "~/.agents/skills"] as const;

export interface AgentSkillCommand {
  name: string;
  description?: string;
}

export function skillSlashCommand(name: string): string {
  const bare = name.startsWith("skill:") ? name.slice("skill:".length) : name.replace(/^\//, "");
  return `/skill:${bare}`;
}

export function parseSkillCommands(
  commands: Array<{ name: string; description?: string; source?: string }>,
): AgentSkillCommand[] {
  const skills: AgentSkillCommand[] = [];
  for (const command of commands) {
    if (command.source !== "skill") continue;
    const name = command.name.startsWith("skill:") ? command.name.slice("skill:".length) : command.name;
    if (!name) continue;
    skills.push({ name, description: command.description });
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

const SKILL_BLOCK_RE = /^<skill name="([^"]+)"[^>]*>[\s\S]*?<\/skill>(?:\n\n([\s\S]+))?$/;

/** Collapse stored `/skill:` or expanded `<skill>` user turns to a short label. */
export function skillUserDisplay(text: string): { command: string; args?: string } | undefined {
  const trimmed = text.trim();
  const slash = trimmed.match(/^\/skill:([^\s]+)(?:\s+([\s\S]+))?$/);
  if (slash) {
    return { command: `/skill:${slash[1]}`, args: slash[2]?.trim() || undefined };
  }
  const block = trimmed.match(SKILL_BLOCK_RE);
  if (block) {
    return { command: `/skill:${block[1]}`, args: block[2]?.trim() || undefined };
  }
  return undefined;
}

export function sameUserSkillTurn(a: string, b: string): boolean {
  if (a === b) return true;
  const left = skillUserDisplay(a);
  const right = skillUserDisplay(b);
  return Boolean(left && right && left.command === right.command);
}
