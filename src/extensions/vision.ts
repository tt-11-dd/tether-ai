import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_VISION_CONFIG,
  isVisionReadable,
  mergeVisionResult,
  mimeFromImagePath,
  mineruCreateBody,
  mineruResult,
  mineruUpload,
  MINERU_PARSE_FILE,
  MINERU_PARSE_TASK,
  resolveVisionSettings,
  visionError,
  visionRequest,
  visionText,
  isVisionHandoff,
  visibleUserText,
  type VisionConfig,
} from "../shared/vision-api";

interface ExtensionAPI {
  registerTool(tool: Record<string, unknown>): void;
  getActiveTools(): string[];
  setActiveTools(names: string[]): void;
  on<T>(event: string, handler: (event: T) => unknown): void;
}

function setVisionTool(pi: ExtensionAPI, on: boolean) {
  const active = pi.getActiveTools();
  const has = active.includes("vision");
  if (on === has) return;
  pi.setActiveTools(on ? [...active, "vision"] : active.filter((name) => name !== "vision"));
}

function isVisualCapture(command: string) {
  return /--screenshot|puppeteer|playwright/i.test(command)
    || (/chrome|chromium/i.test(command) && /headless/i.test(command));
}

const NO_CAPTURE = "- 不要用 Chrome、headless 或截图做视觉验收，除非用户这一轮明确要求截图。改 HTML/CSS 写完即可。";
const LANG_ZH = "- 用户这一轮用中文。思考、计划、工具之间的说明、自检旁白和最终回复全部用简体中文，不要夹英文自言自语。代码、路径、命令、标识符保持原文。";
const LANG_EN = "- The user is writing in English this turn. Think, plan, narrate between tools, and reply in English. Identifiers, paths, and commands stay as written.";

// ponytail: any CJK in the visible user text → zh, else en.
function langLine(prompt: string) {
  return /[\u4e00-\u9fff]/.test(visibleUserText(prompt)) ? LANG_ZH : LANG_EN;
}

/** Agent plugin: GLM-4V-Flash for vision, MinerU for free OCR. */
export default function visionExtension(pi: ExtensionAPI) {
  let wanted = false;
  let lastPrompt = "";
  pi.on("session_start", () => setVisionTool(pi, false));
  pi.on("before_agent_start", (event: { prompt?: string; images?: unknown[]; systemPrompt?: string }) => {
    lastPrompt = event.prompt ?? "";
    wanted = Boolean(event.images?.length) || isVisionHandoff(lastPrompt);
    setVisionTool(pi, wanted);
    const base = event.systemPrompt ?? "";
    const next = `${base.replaceAll(NO_CAPTURE, "").replaceAll(LANG_ZH, "").replaceAll(LANG_EN, "").trimEnd()}\n\n${NO_CAPTURE}\n${langLine(lastPrompt)}`;
    return { systemPrompt: next };
  });
  pi.on("tool_call", (event: { toolName?: string; input?: { cmd?: string } }) => {
    if (event.toolName === "vision" && !wanted) {
      return { block: true, reason: "这一轮没有贴图，不调用图片识别。" };
    }
    const command = event.input?.cmd ?? "";
    if (event.toolName === "exec_command" && isVisualCapture(command) && !/截图|screenshot/i.test(lastPrompt)) {
      return { block: true, reason: "写完不需要截图验收。" };
    }
  });

  pi.registerTool({
    name: "vision",
    label: "图片识别",
    description: "Look at user-pasted image files with GLM-4V-Flash and MinerU OCR. Only call when this turn's user message attached images. Never call for HTML, CSS, or code edits.",
    promptSnippet: "vision: only when the user pasted images this turn",
    parameters: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Absolute paths to image files",
        },
        prompt: {
          type: "string",
          description: "What to look for. Defaults to a detailed visual description.",
        },
      },
      required: ["paths"],
    },
    async execute(
      _id: string,
      params: { paths?: string[]; prompt?: string },
      signal: unknown,
      _onUpdate: unknown,
      ctx: { cwd: string },
    ) {
      const roots = [process.env.HARNESS_VISION_UPLOADS, ctx.cwd].filter((item): item is string => Boolean(item));
      const files = (params.paths ?? []).map((item) => path.resolve(item));
      const blocked = files.find((file) => !isVisionReadable(file, roots));
      if (blocked) throw new Error(`图片不在允许目录：${blocked}`);
      const buffers = await Promise.all(files.map(async (file) => ({ file, bytes: await readFile(file) })));
      const images = buffers.map(({ file, bytes }) => `data:${mimeFromImagePath(file)};base64,${bytes.toString("base64")}`);
      const config = await loadVisionConfig();
      const hasGlmKey = Boolean(config.apiKey?.trim());
      const timeout = AbortSignal.timeout(180_000);
      const abort = signal instanceof AbortSignal ? AbortSignal.any([signal, timeout]) : timeout;
      try {
        const prompt = params.prompt ?? "";
        const [glmParts, ocrParts] = await Promise.all([
          hasGlmKey
            ? Promise.all(images.map((image, index) =>
                analyzeGlm(config, images.length > 1 ? `第 ${index + 1} 张。${prompt}` : prompt, [image], abort)))
            : Promise.resolve([]),
          Promise.all(buffers.map((buf) => mineruOcr(buf, abort).catch(() => ""))),
        ]);
        const glmText = glmParts.filter(Boolean).join("\n\n");
        const ocrText = ocrParts.filter(Boolean).join("\n\n---\n\n");
        const merged = mergeVisionResult(glmText, ocrText);
        if (!merged) {
          throw new Error(
            hasGlmKey
              ? "图片识别未能提取出有效内容"
              : "内置 MinerU OCR 未能提取出文字，且未配置视觉模型 API Key。可在设置中填写智谱 GLM API Key 获取完整视觉分析能力。"
          );
        }
        return {
          content: [{ type: "text", text: merged }],
          details: {
            model: hasGlmKey ? config.model : "mineru-ocr",
            images: images.length,
            ocr: Boolean(ocrText),
          },
        };
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw new Error("已终止");
        throw error;
      }
    },
  });
}

async function analyzeGlm(config: VisionConfig, prompt: string, images: string[], signal: AbortSignal) {
  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(visionRequest(prompt, images, { model: config.model })),
    signal,
  });
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error(visionError(payload, response.status));
  return visionText(payload);
}

/** ponytail: MinerU flash is async upload+poll; skip quietly if it fails. */
async function mineruOcr(file: { file: string; bytes: Buffer }, signal: AbortSignal) {
  const created = await fetch(MINERU_PARSE_FILE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(mineruCreateBody(path.basename(file.file))),
    signal,
  });
  const upload = mineruUpload(await created.json().catch(() => undefined));
  const put = await fetch(upload.fileUrl, { method: "PUT", body: new Uint8Array(file.bytes), signal });
  if (!put.ok) throw new Error(`MinerU 上传失败（${put.status}）`);
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (signal.aborted) throw new Error("已终止");
    const queried = await fetch(`${MINERU_PARSE_TASK}/${upload.taskId}`, { signal });
    const result = mineruResult(await queried.json().catch(() => undefined));
    if (result.state === "done" && result.markdownUrl) {
      const markdown = await fetch(result.markdownUrl, { signal });
      return markdown.ok ? (await markdown.text()).trim() : "";
    }
    if (result.state === "failed") throw new Error(result.error || "MinerU 解析失败");
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error("MinerU 超时");
}

async function loadVisionConfig(): Promise<VisionConfig> {
  const file = process.env.HARNESS_VISION_CONFIG;
  if (file) {
    try {
      const raw = JSON.parse(await readFile(file, "utf8")) as Partial<VisionConfig>;
      return {
        ...resolveVisionSettings(raw),
        apiKey: typeof raw.apiKey === "string" ? raw.apiKey.trim() : "",
      };
    } catch {
      /* fall through */
    }
  }
  return { ...DEFAULT_VISION_CONFIG, apiKey: process.env.ZHIPU_API_KEY?.trim() ?? "" };
}
