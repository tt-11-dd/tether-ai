export type QueuedPrompt = {
  id: string;
  text: string;
  images?: string[];
};

export function createQueuedPrompt(
  text: string,
  images?: string[],
): QueuedPrompt {
  return {
    id: `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    text,
    images,
  };
}

export type DispatchBlock =
  | "running"
  | "loading"
  | "sending"
  | "flushing"
  | "held"
  | "empty";

/** Undefined means the head of the queue may be sent. */
export function dispatchBlock(input: {
  running: boolean;
  loading: boolean;
  sending: boolean;
  flushing: boolean;
  held: boolean;
  queued: number;
}): DispatchBlock | undefined {
  if (input.running) return "running";
  if (input.loading) return "loading";
  if (input.sending) return "sending";
  if (input.flushing) return "flushing";
  if (input.held) return "held";
  if (input.queued <= 0) return "empty";
  return undefined;
}

/**
 * Stop and error pause the queue through that settle.
 * A new turn, or a settle that was not an interrupt, releases the pause.
 */
export function queueHeldAfter(
  event: "stop" | "error" | "start" | "settle",
  interrupted: boolean,
): boolean {
  if (event === "stop" || event === "error") return true;
  if (event === "start") return false;
  return interrupted;
}

export function withoutQueued<T extends { id: string }>(
  queue: T[],
  id: string,
): T[] {
  return queue.filter((entry) => entry.id !== id);
}

export function restoreQueued<T extends { id: string }>(
  queue: T[],
  item: T,
): T[] {
  if (queue.some((entry) => entry.id === item.id)) return queue;
  return [item, ...queue];
}
