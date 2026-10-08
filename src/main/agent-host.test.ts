import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../shared/types";
import { AgentHost } from "./agent-host";

/**
 * 2026-10-03 P0 回归：会话卡死（输入发不出去、只能退出重开）的两个机制性成因。
 *
 *  1. Pi runtime 在 isStreaming 时对不带 streamingBehavior 的 prompt 直接抛错。
 *     渲染层 running 与子进程 _isAgentRunActive 是两个独立标志，错开一次就会命中，
 *     并把主进程 busy 永久留在 true。
 *  2. 主进程 busy 只由事件流驱动，漏掉 agent_settled 就再无回落路径。
 */

interface FakeChild {
  exitCode: number | null;
  pid: undefined;
  stdin: { destroyed: boolean; write: (line: string) => boolean };
  stdout: { on: () => void };
  stderr: { on: () => void };
  once: () => void;
}

function attachFakeChild(host: AgentHost): string[] {
  const writes: string[] = [];
  const child: FakeChild = {
    exitCode: null,
    pid: undefined,
    stdin: {
      destroyed: false,
      write: (line: string) => {
        writes.push(line);
        return true;
      },
    },
    stdout: { on: () => undefined },
    stderr: { on: () => undefined },
    once: () => undefined,
  };
  (host as unknown as { child: FakeChild }).child = child;
  return writes;
}

/** 请求是悬挂的（没有 response），用 handleExit 收尾，避免 30 分钟的 RPC 定时器吊住测试。 */
function teardown(host: AgentHost): void {
  (host as unknown as { handleExit(error: Error): void }).handleExit(new Error("test teardown"));
}

function makeHost(events: AgentEvent[] = []): AgentHost {
  return new AgentHost(
    (event) => events.push(event),
    () => undefined,
  );
}

describe("AgentHost prompt queueing (P0)", () => {
  it("injects a default followUp so a prompt sent mid-stream queues instead of throwing", () => {
    const host = makeHost();
    const writes = attachFakeChild(host);
    void host.request("prompt", { message: "hi" }).catch(() => undefined);
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0])).toMatchObject({
      type: "prompt",
      message: "hi",
      streamingBehavior: "followUp",
    });
    teardown(host);
  });

  it("keeps an explicit streamingBehavior (steer) instead of overwriting it", () => {
    const host = makeHost();
    const writes = attachFakeChild(host);
    void host.request("prompt", { message: "hi", streamingBehavior: "steer" }).catch(() => undefined);
    expect(JSON.parse(writes[0]).streamingBehavior).toBe("steer");
    teardown(host);
  });

  it("does not add streamingBehavior to steer / abort / get_state", () => {
    const host = makeHost();
    const writes = attachFakeChild(host);
    void host.request("steer", { message: "hi" }).catch(() => undefined);
    void host.request("get_state").catch(() => undefined);
    for (const line of writes) {
      expect(JSON.parse(line)).not.toHaveProperty("streamingBehavior");
    }
    teardown(host);
  });
});

describe("AgentHost busy reconciliation (P0)", () => {
  it("clears a stuck busy flag and emits agent_settled after two idle probes", async () => {
    const events: AgentEvent[] = [];
    const host = makeHost(events);
    const internal = host as unknown as {
      busy: boolean;
      request(type: string): Promise<unknown>;
      probeIdle(): Promise<void>;
    };
    attachFakeChild(host);
    internal.busy = true;
    internal.request = async () => ({ isStreaming: false, pendingMessageCount: 0 });

    await internal.probeIdle();
    expect(internal.busy).toBe(true); // 一次空闲不足以判定，避开“prompt 已发、agent_start 未到”的窗口
    await internal.probeIdle();
    expect(internal.busy).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: "agent_settled", reconciled: true });
    teardown(host);
  });

  it("keeps busy while the runtime is still streaming or has queued messages", async () => {
    const events: AgentEvent[] = [];
    const host = makeHost(events);
    const internal = host as unknown as {
      busy: boolean;
      request(type: string): Promise<unknown>;
      probeIdle(): Promise<void>;
    };
    attachFakeChild(host);
    internal.busy = true;
    internal.request = async () => ({ isStreaming: true, pendingMessageCount: 0 });
    await internal.probeIdle();
    await internal.probeIdle();
    expect(internal.busy).toBe(true);

    internal.request = async () => ({ isStreaming: false, pendingMessageCount: 1 });
    await internal.probeIdle();
    await internal.probeIdle();
    expect(internal.busy).toBe(true); // 还有排队消息 = 这一轮没真正结束，不能回落
    expect(events).toHaveLength(0);
    teardown(host);
  });
});
