import { describe, expect, it } from "vitest";
import { drainUtf8Lines } from "./rpc-lines";

describe("drainUtf8Lines", () => {
  it("keeps UTF-8 characters intact when a line spans stdout chunks", () => {
    const payload = JSON.stringify({ type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "消除散落在 JSX 里的重复动画对象" }] } });
    const bytes = Buffer.from(`${payload}\n`, "utf8");
    const split = bytes.indexOf("散") + 1;
    let rest = Buffer.alloc(0);
    const first = drainUtf8Lines(rest, bytes.subarray(0, split));
    rest = Buffer.from(first.rest);
    expect(first.lines).toEqual([]);
    const second = drainUtf8Lines(rest, bytes.subarray(split));
    expect(second.lines).toHaveLength(1);
    expect(JSON.parse(second.lines[0]!).message.content[0].text).toBe("消除散落在 JSX 里的重复动画对象");
  });
});
