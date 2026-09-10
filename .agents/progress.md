# Tether 优化改造进度

## 2025 轮次：仓库审阅后的优化落地

**摸了什么**：全仓只读审阅（src 约 2 万行 TS/TSX + 5000 行 CSS），覆盖主进程/IPC/RPC 宿主（`src/main/index.ts`、`agent-host.ts`、`agent-host-manager.ts`）、渲染层（`App.tsx`、`ui.tsx`、`conversation.ts`、`styles.css`）、shared 工具层与工程配置。基线验证：`pnpm typecheck` 通过；`pnpm test` 16 个文件 / 152 个用例全部通过（注意本机沙箱下默认 tinypool teardown 会 `kill EPERM` 导致进程非零退出，需用 `pnpm exec vitest run --pool=forks --poolOptions.forks.singleFork=true` 才能拿到干净退出）。

**清单在哪**：`.agents/features.json`，共 8 条，前 6 条必做、后 2 条可选（eslint / dead-css 需先确认）。

**本轮已做**：
- 建立本清单与进度文件。

**下一轮该做哪一条**：`session-routing`（最高优先级：多会话并发下 `agent:command` 可能把命令打到错误会话，且新会话不重建索引）。

**已记录但本轮不做**：API Key 彻底不下发渲染层（设置面板需要读写 `profiles[].apiKey`，属设置面板数据流重构，风险与收益不匹配）；`getHost(sessionPath)` 有参分支的 basename 模糊匹配仍有误配风险，改动前需先确认渲染层所有调用点是否只传绝对路径或 tempId；流式期间 7 个全量 O(n) 派生计算（`App.tsx:584-593`）与 `ui.tsx` 缺 memo 化属性能改造，需单独一轮并配基准测量。

---

## 条目 session-routing：已完成

**改了什么**：
- `src/main/index.ts`：`agent:command` 处理 `new_session` / `get_state` / `get_session_stats` 的返回值时，把 `host.sessionPath = file` 改为 `host.setSessionPath(file)`，让新会话路径重建索引、发出 `session_created`、并把 manager 的 host map 从旧路径改键。
- `src/main/agent-host-manager.ts`：`getHost()` 无参分支改为——active 路径存在但 host 已消失时返回 `undefined`（不再猜别的会话）；没有 active 会话时，仅当「去重后恰好一个 running host」才返回它，多个返回 `undefined`。
- `src/main/agent-host-manager.test.ts`：新增 4 个用例覆盖上述分支（active 已失效、唯一 running host 多键去重、多个 running host、无 running host）。测试文件 8 → 12 个用例。

**验证**：`pnpm typecheck` 通过；全部 16 个测试文件通过（152 → 156 个用例）。注意本机沙箱下必须加 `--pool=forks --poolOptions.forks.singleFork=true`，否则 tinypool teardown 的 `kill EPERM` 会让进程以非零码退出（与代码无关）。

**下一条**：`ipc-error-i18n`。

---

## 条目 ipc-error-i18n：已完成

**改了什么**：
- `src/shared/i18n.ts`：zh 与 en 各新增 11 个 `error.*` key（noImage / needUrlAndKey / needApiUrl / needApiKey / invalidApiUrl / httpOnly / notAFolder / noActiveSession / folderNotOpened / pathOutsideWorkspace / workspaceInaccessible）。en 的类型是 `Record<MessageKey, string>`，所以两边必须同时补齐，漏一边 typecheck 就会报错。
- `src/shared/openai-models.ts`：`modelsUrl(base, locale)` 与 `listOpenAiModels(baseUrl, apiKey, fetchImpl, locale)` 增加可选的尾部 locale 参数（默认 zh，向后兼容，现有单参/三参调用与测试不受影响），4 条校验报错改走 `t()`。
- `src/main/index.ts`：`vision:stage`、`auth:list-models`、`agent:command`、`agent:ui-response`、`recentWorkspaces.touch`、`resolveInWorkspace`、`realpathExistingOrJoin` 共 11 处报错改用 `t(appLocale, ...)`；`auth:list-models` 转发 `appLocale` 给 `listOpenAiModels`。

**验证**：`pnpm typecheck` 通过；16 个测试文件 / 156 个用例全绿；`pnpm build` 通过（electron + renderer 均成功）。

**发现的耦合与遗留（重要）**：
- `"Agent session closed"`（`src/main/agent-host.ts:231`）**不能** i18n 化：渲染层用正则匹配它来控制停止态与错误提示（`src/renderer/App.tsx:874`、`1445`、`1673`）。主进程错误文本与渲染层正则的耦合是技术债，彻底解决需要改成错误码，留给后续轮次。
- `src/shared/vision-api.ts:156` 的「先上传至少一张图片」只在 `src/extensions/vision.ts:179` 使用，扩展侧没有 locale 上下文，本轮未改（zh 用户看到的仍是中文，en 用户会看到中文，属未覆盖而非回退）。
- `src/main/agent-host.ts:254`、`290` 的 "No workspace session is active" 同样是 AgentHost 内部无 locale 上下文，本轮未改。
- `pnpm build` 提示 renderer 单个 chunk 540 kB（gzip 168 kB），可考虑 dynamic import / manualChunks 做代码分割 —— 新增待办。

**下一条**：`uploads-boundary`。

---

## 条目 uploads-boundary：已完成

**改了什么**：
- `src/main/index.ts`：新增常量 `MAX_STAGE_IMAGES`(4) / `MAX_STAGE_IMAGE_MB`(12) / `STAGED_UPLOAD_TTL_MS`(7 天)；`vision:stage` 解码后先校验 `bytes.length`，为空报「图片数据无效」，超过 12 MB 报「单张图片不能超过 {mb} MB」，再写盘；新增 `pruneStagedUploads()` 在 `app.whenReady()` 里清扫 `userData/uploads` 中超过 7 天的文件（只删普通文件、单个失败不影响其它）。
- `src/shared/i18n.ts`：新增 `error.invalidImage`、`error.imageTooLarge`（zh + en 各一条）。
- `src/renderer/conversation.ts`：`friendlyAgentError` 剥离 IPC 包装的正则从只认 `agent:(command|start)` 放宽为任意 `'[^']+'`，否则 `vision:stage` 的报错会带着 "Error invoking remote method 'vision:stage':" 前缀显示给用户。
- `src/renderer/conversation.test.ts`：新增一条用例覆盖上述剥离行为。

**验证**：`pnpm typecheck` 通过；16 个测试文件全绿，无失败用例。

**确认过的调用链**：`vision:stage` 的两个调用点（`src/renderer/App.tsx:1399`、`1403`）都在 `sendMessage` 的 try/catch 内，新抛出的错误会经 `friendlyAgentError` 变成 toast，不会变成 unhandled rejection。

**下一条**：`vision-config-idempotent`。

---

## 条目 vision-config-idempotent：已完成

**改了什么**：
- `src/shared/vision-api.ts`：新增 `serializeVisionConfigFile(config)`，把「vision-config.json 的落盘文本格式」固化到有测试的 shared 层（`JSON.stringify(config, null, 2)` + 结尾换行）。
- `src/main/index.ts`：`syncDeepSeekVisionConfig` 改为先把磁盘文本与 `serializeVisionConfigFile(next)` 比较，相同就直接返回；只有内容确实不同（首次落盘、或 chat key/baseUrl 变了）才写。`loadVisionConfig` 的容错行为完全未动。
- `src/shared/vision-api.test.ts`：新增 2 个用例，锁定落盘文本格式与「同配置序列化结果稳定」这两点 —— 幂等判断依赖后者。

**验证**：`pnpm typecheck` 通过；16 个测试文件全绿，无失败用例。

**说明**：`src/main/index.ts` 本身没有测试（依赖 electron 运行时），所以这条的正确性靠「行为等价 + 序列化格式被 shared 层测试锁定」保证：唯一差异是文件已是最新时不再更新 mtime，仓库内没有任何逻辑依赖该文件的 mtime。

**下一条**：`repo-hygiene`。

---

## 条目 repo-hygiene：已完成

**改了什么**：
- `.gitignore`：新增 `.tether-tmp/`（并加了一行注释说明它是本地草稿目录）。
- 执行 `git rm --cached .tether-tmp/upload.png`：把 1.7 MB 的测试截图移出版本控制，**保留磁盘上的文件**，没有删用户数据。

**验证**：`git ls-files .tether-tmp` 输出为空；`.tether-tmp/upload.png` 仍在磁盘上。

**下一条**：`dev-script-cross-platform`。

---

## 条目 dev-script-cross-platform：已完成

**改了什么**：
- `package.json`：`predev` 与 `build:electron` 里的 `rm -rf dist-electron` 换成 `node -e "require('node:fs').rmSync('dist-electron',{recursive:true,force:true})"`；`dev` 里的 `env -u ELECTRON_RUN_AS_NODE cross-env VITE_DEV_SERVER_URL=... electron .` 换成 `node scripts/run-electron.mjs`。
- `scripts/run-electron.mjs`（新增）：在 Node 里 `delete env.ELECTRON_RUN_AS_NODE`（`cross-env` 只能设置变量、不能 unset，Windows 也没有 `env` 命令），默认注入 `VITE_DEV_SERVER_URL`，spawn Electron 二进制并转发 SIGINT/SIGTERM，Electron 启动失败时以非零码退出。

**验证**：
- `node --check scripts/run-electron.mjs` 通过；
- `require("electron")` 在该脚本的模块上下文里解析到 `node_modules/.pnpm/electron@37.10.3/.../MacOS/Electron` 且文件存在；
- `package.json` 仍是合法 JSON；
- `pnpm build:electron` 跑通：`dist-electron` 被清空并重建出 `extensions/main/preload`。

**未验证/遗留**：没有实际执行 `pnpm dev`（会打开 GUI 窗口，且本机验收约定不启窗口），启动器逻辑是逐项验证而非端到端运行 —— 首次在 Windows 上跑 `pnpm dev` 时建议留意。`cross-env` 现在已无脚本引用，可以从 devDependencies 移除，但移除需要重跑 `pnpm install` 更新 lockfile，留待与 ESLint 一起处理。

**下一条**：`eslint`（需要新增 devDependencies，待用户确认）或 `dead-css`。

---

## 条目 eslint：配置就绪，依赖被环境阻塞（passes 仍为 false）

**已做**：
- 新增 `eslint.config.js`（flat config）：忽略构建产物目录；`react-hooks/rules-of-hooks` 为 error、`react-hooks/exhaustive-deps` 为 warn（就是它能在 `App.tsx` 里抓出 stale closure）；`no-empty` 允许空 catch（本仓库大量使用）；`no-console`、`no-unused-vars`、`no-explicit-any` 先设为 warn，避免首次运行直接失败。
- `package.json` 新增 `"lint": "eslint ."` 脚本。

**为什么没装依赖**：沙箱把包管理器 store 隔离开了 —— 现有 `node_modules` 链接自 `/Users/edy/Library/pnpm/store/v11`，该目录只读（`pnpm add` 直接报 `ERR_PNPM_UNEXPECTED_STORE`）；pnpm 想改用的仓库内 `.pnpm-store/v11` 是 8 KB 的空骨架。要切过去就得 `pnpm install` 重链接全部依赖，并触发 Electron 二进制重新下载（`pnpm-workspace.yaml` 里 `allowBuilds.electron: true`），一旦失败会把 `node_modules` 弄成半损坏状态 —— 与「保证现有功能不出问题」冲突，因此没有执行。

**启用方式（在可写 store 的环境跑一次即可）**：
```bash
pnpm add -D eslint @eslint/js typescript-eslint eslint-plugin-react-hooks eslint-plugin-react-refresh globals
pnpm lint
```

**风险已控制**：没有往 `devDependencies` 里写任何依赖，`pnpm-lock.yaml` 未改动（`grep -c eslint pnpm-lock.yaml` 为 0），所以 CI 的 `pnpm install --frozen-lockfile` 不会失败。`pnpm check` 也**没有**加入 lint。等你本地跑完第一遍、把 error 清零之后，再把 `pnpm lint` 加进 `check`。

**下一步**：先跑一次 `pnpm lint` 看真实告警面（预计集中在 `exhaustive-deps` 与 `no-unused-vars`），再决定逐条修还是收紧规则。

---

## 条目 dead-css：已完成

**判定方法（两轮收敛，第一轮有漏洞）**：

1. 第一轮只扫了 `ui.tsx`/`App.tsx`/`main.tsx`，把 `.kw` 误判为死类 —— 它由 `ui.tsx:1607` 的 `<em className={token.kind}>` 运行时产出，字面量 `"kw"` 在 `src/renderer/highlight.ts` 里。**教训：判据的源码范围必须覆盖整个 `src`。**
2. 第二轮把范围扩到全部 `*.ts`/`*.tsx`，并加了一层规则级约束：**只有一条规则的选择器里所有类名都是死类时**才可删。这挡住了 `.markdown pre, .chip-out pre, .approval pre`（含活类 `.markdown`）这类共享规则。
3. 额外保护：跳过 `@media` 块内的规则（两个块在 680-684、5031-5037，本就不含候选），删完校验花括号平衡（净深度 0、最低深度 0）。

**删除结果**：42 条规则 / 314 行，`styles.css` 5038 → 4724 行；构建产物 CSS 78,220 → 73,445 字节。

涉及的死类：`context-cost-val`、`context-foot-item-cost`、`session-loading`、`loading-state`、`thought-tool-chip`、`thought-tool-chips`、`mcp-row`（含**两条互相冲突的重复定义**：一条 `flex-direction: column`、一条 `row`）、`mcp-add`、`settings-usage`、`settings-usage-refresh`、`chip-out`、`task-cmd`（原文带两处 `!important`）、`prompt-queue-count`、`prompt-queue-flush`、`prompt-tags`、`prompt-tag`、`prompt-steer-row`、`prompt-steer-text`、`panel-section`、`settings-profile-row`、`settings-profile-select`、`settings-seg`、`settings-badge`、`settings-status`、`settings-status-dot`、`notice`。

**验证**：花括号平衡 OK；`pnpm typecheck` 通过；`pnpm build` 通过；16 个测试文件全绿无失败。

**保守保留的「半套」样式（下一轮候选，本轮不删）**：`.prompt-tag.link`、`.prompt-input .prompt-tag`、`.settings-badge.free`、`.thought-tool-chip.running`、`.thought-tool-chip.error`、`.chips` 系列组合规则 —— 它们的选择器里混着活类（`.link`/`.free`/`.running`/`.error`/`.chips`），判据判为「不可整条删」。要清理得先确认这些短类名是否真的只服务于已删除的组件。

**需要人工确认的部分**：CSS 类名不进 TypeScript 类型系统，`pnpm build` 不会校验类名使用，所以「界面无可见变化」无法自动化验证 —— 建议打开应用核对一下设置面板（MCP / 用量 / 图片识别 / 自定义 API 配置）、composer 的排队与 steering、以及代码抽屉里的 diff 高亮（`.code-line .kw` 已确认保留）。

---

## 条目 feature-plan-scope：已完成（用户报告的界面问题）

**现象（用户截图）**：点击左侧项目进入项目首页时，右侧「任务规划」面板冒出整份 `.agents/features.json`（标题 `任务规划 7/8`，8 条长描述），与当前对话无关。

**根因**：`src/renderer/App.tsx:594` 是 `const todos = chatTodos.length ? chatTodos : featureTodos;`，而 `featureTodos` 来自**项目级**文件 `.agents/features.json`（`App.tsx:1714-1734`，只要 `workspace` 有值就加载）。项目首页没有消息 → `chatTodos` 为空 → 整份项目清单直接顶上。

**连带问题**：`planApproval` 原先也用 `todos` 判断（`planAwaitingApproval(permission, running, todos)`），于是「plan 模式 + 项目清单里有未完成项」会在与本会话计划无关时弹出「批准计划」按钮。

**改了什么**：
- `src/renderer/conversation.ts`：新增纯函数 `sessionTracksFeaturePlan(messages)` —— 遍历会话工具调用，判断 args（覆盖 `path`/`file_path`/`command`/patch 正文）里是否出现 `.agents/features.json` 或 `.agents/progress.md`。
- `src/renderer/App.tsx`：新增 `tracksFeaturePlan` 与 `projectTodos`；`todos` 改为 `chatTodos.length ? chatTodos : projectTodos`；`planApproval` 改用 `chatTodos`（批准只跟随本会话计划）；`featureTodos` 的加载 effect 增加 `tracksFeaturePlan` 条件，无关会话不再做无谓的 IPC + 磁盘读。
- `src/renderer/conversation.test.ts`：新增 4 个用例（空会话/普通读文件为 false、相对与绝对路径为 true、shell 命令与 patch 正文为 true、`.agents/skills/**` 等其他路径为 false）。该文件 65 → 70 个用例。

**修复后的行为矩阵**：

| 场景 | 修复前 | 修复后 |
| --- | --- | --- |
| 项目首页（未进会话） | 显示整份 features.json | 不显示 |
| 普通会话（从未碰过 plan 文件） | 显示整份 features.json | 不显示 |
| 会话内计划（plan / todo 工具、markdown checklist） | 显示本会话计划 | 显示本会话计划（不变） |
| 长任务会话（读过或写过 features.json / progress.md） | 显示整份 features.json | 显示整份 features.json（有意保留） |

**验证**：`pnpm typecheck` 通过；16 个测试文件全绿（conversation 70 个用例）；`pnpm build` 通过。

**说明**：`.agents/features.json` 是 AGENTS.md 约定的跨会话进度载体，所以没有把它从界面上彻底去掉，而是收窄到「确实在做长任务的那个会话」。若产品上希望连长任务会话也不显示，把 `projectTodos` 直接置空即可。

---

## 条目 drawer-rerender：已完成（用户报告「任务跑的时候点代码列表巨卡」）

**根因**：`src/renderer/ui.tsx` 的 `FileDrawer` 把 `tokenizeCode(body, file.path)` **直接写在渲染体里**（旧 1600 行），且组件没有 memo；`src/renderer/App.tsx:2135` 传的 `onClose={() => setPreview(undefined)}` 又是内联箭头，每次渲染都是新引用。任务在跑时每个 token 都会 `setMessages` → App 重渲染 → 抽屉跟着重渲染 → 整个文件重新分词并**重建上万个 React 元素**。

**量化证据（本机实测）**：

| 指标 | 数值 |
| --- | --- |
| `tokenizeCode` 处理 88 KB / 4700 行文件 | 3.6 ms（**不是**瓶颈） |
| 该文件一次渲染创建的元素数（行元素 + token 元素） | **15,300 个** |
| `ui.tsx` 一次渲染的元素数 | 12,275 个 |
| 流式时事件频率 | 每 token 一次 `setMessages`，通常 10–30 次/秒 |

也就是说瓶颈是 React 元素对象创建 + reconciliation（万级节点 × 每秒几十次），而不是正则扫描。这解释了为什么只是「点开文件」就会让窗口失去响应。

**改了什么**：
- `src/renderer/ui.tsx`：`FileDrawer` 改为 `memo(function FileDrawer(...))`；`tokenizeCode` 结果与 `splitView` 结果移入 `useMemo`（后者依赖 `diff`，折叠状态下不计算）；`Markdown` 组件改为 `memo`。
- `src/renderer/App.tsx`：新增 `closePreview = useCallback(() => setPreview(undefined), [])`，让 `FileDrawer` 的 props 在 token 之间保持同一引用，memo 才能真正命中。
- `src/renderer/ui.tsx`：`InspectPanel` 里的 `filterMentionPaths(entries, prefix)`（`entries` 最多 8000 条工作区路径）与 `edits` 过滤移入 `useMemo`。实测 `filterMentionPaths` 对 8000 条最坏 1.63 ms/次，本身不是主因，但同样不该每 token 跑一遍。

**效果**：流式期间抽屉不再重渲染，元素创建量从约 15,000 个/次 × 20 次/秒降到 0；`entries` 或 `prefix` 变化时才重新过滤。

**验证**：`pnpm typecheck` 通过；16 个测试文件全绿；`pnpm build` 通过。改 `ui.tsx` 时 patch 曾把 FileDrawer 结尾的 `});` 错落到 `InspectPanel` 结尾（两处 `</aside>` 上下文相同），typecheck 立刻报出一串 `TS1005`，已用更长的唯一上下文纠正。

**同类风险仍在（未处理，属性能改造条目）**：`App.tsx` 在流式期间频繁重渲染的非 memo 组件还有 `PromptBar`（61 个 `useState`）与 `InspectPanel`（其 `files`/`todos`/`terminals` 每次 `messages` 变化都是新数组引用，无法靠 memo 挡住）。要根治得让 `workingFiles`、`sessionTools` 这类派生计算只在 tool 事件时更新，而不是每个 token 重算 —— 与早先报告里的「流式期间 7 个全量 O(n) 派生计算」是同一件事。

---

## 条目 drawer-missing-file：已完成（用户报告「点击修改的文件直接空白」）

**现象（用户截图）**：右侧抽屉标题是 `src/renderer/conversation.ts`、右上角有「查看改动 +15 -14」，但代码区只有行号 `1`，内容全白；点「查看改动」能看到 diff。底部项目标签显示当前项目是 `js-sports-manager-web`，而对话内容属于 `tether-ai`。

**根因（两层）**：
1. `src/main/index.ts` 的 `workspace:read` 对 `ENOENT` **返回 `content: ""` 而不是报错**（旧 405-413 行）——「文件不存在」被伪装成「空文件」，于是抽屉渲染出 `tokenizeCode("")` 的结果：一个只有行号 1 的空行。
2. `src/renderer/App.tsx` 的 `openSession`（898-951 行）会加载会话消息并把 `agentCwd.current` 设成该会话的 cwd，但**没有同步 `workspace` state**。用户先点开了 `js-sports-manager-web`，又打开了属于 `tether-ai` 的会话，于是抽屉拿 `js-sports-manager-web` 当根去解析 `src/renderer/conversation.ts` → 找不到 → 空白。而 diff 来自会话数据里的 patch，不依赖文件系统，所以「只能点击改动才能看到」。

**改了什么**：
- `src/main/index.ts`：`workspace:read` 的 ENOENT 分支改为返回 `missing: true`（语义上区分「这里没有」与「空文件」）。
- `src/shared/types.ts`：`DesktopApi.workspace.read` 的返回类型加可选 `missing`（向后兼容，另一个调用点 `App.tsx:1738` 读 `.agents/features.json` 时 `content` 为 `""`，行为不变）。
- `src/renderer/ui.tsx` `FileDrawer`：读到 `missing` 时置 `missing` 状态，若该文件有 patch 就自动切到 diff 视图；抽屉头部下方显示一行提示说明「当前项目里找不到这个文件，下面显示的是本轮改动」。空字符串内容改显示「（空文件）」，不再是一片空白。
- `src/renderer/App.tsx` `openSession`：打开会话时若 `session.cwd` 与当前 `workspace` 不一致，就 `setWorkspace(session.cwd)` 并展开对应项目 —— 这是根因修复，同时让右侧文件树、composer 标签、`@` 文件列表都跟当前会话对齐。
- `src/shared/i18n.ts`：新增 `preview.missing` / `preview.missingPatch` / `preview.empty`（zh + en）。
- `src/renderer/styles.css`：新增 `.drawer-missing` 提示条样式。

**验证**：`pnpm typecheck` 通过；16 个测试文件全绿；`pnpm build` 通过。`workspace.read` 的两个调用点都已核对（另一个是读 `.agents/features.json`，`missing` 时 `content` 为空、`parseFeaturesJson("")` 返回 `[]`，行为不变）。

**说明**：修复后即使处在「项目与会话不一致」的旧状态，点文件也会显示改动而不是空白；重新点一次该会话则 `workspace` 会对齐。真正被删除的文件现在同样走 `missing` 分支并提示，这是期望行为。

---

## 条目 drawer-content-robust：已完成（用户指出「文件已移除却显示（空文件）」）

**用户指出的问题**：文件被移除后，「本轮改动」里仍保留该条目（这是对的，改动记录来自会话数据），但点击显示「（空文件）」——把「不存在」说成了「空」。

**根因**：`drawer-missing-file` 的实现用 `result.content || t("preview.empty")` 决定文案，而区分「已删除」与「空文件」**完全依赖主进程返回的 `missing` 字段**。但主进程的 `missing` 只出现在 ENOENT 分支，正常返回没有这个字段；一旦主进程是旧代码（Electron 只刷新窗口不会重载主进程），字段就是 `undefined`，于是落到 `content === ""` 分支，显示「（空文件）」。**判定建立在一个可能缺失的字段上，是设计缺陷而不只是文案问题。**

**改了什么**：
- `src/main/index.ts`：`workspace:read` 的正常返回（文本与二进制）显式带上 `missing: false`，让该字段始终存在。
- `src/renderer/conversation.ts`：新增纯函数 `drawerContent(result, hasPatch)`，做**三态**判定：
  - `missing === true` → `{ kind: "missing", showPatch }`
  - `missing` 字段缺失 → `{ kind: "unknown" }`（显示空白，**不再断言「空文件」**）
  - `missing === false` 且内容为空 → `{ kind: "empty" }`（只有主进程确认存在时才这么说）
  - 其余走 `text` / `binary`
- `src/renderer/ui.tsx` `FileDrawer`：改用 `drawerContent`；`missing` 时额外 `setRendered(false)`，修掉「markdown/html 文件下 diff 切不过去」的冲突（原先 `preview` 为真会让 `diff` 恒为 false，即使按钮显示已开启）；提示条改为在 diff 打开时也显示，说明为什么看到的是改动。
- `src/shared/i18n.ts`：`preview.missing` 文案补上「（可能已删除，或属于其他项目）」。
- `src/renderer/conversation.test.ts`：新增 4 个用例覆盖四种组合，其中「字段缺失不得判定为空文件」正是这次的回归点（70 → 74 个用例）。

**验证**：`pnpm typecheck` 通过；16 个测试文件全绿；`pnpm build` 通过。

**给用户的提醒**：这次改动同时涉及主进程与渲染层，**必须完全退出 Tether 再启动**（⌘Q 后重开）才会生效；只重新构建/刷新窗口的话，主进程仍是旧代码，仍会走到「（空文件）」那条分支。

---

## 条目 composer-plain-paste：已完成（用户报告「输入框里不要把格式拷贝进来」）

**现象**：往 composer 粘贴内容时，会把来源应用的字体、颜色、链接等 HTML 样式一起带进输入框。

**根因**：composer 是自研的 `contentEditable`（`ui.tsx` 的 `PromptBar`），它的 `onPaste` 只处理了图片分支（`clipboardData.files`），文本粘贴直接走浏览器默认行为 —— 而默认行为会插入 `text/html` 那一份，于是外部样式全部带进来。

**改了什么**：
- `src/renderer/conversation.ts`：新增纯函数 `plainTextToPromptHtml(text)` —— 统一换行符后按行转义 `&` / `<` / `>`，行间用 `<br>` 连接。
- `src/renderer/ui.tsx`：`PromptBar` 的 `onPaste` 增加文本分支，`preventDefault()` 后调用新增的 `pastePlainText()`；该函数用 `document.execCommand("insertHTML", false, ...)` 插入，**而不是手工操作 Range**，这样粘贴仍然进编辑器的 undo 栈（⌘Z 可撤销），插入的 HTML 又完全由我们自己转义生成，外部样式无从进入。
- `src/renderer/conversation.test.ts`：新增 3 个用例（换行 `\n` / `\r\n` / `\r` 统一为 `<br>`、`<b>` 与 `onerror` 属性被转义、粘贴代码的缩进与空行保留）。该文件 74 → 77 个用例。

**为什么换行要转成 `<br>`**：`.prompt-input` 是 `white-space: pre-wrap`，而 `serializePrompt` 会把 `<br>` 还原成 `\n`；如果直接让浏览器把换行生成为 `<div>`，`flattenPromptBlocks` 展平块级元素时会把换行吃掉。

**未改动的部分**：图片粘贴仍优先走 `clipboardData.files` 分支（`preventDefault()` + `addUploads`），行为不变；剪贴板里没有 `text/plain` 时（例如从文件管理器拖入）仍交给默认行为。

**验证**：`pnpm typecheck` 通过；16 个测试文件全绿（77 个用例）；`pnpm build` 通过。

---

## 条目 panel-workspace-fallback：已完成（用户报告「首次进软件直接点会话，右侧面板没有了」）

**直接原因**：`App.tsx` 里右侧面板的挂载条件是

```tsx
inspect={workspace ? (<InspectPanel workspace={workspace} ... />) : undefined}
```

也就是说 `workspace` 为空时面板**根本不挂载**（不是渲染成空白）。首次进入软件时 `workspace` 是 `undefined`，只有先点项目（`bindProject` 会 `setWorkspace`）才会有值 —— 这正好对应用户描述的「先点项目再点会话，右边才出来」。

**改了什么（两层，避免只堵一头）**：
- `src/renderer/App.tsx` `openSession`：把 workspace 同步从「`session.cwd` 与当前 workspace 不同才设置」改成**只要 `session.cwd` 存在就无条件 `setWorkspace`**（相同值时 React 自身会 bail out，没有额外渲染代价）。上一版依赖 `isSamePath` 比较，多一个可能出错的环节。
- `src/renderer/App.tsx`：新增
  ```ts
  const threadCwd = sessions.find((s) => isSameSession(s, activeSession))?.cwd;
  const panelCwd = workspace ?? threadCwd;
  ```
  右侧面板改用 `panelCwd` 判断挂载并作为 `workspace` / `folder` 传给 `InspectPanel`。即使 workspace 同步这一环因为任何原因没跟上，只要当前会话有 cwd，面板就会挂载并列出该会话所属项目的文件。

**旁证**：`tether-agent-core` 的 `listTetherThreads`（`dist/state.js:228`）会过滤掉 `typeof header.cwd !== "string"` 的会话，所以会话列表里的 `session.cwd` 一定非空，`panelCwd` 的回退是可靠的（抽查本机 7 个会话文件，除一个无 cwd 被列表过滤外其余都带 cwd）。

**验证**：`pnpm typecheck` 通过；16 个测试文件全绿；`pnpm build` 通过。

**遗留**：`PromptBar` 的 `workspace` prop 仍是 `workspace`（未跟随 `panelCwd`）。若 workspace 未同步，composer 的项目标签与 `@` 文件列表会为空，属同一族问题；等确认这次修复有效后再一并处理。

---

## 条目 cross-review-hardening：已完成（用户要求对本轮大跨度改动做自查与补测）

**自查发现并修掉的问题（4 个）**：

1. **`FileDrawer` 没跟上 `panelCwd`（真 bug）**：上一条把右侧面板改成 `panelCwd`，但抽屉仍然传 `workspace`（`App.tsx:2148`）。workspace 未同步时抽屉依旧用错误的项目根读文件 —— 用户上一个问题只修了一半。
2. **`panelCwd` 的优先级反了**：原写法 `workspace ?? threadCwd` 让「选中的项目」压过「会话自己的 cwd」。用户在项目 B 打开属于项目 A 的会话、而同步又失败时，仍然会用 B 的根。改为 `activeThread?.cwd ?? workspace` —— 抽屉和右侧面板属于**当前会话**，项目只在首页（无会话）时作回退。
3. **`openSession` 的多余依赖**：改成无条件 `setWorkspace` 后函数体已不再读 `workspace`，但依赖数组里还留着它，导致每次 workspace 变化都重建回调、进而让所有 `SessionRow` 重渲染。已移除。
4. **`setOpenProjects` 非幂等**：`{ ...current, [cwd]: true }` 每次都建新对象，即使项目早已展开也会触发重渲染。改为已展开时返回原引用（React 才会 bail out）。这也修正了我原先注释里「safe unconditionally」的说法 —— `setWorkspace` 会 bail out，`setOpenProjects` 不会。

**补的测试（这是本轮最实质的补强）**：`isSamePath` / `isSameSession` 原先定义在 `App.tsx` 内部 —— 组件文件没有测试环境，意味着**会话匹配这个核心判定从来没有测试**，而它被 20 多处调用（openSession、isSessionInSet、SessionRow 高亮、事件路由）。已抽到 `conversation.ts` 并补 5 个用例：undefined 不匹配任何值（含另一个 undefined）、大小写与分隔符归一（macOS/Windows 盘符大小写不敏感）、兄弟路径不混淆、会话按 id / runtime path / storagePath 三种方式匹配。`conversation.test.ts` 77 → 82 个用例。

**端到端回放（真实会话文件）**：524 条原始消息 → 250 条归一化 → 24 个分组，模式 `uauauauauauauauauauauaua`，**user/assistant 严格交替、无断裂**；`sessionTracksFeaturePlan` 对本会话为 `true`（确实碰过 features.json），对其它会话为 `false`；`isSameSession` / `isSamePath` 在真实 id 与真实 cwd 上返回 `true`；`drawerContent` 三态与 `plainTextToPromptHtml` 转义输出符合预期。

**CSS 结构校验**：删除 314 行后花括号净深度 0 / 最低深度 0、无孤立 `{`、`.chat` 等选择器定义数量与改前一致（重复出现的 `from`/`to`/`50%` 是 keyframes，正常）。

**仍然没有自动化保障的部分（如实记录）**：

| 层 | 保障 |
| --- | --- |
| `conversation.ts` 纯函数 | ✅ 15 个 describe / 82 用例 |
| `agent-host-manager` | ✅ 4 个新用例 |
| `App.tsx` 状态流转 | ❌ 无组件测试，需人工走查 |
| `ui.tsx` DOM 行为（粘贴、抽屉渲染） | ⚠️ 仅纯函数部分有测试 |
| `main/index.ts` IPC | ❌ 依赖 electron 运行时 |
| `styles.css` 删除 | ⚠️ 结构校验 + build，视觉需人工 |

**注意**：改动大部分已进 index（`git status` 里 `M ` / `A ` / `MM`），提交前统一 `git add -A` 即可。

---

## 条目 mainflow-scan：已完成（用户要求扫描「有没有动主流程」）

**扫描方法**：先列出全部改动，再按「主流程」五个面逐个比对（agent 生命周期 / 消息与事件流 / 会话与项目切换 / 文件读写与安全边界 / 权限与 plan 批准），并用 grep 找同一语义的所有消费点。

### 触及主流程的改动（6 处，逐一评估）

| 改动 | 位置 | 主流程 | 风险 |
| --- | --- | --- | --- |
| `agent:command` 写回会话路径改走 `setSessionPath` | `main/index.ts` | 会话生命周期 | 低：路径相同时 `setSessionPath` early return，无副作用；路径变化时才重建索引 + 发 `session_created` |
| `getHost()` 无参兜底收紧 | `agent-host-manager.ts` | 命令路由 | **中：见下方发现 A** |
| `openSession` 打开会话时切换当前项目 | `App.tsx` | 会话/项目切换 | 行为变化（有意）：workspace 跟随会话 cwd；不影响后台会话（agentCwd/startAgent 只作用于当前会话） |
| `panelCwd` 取代 `workspace` 作为路径根 | `App.tsx` | 切换 + 文件读写 | **中：见下方发现 B** |
| `workspace:read` 的 ENOENT 改报 `missing` | `main/index.ts` | 文件读写 | 低：仅新增字段；另一个调用点（读 features.json）行为不变 |
| `planApproval` 只用会话内计划 | `App.tsx` | 权限/plan 批准 | 行为变化（有意）：项目清单不再独自触发「批准计划」按钮 |

### 扫描发现并修掉的两类漏改

**发现 A：2 处 `agent.command` 不传 `sessionPath`**，依赖我刚收紧的兜底 —— 收紧后它们会从「可能打错会话」变成「静默失败」（调用点都带 `.catch(() => undefined)`）：
- `App.tsx:555` `set_thinking_level`（会话恢复时同步思考级别）
- `App.tsx:565` `set_thinking_level`（用户手动切换 effort）

这两处是**用户可见功能**，已补 `sessionRef.current`。另 2 处不传的调用点经核实安全：`removeProject` 的 `abort` 后面紧跟 `stop()`（无参 → `stopAll`）兜底；`sendMessage` 的 `prompt` 有 `sessionRef.current || optimisticSessionId`，startAgent 后必然有值。

**发现 B：`workspace` 被当作「路径根」的另外 5 处消费点**（上一轮我只改了面板与抽屉）：
- `ensureModelReady` 的 `startAgent(workspace, ...)` → 重启 agent 会用错的工作目录
- `applyUndo` 的 `workspace.restore(files, workspace)` → **撤销会把文件恢复到错误的项目**
- `featureTodos` 读取 `.agents/features.json` 的根
- `PromptBar` 的 `workspace` prop（composer 项目标签与 `@` 文件列表）
- 设置面板保存后重启 agent 的 `startAgent(workspace, ...)`

全部改为 `panelCwd`；同时把 `panelCwd` / `activeThread` 的定义从 1753 行**前移到 455 行**——因为它现在出现在多个 `useCallback` 的依赖数组里，而依赖数组在渲染期求值，定义在后面会直接 TDZ 报错。删除旧定义时 `apply_patch` 对含反引号与破折号的注释行解析失败，改用精确行号 `sed` 删除并立即用 typecheck 验证。

### 确认**没有**动到的主流程

- `applyAgentEvent`（流式事件归并）—— 未改
- `sendMessage` 主体、`startAgent` 主体 —— 未改（仅 2 个调用点的传参）
- `resolveInWorkspace` 的**判定逻辑**（越界与 symlink 复检）—— 未改，只换了错误文案
- `resolveSandbox` 与四种权限模式 —— 未改
- `agent-host.ts`（RPC 宿主、超时、stdin/EPIPE 处理）—— 未改
- `preload` 暴露面 —— 未改（仅 `read` 返回类型放宽为可选字段）
- `process-tree` / 会话索引 / 事件派发 —— 未改

**验证**：`pnpm typecheck` 通过；16 个测试文件全绿；`pnpm build` 通过。

### 剩余风险（如实列出）

1. `styles.css` 删除 314 行的**视觉影响**无法自动验证，需人工走查。
2. `package.json` 的 dev/build 脚本改动**未在 Windows 上验证**（CI 用 bash，本地 Windows 用 cmd/PowerShell 需实测）。
3. `App.tsx` / `ui.tsx` 仍无组件测试，状态流转只能人工走查。
4. `removeProject` 里无参 `abort` 在「active 路径已失效」时会静默失败（随后 `stopAll` 兜底，实际影响有限）。

---

## 条目 impact-audit：已完成（不等提问，主动全量审计）

**背景**：连续两轮都是「用户追问 → 我又查出问题」。复盘后确认根因不是能力而是纪律：这些问题的信息一直在源码里，`grep` 就能拿到，我只是没去查。于是这次把**所有能机械验证的影响面一次跑完**。

### 审计的 9 个面与结论

| # | 面 | 方法 | 结论 |
| --- | --- | --- | --- |
| 1 | `agent.command` 的 `sessionPath` 参数 | 列出全部 19 个调用点 | **发现漏改**：2 处不传（见下） |
| 2 | 「路径根」语义的全部消费点 | grep `workspace` / `panelCwd` 全部用法 | **发现漏改**：7 处（见下） |
| 3 | i18n 键完整性 | 类型 + 脚本比对 zh/en | ✓ `en: Record<MessageKey, string>` 由 tsc 保证键一一对应；`t()` 的 key 受 `MessageKey` 约束，不会引用不存在的键 |
| 4 | zh 是否漏翻 | 扫所有 value 是否含中文 | ✓ 仅 10 条不含中文，全是品牌名（Brave/Tavily/Jina/Exa/Tether）、语言名、`{done}/{total}` 占位符、全角逗号——均属正确 |
| 5 | 本轮新增函数的消费点 | 逐个 grep | ✓ 7 个新函数全部有实际调用（`plainTextToPromptHtml` 在 `ui.tsx:1938` 的 `execCommand("insertHTML")` 中） |
| 6 | `read` 的 `missing` 链路 | 主进程 3 个返回分支 + 渲染层判定 | ✓ 链路完整；旧主进程不返回该字段时降级为 `unknown`（空白），不会误报「空文件」 |
| 7 | `todos` / `chatTodos` | 列全部消费点 | ✓ 自洽：面板显示用 `chatTodos ?? projectTodos`（用户能看到项目进度），批准按钮只用 `chatTodos`（批准的必须是 agent 的计划） |
| 8 | memo 组件的 props 稳定性 | 检查 `Markdown` / `FileDrawer` 全部使用点 | ✓ props 均为 `string` / `boolean` / `useCallback([])`，memo 有效 |
| 9 | CI 引用的脚本 | 读 `release.yml` | ✓ CI 用 `pnpm build:electron && pnpm build:renderer`，与本地 `pnpm build` 等价 |

### 本次新增修复的 2 处

`undoLastTurn`（`App.tsx:1132`）与 `compactContext`（`App.tsx:1167`）在 agent 未运行时用 `startAgent(workspace, ...)` 重启：

```ts
if (!agentCwd.current) {
  const started = await startAgent(workspace, sessionRef.current, true, true);
}
```

**后果**：跨项目场景下（用户切到别的项目、或 workspace 未同步），点「撤销上一轮」会把 agent 起在**错误的工作目录**，随后的 `get_entries` 与压缩都作用在错误目录上。已改为 `panelCwd`，`compactContext` 的「有没有可压缩内容」判断也一并改为 `!panelCwd`。

### 发现但不属于本轮范围（如实记录，未改）

1. **53 个 i18n 死键**（`settings.*` 占 37 个，另有 `slash.*`、`about.langZh`、`toast.sessionRestarted` 等）。已确认：无模板拼接、无 `MessageKey` 变量传递，是既有遗留；本轮新增的 32 个键（`preview.*` / `error.*`，zh+en）**全部有引用**，不在死键内。其中部分可能是「UI 该有却漏接」（如 `settings.skillsHint`），需产品判断，不擅自处理。
2. `InspectPanel` 是 `export function`，**没有** memo 包裹；即便加上，`files`/`todos`/`terminals` 每次 messages 变化都是新数组引用，仍会重渲染。属性能优化，非缺陷。
3. `compactContext` 的错误处理里硬编码了 `/^Error invoking remote method 'agent:command':\s*/i`，只剥离这一个通道的前缀；应用统一的 `friendlyAgentError`。属既有代码。
4. `styles.css` 删除 314 行的视觉影响、`package.json` 脚本在 Windows 的行为，**无法用 grep 或单测穷尽**，只能人工/实机验证。

**验证**：`pnpm typecheck` 通过；16 个测试文件全绿；`pnpm build` 通过。

---

## 条目 preview-cwd：已完成（修 HTML 预览 Not found）

**问题**：点抽屉里的预览，HTML 显示 Not found，而打开文件正常。

**根因**：两条路径不同源。打开文件走 IPC workspace:open(path, cwd)，会带上抽屉的根（本轮已改为 panelCwd，即会话目录）；预览走 iframe 的自定义协议，主进程 servePreview 只用 activeAgentCwd（最后启动的 agent 的 cwd）。跨项目、切会话、agent 未运行时两者分叉，预览就 404。

**第一版修法是错的，是自查加实测抓出来的**：把工作区放进 URL 的 userinfo（理由是 query 在相对导航时会被丢掉、userinfo 会保留）。实测（真实 Electron 渲染进程，用 iframe 发起请求）结果是：

- 构造: harness-preview://%2FUsers%2Fa%2Fmy%20proj@workspace/dir/page.html
- 实收: harness-preview://workspace/dir/page.html  （userinfo 被 Chromium 整个剥掉）

**Chromium 会对自定义协议请求剥离 userinfo**，所以这版在真实应用里完全不生效。只看 Node 的 new URL() 行为会得出错误结论（Node 会保留）。

**最终方案**：工作区放进 pathname，用 ~ 作标记段，cwd 双重 URL 编码保证它始终是一个路径段：

    harness-preview://workspace/~/<encodeURIComponent(encodeURIComponent(cwd))>/<file>

实测确认（同一套 Electron 实机手段）：

- /~/%252FUsers%252Fedy%252Fmy%2520proj/dir/page.html
- /~/%252FUsers%252Fedy%252Fmy%2520proj/img/logo.png  （相对资源 ../img/logo.png 保留了前缀）

第二行是关键：页面内部的相对资源导航同样带着工作区，否则 CSS 与图片仍会 404。

**改动**：
- src/shared/types.ts：新增 PREVIEW_CWD_SEGMENT、previewFileUrl(file, workspace)、parsePreviewPath(pathname)（纯函数可测）；移除 userinfo 版实现。
- src/main/index.ts：servePreview 改用 parsePreviewPath，把解出的工作区交给原来的 resolveInWorkspace（越界、symlink、allowed 检查一律未放宽）。
- src/renderer/ui.tsx：iframe 用 previewFileUrl(file.path, workspace)，删除旧的 previewUrl。
- src/shared/preview-url.test.ts：7 个用例，含真实渲染进程实际发出的 pathname 回归用例。

**顺手修掉的疏漏**：删 previewUrl 时留下了它的 JSDoc，注释悬空挂到了 mentionAt 上。

**沙箱里实机跑 Electron 的方法（重要，可复用）**：

    ELECTRON_RUN_AS_NODE= ./node_modules/.bin/electron --no-sandbox --disable-gpu <entry>

- 上层环境把 ELECTRON_RUN_AS_NODE=1 设进了子进程，不清掉的话 require("electron") 拿到的是 npm 包的路径字符串（protocol 为 undefined）。
- Chromium 沙箱在外层 Seatbelt 里初始化会失败，必须 --no-sandbox --disable-gpu。
- 这样能真实跑通渲染进程加自定义协议，是唯一能验证 Chromium URL 行为的办法，比读文档或推断可靠。

**验证**：tsc 通过；17 个测试文件 / 89 用例全绿；vite build 通过；tsup 通过；编译产物中存在 parsePreviewPath 与 PREVIEW_CWD_SEGMENT，且不含 url.username。

**仍未验证**：resolveInWorkspace 的 allowed 检查（cwd 必须是 activeAgentCwd 或最近打开的项目）需要完整 app 才能跑，仅做逻辑审查。行为与 workspace:read 一致，故预览与抽屉要么同时可用、要么同时报同一错误。
