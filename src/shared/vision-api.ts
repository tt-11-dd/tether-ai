import { PREVIEW_SCHEME, UPLOADS_HOST } from "./types";

export const VISION_ENDPOINT = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
export const VISION_MODEL = "glm-4v-flash";
export const MAX_VISION_IMAGES = 4;
export const MINERU_PARSE_FILE = "https://mineru.net/api/v1/agent/parse/file";
export const MINERU_PARSE_TASK = "https://mineru.net/api/v1/agent/parse";
const STALE_VISION_ENDPOINTS = new Set([
  "https://apihub.agnes-ai.com/v1/chat/completions",
  "https://apihub.agnes-ai.com/v1/messages",
  "https://apihub.agnes-ai.com/v1",
]);
const STALE_VISION_MODELS = new Set(["agnes-2.5-flash", "glm-4.6v-flash"]);

export interface VisionConfig {
  endpoint: string;
  model: string;
  apiKey: string;
}

export const DEFAULT_VISION_CONFIG: Omit<VisionConfig, "apiKey"> = {
  endpoint: VISION_ENDPOINT,
  model: VISION_MODEL,
};

export function resolveVisionSettings(raw?: Partial<Pick<VisionConfig, "endpoint" | "model">>) {
  const endpoint = raw?.endpoint?.trim() ?? "";
  const model = raw?.model?.trim() ?? "";
  return {
    endpoint: !endpoint || STALE_VISION_ENDPOINTS.has(endpoint) ? VISION_ENDPOINT : endpoint,
    model: !model || STALE_VISION_MODELS.has(model) ? VISION_MODEL : model,
  };
}

/** GLM-4V-Flash: OpenAI chat.completions with data-URI image_url. */
export function visionRequest(prompt: string, images: string[], options?: { model?: string }) {
  const refs = images.filter(Boolean).slice(0, MAX_VISION_IMAGES);
  if (refs.length === 0) throw new Error("先上传至少一张图片");
  return {
    model: options?.model?.trim() || VISION_MODEL,
    messages: [{
      role: "user" as const,
      content: [
        ...refs.map((url) => ({ type: "image_url" as const, image_url: { url } })),
        { type: "text" as const, text: prompt.trim() || "请详细描述这张图片的内容" },
      ],
    }],
  };
}

export function visionText(payload: unknown): string {
  const choice = (payload as { choices?: Array<{ message?: { content?: unknown } }> } | null)?.choices?.[0]?.message?.content;
  if (typeof choice === "string" && choice.trim()) return choice.trim();
  if (Array.isArray(choice)) {
    const text = choice
      .map((part) => (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
        ? (part as { text: string }).text
        : ""))
      .join("")
      .trim();
    if (text) return text;
  }
  throw new Error("接口没有返回图片识别结果");
}

export function mergeVisionResult(glm: string, ocr?: string) {
  const text = ocr?.trim();
  const vision = glm?.trim();
  if (!text) return vision || "";
  if (!vision) return `OCR 提取文字（MinerU）：\n${text}`;
  return `图片识别（GLM-4V-Flash）：\n${vision}\n\nOCR（MinerU）：\n${text}`;
}

/** Chip labels so GLM 识图 and MinerU OCR never share one ambiguous badge. */
export function visionToolChips(details?: unknown): string[] {
  if (!details || typeof details !== "object") return ["图片识别"];
  const record = details as {
    model?: unknown;
    engines?: unknown;
    ocr?: unknown;
    glm?: unknown;
  };
  const engines = Array.isArray(record.engines)
    ? record.engines.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : [];
  const model = typeof record.model === "string" ? record.model.trim() : "";
  const usedGlm = record.glm === true
    || engines.some((item) => item !== "mineru-ocr")
    || (Boolean(model) && model !== "mineru-ocr");
  const usedOcr = record.ocr === true || engines.includes("mineru-ocr") || model === "mineru-ocr";
  const chips: string[] = [];
  if (usedGlm) chips.push(`GLM-4V 识图 · ${model && model !== "mineru-ocr" ? model : "glm-4v-flash"}`);
  if (usedOcr) chips.push("MinerU OCR");
  return chips.length > 0 ? chips : ["图片识别"];
}

export function visionToolTitle(details?: unknown): string {
  return visionToolChips(details).join(" · ");
}

/** Split the merged vision tool output back into labeled engine sections for the UI. */
export function visionResultSections(output?: string): Array<{ label: string; text: string }> {
  const text = output?.trim() ?? "";
  if (!text) return [];
  const glm = text.match(/图片识别（GLM-4V-Flash）：\n([\s\S]*?)(?:\n\nOCR（MinerU）：\n|$)/)?.[1]?.trim();
  const ocr = text.match(/OCR 提取文字（MinerU）：\n([\s\S]+)$/)?.[1]?.trim()
    ?? text.match(/OCR（MinerU）：\n([\s\S]+)$/)?.[1]?.trim();
  if (glm || ocr) {
    return [
      ...(glm ? [{ label: "GLM-4V 识图", text: glm }] : []),
      ...(ocr ? [{ label: "MinerU OCR", text: ocr }] : []),
    ];
  }
  return [{ label: "图片识别", text }];
}

export function visionEngineDetails(options: {
  model: string;
  hasGlmKey: boolean;
  images: number;
  glmText?: string;
  ocrText?: string;
  /** Before results arrive: show what will be tried. */
  pending?: boolean;
}) {
  const glmText = options.glmText?.trim() ?? "";
  const ocrText = options.ocrText?.trim() ?? "";
  if (options.pending) {
    return {
      model: options.hasGlmKey ? options.model : "mineru-ocr",
      engines: options.hasGlmKey ? [options.model, "mineru-ocr"] : ["mineru-ocr"],
      images: options.images,
      ocr: true,
      glm: options.hasGlmKey,
    };
  }
  const engines = [
    ...(options.hasGlmKey && glmText ? [options.model] : []),
    ...(ocrText ? ["mineru-ocr"] : []),
  ];
  return {
    model: options.hasGlmKey && glmText ? options.model : "mineru-ocr",
    engines,
    images: options.images,
    ocr: Boolean(ocrText),
    glm: Boolean(options.hasGlmKey && glmText),
  };
}

export function mineruCreateBody(fileName: string) {
  return { file_name: fileName, language: "ch" };
}

export function mineruUpload(payload: unknown): { taskId: string; fileUrl: string } {
  const data = (payload as { code?: number; data?: { task_id?: string; file_url?: string }; msg?: string } | null);
  if (data?.code !== 0 || !data.data?.task_id || !data.data.file_url) {
    throw new Error(typeof data?.msg === "string" && data.msg !== "ok" ? data.msg : "MinerU 创建任务失败");
  }
  return { taskId: data.data.task_id, fileUrl: data.data.file_url };
}

export function mineruResult(payload: unknown): { state: string; markdownUrl?: string; error?: string } {
  const data = (payload as { data?: { state?: string; markdown_url?: string; err_msg?: string } } | null)?.data;
  return {
    state: data?.state ?? "",
    ...(data?.markdown_url ? { markdownUrl: data.markdown_url } : {}),
    ...(data?.err_msg ? { error: data.err_msg } : {}),
  };
}

/** Hidden prefix so the agent instruction is not rendered as a second user bubble. */
export const VISION_HANDOFF_MARK = "\u200b[vision]";

export function visionAgentPrompt(prompt: string, paths: string[]) {
  const files = paths.filter(Boolean);
  if (files.length === 0) return prompt;
  return [
    `${VISION_HANDOFF_MARK}${prompt}`,
    "",
    "用户上传了图片，当前模型看不到图。先调用 vision 工具查看：",
    ...files.map((file) => `- ${file}`),
    "然后按用户原话执行。要写文件就写到当前项目，不要只在对话里贴代码。",
  ].join("\n");
}

export function isVisionHandoff(text: string) {
  return text.includes("[vision]") && text.includes("先调用 vision 工具查看");
}

/** Staged upload paths listed in a stored handoff, so old turns can show their thumbnails again. */
export function visionHandoffPaths(text: string): string[] {
  if (!isVisionHandoff(text)) return [];
  return text
    .split("\n")
    .flatMap((line) => {
      const file = line.match(/^-\s+(\S.*)$/)?.[1]?.trim();
      return file && mentionsImageFile(file) ? [file] : [];
    });
}

/**
 * Session titles collapse the stored handoff onto one line, so the newline split used by
 * `visibleUserText` cannot recover them; cut at the agent instruction instead.
 */
export function visionTitle(title: string) {
  const stripped = title.replace(/\u200b?\[vision\]/, "");
  if (stripped === title) return title;
  const cut = stripped.indexOf("用户上传了图片");
  return (cut < 0 ? stripped : stripped.slice(0, cut)).trim() || title;
}

export function visionUploadUrl(file: string) {
  const name = file.replace(/\\/g, "/").split("/").pop() ?? "";
  return `${PREVIEW_SCHEME}://${UPLOADS_HOST}/${encodeURIComponent(name)}`;
}

export function visibleUserText(text: string) {
  if (!isVisionHandoff(text)) return text;
  return (text.split("\n")[0] ?? "").replace(/^\u200b?\[vision\]/, "").trim();
}

/** The turn points at an image on disk (@mention or plain path), not just a pasted attachment. */
export function mentionsImageFile(text: string) {
  return /\.(?:png|jpe?g|webp|gif|bmp)(?![a-z0-9])/i.test(text);
}

export function isVisionReadable(file: string, roots: string[]) {
  const resolved = file.replace(/\\/g, "/");
  return roots.some((root) => {
    const base = root.replace(/\\/g, "/").replace(/\/$/, "");
    return Boolean(base) && (resolved === base || resolved.startsWith(`${base}/`));
  });
}

export function mimeFromImagePath(file: string) {
  const ext = file.split(".").pop()?.toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "image/png";
}

export function visionError(payload: unknown, status: number): string {
  const message = (payload as { error?: { message?: unknown }; message?: unknown } | null);
  const detail = typeof message?.error?.message === "string"
    ? message.error.message
    : typeof message?.message === "string" ? message.message : "";
  return detail || `图片识别失败（${status}）`;
}
