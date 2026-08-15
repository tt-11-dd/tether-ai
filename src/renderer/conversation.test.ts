import { describe, expect, it } from "vitest";
import { visionAgentPrompt } from "../shared/vision-api";
import { applyAgentEvent, cacheHitRate, collectFileChanges, collectTodos, collectWorkingFiles, dropLastTurn, filterMentionPaths, formatCommand, formatThinking, groupConversation, hasNewCheckpointUndo, lastTurnRestoreFiles, liveStatus, mentionedFiles, normalizeMessages, omitFinalReply, optimisticUserMessage, parseFeaturesJson, repairMarkdownTables, splitPatch, thoughtSteps, toolErrorText, toolSummary, toolWritePreview, turnAnchorId, turnAnchors, turnWork, undoDialogTitle, workspaceRelative } from "./conversation";

describe("conversation events", () => {
  it("calculates prompt cache hit rate from reported token usage", () => {
    expect(cacheHitRate({ input: 500, cacheRead: 9_500, cacheWrite: 0 })).toBe(95);
    expect(cacheHitRate({ input: 0, cacheRead: 0, cacheWrite: 0 })).toBeUndefined();
  });

  it("streams one assistant message after an optimistic user prompt", () => {
    let messages = [optimisticUserMessage("Build the desktop app")];
    messages = applyAgentEvent(messages, {
      type: "message_start",
      message: { role: "user", content: [{ type: "text", text: "Build the desktop app" }] },
    });
    messages = applyAgentEvent(messages, {
      type: "message_update",
      message: { role: "assistant", content: [{ type: "text", text: "Working" }] },
    });
    messages = applyAgentEvent(messages, {
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "Working. Done." }] },
    });

    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({ role: "assistant", text: "Working. Done.", streaming: false });
  });

  it("hides the vision handoff user turn so write tools stay on the same assistant", () => {
    const assistant = {
      id: "vision-1",
      role: "assistant" as const,
      text: "",
      thinking: "识图",
      images: [] as [],
      tools: [{ id: "v", name: "vision", title: "POST glm-4.6v-flash", status: "complete" as const }],
      work: [],
    };
    let messages = [optimisticUserMessage("做成 html"), assistant];
    messages = applyAgentEvent(messages, {
      type: "message_start",
      message: { role: "user", content: [{ type: "text", text: visionAgentPrompt("做成 html", ["D:/tmp/1.png"]) }] },
    });
    expect(messages).toHaveLength(2);
    expect(messages.at(-1)?.role).toBe("assistant");
    messages = applyAgentEvent(messages, {
      type: "tool_execution_start",
      toolCallId: "w1",
      toolName: "exec_command",
      args: { cmd: "cat > index.html" },
    });
    expect(messages.at(-1)?.tools.some((tool) => tool.id === "w1" || tool.name === "exec_command")).toBe(true);
  });

  it("still hides the handoff after the zero-width mark is stripped", () => {
    const prompt = visionAgentPrompt("这是什么", ["/tmp/1.jpg"]).replace(/^\u200b/, "");
    const local = optimisticUserMessage("这是什么", false, [{ data: "AAA", mimeType: "image/jpeg" }]);
    const messages = applyAgentEvent([local], {
      type: "message_start",
      message: { role: "user", content: [{ type: "text", text: prompt }] },
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ text: "这是什么", images: [{ data: "AAA", mimeType: "image/jpeg" }] });
  });

  it("unwraps a stored vision handoff into the original user text", () => {
    const messages = normalizeMessages([{
      role: "user",
      content: [{ type: "text", text: visionAgentPrompt("这是什么", ["/tmp/1.jpg"]) }],
    }]);
    expect(messages[0]).toMatchObject({ role: "user", text: "这是什么" });
  });

  it("shows the model error when a turn fails", () => {
    const messages = applyAgentEvent([optimisticUserMessage("你好")], {
      type: "message_end",
      message: {
        role: "assistant",
        content: [],
        stopReason: "error",
        errorMessage: "404 Not Found: /chat/completions",
      },
    });
    expect(messages.at(-1)).toMatchObject({
      role: "assistant",
      error: "404 Not Found: /chat/completions",
    });
  });

  it("keeps the command title when the end event has no args", () => {
    let messages = applyAgentEvent([], {
      type: "tool_execution_start",
      toolCallId: "cmd-1",
      toolName: "exec_command",
      args: { cmd: "git status" },
    });
    messages = applyAgentEvent(messages, {
      type: "tool_execution_end",
      toolCallId: "cmd-1",
      toolName: "exec_command",
      result: { details: { command: "git status", exitCode: 0 } },
      isError: false,
    });

    expect(messages[0]?.tools).toHaveLength(1);
    expect(messages[0]?.tools[0]?.title).toBe("Ran git status");
  });

  it("formats chained shell commands", () => {
    const cmd = `wc -l SkillToolApp/Sources/SkillToolApp/*.swift && echo "---" && cat SkillToolApp/Package.swift`;
    expect(formatCommand(cmd)).toBe("wc -l SkillToolApp/Sources/SkillToolApp/*.swift\ncat SkillToolApp/Package.swift");
    expect(applyAgentEvent([], {
      type: "tool_execution_start",
      toolCallId: "cmd-2",
      toolName: "exec_command",
      args: { cmd },
    })[0]?.tools[0]?.title).toBe("Ran wc · 2 条命令");
  });

  it("correlates tool start and completion events", () => {
    let messages = applyAgentEvent([], {
      type: "tool_execution_start",
      toolCallId: "call-1",
      toolName: "apply_patch",
      args: {},
      timestamp: 1_700_000_000_000,
    });
    messages = applyAgentEvent(messages, {
      type: "tool_execution_end",
      toolCallId: "call-1",
      toolName: "apply_patch",
      result: "patched",
      isError: false,
      timestamp: 1_700_000_002_000,
    });

    expect(messages[0]?.tools).toHaveLength(1);
    expect(messages[0]?.tools[0]).toMatchObject({
      id: "call-1",
      status: "complete",
      output: "patched",
      startedAt: 1_700_000_000_000,
      endedAt: 1_700_000_002_000,
    });
  });

  it("keeps the vision tool error text so the UI can show it", () => {
    let messages = applyAgentEvent([], {
      type: "tool_execution_start",
      toolCallId: "v1",
      toolName: "vision",
    });
    messages = applyAgentEvent(messages, {
      type: "tool_execution_end",
      toolCallId: "v1",
      toolName: "vision",
      isError: true,
      result: { content: [{ type: "text", text: "invalid image" }] },
    });
    expect(messages[0]?.tools[0]).toMatchObject({ status: "error", title: "图片识别", output: "invalid image" });
    expect(toolErrorText(messages[0]!.tools)).toBe("invalid image");
  });

  it("renames the vision chip once engine details arrive", () => {
    let messages = applyAgentEvent([], {
      type: "tool_execution_start",
      toolCallId: "v2",
      toolName: "vision",
    });
    expect(messages[0]?.tools[0]?.title).toBe("图片识别");
    messages = applyAgentEvent(messages, {
      type: "tool_execution_update",
      toolCallId: "v2",
      toolName: "vision",
      partialResult: {
        details: {
          model: "mineru-ocr",
          engines: ["mineru-ocr"],
          images: 1,
          ocr: true,
          glm: false,
        },
      },
    });
    expect(messages[0]?.tools[0]?.title).toBe("MinerU OCR");
    messages = applyAgentEvent(messages, {
      type: "tool_execution_end",
      toolCallId: "v2",
      toolName: "vision",
      result: {
        content: [{ type: "text", text: "OCR 提取文字（MinerU）：\nhello" }],
        details: {
          model: "glm-4v-flash",
          engines: ["glm-4v-flash", "mineru-ocr"],
          images: 1,
          ocr: true,
          glm: true,
        },
      },
    });
    expect(messages[0]?.tools[0]?.title).toBe("GLM-4V 识图 · glm-4v-flash · MinerU OCR");
  });

  it("normalizes stored assistant tool calls", () => {
    const messages = normalizeMessages([
      {
        role: "assistant",
        content: [
          { type: "toolCall", id: "tool-1", name: "exec_command", arguments: { cmd: "rg --files" } },
          { type: "text", text: "Done." },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "tool-1",
        content: [{ type: "text", text: "src/index.ts" }],
        isError: false,
      },
    ]);
    expect(messages[0]).toMatchObject({ role: "assistant", text: "Done." });
    expect(messages[0]?.tools[0]).toMatchObject({ id: "tool-1", title: "Ran rg --files", output: "src/index.ts" });
  });

  it("keeps one assistant turn across thinking, tools, and later text", () => {
    let messages = [optimisticUserMessage("能改文件吗")];
    messages = applyAgentEvent(messages, {
      type: "message_start",
      message: { role: "assistant", content: [{ type: "thinking", thinking: "The user asks" }] },
    });
    messages = applyAgentEvent(messages, {
      type: "message_update",
      message: { role: "assistant", content: [{ type: "thinking", thinking: "The user asks if I can modify files." }] },
    });
    messages = applyAgentEvent(messages, {
      type: "message_end",
      message: { role: "assistant", content: [{ type: "thinking", thinking: "The user asks if I can modify files." }] },
    });
    messages = applyAgentEvent(messages, {
      type: "tool_execution_start",
      toolCallId: "cmd-1",
      toolName: "exec_command",
      args: { cmd: "git status" },
      timestamp: 1_700_000_000,
    });
    messages = applyAgentEvent(messages, {
      type: "message_start",
      message: { role: "assistant", content: [{ type: "thinking", thinking: "No AGENTS.md, continue." }] },
    });
    messages = applyAgentEvent(messages, {
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "可以改。" }] },
    });
    messages = applyAgentEvent(messages, { type: "agent_settled" });

    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({
      role: "assistant",
      streaming: false,
      text: "可以改。",
    });
    expect(messages[1]?.thinking).toContain("The user asks if I can modify files.");
    expect(messages[1]?.thinking).toContain("No AGENTS.md, continue.");
    expect(messages[1]?.tools).toHaveLength(1);
  });

  it("keeps one copy when thinking snapshots grow in place", () => {
    const prefix = "I now have a thorough understanding of the app. Let me look at a few more details: the disabled items handling";
    let messages = applyAgentEvent([], {
      type: "message_start",
      message: { role: "assistant", content: [{ type: "thinking", thinking: prefix }] },
    });
    messages = applyAgentEvent(messages, {
      type: "message_update",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: prefix },
          { type: "thinking", thinking: `${prefix}, the settings toggle` },
        ],
      },
    });
    messages = applyAgentEvent(messages, {
      type: "message_update",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: prefix },
          { type: "thinking", thinking: `${prefix}, the settings toggle` },
          { type: "thinking", thinking: `${prefix}, the settings toggle "删除前确认"` },
        ],
      },
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]?.thinking).toBe(`${prefix}, the settings toggle "删除前确认"`);
    expect(messages[0]?.thinking?.split(prefix).length).toBe(2);
  });

  it("ignores files that were only listed or read", () => {
    expect(collectFileChanges([
      {
        id: "1",
        name: "exec_command",
        title: "Ran find",
        status: "complete",
        output: "src/App.swift\n.build/Symbols-ABC.swiftmodule\nREADME.md",
      },
      {
        id: "2",
        name: "read_file",
        title: "Read src/App.swift",
        status: "complete",
        args: { path: "src/App.swift" },
      },
    ])).toEqual([]);
  });

  it("collects files that were only read into the working set", () => {
    expect(collectWorkingFiles([
      {
        id: "1",
        name: "read_file",
        title: "Read src/App.swift",
        status: "complete",
        args: { path: "src/App.swift" },
      },
      {
        id: "2",
        name: "exec_command",
        title: "Ran git status",
        status: "complete",
        args: { cmd: "git status" },
      },
    ])).toEqual([
      { path: "src/App.swift", kind: "read", additions: 0, deletions: 0 },
    ]);
    expect(toolSummary([
      { id: "1", name: "read_file", title: "Read a", status: "complete", args: { path: "a.ts" } },
      { id: "2", name: "read_file", title: "Read b", status: "complete", args: { path: "b.ts" } },
      { id: "3", name: "exec_command", title: "Ran ls", status: "complete" },
    ])).toBe("读了 2 个文件，跑了 1 条命令");
    expect(thoughtSteps(
      [
        { type: "thinking", id: "t1", text: "先看结构" },
        { type: "tool", id: "w1", toolId: "1" },
        { type: "thinking", id: "t2", text: "再读源码" },
        { type: "tool", id: "w2", toolId: "3" },
      ],
      [
        { id: "1", name: "read_file", title: "Read a", status: "complete", args: { path: "a.ts" } },
        { id: "3", name: "exec_command", title: "Ran ls", status: "complete" },
      ],
    )).toEqual([
      { text: "先看结构", tools: [{ id: "1", name: "read_file", title: "Read a", status: "complete", args: { path: "a.ts" } }] },
      { text: "再读源码", tools: [{ id: "3", name: "exec_command", title: "Ran ls", status: "complete" }] },
    ]);
  });

  it("shows collapsed thinking when the final message only left tool steps", () => {
    const tools = [{ id: "1", name: "exec_command", title: "Ran ls", status: "complete" as const }];
    expect(thoughtSteps(
      [{ type: "tool", id: "w1", toolId: "1" }],
      tools,
      "先看结构\n\n再读源码",
    )).toEqual([
      { text: "先看结构", tools: [] },
      { text: "再读源码", tools },
    ]);
  });

  it("keeps streamed thinking when the closing message drops it", () => {
    const streamed = applyAgentEvent([], {
      type: "message_start",
      message: { role: "assistant", content: [{ type: "thinking", thinking: "先看结构" }] },
    } as never);
    const closed = applyAgentEvent(streamed, {
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          { type: "toolCall", id: "1", name: "exec_command", arguments: {} },
          { type: "text", text: "改完了" },
        ],
      },
    } as never);
    expect(closed.at(-1)!.work.some((item) => item.type === "thinking")).toBe(true);
    expect(closed.at(-1)!.thinking).toBe("先看结构");
  });

  it("keeps every thought of a turn in order across snapshots", () => {
    let messages = applyAgentEvent([], {
      type: "message_start",
      message: { role: "assistant", content: [{ type: "thinking", thinking: "先看 startTime 是怎么传的" }] },
    } as never);
    messages = applyAgentEvent(messages, {
      type: "tool_execution_start",
      toolCallId: "cmd-1",
      toolName: "exec_command",
      args: { cmd: "rg startTime" },
    } as never);
    messages = applyAgentEvent(messages, {
      type: "message_start",
      message: { role: "assistant", content: [{ type: "thinking", thinking: "后端要 00:00:00 ~ 23:59:59" }] },
    } as never);
    messages = applyAgentEvent(messages, {
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "改好了" }] },
    } as never);

    const message = messages.at(-1)!;
    expect(thoughtSteps(message.work, message.tools, message.thinking).map((step) => step.text)).toEqual([
      "先看 startTime 是怎么传的",
      "后端要 00:00:00 ~ 23:59:59",
      "改好了",
    ]);
    expect(thoughtSteps(message.work, message.tools, message.thinking)[0]?.tools.map((tool) => tool.id)).toEqual(["cmd-1"]);
  });

  it("keeps every inter-tool text beat instead of replacing the last one", () => {
    let messages = applyAgentEvent([], {
      type: "message_start",
      message: { role: "assistant", content: [{ type: "text", text: "先看导航" }] },
    } as never);
    messages = applyAgentEvent(messages, {
      type: "tool_execution_start",
      toolCallId: "cmd-1",
      toolName: "exec_command",
      args: { cmd: "ls" },
    } as never);
    messages = applyAgentEvent(messages, {
      type: "message_start",
      message: { role: "assistant", content: [{ type: "text", text: "再改链接" }] },
    } as never);
    messages = applyAgentEvent(messages, {
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "完成。" }] },
    } as never);
    const message = messages.at(-1)!;
    expect(thoughtSteps(message.work, message.tools).map((step) => step.text)).toEqual([
      "先看导航",
      "再改链接",
      "完成。",
    ]);
    expect(thoughtSteps(omitFinalReply(message.work, message.text), message.tools).map((step) => step.text)).toEqual([
      "先看导航",
      "再改链接",
    ]);
  });

  it("keeps every thought when a stored turn spans several messages", () => {
    const messages = normalizeMessages([
      { role: "assistant", content: [{ type: "thinking", thinking: "先看 startTime 是怎么传的" }] },
      { role: "assistant", content: [{ type: "toolCall", id: "cmd-1", name: "exec_command", arguments: { cmd: "rg startTime" } }] },
      { role: "assistant", content: [{ type: "thinking", thinking: "后端要 00:00:00 ~ 23:59:59" }, { type: "text", text: "改好了" }] },
    ]);
    const work = turnWork(messages);
    expect(thoughtSteps(work, messages.flatMap((item) => item.tools)).map((step) => step.text)).toEqual([
      "先看 startTime 是怎么传的",
      "后端要 00:00:00 ~ 23:59:59",
      "改好了",
    ]);
    expect(thoughtSteps(omitFinalReply(work, "改好了"), messages.flatMap((item) => item.tools)).map((step) => step.text)).toEqual([
      "先看 startTime 是怎么传的",
      "后端要 00:00:00 ~ 23:59:59",
    ]);
  });

  it("keeps @ mentioned files in the working set", () => {
    const messages = [
      optimisticUserMessage("@yq.html 看一下这个页面"),
      optimisticUserMessage("@src/views/merchant/ 这个目录呢"),
    ];
    expect(mentionedFiles(messages)).toEqual(["yq.html"]);
    expect(collectWorkingFiles([], mentionedFiles(messages))).toEqual([
      { path: "yq.html", kind: "read", additions: 0, deletions: 0 },
    ]);
  });

  it("prefers checklist todos from the assistant reply", () => {
    expect(collectTodos([
      {
        id: "a",
        role: "assistant",
        text: "计划：\n- [ ] 核验 README\n- [x] 重写文档\n- [ ] 检查渲染",
        images: [],
        tools: [],
        work: [],
      },
    ]).map((item) => item.text)).toEqual(["核验 README", "重写文档", "检查渲染"]);
  });

  it("does not treat numbered document headings as todos", () => {
    expect(collectTodos([
      {
        id: "a",
        role: "assistant",
        text: "1. 9 家模型供应商\n2. 项目工作台\n3. Agent 会话\n4. 输入体验",
        images: [],
        tools: [],
        work: [],
      },
    ])).toEqual([]);
  });

  it("parses features.json into session todos", () => {
    expect(parseFeaturesJson(JSON.stringify([
      { id: "chat", description: "新对话按钮创建空白会话", passes: true },
      { id: "drawer", description: "右侧抽屉可开关", passes: false },
    ]))).toEqual([
      { id: "chat", text: "新对话按钮创建空白会话", done: true },
      { id: "drawer", text: "右侧抽屉可开关", done: false },
    ]);
    expect(parseFeaturesJson("{")).toEqual([]);
  });

  it("splits collapsed markdown table rows", () => {
    expect(repairMarkdownTables("| 部分 | 作用 || ------ | ------ || name | 包标识名 |")).toBe(
      "| 部分 | 作用 |\n| ------ | ------ |\n| name | 包标识名 |",
    );
  });

  it("pairs patch lines into a split view", () => {
    expect(splitPatch("*** Update File: a.html\n@@\n-old\n+new\n context\n+only")).toEqual([
      { kind: "meta", old: "*** Update File: a.html", next: "" },
      { kind: "meta", old: "@@", next: "" },
      { kind: "del", old: "old", next: "" },
      { kind: "add", old: "", next: "new" },
      { kind: "ctx", old: "context", next: "context" },
      { kind: "add", old: "", next: "only" },
    ]);
  });

  it("shows writing progress from apply_patch input", () => {
    expect(liveStatus([{
      id: "1",
      name: "apply_patch",
      title: "Wrote about.html",
      status: "running",
      args: { input: "*** Begin Patch\n*** Add File: about.html\n+<h1>Hi</h1>\n*** End Patch" },
    }])).toMatch(/正在写入 about\.html · 约 .+ 字符/);
    expect(liveStatus([])).toBe("思考中…");
  });

  it("uses the latest edit counts when the same file is patched again", () => {
    const files = collectFileChanges([
      {
        id: "1",
        name: "apply_patch",
        title: "Edited 1.html",
        status: "complete",
        args: { input: "*** Begin Patch\n*** Update File: 1.html\n@@\n-a\n+b\n+c\n*** End Patch" },
      },
      {
        id: "2",
        name: "apply_patch",
        title: "Edited 1.html",
        status: "complete",
        args: { input: "*** Begin Patch\n*** Update File: 1.html\n@@\n-x\n+y\n*** End Patch" },
      },
    ]);
    expect(files).toMatchObject([{ path: "1.html", additions: 1, deletions: 1 }]);
  });

  it("collects added and deleted lines from apply_patch input", () => {
    const files = collectFileChanges([{
      id: "1",
      name: "apply_patch",
      title: "Edited src/App.vue",
      status: "complete",
      args: {
        input: "*** Begin Patch\n*** Update File: src/App.vue\n@@\n-old\n+new line\n+another\n*** End Patch",
      },
      output: "Applied patch to 1 file(s): +2 -1\nsrc/App.vue",
    }]);
    expect(files).toEqual([
      { path: "src/App.vue", additions: 2, deletions: 1, patch: expect.stringContaining("+new line") },
    ]);
  });

  it("lists top-level folders first, then one level of children after a prefix", () => {
    const files = [
      "README.md",
      "src/",
      "src/App.tsx",
      "src/views/",
      "src/views/list.vue",
      "src/views/merchant/",
      "src/views/merchant/management/",
      "src/views/merchant/phase/",
      "src/views/merchant/player/",
      "src/views/merchant/management/components/",
      "package.json",
    ];
    expect(filterMentionPaths(files, "")).toEqual(["src/", "package.json", "README.md"]);
    expect(filterMentionPaths(files, "src/")).toEqual(["src/", "src/views/", "src/App.tsx"]);
    expect(filterMentionPaths(files, "src/views/")).toEqual(["src/views/", "src/views/merchant/", "src/views/list.vue"]);
    expect(filterMentionPaths(files, "src/views/merchant")).toEqual([
      "src/views/merchant/",
      "src/views/merchant/management/",
      "src/views/merchant/phase/",
      "src/views/merchant/player/",
    ]);
  });

  it("maps Finder drop paths onto workspace-relative mentions", () => {
    expect(workspaceRelative("/proj/README.md", "/proj")).toBe("README.md");
    expect(workspaceRelative("/proj/docs/a.md", "/proj")).toBe("docs/a.md");
    expect(workspaceRelative("/proj", "/proj")).toBe("");
    expect(workspaceRelative("/other/a.md", "/proj")).toBeUndefined();
  });

  it("keeps all direct children when browsing a wide folder", () => {
    const files = [
      "wide/",
      ...Array.from({ length: 100 }, (_, index) => `wide/dir-${String(index).padStart(3, "0")}/`),
      ...Array.from({ length: 20 }, (_, index) => `wide/file-${String(index).padStart(3, "0")}.ts`),
    ];
    const matches = filterMentionPaths(files, "wide/");
    expect(matches).toHaveLength(121);
    expect(matches[0]).toBe("wide/");
    expect(matches).toContain("wide/dir-099/");
    expect(matches).toContain("wide/file-019.ts");
  });

  it("drops the last user turn and following assistant replies", () => {
    const user = optimisticUserMessage("加上我的");
    const assistant = { ...optimisticUserMessage(""), id: "a", role: "assistant" as const, text: "已加上" };
    expect(dropLastTurn([user, assistant]).map((item) => item.id)).toEqual([]);
    expect(dropLastTurn([optimisticUserMessage("先问"), user, assistant]).map((item) => item.text)).toEqual(["先问"]);
    expect(dropLastTurn([user]).map((item) => item.id)).toEqual([]);
    expect(dropLastTurn([])).toEqual([]);
  });

  it("restores every last-turn checkpoint, keeping the earliest before per file", () => {
    expect(lastTurnRestoreFiles([
      { type: "message", message: { role: "user", content: "先改 html" } },
      { type: "custom", customType: "tether-checkpoint", data: { id: "old", before: [{ path: "stale.html", content: "no" }] } },
      { type: "message", message: { role: "user", content: "再改 css" } },
      { type: "custom", customType: "tether-checkpoint", data: { id: "html", before: [{ path: "index.html", content: "<old>" }] } },
      { type: "custom", customType: "tether-checkpoint", data: { id: "css", before: [{ path: "style.css", content: "body{}" }, { path: "index.html", content: "<mid>" }] } },
    ])).toEqual([
      { path: "index.html", content: "<old>" },
      { path: "style.css", content: "body{}" },
    ]);
  });

  it("skips undone checkpoints and does not treat /undo as a new turn", () => {
    expect(lastTurnRestoreFiles([
      { type: "message", message: { role: "user", content: "改" } },
      { type: "custom", customType: "tether-checkpoint", data: { id: "c1", before: [{ path: "a.css", content: "x" }] } },
      { type: "custom", customType: "tether-checkpoint-undone", data: { checkpointId: "c1" } },
      { type: "message", message: { role: "user", content: [{ type: "text", text: "/undo" }] } },
    ])).toEqual([]);
  });

  it("only treats a new checkpoint-undone entry as a successful undo", () => {
    const before = [{ id: "a", type: "message" }, { id: "b", type: "custom", customType: "tether-checkpoint" }];
    expect(hasNewCheckpointUndo(before, before)).toBe(false);
    expect(hasNewCheckpointUndo(before, [...before, { id: "c", type: "custom", customType: "tether-checkpoint-undone" }])).toBe(true);
    expect(hasNewCheckpointUndo(before, [...before, { id: "c", type: "custom", customType: "tether-checkpoint" }])).toBe(false);
  });

  it("rewrites undo confirm titles to the last user turn", () => {
    expect(undoDialogTitle("Undo 7f6eb0f8-6a0?", "在新增一个我的")).toBe("撤回「在新增一个我的」？");
    expect(undoDialogTitle("Undo abc?", "x".repeat(40))).toBe(`撤回「${"x".repeat(36)}…」？`);
    expect(undoDialogTitle("Allow unrestricted host access?")).toBe("Allow unrestricted host access?");
  });

  it("breaks thinking walls into list-friendly lines", () => {
    expect(formatThinking("看一下结构 1. `a.ts` 2. `b.ts` - 当前结构 - 对接时需要做的事")).toBe([
      "看一下结构",
      "1. `a.ts`",
      "2. `b.ts`",
      "- 当前结构",
      "- 对接时需要做的事",
    ].join("\n"));
  });

  it("splits long live thinking into visible steps", () => {
    expect(thoughtSteps([
      { type: "thinking", id: "t1", text: "先看结构 1. `a.ts` 2. `b.ts` - 当前结构 - 对接时需要做的事" },
    ], []).map((step) => step.text)).toEqual([
      "先看结构",
      "1. `a.ts`",
      "2. `b.ts`",
      "- 当前结构",
      "- 对接时需要做的事",
    ]);
  });

  it("strips model think tags so they are not shown as raw markup", () => {
    expect(formatThinking("<thinking>Inspecting key file contents for summary</thinking>"))
      .toBe("Inspecting key file contents for summary");
  });

  it("hides <thinking> blocks from the visible assistant reply", () => {
    const messages = applyAgentEvent([], {
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "<thinking>Inspecting related pages for consistent navigation</thinking>" }],
      },
    });
    expect(messages[0]?.text).toBe("");
    expect(messages[0]?.thinking).toBe("Inspecting related pages for consistent navigation");
  });

  it("builds one jump anchor per real user question", () => {
    const messages = normalizeMessages([
      { role: "user", content: [{ type: "text", text: "新增友链页面\n顺便加个入口" }] },
      { role: "assistant", content: [{ type: "text", text: "好" }] },
      { role: "user", content: [{ type: "text", text: "/undo" }] },
      { role: "user", content: [{ type: "text", text: "修复样式问题" }] },
    ]);
    const anchors = turnAnchors(groupConversation(messages));
    expect(anchors.map((item) => item.label)).toEqual(["新增友链页面 顺便加个入口", "修复样式问题"]);
    expect(anchors[0]?.id).toBe(turnAnchorId(messages[0]!.id));
  });
});
