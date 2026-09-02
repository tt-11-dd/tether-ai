# Tether Development Guide

> 简体中文: [DEVELOPMENT.md](DEVELOPMENT.md)

> A repo-oriented AI coding desktop workbench. This guide is for engineers working inside the Tether repository: architecture, module responsibilities, key data flows, and common development tasks. Product description and user documentation live in `README.md` / `README.zh-CN.md`.

## 1. Project Overview

Tether is a local-first AI coding desktop workbench built on Electron: model calls, workspace tools, terminal commands, permission prompts, session history, and diff review all live in one desktop app. The UI and session data stay on your machine; model requests go directly to the provider or local gateway you configure.

**Core positioning**: Tether does not reimplement agent foundations. The agent loop, sandbox, sessions, tools, checkpoints, MCP, and Hooks are all provided by the npm package `tether-agent-core` (which wraps the Pi ecosystem `@earendil-works/pi-*`). This repository is responsible for:

- The Electron shell (windows, menus, IPC, permission entry points, workspace file access, update checks)
- The renderer UI (React, Chinese/English interface)
- Bridging the `tether-agent-core` RPC child process into a desktop-usable agent

| Technology | Purpose |
| --- | --- |
| Electron 37 | Desktop shell, main process, contextBridge isolation |
| React 19 + react-markdown | Renderer UI |
| TypeScript 5.9 (strict) | All source code |
| Vite 7 | Renderer build + dev server |
| tsup 8 | Main / preload / extension builds (ESM/CJS) |
| Vitest 3 | Unit tests |
| tether-agent-core 0.1.18 | Agent runtime (RPC worker, sandbox, sessions, checkpoints) |
| electron-builder 26 | Packaging dmg / nsis / dir |

### 1.1 Architecture Layers

```text
React Renderer (src/renderer)
  conversation rendering, diff panel, settings, project/session navigation, composer
        │  contextBridge (window.harness) / Electron IPC
        ▼
Electron Main (src/main)
  windows, workspace files, credentials, AgentHost child-process host, update checks, preview protocol
        │  newline-delimited JSON-RPC over stdio
        ▼
tether-agent-core (node_modules dependency, RPC worker process)
  permissions, sandbox, tools, checkpoints, MCP, session files, Pi agent loop
```

The renderer has no direct Node.js access; all desktop capabilities cross the typed `DesktopApi` contract defined in `src/shared/types.ts` over IPC. The agent runs in a separate child process (spawned via `process.execPath` with `ELECTRON_RUN_AS_NODE=1`). After a crash, an on-disk session can still continue as a conversation, but Tether never silently replays unfinished commands.

## 2. Directory Layout

```text
.
├── AGENTS.md                  # repo-level engineering conventions (pick a project first, cross-session progress, …)
├── README.md / README.zh-CN.md
├── package.json               # scripts: dev / build / typecheck / test / check / pack*
├── electron-builder.yml       # packaging config (asar: false, icons, target platforms)
├── tsup.config.ts             # three-target build: main / preload / extension
├── vite.config.ts             # renderer dev server + build + vitest config
├── tsconfig.json
├── pnpm-workspace.yaml        # allowBuilds / minimumReleaseAgeExclude config
├── scripts/
│   ├── ensure-electron.mjs    # postinstall: fix Electron binaries, write path.txt, patch Info.plist name
│   └── make-icon.py           # icon generation script
├── build/                     # icon assets (icon.png / icon-win.png / icon.svg)
├── .agents/skills/            # built-in project skills (init-long-run / continue-long-run / plan-then-act / tether-ui)
├── .github/workflows/release.yml
└── src/
    ├── main/                  # Electron main process
    │   ├── index.ts           # windows, IPC, workspace, permissions, updates, preview protocol (~850 lines)
    │   ├── agent-host.ts      # Agent RPC child-process host (spawn / requests / event dispatch)
    │   ├── rpc-lines.ts       # line-splitting for RPC stdout (UTF-8 safe)
    │   ├── skills-fs.ts       # local skills directory scanning and reveal
    │   └── update-check.ts    # GitHub Release update checks
    ├── preload/
    │   └── index.ts           # contextBridge exposing window.harness (DesktopApi)
    ├── renderer/              # React renderer
    │   ├── App.tsx            # global state orchestration and main flows (~1450 lines)
    │   ├── ui.tsx             # all UI components (~3150 lines)
    │   ├── conversation.ts    # session event merging, message normalization, diff parsing (pure logic)
    │   ├── i18n.tsx           # LocaleProvider / useI18n
    │   ├── highlight.ts       # code highlighting
    │   ├── main.tsx           # entry point
    │   └── styles.css         # global styles
    ├── shared/                # pure-function layer shared by main and renderer (importable on both sides)
    │   ├── types.ts           # IPC contract DesktopApi, permission/sandbox types, provider enum
    │   ├── i18n.ts            # zh/en message tables and t() translation
    │   ├── skills.ts          # skill command parsing (/skill:xxx, <skill> blocks)
    │   ├── thinking.ts        # thinking levels / effort mapping, model reasoning inference
    │   ├── chat-profiles.ts   # DeepSeek / custom profile data model and migration
    │   ├── openai-models.ts   # {base}/models listing and parsing
    │   └── vision-api.ts      # GLM-4V / MinerU vision API wrappers
    └── extensions/
        └── vision.ts          # vision extension (registers the vision tool as an agent plugin)
```

### 2.1 Module Dependency Rules

- `src/shared/**`: pure functions with no Electron / React dependencies. Importable by the main process, preload, and renderer; the code must run on both sides.
- `src/main/**` may only import `src/shared`, never `src/renderer`.
- `src/renderer/**` accesses desktop capabilities through `window.harness` (typed as `DesktopApi`); it never imports Electron directly.
- `src/preload/index.ts` is a one-to-one mapping layer for IPC channels. When adding IPC, update `shared/types.ts` (type contract) → `preload/index.ts` (caller) → `main/index.ts` (implementation) together.

## 3. Quick Start

### 3.1 Requirements

- Node.js `>= 22.19`
- pnpm (`pnpm-workspace.yaml` already configures allowBuilds)
- macOS (Apple Silicon) or Windows x64

### 3.2 Common Commands

```bash
pnpm install        # postinstall runs scripts/ensure-electron.mjs to fix up Electron binaries
pnpm dev            # Vite dev server (127.0.0.1:5177) + Electron
pnpm typecheck      # tsc --noEmit
pnpm test           # vitest run
pnpm build          # build:electron (tsup) + build:renderer (vite build)
pnpm check          # typecheck + test + build
pnpm pack           # build + electron-builder (mac + win)
pnpm pack:mac       # macOS dmg only
pnpm pack:win       # Windows nsis only
```

Note: outside CI, `pnpm test` may trigger pnpm's dependency-state check and try to reinstall. In restricted environments, run `node_modules/.bin/vitest run` directly (add `--pool=threads` if needed).

### 3.3 Developing Alongside the Runtime

The app consumes `tether-agent-core` from npm. To work on the Runtime itself at the same time, temporarily link a local copy of the Runtime package (README suggests `../tether-runtime/packages/core`). Switch back to the registry version before releasing.

## 4. IPC Contract (src/shared/types.ts)

`DesktopApi` is the type contract for every capability the renderer can access; `window.harness` is its instance. Channels are named `domain:action`; most are `invoke` (request/response), a few are `send` (events).

### 4.1 Channel Reference

| Domain | Channels | Description |
| --- | --- | --- |
| app | `app:version` / `app:open-external` / `app:reveal-path` / `app:list-skills` / `app:check-update` / `app:get-locale` / `app:set-locale` | version, external links (http(s) only), reveal skills directory, skills list, manual update check, locale read/write |
| window | `window:minimize` / `window:toggle-maximize` / `window:close` | caption buttons for the frameless window off macOS (macOS uses native traffic lights) |
| workspace | `workspace:choose` / `workspace:recent` / `workspace:forget` / `workspace:read` / `workspace:open` / `workspace:reveal` / `workspace:list` / `workspace:restore` | pick/recent/forget workspaces, read files (200KB cap, binary detection), open externally, reveal in file manager, list the workspace file tree, batch-restore files |
| workspace (event) | `workspace:changed` | workspace file changes (recursive fs.watch + 200ms debounce) |
| vision | `vision:config` / `vision:save-config` / `vision:stage` | vision config read/write, stage images (base64 to userData/uploads) |
| sessions | `sessions:list` / `sessions:remove` / `sessions:pin` / `sessions:rename` | list / archive-delete / pin / rename sessions (append a `session_info` entry + rebuild index) |
| auth | `auth:status` / `auth:read-api-key` / `auth:save-api-key` / `auth:list-models` / `auth:profiles` / `auth:save-profiles` / `auth:logout` | provider status (stored / environment), API key read/write, model list, chat profiles read/write, logout |
| agent | `agent:start` / `agent:stop` / `agent:command` / `agent:ui-response` | start/stop the agent child process, run RPC commands, reply to extension UI requests |
| agent (events) | `agent:event` / `agent:error` | agent event stream / error stream |
| main → renderer (event) | `app:command` | menu actions (`new-thread` / `open-folder` / `fullscreen-on` / `fullscreen-off`) |

### 4.2 Key Types

- `PermissionMode`: `"plan" | "ask" | "auto" | "full"` — permission modes.
- `SandboxMode`: `"read-only" | "workspace-write" | "danger-full-access"` — sandbox modes.
- `ProviderId`: `deepseek` / `openai-codex` / `openai` / `anthropic` / `openrouter` / `zai` / `kimi-coding` / `minimax` / `xai` / `opencode-go`. The desktop settings currently focus on DeepSeek and custom OpenAI-compatible Base URLs; the rest are exposed progressively in the UI (`auth.status` already returns all of them).
- `AgentStartOptions`: `agent:start` input (cwd / project / provider / model / baseUrl / maxTokens / effort / permission / sandbox / network / sessionPath / resume / extraModels).
- `AgentSnapshot`: state / messages / models / thinkingLevels / stats / skills returned at startup.
- `AgentEvent`: `Record<string, unknown> & { type: string }` — every event carries a `type` field; see §6.4 for concrete event types.

**Standard steps to add IPC** (example: a new `workspace:foo`):

1. In `src/shared/types.ts`, add `foo(...): Promise<T>` under `DesktopApi.workspace`.
2. In `src/preload/index.ts`, add `foo: (args) => ipcRenderer.invoke("workspace:foo", args)`.
3. In `registerIpc()` in `src/main/index.ts`, add `ipcMain.handle("workspace:foo", ...)` with input validation and error handling.
4. If it touches workspace paths, it must go through `resolveInWorkspace()` for root validation (path traversal protection).

## 5. Agent Child-Process Protocol (src/main/agent-host.ts)

The agent runs in a separate Node child process (the `tether-agent-core` RPC entry point). The wire protocol is **newline-delimited JSON-RPC over stdio**:

- Requests: the main process writes one line of `{ type, id, ...data }` JSON to `child.stdin`.
- Responses: the child writes `{ type: "response", id, success, data | error }` on stdout.
- Events: the child pushes `{ type: "...", ... }` on stdout; the main process forwards them to the renderer via `agent:event`.
- stderr is accumulated and used for error details on timeout / exit.

### 5.1 Request Timeouts

| Category | Timeout |
| --- | --- |
| Normal requests (get_state, set_model, …) | 45s |
| Long requests (`prompt` / `steer` / `abort` / `get_entries` / `get_fork_messages` / `get_messages` / `get_session_stats` / `fork` / `compact`) | 30min |

### 5.2 Allowed RPC Command Whitelist

The main process maintains a whitelist in `ALLOWED_AGENT_COMMANDS`; the renderer's `agent:command` can only issue these:

```
prompt  steer  abort  new_session  get_state  get_messages  set_model
set_thinking_level  get_session_stats  get_available_models  get_available_thinking_levels
get_fork_messages  get_entries  get_commands  fork  compact
```

New commands must be added to the whitelist or renderer calls will be rejected.

### 5.3 Lifecycle

- `start()`: `stop()` the old one first → spawn (`ELECTRON_RUN_AS_NODE=1`, `PI_TELEMETRY=0`, `PI_SKIP_VERSION_CHECK=1`, optional `HARNESS_EXTRA_MODELS` / `HARNESS_VISION_CONFIG` / `HARNESS_VISION_UPLOADS` env vars) → return `snapshot()`.
- `stop()`: SIGTERM, SIGKILL after 900ms if still alive; all pending requests are rejected.
- `handleLine()`: responses match pending by `id`; non-response lines are forwarded as events.
- Child exit: pending requests are all rejected and `emitError` fires (with stderr attached).

### 5.4 Startup Parameters

`agent:start` in `src/main/index.ts` does several things:

- Defaults `cwd` to `userData/tasks` (the read-only task area when there is no project).
- On resume with the same session, returns the current snapshot directly (no process restart).
- Sandbox fallbacks: the `tasks` directory is forced to `read-only`; a requested `read-only` project is upgraded to `workspace-write`.
- Attaches the vision extension: `--extension dist-electron/extensions/vision.js`, plus `HARNESS_VISION_CONFIG` and `HARNESS_VISION_UPLOADS`.
- A custom profile's maxTokens is passed as `--max-tokens`.

## 6. Renderer Process

### 6.1 App.tsx — State Orchestration

`App()` is the single large state container. Main state:

| State | Meaning |
| --- | --- |
| `workspace` / `workspaces` | current workspace path / recent workspace list |
| `sessions` / `activeSession` | session list / current session file path |
| `messages` | render-side message array (`ChatMessage[]`) |
| `queued` | messages queued during generation (max 5) |
| `running` / `loading` / `sending` | agent streaming state machine |
| `permission` / `effort` / `model` / `thinkingLevels` | permission mode / thinking effort / model / available thinking levels |
| `uiRequest` | extension UI request (confirm box, select box, …) |
| `sandboxAsk` | direct-access confirmation when Windows has no sandbox |
| `preview` | file diff drawer |

Key flows (useCallback chain):

- `startAgent(cwd, sessionPath, asProject, resume, mode, seedMessage)` — unified entry: validate credentials → resolve sandbox → `window.harness.agent.start` → hydrate messages → sync set_model / set_thinking_level → refresh session list and skills. On first send, the optimistic user message is passed in as `seedMessage`.
- `bindProject` / `openFolder` / `newThread` / `removeProject` — project and session switching; if the agent is running it prompts to stop first.
- `sendMessage(preset, images)` — see §6.3.
- `undoLastTurn` / `compactContext` — see §7.
- `onEvent` subscription — see §6.4.

Render structure: `SidebarNav` (project tree + sessions) + `Chat` (message stream + composer + `InspectPanel` right-hand rail + `FileDrawer` diff drawer).

### 6.2 Message Model (conversation.ts)

`ChatMessage`:

```ts
interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;          // plain text (thinking already stripped)
  thinking?: string;     // thinking content (<thinking> blocks)
  timestamp?: number;
  streaming?: boolean;   // streaming in progress
  queued?: boolean;
  images: ChatImage[];   // pasted images (data URI or on-disk src)
  tools: ToolActivity[]; // tool calls (running / complete / error)
  work: WorkItem[];      // time-ordered work items (thinking / text / tool)
  error?: string;
}
```

`conversation.ts` is the **pure logic layer** (no React). Responsibilities:

- `normalizeMessages`: agent raw messages → `ChatMessage[]`; `toolResult` roles back-fill into the matching tool.
- `applyAgentEvent(messages, event)`: incrementally applies events (see §6.4).
- `groupConversation`: merges adjacent assistant messages into one `ConversationGroup` (a "turn").
- `turnAnchors`: jump anchors from real user questions.
- `collectFileChanges` / `splitPatch` / `changesFromPatch`: file changes and line counts parsed from tool args/output.
- `collectWorkingFiles` / `sessionTools` / `sessionTerminals`: inputs for the InspectPanel.
- `collectTodos` / `parseFeaturesJson`: task lists (todo tool → plan tool → `.agents/features.json` → markdown checkboxes, in priority order).
- `friendlyAgentError` / `isRecoverableRequestError`: error classification (401/429/504/model/endpoint/network/context).
- `lastTurnRestoreFiles` / `hasNewCheckpointUndo`: checkpoint parsing for /undo.
- Rich-text helpers: `splitThinkTags` (strips model XML thinking blocks), `collapseThinking`, `repairMarkdownTables`, `splitHttpUrls`, `splitPromptChips` (URL / @file chip restoration in the composer).

### 6.3 Main Send Path

1. `sendMessage` validates non-empty and not already sending; `/undo` takes a dedicated branch.
2. If `running`: plain text enters the queue (max 5; `/` commands are never queued); otherwise continue.
3. Without a workspace, `openFolder()` runs first.
4. **Optimistic render**: `optimisticUserMessage` paints the user message immediately, `setRunning(true)`.
5. First send (no agent yet): `startAgent(..., seedMessage=optimistic message)`.
6. `agent:command("prompt", { message })`; with images, `vision:stage` first (base64 to disk) and the message body becomes `visionAgentPrompt` (with handoff paths).
7. On failure: remove the optimistic message, restore the draft, toast the error; the `agent_settled` event finishes the state.

Queue consumption: a useEffect watches `queued` and sends items one by one when not running/loading. Stopping (abort) **keeps** the queue; switching threads, starting a new chat, or changing projects clears it.

### 6.4 Event Stream (applyAgentEvent)

Agent events arrive via `agent:event`. `App.tsx` handles side effects first (`running`, toasts, UI requests), then hands the event to `applyAgentEvent`:

| Event | Merge behavior |
| --- | --- |
| `agent_start` | `setRunning(true)` |
| `agent_settled` | clear streaming/queued flags; fetch stats and session list; dismiss UI requests |
| `agent_end` | if the last assistant message carries an error, mark the last message with it |
| `message_start` / `message_update` / `message_end` | dedupe user messages (same-text merge); assistant messages merge incrementally (`mergeAssistant`, preserving thinking merges and work concatenation) |
| `tool_execution_start` / `_update` / `_end` | upsert tool activity (`upsertLastAssistantTool`), status running→complete/error, with output and details |
| `extension_ui_request` | `notify` → toast; `select/confirm/input/editor` → `uiRequest` card |
| `extension_error` | toast unless transient |

`mergeAssistant` merges work with `graftWork`: a snapshot message only carries its own parts, so later thinking fragments locate existing slots by "containment" (`overlaps`) and update in place, appending the rest — so every thought in a turn is kept in the order it happened.

### 6.5 ui.tsx — Components

Exported components grouped by function:

- **Conversation rendering**: `UserTurn` / `AssistantTurn` / `Thinking` / `StreamingText` / `Markdown` (react-markdown + remark-gfm + custom copy button).
- **Navigation**: `SidebarNav` / `TurnNav` (turn jumps) / `WindowControls` (Windows frameless window buttons).
- **Inspect rail**: `InspectPanel` (working files / task list / terminal jobs, draggable width persisted) / `ChangeSummary` / `FileDrawer` (split diff view, `splitPatch` renders git-style rows).
- **Composer**: `PromptBar` (contenteditable; `@` file chips, URL chips, image chips, queued rows, model/effort/permission pickers).
- **Settings**: `Login` (panes: chat / vision / skills / shortcuts / about).
- **Common**: `Icon` (inline SVG path) / `CopyButton` / `ApprovalCard` / `PermissionPicker` / `EffortPicker` / `Combo` / `ContextStats`.

All styling lives in `styles.css` (hand-written CSS, no UI framework). Before changing UI look-and-feel, read `.agents/skills/tether-ui/SKILL.md` and `tokens.md` (UI design-token conventions).

### 6.6 Internationalization

- Copy lives in `src/shared/i18n.ts`: flat key tables for `zh` / `en`, with `t(locale, key, vars)` doing `{var}` interpolation.
- `i18n.tsx` provides `LocaleProvider` / `useI18n()`; it loads from `app:get-locale` on first render and calls `setConversationLocale` on switch so pure functions in conversation.ts follow the language too.
- Never hard-code user-visible copy in the renderer; new copy needs both `zh` and `en` keys.
- Locale resolution: `resolveLocale` prefers the stored value (`locale` in `~/.tether/settings.json`), otherwise follows the system language list; default is `zh`.

## 7. Sessions, Recovery & Edit Safety

### 7.1 Session Files

Sessions are managed by `tether-agent-core` (`TetherStateStore` / `listTetherThreads`); the main process only maps them: `sessions:list` converts threads to `SessionSummary` (including `path` session-file path, `storagePath` index path, `preview`, etc.). Renaming **appends** a `session_info` entry and rebuilds the index (`sessions:rename`).

Recovery: opening a session calls `agent:start({ sessionPath, resume: true })`; the agent process restores from disk and the renderer rebuilds messages with `normalizeMessages`. On-disk images only store staged paths, rebuilt as `src` references via `stagedImages` (served by the preview protocol).

### 7.2 /undo and Checkpoints

`tether-agent-core` records a `tether-checkpoint` entry (with each file's `before` content) on file writes. The `/undo` flow:

1. `get_entries` pulls session entries; `lastTurnRestoreFiles` resolves the `before` file set of the newest checkpoint **after the last real user turn** that has not been undone by `tether-checkpoint-undone`.
2. Show an `ApprovalCard` confirmation (special id `harness:undo`).
3. On confirm, `workspace:restore(files)` writes the files back (`content: null` means delete) and `dropLastTurn` removes the turn from the UI.

`hasNewCheckpointUndo` detects "an undo happened" in the event stream to avoid racing duplicate undos.

### 7.3 Context Compaction

`compactContext`: not running → ensure an agent → `agent:command("compact")` → fetch new messages and stats to refresh the UI. Too-short or missing sessions get dedicated toasts.

### 7.4 Terminal Jobs

Background/in-flight shell commands are extracted from tool activity by `sessionTerminals` (tracked by `process_id`). The InspectPanel can `stopJobs("/stop-job <id>")` or `/stop-jobs` (requires tether-agent-core ≥ 0.1.6 to provide the commands).

## 8. Permissions, Sandbox & Security Boundaries

### 8.1 Permission Modes (PermissionMode)

| Mode | Behavior |
| --- | --- |
| `plan` | Read-only analysis and planning; diagnostic commands may run in a read-only sandbox |
| `ask` | Ask before writes, network access, or boundary escalation |
| `auto` | Run ordinary workspace operations automatically; ask on escalation |
| `full` | Disable workspace sandboxing for explicitly trusted projects |

### 8.2 Sandbox Resolution (resolveSandbox)

- Non-project (tasks area): forced `read-only`.
- `full` mode: `danger-full-access`.
- macOS: `workspace-write` (system Seatbelt sandbox).
- Windows with a non-trusted project: show a confirm dialog (`sandboxAsk`) asking whether to allow direct access; on allow it is remembered (`rememberUnsandboxed`, stored in localStorage), otherwise fall back to `workspace-write`. On Windows, if a project was chosen but the sandbox is not full and direct access was not allowed, the send flow cancels with a toast.

### 8.3 Workspace File Safety

Every relative path sent by the renderer must pass through `resolveInWorkspace()`: after resolution it must stay within "the current agent cwd or a recent workspace", otherwise it is rejected (path traversal protection). `servePreview` (the preview protocol) only serves files inside the workspace; the `uploads` host only serves staged images by basename. External links allow only http(s). `workspace:read` caps at 200KB and detects binaries (`buffer.includes(0)`).

## 9. Vision Capabilities (src/extensions/vision.ts)

`src/extensions/vision.ts` registers the vision tool as an agent plugin (via the `--extension` flag):

- **GLM-4V-Flash image understanding**: requires a user-provided Zhipu API key (`vision-config.json`); uses the OpenAI chat.completions-compatible format with data-URI images.
- **MinerU OCR**: free OCR, asynchronous upload + polling (45s timeout), degrades silently on failure.
- The tool is enabled only when **this turn's user message pasted images** or the message contains an image handoff (decided stickily in `before_agent_start`; not removed mid-session, so the model doesn't fall back to shell OCR hacks).
- The system prompt injects two engineering conventions: `NO_CAPTURE` (no Chrome/headless screenshots for visual acceptance unless the user explicitly asked this turn) and the narration-language rule (zh or en based on whether the visible user text contains CJK).
- The extension API comes from agent-core's `ExtensionAPI`: `registerTool` / `getActiveTools` / `setActiveTools` / `on`.

The shared layer `vision-api.ts` provides pure functions: request construction, response parsing, result merging (GLM + OCR sections), `visionHandoffPaths` / `visibleUserText` (recovering the original user text and image paths from handoff messages). Pasted base64 images are staged via `vision:stage` into `userData/uploads` (max 4), and the session file only stores staged paths.

## 10. Data & Storage Layout

| Location | Contents |
| --- | --- |
| `appData/Tether` (userData; legacy `appData/DSHarness` is auto-renamed on first launch) | `recent-workspaces.json`, `vision-config.json`, `chat-profiles.json`, `uploads/` (staged images), `tasks/` (cwd without a project) |
| `~/.tether` (getTetherHome, managed by tether-agent-core) | `settings.json` (locale / default provider+model), session index and thread storage, credentials (a file when `TETHER_CREDENTIALS_STORE=file` instead of the OS keyring) |
| project `.agents/` | `features.json` (cross-session task list), `progress.md` (progress) — maintained by skill conventions |

Environment variables: `TETHER_CREDENTIALS_STORE=file` (avoids keyring prompts in the distributed build); `PI_TELEMETRY=0`; `PI_SKIP_VERSION_CHECK=1`; `HARNESS_EXTRA_MODELS` / `HARNESS_VISION_CONFIG` / `HARNESS_VISION_UPLOADS` passed to the agent child process.

## 11. Skills System

Skills are loaded by the Pi runtime (Tether does not ship a separate loader); this repository only provides UI and filesystem helpers:

- **Scanning**: `src/main/skills-fs.ts` scans user-level (`~/.tether/skills`, `~/.agents/skills`) and project-level (`.agents/skills`, `.pi/skills`, requires trusting the project) roots; `app:list-skills` feeds the settings page.
- **Runtime commands**: the agent's `get_commands` returns commands with `source === "skill"`; `src/shared/skills.ts` `parseSkillCommands` produces `AgentSkillCommand[]` (name / description / path) for `/` completion and the settings page.
- **Input normalization**: `skillUserDisplay` collapses `/skill:xxx` or expanded `<skill>` blocks into one command; `sameUserSkillTurn` is used for message deduplication.
- **Built-in project skills**: `.agents/skills/` contains `init-long-run` / `continue-long-run` / `plan-then-act` / `tether-ui` (UI look-and-feel). Skill files must include frontmatter `name` + `description`; missing either means the skill is not loaded.
- Skill manifest files are additionally collected into the workspace file tree by `addSkillManifests` in `listWorkspaceFiles`, so the `@` picker can reference them.

## 12. Build & Packaging

### 12.1 Three-Target Build (tsup.config.ts)

| Artifact | Entry | Format | Output |
| --- | --- | --- | --- |
| Main process | `src/main/index.ts` | ESM (`.mjs`) | `dist-electron/main/index.mjs` (`main` in `package.json`) |
| preload | `src/preload/index.ts` | CJS (`.cjs`) | `dist-electron/preload/index.cjs` |
| Extension | `src/extensions/vision.ts` | ESM (`.js`) | `dist-electron/extensions/vision.js` |

`electron` and `tether-agent-core` are marked external.

### 12.2 Renderer (vite.config.ts)

Dev server is pinned to `127.0.0.1:5177` (strictPort); build output goes to `dist/` with `base: "./"` (loaded via file://); the vitest config lives in the same file (`src/**/*.test.ts`, node environment).

### 12.3 Packaging (electron-builder.yml)

- `asar: false`: the RPC worker and native keyring need real filesystem paths.
- `extraResources` carries `icon.png`; macOS uses `logo.icns` (ad-hoc signing with `identity: "-"` so Gatekeeper doesn't report the app as "damaged"), Windows uses `build/icon-win.png` (taskbar icon padding differs from macOS).
- macOS target dmg (arm64), Windows target nsis (x64), Linux target dir.
- `.github/workflows/release.yml` drives the release pipeline.

### 12.4 Electron Binary Fix-up (scripts/ensure-electron.mjs)

Runs on postinstall / predev: checks whether the Electron distribution binaries are complete, runs `install.js` when missing, unpacks from the `~/Library/Caches/electron` zip cache on macOS, and patches `CFBundleName` / `CFBundleDisplayName` in `Info.plist` to Tether.

## 13. Testing

- Location: `*.test.ts` next to the source (Vitest, node environment); currently 12 files with ~112 cases.
- Focus: `conversation.ts` event merging and parsing (largest surface), `shared/*` pure functions (i18n, chat-profiles, thinking, skills, vision-api, openai-models), `main/*` utilities (rpc-lines, skills-fs, update-check).
- Run: `pnpm test` or `node_modules/.bin/vitest run`; CI uses the default config.
- Known environment-related failure: `skills-fs.test.ts` assumes a clean `$HOME` (a temp HOME containing only the skill it creates). If your machine's `$HOME` contains real skill directories (e.g. `.cursor/skills-cursor`), extra entries break the assertion — CI/clean environments are unaffected.

When adding features to the pure logic (conversation / shared), follow a "write the `*.test.ts` first, then implement" rhythm; use Vitest's `describe/it/expect`.

## 14. Common Development Tasks

### 14.1 Adding an IPC Capability

Follow the four steps in §4.2. In main-process handlers, validate every value coming from the renderer first (length, whitelists, path boundaries).

### 14.2 Adding User-Visible Copy

1. Add a key to both the `zh` and `en` tables in `src/shared/i18n.ts` (user-facing copy in Simplified Chinese).
2. In the renderer use `const { t } = useI18n()` and `t("key", { var })`; in conversation.ts pure functions use `ct(key, vars)`.
3. Never hard-code copy; code, paths, and commands stay as written.

### 14.3 Adding a UI Component / Changing the Look-and-Feel

- Put components in `src/renderer/ui.tsx` (or split into a new file); styles go into `styles.css`.
- First read `.agents/skills/tether-ui/SKILL.md` and `tokens.md` to keep color, radius, and spacing tokens consistent.
- Visual acceptance: per repo convention, do **not** use Chrome/headless/screenshots for visual acceptance (unless the user explicitly asked for screenshots this turn); writing the HTML/CSS is enough.

### 14.4 Adding an Agent Tool or RPC Command

1. Commands: add to the `ALLOWED_AGENT_COMMANDS` whitelist; `agent:command` arguments pass through to agent-core.
2. Events: tool execution events are merged by `toolFromEvent` / `upsertLastAssistantTool` in `conversation.ts`; new tool kinds need branches in `toolTitle` / `traceRows` / `liveStatus` for titles and icons.
3. If the new tool produces file changes, make sure `collectFileChanges` can parse them (patch args / details.files / output regex).
4. Add long-running requests to the `LONG_RUNNING_REQUESTS` timeout set.

### 14.5 Changing the Session Persistence Format

First look at `tether-agent-core`'s session entry types (`SessionEntryLike`: `message` / `custom` entries); the parsing functions in `conversation.ts` and `lastTurnRestoreFiles` depend on the `tether-checkpoint` / `tether-checkpoint-undone` customType conventions — keep them in sync.

## 15. Engineering Conventions (AGENTS.md Summary)

- New conversations must pick a project first; the cwd is bound and `startAgent` runs on the first message.
- Pressing Enter during generation queues the message (max 5, not stored in the session file); stopping keeps the queue, switching thread/project clears it; `/` commands are never queued.
- Cross-session progress lives in `.agents/features.json` and `.agents/progress.md`, not only in chat; `features.json` only changes `passes`, never deletes entries or edits `description`.
- User-facing copy is Simplified Chinese; code, paths, and commands stay as written.
- Before changing files under nested directories, read the applicable `AGENTS.md` / `CLAUDE.md` at each level.

## 16. Troubleshooting

| Symptom | Diagnosis |
| --- | --- |
| Blank window after `pnpm dev` | The dev server must occupy `127.0.0.1:5177` (strictPort); a busy port fails startup. Check `VITE_DEV_SERVER_URL` |
| Agent hangs without response | Check `AgentHost` request timeouts (45s normal / 30min long); the child's stderr is appended to error messages |
| Tests fail with `kill EPERM` | The sandbox restricts tinypool from cleaning up child processes; use `vitest run --pool=threads` |
| Skills not loading | Frontmatter missing `name`/`description`; project skills need a trusted project; the path must be under a standard skill root |
| /undo has no effect | The turn made no write-type tool calls; or the checkpoint was already undone; `get_entries` should show a `tether-checkpoint` entry |
| Opening legacy session data | First launch tries to rename `DSHarness` to `Tether`; if migration is unavailable the old directory stays usable only by older builds |

---

*Document maintenance: when changing IPC channels, the agent protocol, storage layout, or component structure, update the corresponding section here too.*
