# Tether 开发文档

> English: [DEVELOPMENT.en.md](DEVELOPMENT.en.md)

> 面向仓库的 AI 编程桌面工作台。本文面向在 Tether 仓库内做开发的工程师：解释架构、模块职责、关键数据流与常见开发任务。产品说明与用户文档见根目录 `README.md` / `README.zh-CN.md`。

## 1. 项目概览

Tether 是一个基于 Electron 的本地优先 AI 编程桌面工作台：模型调用、工作区工具、终端命令、权限确认、会话历史与 diff 审查集中在一个桌面应用里。UI 与会话数据留在本机，模型请求直连用户配置的 provider 或本地网关。

**核心定位**：Tether 不重新实现 agent 基础能力。agent 循环、沙箱、会话、工具、checkpoint、MCP、Hooks 都由 npm 包 `tether-agent-core`（内部再封装 Pi 生态 `@earendil-works/pi-*`）提供。本仓库只负责：

- Electron 壳（窗口、菜单、IPC、权限入口、工作区文件访问、更新检查）
- 渲染进程 UI（React，中文/英文界面）
- 把 `tether-agent-core` 的 RPC 子进程桥接成桌面可用的 agent

| 技术                      | 用途                                               |
| ------------------------- | -------------------------------------------------- |
| Electron 37               | 桌面壳、主进程、contextBridge 隔离                 |
| React 19 + react-markdown | 渲染进程 UI                                        |
| TypeScript 5.9（strict）  | 全部源码                                           |
| Vite 7                    | 渲染进程构建 + dev server                          |
| tsup 8                    | 主进程 / preload / 扩展构建为 ESM/CJS              |
| Vitest 3                  | 单元测试                                           |
| tether-agent-core 0.1.15   | agent 运行时（RPC worker、沙箱、会话、checkpoint） |
| electron-builder 26       | 打包 dmg / nsis / dir                              |

### 1.1 架构分层

```text
React Renderer（src/renderer）
  会话渲染、diff 面板、设置、项目/会话导航、composer
        │  contextBridge（window.harness）/ Electron IPC
        ▼
Electron Main（src/main）
  窗口、工作区文件、凭据、AgentHost 子进程宿主、更新检查、预览协议
        │  换行分隔 JSON-RPC over stdio
        ▼
tether-agent-core（node_modules 依赖，RPC worker 进程）
  权限、沙箱、工具、checkpoint、MCP、会话文件、Pi agent 循环
```

渲染进程没有任何 Node.js 直连能力；桌面能力全部通过 `src/shared/types.ts` 里定义的类型化 `DesktopApi` 契约走 IPC。agent 运行在独立子进程（通过 `process.execPath` + `ELECTRON_RUN_AS_NODE=1` 启动），崩溃后磁盘上的会话仍可继续作为对话恢复，但 Tether 不会静默重放未完成的命令。

## 2. 目录结构

```text
.
├── AGENTS.md                  # 仓库级工程约定（新对话先选项目、跨会话进度等）
├── README.md / README.zh-CN.md
├── package.json               # scripts：dev / build / typecheck / test / check / pack*
├── electron-builder.yml       # 打包配置（asar: false，图标、目标平台）
├── tsup.config.ts             # 主进程 / preload / 扩展的三段构建
├── vite.config.ts             # 渲染进程 dev server + build + vitest 配置
├── tsconfig.json
├── pnpm-workspace.yaml        # allowBuilds / minimumReleaseAgeExclude 配置
├── scripts/
│   ├── ensure-electron.mjs    # postinstall：补齐 Electron 二进制、写 path.txt、改 Info.plist 名称
│   └── make-icon.py           # 图标生成脚本
├── build/                     # 图标资源（icon.png / icon-win.png / icon.svg）
├── .agents/skills/            # 项目内置技能（init-long-run / continue-long-run / plan-then-act / tether-ui）
├── .github/workflows/release.yml
└── src/
    ├── main/                  # Electron 主进程
    │   ├── index.ts           # 窗口、IPC、工作区、权限、更新、预览协议（约 850 行）
    │   ├── agent-host.ts      # Agent RPC 子进程宿主（spawn / 请求 / 事件分发）
    │   ├── rpc-lines.ts       # 按行切分 RPC stdout（UTF-8 安全）
    │   ├── skills-fs.ts       # 本地技能目录扫描与 reveal
    │   └── update-check.ts    # GitHub Release 更新检查
    ├── preload/
    │   └── index.ts           # contextBridge 暴露 window.harness（DesktopApi）
    ├── renderer/              # React 渲染进程
    │   ├── App.tsx            # 全局状态编排与主流程（约 1450 行）
    │   ├── ui.tsx             # 全部 UI 组件（约 3150 行）
    │   ├── conversation.ts    # 会话事件归并、消息归一化、diff 解析等纯逻辑
    │   ├── i18n.tsx           # LocaleProvider / useI18n
    │   ├── highlight.ts       # 代码高亮
    │   ├── main.tsx           # 入口
    │   └── styles.css         # 全局样式
    ├── shared/                # 主进程与渲染进程共享的纯函数层（两侧均可 import）
    │   ├── types.ts           # IPC 契约 DesktopApi、权限/沙箱类型、provider 枚举
    │   ├── i18n.ts            # 中英文文案表与 t() 翻译
    │   ├── skills.ts          # 技能命令解析（/skill:xxx、<skill> 块）
    │   ├── thinking.ts        # 思考等级 / effort 映射、模型推理能力推断
    │   ├── chat-profiles.ts   # DeepSeek / 自定义 profile 数据模型与迁移
    │   ├── openai-models.ts   # {base}/models 模型列表抓取与解析
    │   └── vision-api.ts      # GLM-4V / MinerU 视觉 API 封装
    └── extensions/
        └── vision.ts          # 视觉扩展（作为 agent 插件注册 vision 工具）
```

### 2.1 模块之间的依赖规则

- `src/shared/**`：纯函数，无 Electron / React 依赖，主进程、preload、渲染进程都可以 import；两侧都必须可以运行其代码。
- `src/main/**` 只能 import `src/shared`，不能 import `src/renderer`。
- `src/renderer/**` 通过 `window.harness`（类型为 `DesktopApi`）访问桌面能力，不直接 import Electron。
- `src/preload/index.ts` 是 IPC 通道的一对一映射层，新增 IPC 时同步修改 `shared/types.ts`（类型契约）→ `preload/index.ts`（调用方）→ `main/index.ts`（实现）。

## 3. 快速开始

### 3.1 环境要求

- Node.js `>= 22.19`
- pnpm（`pnpm-workspace.yaml` 已配置 allowBuilds）
- macOS（Apple Silicon）或 Windows x64

### 3.2 常用命令

```bash
pnpm install        # postinstall 会执行 scripts/ensure-electron.mjs 补齐 Electron 二进制
pnpm dev            # Vite dev server (127.0.0.1:5177) + Electron
pnpm typecheck      # tsc --noEmit
pnpm test           # vitest run
pnpm build          # build:electron (tsup) + build:renderer (vite build)
pnpm check          # typecheck + test + build
pnpm pack           # build + electron-builder（mac + win）
pnpm pack:mac       # 仅 macOS dmg
pnpm pack:win       # 仅 Windows nsis
```

注意：`pnpm test` 在 CI 之外可能触发 pnpm 的依赖状态检查并尝试重新 install；在受限环境直接执行 `node_modules/.bin/vitest run`（必要时加 `--pool=threads`）即可。

### 3.3 与 Runtime 同时开发

应用从 npm 消费 `tether-agent-core`。如果要同时改 Runtime 本身，临时把本地 Runtime 包链接进来（README 建议 `../tether-runtime/packages/core`）。正式发布前记得改回 registry 版本。

## 4. IPC 契约（src/shared/types.ts）

`DesktopApi` 是渲染进程能访问的全部能力的类型契约，`window.harness` 即其实例。所有通道名以 `域:动作` 命名，`invoke`（请求-响应）为主，个别为 `send`（事件）。

### 4.1 通道清单

| 域                    | 通道                                                                                                                                                             | 说明                                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| app                   | `app:version` / `app:open-external` / `app:reveal-path` / `app:list-skills` / `app:check-update` / `app:get-locale` / `app:set-locale`                           | 版本、外链（仅 http(s)）、技能目录 reveal、技能列表、手动更新检查、语言读写                                      |
| window                | `window:minimize` / `window:toggle-maximize` / `window:close`                                                                                                    | 非 macOS 无边框窗口的标题栏按钮（macOS 用原生 traffic lights）                                                   |
| workspace             | `workspace:choose` / `workspace:recent` / `workspace:forget` / `workspace:read` / `workspace:open` / `workspace:reveal` / `workspace:list` / `workspace:restore` | 选择/最近/遗忘工作区、读文件（200KB 截断、二进制检测）、外部打开、文件管理器显示、列出工作区文件树、批量恢复文件 |
| workspace（事件）     | `workspace:changed`                                                                                                                                              | 工作区文件变更（fs.watch 递归 + 200ms 防抖）                                                                     |
| vision                | `vision:config` / `vision:save-config` / `vision:stage`                                                                                                          | 视觉配置读写、图片暂存（base64 落盘到 userData/uploads）                                                         |
| sessions              | `sessions:list` / `sessions:remove` / `sessions:pin` / `sessions:rename`                                                                                         | 会话列表 / 归档删除 / 置顶 / 重命名（追加 `session_info` 条目 + 重建索引）                                       |
| auth                  | `auth:status` / `auth:read-api-key` / `auth:save-api-key` / `auth:list-models` / `auth:profiles` / `auth:save-profiles` / `auth:logout`                          | provider 状态（stored / environment）、API key 读写、模型列表、chat profiles 读写、登出                          |
| agent                 | `agent:start` / `agent:stop` / `agent:command` / `agent:ui-response`                                                                                             | 启动/停止 agent 子进程、执行 RPC 命令、回复扩展 UI 请求                                                          |
| agent（事件）         | `agent:event` / `agent:error`                                                                                                                                    | agent 事件流 / 错误流                                                                                            |
| 主进程 → 渲染（事件） | `app:command`                                                                                                                                                    | 菜单动作（`new-thread` / `open-folder` / `fullscreen-on` / `fullscreen-off`）                                    |

### 4.2 关键类型

- `PermissionMode`: `"plan" | "ask" | "auto" | "full"` —— 权限模式。
- `SandboxMode`: `"read-only" | "workspace-write" | "danger-full-access"` —— 沙箱模式。
- `ProviderId`: `deepseek` / `openai-codex` / `openai` / `anthropic` / `openrouter` / `zai` / `kimi-coding` / `minimax` / `xai` / `opencode-go`。桌面设置目前重点暴露 DeepSeek 与自定义 OpenAI 兼容 Base URL；其余 provider 的 UI 是渐进式暴露的（`auth.status` 已返回全部）。
- `AgentStartOptions`：`agent:start` 入参（cwd / project / provider / model / baseUrl / maxTokens / effort / permission / sandbox / network / sessionPath / resume / extraModels）。
- `AgentSnapshot`：启动时一次性返回 state / messages / models / thinkingLevels / stats / skills。
- `AgentEvent`：`Record<string, unknown> & { type: string }` —— 所有事件带 `type` 字段，具体事件类型见 §6.4。

**新增 IPC 的标准步骤**（以新增 `workspace:foo` 为例）：

1. `src/shared/types.ts` 在 `DesktopApi.workspace` 下加 `foo(...): Promise<T>`。
2. `src/preload/index.ts` 加 `foo: (args) => ipcRenderer.invoke("workspace:foo", args)`。
3. `src/main/index.ts` 的 `registerIpc()` 里加 `ipcMain.handle("workspace:foo", ...)`，并做入参校验与错误处理。
4. 若涉及工作区路径，必须走 `resolveInWorkspace()` 做根目录校验（防目录穿越）。

## 5. Agent 子进程协议（src/main/agent-host.ts）

agent 运行在独立的 Node 子进程里（`tether-agent-core` 的 RPC 入口），通信协议是**换行分隔的 JSON-RPC over stdio**：

- 请求：主进程向 `child.stdin` 写一行 `{ type, id, ...data }` JSON。
- 响应：子进程在 stdout 回 `{ type: "response", id, success, data | error }`。
- 事件：子进程在 stdout 推送 `{ type: "...", ... }`，主进程通过 `agent:event` 转发给渲染进程。
- stderr 收集起来，用于超时/退出时报错详情。

### 5.1 请求超时

| 分类                                                                                                                                     | 超时  |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| 普通请求（get_state、set_model 等）                                                                                                      | 45s   |
| 长请求（`prompt` / `steer` / `abort` / `get_entries` / `get_fork_messages` / `get_messages` / `get_session_stats` / `fork` / `compact`） | 30min |

### 5.2 允许的 RPC 命令白名单

主进程在 `ALLOWED_AGENT_COMMANDS` 里维护白名单，渲染进程 `agent:command` 只能发这些命令：

```
prompt  steer  abort  new_session  get_state  get_messages  set_model
set_thinking_level  get_session_stats  get_available_models  get_available_thinking_levels
get_fork_messages  get_entries  get_commands  fork  compact
```

新增命令必须同时加入白名单，否则渲染进程调用会被拒绝。

### 5.3 生命周期

- `start()`：先 `stop()` 旧的 → spawn（`ELECTRON_RUN_AS_NODE=1`、`PI_TELEMETRY=0`、`PI_SKIP_VERSION_CHECK=1`、可选 `HARNESS_EXTRA_MODELS` / `HARNESS_VISION_CONFIG` / `HARNESS_VISION_UPLOADS` 环境变量）→ 返回 `snapshot()`。
- `stop()`：SIGTERM，900ms 后仍未退出则 SIGKILL；所有 pending 请求 reject。
- `handleLine()`：响应按 `id` 匹配 pending；非响应行视为事件转发。
- 子进程退出：pending 全部 reject，并 emitError（附 stderr）。

### 5.4 启动参数

`agent:start` 在 `src/main/index.ts` 里做了几件事：

- cwd 缺省为 `userData/tasks`（无项目时的只读任务区）。
- resume 且同会话时直接返回当前 snapshot（不重启进程）。
- 沙箱兜底：`tasks` 目录强制 `read-only`；请求 `read-only` 的项目提升为 `workspace-write`。
- 附加 vision 扩展参数：`--extension dist-electron/extensions/vision.js`、`HARNESS_VISION_CONFIG`、`HARNESS_VISION_UPLOADS`。
- 自定义 profile 的 maxTokens 会作为 `--max-tokens` 传入。

## 6. 渲染进程

### 6.1 App.tsx —— 状态编排

`App()` 是唯一的大型状态容器，主要状态：

| 状态                                                 | 含义                                      |
| ---------------------------------------------------- | ----------------------------------------- |
| `workspace` / `workspaces`                           | 当前工作区路径 / 最近工作区列表           |
| `sessions` / `activeSession`                         | 会话列表 / 当前会话文件路径               |
| `messages`                                           | 渲染用消息数组（`ChatMessage[]`）         |
| `queued`                                             | 生成中排队的消息（最多 5 条）             |
| `running` / `loading` / `sending`                    | agent 流式状态机                          |
| `permission` / `effort` / `model` / `thinkingLevels` | 权限模式 / 思考力度 / 模型 / 可用思考等级 |
| `uiRequest`                                          | 扩展 UI 请求（确认框、选择框等）          |
| `sandboxAsk`                                         | Windows 无沙箱时的直接访问确认            |
| `preview`                                            | 文件 diff 抽屉                            |

关键流程（useCallback 链）：

- `startAgent(cwd, sessionPath, asProject, resume, mode, seedMessage)` —— 统一入口：校验凭据 → 解析沙箱 → `window.harness.agent.start` → hydrate 消息 → set_model / set_thinking_level 同步 → 刷新会话列表与技能。首条消息时把乐观用户消息作为 `seedMessage` 传入。
- `bindProject` / `openFolder` / `newThread` / `removeProject` —— 项目与会话切换；切换前若 agent 在跑会提示先停止。
- `sendMessage(preset, images)` —— 见 §6.3。
- `undoLastTurn` / `compactContext` —— 见 §7。
- `onEvent` 事件订阅 —— 见 §6.4。

渲染结构：`SidebarNav`（项目树+会话）+ `Chat`（消息流 + composer + `InspectPanel` 右侧检查栏 + `FileDrawer` diff 抽屉）。

### 6.2 消息模型（conversation.ts）

`ChatMessage`：

```ts
interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string; // 纯文本（thinking 已剥离）
  thinking?: string; // 思考内容（<thinking> 块）
  timestamp?: number;
  streaming?: boolean; // 流式进行中
  queued?: boolean;
  images: ChatImage[]; // 粘贴的图片（data URI 或磁盘 src）
  tools: ToolActivity[]; // 工具调用（running / complete / error）
  work: WorkItem[]; // 时序化的工作项（thinking / text / tool）
  error?: string;
}
```

`conversation.ts` 是**纯逻辑层**（无 React），职责：

- `normalizeMessages`：agent 的原始消息数组 → `ChatMessage[]`；`toolResult` 角色回填到对应工具。
- `applyAgentEvent(messages, event)`：增量应用事件（见 §6.4）。
- `groupConversation`：相邻 assistant 消息合并为一个 `ConversationGroup`（一"轮"）。
- `turnAnchors`：按真实用户问题生成跳转锚点。
- `collectFileChanges` / `splitPatch` / `changesFromPatch`：从工具参数/输出解析文件变更与行数统计。
- `collectWorkingFiles` / `sessionTools` / `sessionTerminals`：InspectPanel 的输入。
- `collectTodos` / `parseFeaturesJson`：任务清单（todo 工具 → plan 工具 → `.agents/features.json` → markdown checkbox 优先级）。
- `friendlyAgentError` / `isRecoverableRequestError`：错误归类（401/429/504/模型/端点/网络/上下文）。
- `lastTurnRestoreFiles` / `hasNewCheckpointUndo`：/undo 的 checkpoint 解析。
- 富文本辅助：`splitThinkTags`（剥离模型 XML 思考块）、`collapseThinking`、`repairMarkdownTables`、`splitHttpUrls`、`splitPromptChips`（composer 的 URL / @文件 chip 恢复）。

### 6.3 发送消息的主链路

1. `sendMessage` 校验非空且未在发送中；`/undo` 走专门分支。
2. 若 `running`：普通文本进入队列（最多 5 条，`/` 命令不排队）；否则继续。
3. 无工作区时先 `openFolder()`。
4. **乐观渲染**：`optimisticUserMessage` 立即把用户消息画进列表，`setRunning(true)`。
5. 首次发送（无 agent）：`startAgent(..., seedMessage=乐观消息)`。
6. `agent:command("prompt", { message })`；带图时先 `vision:stage`（base64 落盘），消息体替换为 `visionAgentPrompt`（含 handoff 路径）。
7. 失败：移除乐观消息、恢复 draft、toast 错误；`agent_settled` 事件负责收尾状态。

队列消费：useEffect 监听 `queued`，非运行/非加载时逐条取出发送；停止（abort）**保留**队列，切对话/换项目/新聊天清空队列。

### 6.4 事件流（applyAgentEvent）

agent 事件通过 `agent:event` 推送，`App.tsx` 里先做副作用处理（`running`、toast、UI 请求），再交给 `applyAgentEvent` 归并：

| 事件                                               | 归并行为                                                                                                 |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `agent_start`                                      | `setRunning(true)`                                                                                       |
| `agent_settled`                                    | 清 streaming/queued 标记；拉取 stats 与会话列表；关掉 UI 请求                                            |
| `agent_end`                                        | 若末条 assistant 带 error，给最后一条消息标错                                                            |
| `message_start` / `message_update` / `message_end` | 用户消息去重（同文本合并）；assistant 消息增量 merge（`mergeAssistant`，保留 thinking 合并与 work 拼接） |
| `tool_execution_start` / `_update` / `_end`        | upsert 工具活动（`upsertLastAssistantTool`），状态 running→complete/error，附带输出与 details            |
| `extension_ui_request`                             | `notify` → toast；`select/confirm/input/editor` → `uiRequest` 弹卡片                                     |
| `extension_error`                                  | 非瞬态错误 toast                                                                                         |

`mergeAssistant` 的 work 归并用 `graftWork`：快照消息只带自己的 part，后续 thinking 片段按"包含关系"（`overlaps`）定位已有槽位就地更新，其余追加——保证一轮里所有思考按发生顺序保留。

### 6.5 ui.tsx —— 组件

按功能分组的导出组件：

- **会话渲染**：`UserTurn` / `AssistantTurn` / `Thinking` / `StreamingText` / `Markdown`（react-markdown + remark-gfm + 自绘 copy 按钮）。
- **导航**：`SidebarNav` / `TurnNav`（回合跳转）/ `WindowControls`（Windows 无边框窗口按钮）。
- **右侧检查栏**：`InspectPanel`（工作文件 / 任务清单 / 终端 jobs，宽度可拖拽记忆）/ `ChangeSummary` / `FileDrawer`（diff 拆分视图，`splitPatch` 按 git 风格行渲染）。
- **Composer**：`PromptBar`（contenteditable，支持 `@` 文件 chip、URL chip、图片 chip、排队行、模型/力度/权限选择器）。
- **设置**：`Login`（多 pane：chat / vision / skills / shortcuts / about）。
- **通用**：`Icon`（内联 SVG path）/ `CopyButton` / `ApprovalCard` / `PermissionPicker` / `EffortPicker` / `Combo`（组合输入框）/ `ContextStats`。

样式全部在 `styles.css`（手写 CSS，无 UI 框架）。改 UI 气质前先读 `.agents/skills/tether-ui/SKILL.md` 与 `tokens.md`（界面气质规范）。

### 6.6 国际化

- 文案集中在 `src/shared/i18n.ts`：`zh` / `en` 两个扁平 key 表，`t(locale, key, vars)` 做 `{var}` 插值。
- `i18n.tsx` 提供 `LocaleProvider` / `useI18n()`，首次从 `app:get-locale` 加载，切换时同步 `setConversationLocale`（让 conversation.ts 的纯函数文案也跟随语言）。
- 渲染进程内不直接写死用户可见文案；新增文案必须同时加 `zh` 与 `en` 两个 key。
- 语言解析：`resolveLocale` 优先存储值（`~/.tether/settings.json` 的 `locale`），否则跟随系统语言列表；默认 `zh`。

## 7. 会话、恢复与编辑安全

### 7.1 会话文件

会话由 `tether-agent-core` 管理（`TetherStateStore` / `listTetherThreads`），主进程只做映射：`sessions:list` 把 thread 转成 `SessionSummary`（含 `path` 会话文件路径、`storagePath` 索引路径、`preview` 等）。重命名通过**追加**一条 `session_info` 条目并重建索引完成（`sessions:rename`）。

恢复：打开会话时 `agent:start({ sessionPath, resume: true })` 传入会话文件，agent 进程从磁盘恢复；渲染层用 `normalizeMessages` 重建消息，磁盘上的图片只存暂存路径，用 `stagedImages` 重建为 `src` 引用（经预览协议访问）。

### 7.2 /undo 与 checkpoint

`tether-agent-core` 在文件写入时落 `tether-checkpoint` 条目（含每个文件的 `before` 内容）。`/undo` 流程：

1. `get_entries` 拉会话条目，`lastTurnRestoreFiles` 解析**最后一个真实用户轮之后**、未被 `tether-checkpoint-undone` 撤销过的最新 checkpoint 的 before 文件集。
2. 弹 `ApprovalCard` 确认（`harness:undo` 特殊 id）。
3. 确认后 `workspace:restore(files)` 写回文件（`content: null` 表示删除），并 `dropLastTurn` 移除 UI 上该轮消息。

`hasNewCheckpointUndo` 用于在事件流里识别"撤销已发生"，避免竞态重复撤销。

### 7.3 上下文压缩

`compactContext`：非运行态 → 确保有 agent → `agent:command("compact")` → 拉新消息与 stats 刷新界面。会话太短/无会话时有专门的中文 toast。

### 7.4 终端 jobs

后台/进行中的 shell 命令由 `sessionTerminals` 从工具活动里提炼（`process_id` 追踪），InspectPanel 可 `stopJobs("/stop-job <id>")` 或 `/stop-jobs`（需要 tether-agent-core ≥ 0.1.6 提供该命令）。

## 8. 权限、沙箱与安全边界

### 8.1 权限模式（PermissionMode）

| 模式   | 行为                                     |
| ------ | ---------------------------------------- |
| `plan` | 只读分析与规划；诊断命令可在只读沙箱运行 |
| `ask`  | 写入/网络/边界升级前询问                 |
| `auto` | 普通工作区操作自动执行，升级时询问       |
| `full` | 对显式信任的项目关闭工作区沙箱           |

### 8.2 沙箱解析（resolveSandbox）

- 非项目（tasks 区）：强制 `read-only`。
- `full` 模式：`danger-full-access`。
- macOS：`workspace-write`（系统 Seatbelt 沙箱）。
- Windows 且非信任项目：弹确认框（`sandboxAsk`）询问是否允许直接访问；允许后记住（`rememberUnsandboxed`，存 localStorage），否则回落 `workspace-write`。Windows 若选了项目但沙箱不是 full 且没允许，发送流程会取消并提示。

### 8.3 工作区文件安全

所有渲染进程发来的相对路径都必须经过 `resolveInWorkspace()`：解析后必须落在"当前 agent cwd 或最近工作区"之内，否则拒绝（防目录穿越）。`servePreview`（预览协议）只服务工作区内文件，`uploads` host 只按 basename 服务暂存图片。外部链接只允许 http(s)。`workspace:read` 有 200KB 截断与二进制检测（`buffer.includes(0)`）。

## 9. 视觉能力（src/extensions/vision.ts）

`src/extensions/vision.ts` 是作为 agent 插件（`--extension` 参数）注册的视觉工具：

- **GLM-4V-Flash 识图**：需要用户配置智谱 API key（`vision-config.json`）；走 OpenAI chat.completions 兼容格式，data URI 传图。
- **MinerU OCR**：免费 OCR，异步上传 + 轮询（45s 超时），失败静默降级。
- 工具在**本回合用户粘贴了图片**或消息含图片 handoff 时才启用（`before_agent_start` 里粘性决定，会话内不中途摘除，避免模型回退到 shell OCR 花招）。
- 系统提示注入两条工程约定：`NO_CAPTURE`（除非用户本轮明确要截图，否则不用 Chrome/headless 截图验收）与语言旁白规则（按可见用户文本是否含 CJK 选择中/英文）。
- 扩展 API 来自 agent-core 的 `ExtensionAPI`：`registerTool` / `getActiveTools` / `setActiveTools` / `on`。

shared 层 `vision-api.ts` 提供纯函数：请求构造、响应解析、结果合并（GLM + OCR 分段）、`visionHandoffPaths` / `visibleUserText`（从 handoff 消息还原用户原文与图片路径）。图片粘贴后 base64 经 `vision:stage` 落盘到 `userData/uploads`（限制 4 张），会话文件里只存暂存路径。

## 10. 数据与存储布局

| 位置                                                                        | 内容                                                                                                                                   |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `appData/Tether`（userData，旧的 `appData/DSHarness` 首次启动自动改名迁移） | `recent-workspaces.json`（最近工作区）、`vision-config.json`、`chat-profiles.json`、`uploads/`（暂存图片）、`tasks/`（无项目时的 cwd） |
| `~/.tether`（getTetherHome，tether-agent-core 管理）                        | `settings.json`（locale / 默认 provider+model）、会话索引与线程存储、凭据（`TETHER_CREDENTIALS_STORE=file` 时落文件而非系统钥匙串）    |
| 项目内 `.agents/`                                                           | `features.json`（跨会话任务清单）、`progress.md`（进度）——由技能约定维护                                                               |

环境变量约定：`TETHER_CREDENTIALS_STORE=file`（分发版避免钥匙串弹窗）；`PI_TELEMETRY=0`；`PI_SKIP_VERSION_CHECK=1`；`HARNESS_EXTRA_MODELS` / `HARNESS_VISION_CONFIG` / `HARNESS_VISION_UPLOADS` 传给 agent 子进程。

## 11. 技能（Skills）系统

技能由 Pi 运行时加载（Tether 不另写 loader），本仓库只做 UI 与文件系统辅助：

- **扫描**：`src/main/skills-fs.ts` 扫用户级（`~/.tether/skills`、`~/.agents/skills`）与项目级（`.agents/skills`、`.pi/skills`，需信任项目）；`app:list-skills` 供设置页展示。
- **运行时命令**：agent 侧 `get_commands` 返回 `source === "skill"` 的命令，`src/shared/skills.ts` 的 `parseSkillCommands` 解析出 `AgentSkillCommand[]`（name / description / path），供 `/` 补全与设置页。
- **输入归一**：`skillUserDisplay` 把 `/skill:xxx` 或展开的 `<skill>` 块折叠成统一命令；`sameUserSkillTurn` 用于消息去重。
- **项目内技能**：`.agents/skills/` 下有 `init-long-run` / `continue-long-run` / `plan-then-act` / `tether-ui`（界面气质）。技能文件必须含 frontmatter `name` + `description`，缺项不加载。
- 技能目录文件会被 `listWorkspaceFiles` 的 `addSkillManifests` 额外收录进工作区文件树，`@` 选择器可引用。

## 12. 构建与打包

### 12.1 三端构建（tsup.config.ts）

| 产物    | 入口                       | 格式          | 输出                                                       |
| ------- | -------------------------- | ------------- | ---------------------------------------------------------- |
| 主进程  | `src/main/index.ts`        | ESM（`.mjs`） | `dist-electron/main/index.mjs`（`package.json` 的 `main`） |
| preload | `src/preload/index.ts`     | CJS（`.cjs`） | `dist-electron/preload/index.cjs`                          |
| 扩展    | `src/extensions/vision.ts` | ESM（`.js`）  | `dist-electron/extensions/vision.js`                       |

`electron` 与 `tether-agent-core` 标记为 external。

### 12.2 渲染进程（vite.config.ts）

dev server 固定 `127.0.0.1:5177`（strictPort）；build 产物 `dist/`，`base: "./"`（file:// 加载）；vitest 配置同文件（`src/**/*.test.ts`，node 环境）。

### 12.3 打包（electron-builder.yml）

- `asar: false`：RPC worker 与原生 keyring 需要真实文件路径。
- `extraResources` 放 `icon.png`；mac 用 `logo.icns`（ad-hoc 签名 `identity: "-"`，避免 Gatekeeper 报"已损坏"），Windows 用 `build/icon-win.png`（任务栏图标与 mac 留白不同）。
- mac 目标 dmg（arm64）、win 目标 nsis（x64）、linux 目标 dir。
- `.github/workflows/release.yml` 负责发布流水线。

### 12.4 Electron 二进制补齐（scripts/ensure-electron.mjs）

postinstall / predev 执行：检查 Electron 发行二进制是否完整，缺失时跑 `install.js`，macOS 下还会从 `~/Library/Caches/electron` 缓存 zip 解压，并把 `Info.plist` 的 `CFBundleName` / `CFBundleDisplayName` 改为 Tether。

## 13. 测试

- 位置：与源码同目录的 `*.test.ts`（Vitest，node 环境），目前 12 个文件约 112 个用例。
- 重点覆盖：`conversation.ts` 事件归并与解析（最大测试面）、`shared/*` 纯函数（i18n、chat-profiles、thinking、skills、vision-api、openai-models）、`main/*` 工具（rpc-lines、skills-fs、update-check）。
- 运行：`pnpm test` 或 `node_modules/.bin/vitest run`；CI 里用默认配置。
- 已知环境相关失败：`skills-fs.test.ts` 假设 `$HOME` 干净（临时 HOME 下只有它创建的 skill）；若本机 `$HOME` 下存在真实技能目录（如 `.cursor/skills-cursor`）会多出条目导致断言失败——CI/干净环境不受影响。

给纯逻辑（conversation / shared）加功能时，遵循"先补 `*.test.ts` 再实现"的节奏；新用例用 Vitest 的 `describe/it/expect`。

## 14. 常见开发任务

### 14.1 加一个 IPC 能力

见 §4.2 的四步流程。注意：主进程 handler 里对渲染进程传来的未知数据一律先做类型/范围校验（长度、白名单、路径越界）。

### 14.2 加一条用户可见文案

1. `src/shared/i18n.ts` 的 `zh` 与 `en` 表各加一个 key（面向用户用简体中文）。
2. 渲染进程用 `const { t } = useI18n()` 取 `t("key", { var })`；conversation.ts 纯函数用 `ct(key, vars)`。
3. 不要硬编码文案；代码、路径、命令保持原文。

### 14.3 加一个 UI 组件 / 改界面气质

- 组件放 `src/renderer/ui.tsx`（或拆到新文件），样式进 `styles.css`。
- 先读 `.agents/skills/tether-ui/SKILL.md` 与 `tokens.md`，保持配色、圆角、间距令牌一致。
- 视觉验收：按仓库约定**不要用 Chrome/headless/截图**做验收（除非用户本轮明确要求截图），写完 HTML/CSS 即可。

### 14.4 加一个 agent 工具或 RPC 命令

1. 命令：加入 `ALLOWED_AGENT_COMMANDS` 白名单；`agent:command` 入参透传给 agent-core。
2. 事件：工具的执行事件由 `conversation.ts` 的 `toolFromEvent` / `upsertLastAssistantTool` 归并，若有新工具类型需在 `toolTitle` / `traceRows` / `liveStatus` 增加标题与图标分支。
3. 若新工具产出文件变更，确保 `collectFileChanges` 能解析（patch 参数 / details.files / output 正则）。
4. 长请求记得加入 `LONG_RUNNING_REQUESTS` 超时集合。

### 14.5 修改会话持久化格式

先看 `tether-agent-core` 的会话条目类型（`SessionEntryLike`：`message` / `custom` 条目）；`conversation.ts` 的解析函数与 `lastTurnRestoreFiles` 依赖 `tether-checkpoint` / `tether-checkpoint-undone` 的 customType 约定，改动需同步。

## 15. 工程约定（AGENTS.md 摘要）

- 新对话必须先选项目；绑定 cwd，发第一条消息才 `startAgent`。
- 生成中回车进入排队（最多 5 条，不入会话文件）；停止保留排队，换对话/项目清空；`/` 命令不进队。
- 跨会话进度写在 `.agents/features.json` 和 `.agents/progress.md`，不要只写在聊天里；`features.json` 只改 `passes`，不删条目或改 `description`。
- 面向用户文案用简体中文；代码、路径、命令保持原文。
- 改动涉及嵌套目录前，先读相应层级的 `AGENTS.md` / `CLAUDE.md`。

## 16. 常见问题

| 现象                  | 排查                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------ |
| `pnpm dev` 后窗口空白 | dev server 必须占用 `127.0.0.1:5177`（strictPort），被占用会启动失败；检查 `VITE_DEV_SERVER_URL` |
| agent 卡住无响应      | 查看 `AgentHost` 的请求超时（普通 45s / 长请求 30min）；子进程 stderr 会拼进错误消息             |
| 测试报 kill EPERM     | 沙箱环境限制 tinypool 清理子进程；用 `vitest run --pool=threads`                                 |
| skills 不加载         | frontmatter 缺 `name`/`description`；项目技能需先信任项目；路径要在标准 skill 根                 |
| /undo 无效果          | 该轮没有写入类工具；或 checkpoint 已被撤销；`get_entries` 里应有 `tether-checkpoint` 条目        |
| 打开旧版本会话数据    | 首次启动会尝试把 `DSHarness` 改名迁移到 `Tether`；迁移不可用时旧目录仅老版本可用                 |

---

_文档维护：改动 IPC 通道、agent 协议、存储布局或组件结构时，请同步更新本文档对应章节。_
