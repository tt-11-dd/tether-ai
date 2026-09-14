import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { downloadUpdate, installPlan, progressSnapshot } from "./update-install";

let sandbox = "";

beforeEach(async () => {
  sandbox = await mkdtemp(path.join(os.tmpdir(), "tether-update-test-"));
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

/** A release download is a plain byte stream, so the response only needs body and content-length. */
function byteResponse(chunks: Uint8Array[], total?: number): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  const headers = new Headers();
  if (total !== undefined) headers.set("content-length", String(total));
  return { ok: true, status: 200, headers, body } as unknown as Response;
}

describe("progressSnapshot", () => {
  it("reports a percentage only when the total size is known", () => {
    expect(progressSnapshot(512, 2048)).toEqual({ received: 512, total: 2048, percent: 25 });
    expect(progressSnapshot(512)).toEqual({ received: 512 });
    expect(progressSnapshot(512, 0)).toEqual({ received: 512 });
  });
});

describe("installPlan", () => {
  it("runs the NSIS installer on Windows and opens the dmg elsewhere", () => {
    expect(installPlan("win32", "C:\\tmp\\Tether-Setup-0.4.0.exe")).toEqual({
      kind: "windows-installer",
      command: "C:\\tmp\\Tether-Setup-0.4.0.exe",
      args: ["--updated"],
    });
    expect(installPlan("darwin", "/tmp/Tether-0.4.0-arm64.dmg")).toEqual({
      kind: "open-dmg",
      path: "/tmp/Tether-0.4.0-arm64.dmg",
    });
  });
});

describe("downloadUpdate", () => {
  it("writes the asset and reports monotonic progress", async () => {
    const file = path.join(sandbox, "Tether-Setup-0.4.0.exe");
    const progress: number[] = [];

    const result = await downloadUpdate({
      url: "https://example.test/setup.exe",
      file,
      fetchImpl: async () => byteResponse([new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])], 5),
      onProgress: (update) => progress.push(update.percent ?? -1),
    });

    expect(result).toEqual({ file, bytes: 5 });
    expect(progress).toEqual([60, 100]);
    await expect(readFile(file)).resolves.toEqual(Buffer.from([1, 2, 3, 4, 5]));
    // The partial file is renamed away, so a finished download is the only thing left behind.
    await expect(stat(`${file}.part`)).rejects.toThrow();
  });

  it("refuses a truncated download instead of publishing a partial installer", async () => {
    const file = path.join(sandbox, "Tether-Setup-0.4.0.exe");

    await expect(
      downloadUpdate({
        url: "https://example.test/setup.exe",
        file,
        fetchImpl: async () => byteResponse([new Uint8Array([1, 2, 3])], 9),
      }),
    ).rejects.toThrow(/stopped at 3 of 9/);
    await expect(stat(file)).rejects.toThrow();
    await expect(stat(`${file}.part`)).rejects.toThrow();
  });

  it("surfaces HTTP failures with the status code", async () => {
    const file = path.join(sandbox, "Tether-Setup-0.4.0.exe");

    await expect(
      downloadUpdate({
        url: "https://example.test/setup.exe",
        file,
        fetchImpl: async () => ({ ok: false, status: 404 }) as unknown as Response,
      }),
    ).rejects.toThrow(/HTTP 404/);
  });

  it("cleans up the partial file when the download is cancelled", async () => {
    const file = path.join(sandbox, "Tether-Setup-0.4.0.exe");
    const controller = new AbortController();

    await expect(
      downloadUpdate({
        url: "https://example.test/setup.exe",
        file,
        signal: controller.signal,
        fetchImpl: async () => {
          controller.abort();
          throw new Error("The operation was aborted");
        },
      }),
    ).rejects.toThrow(/aborted/);
    await expect(stat(`${file}.part`)).rejects.toThrow();
  });
});
