import { describe, expect, it } from "vitest";
import { isVisionHandoff, isVisionReadable, mergeVisionResult, mimeFromImagePath, mineruResult, mineruUpload, resolveVisionSettings, visibleUserText, visionAgentPrompt, visionError, visionRequest, visionText } from "./vision-api";

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
      endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
      model: "glm-4v-flash",
    });
  });
});

describe("mergeVisionResult", () => {
  it("keeps GLM text when OCR is empty", () => {
    expect(mergeVisionResult("导航栏", "")).toBe("导航栏");
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
