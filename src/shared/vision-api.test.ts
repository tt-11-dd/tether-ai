import { describe, expect, it } from "vitest";
import { isVisionHandoff, isVisionReadable, mergeVisionResult, mimeFromImagePath, mineruResult, mineruUpload, modelSupportsVision, resolveVisionSettings, toPromptImages, visibleUserText, visionAgentPrompt, visionEngineDetails, visionError, visionHandoffPaths, visionRequest, visionResultSections, visionText, visionTitle, visionToolChips, visionToolTitle, visionUploadUrl } from "./vision-api";

describe("modelSupportsVision", () => {
  it("accepts known vision models", () => {
    expect(modelSupportsVision("deepseek-v4-flash-vision-exp")).toBe(true);
    expect(modelSupportsVision("gpt-4o")).toBe(true);
    expect(modelSupportsVision("claude-sonnet-4")).toBe(true);
  });

  it("rejects plain DeepSeek chat models", () => {
    expect(modelSupportsVision("deepseek-v4-flash")).toBe(false);
    expect(modelSupportsVision("deepseek-v4-pro")).toBe(false);
  });
});

describe("toPromptImages", () => {
  it("parses data URIs", () => {
    expect(toPromptImages(["data:image/png;base64,AAA"])).toEqual([
      { type: "image", mimeType: "image/png", data: "AAA" },
    ]);
  });
});

describe("visionRequest", () => {
  it("puts images and prompt into chat.completions content parts", () => {
    const body = visionRequest("这是什么", ["data:image/png;base64,AAA"]);
    expect(body.model).toBe("glm-4v-flash");
    expect(body.messages[0]?.content).toEqual([
      { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } },
      { type: "text", text: "这是什么" },
    ]);
  });

  it("defaults the prompt when the user only uploads", () => {
    expect(visionRequest("  ", ["data:image/png;base64,AAA"]).messages[0]?.content.at(-1))
      .toEqual({ type: "text", text: "请详细描述这张图片的内容" });
  });
});

describe("visionText", () => {
  it("reads choices[0].message.content", () => {
    expect(visionText({ choices: [{ message: { content: "一只猫" } }] })).toBe("一只猫");
  });

  it("throws when empty", () => {
    expect(() => visionText({ choices: [] })).toThrow();
  });
});

describe("resolveVisionSettings", () => {
  it("replaces the Agnes defaults", () => {
    expect(resolveVisionSettings({
      endpoint: "https://apihub.agnes-ai.com/v1/chat/completions",
      model: "agnes-2.5-flash",
    })).toEqual({
      provider: "custom",
      endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
      model: "glm-4v-flash",
    });
  });

  it("locks DeepSeek vision to the official model id", () => {
    expect(resolveVisionSettings({ provider: "deepseek" })).toMatchObject({
      provider: "deepseek",
      model: "deepseek-v4-flash-vision-exp",
      endpoint: "https://api.deepseek.com/chat/completions",
    });
  });

  it("keeps an explicit DeepSeek completions URL when provided", () => {
    expect(resolveVisionSettings({
      provider: "deepseek",
      endpoint: "https://api.deepseek.com/chat/completions",
    }).endpoint).toBe("https://api.deepseek.com/chat/completions");
  });
});

describe("mergeVisionResult", () => {
  it("keeps GLM text when OCR is empty", () => {
    expect(mergeVisionResult("导航栏", "")).toBe("导航栏");
  });

  it("returns only OCR text when GLM is empty", () => {
    expect(mergeVisionResult("", "模型 产品")).toBe("OCR 提取文字（MinerU）：\n模型 产品");
  });

  it("appends MinerU OCR", () => {
    expect(mergeVisionResult("导航栏", "模型 产品")).toContain("OCR（MinerU）");
  });
});

describe("mineruUpload", () => {
  it("reads task_id and file_url", () => {
    expect(mineruUpload({ code: 0, data: { task_id: "t1", file_url: "https://oss/x" } }))
      .toEqual({ taskId: "t1", fileUrl: "https://oss/x" });
  });
});

describe("mineruResult", () => {
  it("reads done markdown", () => {
    expect(mineruResult({ data: { state: "done", markdown_url: "https://cdn/x.md" } }))
      .toEqual({ state: "done", markdownUrl: "https://cdn/x.md" });
  });
});

describe("visionAgentPrompt", () => {
  it("marks the follow-up so chat can hide it", () => {
    const text = visionAgentPrompt("做成 html", ["D:/tmp/1.png"]);
    expect(isVisionHandoff(text)).toBe(true);
    expect(isVisionHandoff("@1.html 移除Agnes 模型中心这个大模块")).toBe(false);
    expect(isVisionHandoff("做成 html")).toBe(false);
    expect(text).toContain("做成 html");
    expect(text).toContain("D:/tmp/1.png");
    expect(text).toContain("vision");
    expect(isVisionHandoff(text.replace(/^\u200b/, ""))).toBe(true);
    expect(visibleUserText(text)).toBe("做成 html");
    expect(/[\u4e00-\u9fff]/.test(visibleUserText(text))).toBe(true);
    expect(/[\u4e00-\u9fff]/.test(visibleUserText("fix the button"))).toBe(false);
    expect(/[\u4e00-\u9fff]/.test(visibleUserText(visionAgentPrompt("what's this", ["/tmp/1.png"])))).toBe(false);
  });
});

describe("restoring a stored handoff", () => {
  const stored = visionAgentPrompt("这是什么", ["/Users/me/Library/Application Support/Tether/uploads/1786-1.png"]);

  it("recovers the staged upload paths and their preview urls", () => {
    expect(visionHandoffPaths(stored)).toEqual([
      "/Users/me/Library/Application Support/Tether/uploads/1786-1.png",
    ]);
    expect(visionUploadUrl(stored.split("\n").at(-2)!.slice(2))).toBe("harness-preview://uploads/1786-1.png");
    expect(visionHandoffPaths("看看 @a.png")).toEqual([]);
  });

  it("keeps the handoff instruction out of the session title", () => {
    expect(visionTitle(stored.replace(/\n+/g, " "))).toBe("这是什么");
    expect(visionTitle("修复登录页样式")).toBe("修复登录页样式");
  });
});

describe("visionToolTitle", () => {
  it("names the engine chip from pending and final details", () => {
    expect(visionToolChips(visionEngineDetails({
      model: "glm-4v-flash",
      hasGlmKey: false,
      images: 1,
      pending: true,
    }))).toEqual(["MinerU OCR"]);
    expect(visionToolChips(visionEngineDetails({
      model: "glm-4v-flash",
      hasGlmKey: true,
      images: 1,
      pending: true,
    }))).toEqual(["识图 · glm-4v-flash"]);
    expect(visionToolTitle(visionEngineDetails({
      model: "glm-4v-flash",
      hasGlmKey: true,
      images: 1,
      glmText: "a browser",
      ocrText: "WeTab",
    }))).toBe("识图 · glm-4v-flash · MinerU OCR");
    expect(visionToolChips(visionEngineDetails({
      model: "glm-4v-flash",
      hasGlmKey: true,
      images: 1,
      glmText: "a browser",
    }))).toEqual(["识图 · glm-4v-flash"]);
    expect(visionToolChips()).toEqual(["图片识别"]);
  });

  it("splits merged vision output into labeled engine sections", () => {
    expect(visionResultSections(mergeVisionResult("a browser tab", "WeTab\n搜索", "glm-4v-flash"))).toEqual([
      { label: "glm-4v-flash", text: "a browser tab" },
      { label: "MinerU OCR", text: "WeTab\n搜索" },
    ]);
    expect(visionResultSections(mergeVisionResult("", "only ocr"))).toEqual([
      { label: "MinerU OCR", text: "only ocr" },
    ]);
  });
});

describe("isVisionReadable", () => {
  it("allows uploads and workspace files only", () => {
    expect(isVisionReadable("D:/app/uploads/1.png", ["D:/app/uploads", "D:/code/proj"])).toBe(true);
    expect(isVisionReadable("D:/code/proj/shot.png", ["D:/app/uploads", "D:/code/proj"])).toBe(true);
    expect(isVisionReadable("D:/secrets/id.png", ["D:/app/uploads", "D:/code/proj"])).toBe(false);
  });
});

describe("mimeFromImagePath", () => {
  it("maps common extensions", () => {
    expect(mimeFromImagePath("a.jpg")).toBe("image/jpeg");
    expect(mimeFromImagePath("a.PNG")).toBe("image/png");
  });
});

describe("visionError", () => {
  it("prefers the API message", () => {
    expect(visionError({ error: { message: "invalid key" } }, 401)).toBe("invalid key");
    expect(visionError({}, 500)).toBe("图片识别失败（500）");
  });
});
