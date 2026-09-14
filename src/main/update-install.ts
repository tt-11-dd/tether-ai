import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";
import type { UpdateProgress } from "../shared/types";

type FetchUpdate = (url: string, init?: RequestInit) => Promise<Response>;

/** GitHub serves release assets as plain bytes, so content-length is the real file size. */
export function progressSnapshot(received: number, total?: number): UpdateProgress {
  if (!total || total <= 0) return { received };
  const ratio = Math.min(1, Math.max(0, received / total));
  return { received, total, percent: Math.round(ratio * 1000) / 10 };
}

export type InstallPlan =
  | { kind: "windows-installer"; command: string; args: string[] }
  | { kind: "open-dmg"; path: string };

/**
 * Windows hands the NSIS installer the same `--updated` flag electron-updater uses, so the running
 * app is replaced without a wizard. macOS builds are ad-hoc signed here, which Squirrel.Mac refuses
 * to auto-install, so the dmg is opened for the user instead of pretending to be a silent update.
 */
export function installPlan(platform: NodeJS.Platform, file: string): InstallPlan {
  if (platform === "win32") return { kind: "windows-installer", command: file, args: ["--updated"] };
  return { kind: "open-dmg", path: file };
}

export interface DownloadUpdateOptions {
  url: string;
  /** Destination for the finished file; the bytes land in `<file>.part` first. */
  file: string;
  fetchImpl: FetchUpdate;
  onProgress?: (progress: UpdateProgress) => void;
  signal?: AbortSignal;
}

/**
 * Streams a release asset to disk. The partial file is renamed only after the byte count matches
 * content-length, so an interrupted download can never look installable.
 */
export async function downloadUpdate(
  options: DownloadUpdateOptions,
): Promise<{ file: string; bytes: number }> {
  await mkdir(path.dirname(options.file), { recursive: true });
  const response = await options.fetchImpl(options.url, {
    signal: options.signal,
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`Update download failed with HTTP ${response.status}`);
  const body = response.body;
  if (!body) throw new Error("Update download returned an empty body");

  const declared = Number(response.headers.get("content-length") ?? "");
  const total = Number.isFinite(declared) && declared > 0 ? declared : undefined;
  const partial = `${options.file}.part`;
  const sink = createWriteStream(partial, { mode: 0o600 });
  let received = 0;

  try {
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      received += value.byteLength;
      if (!sink.write(Buffer.from(value))) await once(sink, "drain");
      options.onProgress?.(progressSnapshot(received, total));
    }
    await new Promise<void>((resolve, reject) => {
      sink.on("error", reject);
      sink.end(() => resolve());
    });
  } catch (error) {
    sink.destroy();
    await rm(partial, { force: true });
    throw error;
  }

  if (total !== undefined && received !== total) {
    await rm(partial, { force: true });
    throw new Error(`Update download stopped at ${received} of ${total} bytes`);
  }

  // Published atomically: a stale installer from an earlier version must never be reinstalled.
  await rm(options.file, { force: true });
  await rename(partial, options.file);
  return { file: options.file, bytes: received };
}
