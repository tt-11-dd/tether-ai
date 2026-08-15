import { describe, expect, it } from "vitest";
import { visionAgentPrompt } from "../shared/vision-api";
import visionExtension from "./vision";

function harness() {
  const handlers = new Map<string, (event: unknown) => unknown>();
  let active: string[] = [];
  visionExtension({
    registerTool() {},
    getActiveTools: () => active,
    setActiveTools: (names: string[]) => { active = names; },
    on: (event: string, handler: (event: never) => unknown) => {
      handlers.set(event, handler as (event: unknown) => unknown);
    },
  } as Parameters<typeof visionExtension>[0]);
  return {
    tools: () => active,
    fire: (event: string, payload: unknown) => handlers.get(event)?.(payload),
  };
}

describe("vision tool availability", () => {
  it("stays available on later turns once the session has an image", () => {
    const pi = harness();
    pi.fire("session_start", {});
    pi.fire("before_agent_start", { prompt: visionAgentPrompt("这是什么", ["/tmp/a.png"]) });
    expect(pi.tools()).toContain("vision");

    pi.fire("before_agent_start", { prompt: "再看看图里第二块写了什么" });
    expect(pi.tools()).toContain("vision");
    expect(pi.fire("tool_call", { toolName: "vision", input: { paths: ["/tmp/a.png"] } })).toBeUndefined();
  });

  it("follows an image path the user typed instead of pasting", () => {
    const pi = harness();
    pi.fire("session_start", {});
    pi.fire("before_agent_start", { prompt: "@/Users/me/shot.PNG 这张图里的报错是什么" });
    expect(pi.tools()).toContain("vision");
  });

  it("stays out of sessions that never had an image", () => {
    const pi = harness();
    pi.fire("session_start", {});
    pi.fire("before_agent_start", { prompt: "把按钮改成蓝色" });
    expect(pi.tools()).not.toContain("vision");
    expect(pi.fire("tool_call", { toolName: "vision", input: {} })).toMatchObject({ block: true });
  });
});
