import { describe, expect, it } from "vitest";
import { dispatchBlock, queueHeldAfter, restoreQueued, withoutQueued } from "./queue";

const open = { running: false, loading: false, sending: false, flushing: false, held: false, queued: 1 };

describe("dispatchBlock", () => {
  it("allows dispatch only when the session is idle and the queue is open", () => {
    expect(dispatchBlock(open)).toBeUndefined();
    expect(dispatchBlock({ ...open, sending: true })).toBe("sending");
    expect(dispatchBlock({ ...open, held: true })).toBe("held");
    expect(dispatchBlock({ ...open, queued: 0 })).toBe("empty");
  });
});

describe("queueHeldAfter", () => {
  it("keeps a pause through the interrupted settle and releases it on the next turn", () => {
    expect(queueHeldAfter("stop", false)).toBe(true);
    expect(queueHeldAfter("error", false)).toBe(true);
    expect(queueHeldAfter("settle", true)).toBe(true);
    expect(queueHeldAfter("settle", false)).toBe(false);
    expect(queueHeldAfter("start", true)).toBe(false);
  });
});

describe("restoreQueued", () => {
  it("puts a rejected item back at the front once", () => {
    const item = { id: "a", text: "later" };
    const rest = [{ id: "b", text: "next" }];
    expect(restoreQueued(withoutQueued([item, ...rest], "a"), item)).toEqual([item, ...rest]);
    expect(restoreQueued([item], item)).toEqual([item]);
  });
});
