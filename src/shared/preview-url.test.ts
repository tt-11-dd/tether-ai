import { describe, expect, it } from "vitest";
import {
  PREVIEW_CWD_SEGMENT,
  PREVIEW_HOST,
  PREVIEW_SCHEME,
  parsePreviewPath,
  previewFileUrl,
} from "./types";

describe("previewFileUrl", () => {
  it("keeps the old origin when no workspace is given", () => {
    expect(previewFileUrl("pelican-bike.html")).toBe(
      `${PREVIEW_SCHEME}://${PREVIEW_HOST}/pelican-bike.html`,
    );
    expect(parsePreviewPath("/pelican-bike.html")).toEqual({
      workspace: undefined,
      path: "pelican-bike.html",
    });
  });

  it("carries the workspace in the path so relative assets keep it", () => {
    const cwd = "/Users/a/my project";
    const url = new URL(previewFileUrl("pages/index.html", cwd));
    expect(parsePreviewPath(url.pathname)).toEqual({
      workspace: cwd,
      path: "pages/index.html",
    });

    // A relative asset one level up keeps the same workspace prefix.
    const asset = new URL("../img/logo.png", url);
    expect(parsePreviewPath(asset.pathname)).toEqual({
      workspace: cwd,
      path: "img/logo.png",
    });

    // The cwd stays a single segment, so it can never be read back as part of the file path.
    expect(asset.pathname.split("/")[2]).toBe(encodeURIComponent(encodeURIComponent(cwd)));
  });

  it("encodes Windows paths and spaces", () => {
    const cwd = "C:\\Users\\a\\proj";
    const url = new URL(previewFileUrl("docs/a b.html", cwd));
    expect(parsePreviewPath(url.pathname)).toEqual({
      workspace: cwd,
      path: "docs/a b.html",
    });
  });

  it("ignores a blank workspace", () => {
    expect(previewFileUrl("a.html", "  ")).toBe(
      `${PREVIEW_SCHEME}://${PREVIEW_HOST}/a.html`,
    );
  });

  it("tolerates malformed encoding instead of throwing", () => {
    expect(parsePreviewPath(`/${PREVIEW_CWD_SEGMENT}/%E0%A4%A/x.html`)).toEqual({
      workspace: undefined,
      path: "x.html",
    });
  });

  it("treats a bare ~ file as a normal path", () => {
    // Only `~ / <cwd> / <file>` (three or more segments) is a workspace prefix.
    expect(parsePreviewPath("/~/only.html")).toEqual({
      workspace: undefined,
      path: "~/only.html",
    });
  });

  // Captured verbatim from a real Electron renderer requesting the preview, so a future change
  // that starts double-decoding (or that normalises the prefix away) fails here instead of in the
  // app. Note the asset request keeps the workspace prefix.
  it("matches the exact pathnames a real renderer sends", () => {
    expect(parsePreviewPath("/~/%252FUsers%252Fedy%252Fmy%2520proj/dir/page.html")).toEqual({
      workspace: "/Users/edy/my proj",
      path: "dir/page.html",
    });
    expect(parsePreviewPath("/~/%252FUsers%252Fedy%252Fmy%2520proj/img/logo.png")).toEqual({
      workspace: "/Users/edy/my proj",
      path: "img/logo.png",
    });
  });
});
