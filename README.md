<div align="center">

<img src="build/icon.png" width="96" alt="Tether logo" />

# Tether

**面向仓库的 AI 编程桌面工作台** —— 基于本地 [`tether-agent-core`](../tether-runtime/packages/core) 的 Electron 宿主。

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.19-blue)](https://nodejs.org)
[![Electron](https://img.shields.io/badge/Electron-37-blueviolet)](https://www.electronjs.org)
[![Tether Agent Core](https://img.shields.io/badge/tether--agent--core-0.1.0-brown)](../tether-runtime/packages/core)
![Platform: macOS / Linux / Windows](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey)

</div>

Agent 循环、权限、沙箱、会话存储等核心逻辑全部在 `tether-agent-core` 中实现，本仓库只负责把它们装进一个原生桌面应用，并提供一套面向中文用户、围绕「打开仓库 → 对话 → 改代码」的工作流界面。

> **快速上手**：`pnpm install && pnpm dev` → ⌘/Ctrl + O 打开一个仓库 → 点击左下角账户区域配置 API Key → 在输入框发送「解释这个仓库」。

## 目录

- [特性](#特性)
- [快速开始](#快速开始)
- [脚本](#脚本)
- [使用说明](#使用说明)
- [架构](#架构)
- [目录结构](#目录结构)
- [数据与互操作](#数据与互操作)
- [打包与发布](#打包与发布)
- [安全模型](#安全模型)
- [开发](#开发)
- [已知限制](#已知限制)
- [常见问题](#常见问题)
- [License](#license)

## 特性

### 多模型供应商

支持 9 家供应商：**DeepSeek、OpenAI Codex、OpenAI、Anthropic、OpenRouter、ZAI、Kimi Coding、MiniMax、xAI**。

- DeepSeek 使用 API Key（可自定义 Base URL）；
- 其余供应商走设备码 / OAuth 登录；
- 也支持通过环境变量注入密钥（`auth:status` 会识别已配置的 Key）。

### 项目工作台

- 打开任意仓库文件夹，会话按项目组织在侧边栏；
- 展示最近项目与每个项目下的历史对话，可搜索过滤；
- 首页提供快捷建议（「解释这个仓库」「找出最可疑的 bug」「补一组测试」）与最近会话入口。

### Agent 会话

- 流式输出、思考过程（reasoning 面板）、工具调用活动（进行中 / 成功 / 失败）；
- 文件变更摘要与 diff 预览（新增 / 删除行数、补丁详情）；
- 会话统计：token 用量、成本、上下文占用；
- agent 发起的交互请求（确认 / 选择 / 输入 / 编辑器）以审批卡片呈现，可打断或批准。

### 输入体验

- 斜杠命令：`/new` 新对话、`/open` 打开仓库、`/login` 连接模型；
- 输入 `@` 即可引用工作区文件（自动补全）；
- 快捷键：**⌘/Ctrl + N** 新建会话、**⌘/Ctrl + O** 打开文件夹。

### 权限与沙箱

- 四档权限：`plan`（只读规划）/ `ask`（每步询问）/ `auto`（可自动改）/ `full`（全开）；
- 三档沙箱：`read-only` / `workspace-write` / `danger-full-access`；
- 非项目会话（未打开文件夹时）固定为只读，项目会话默认为工作区可写；
- agent 越权时给出明确提示（如只读会话中尝试改文件）。

### 自有运行时

会话、密钥和运行时设置统一存放在 `~/.tether`，由自有的
`tether-agent-core` 管理。

### 安全基线

- `contextIsolation` + `sandbox` 开启、无 `nodeIntegration`；
- 文件读取带路径穿越校验，超过 200 KB 自动截断，二进制文件不注入文本；
- 外部链接只允许 http(s)，并统一交给系统浏览器打开。

## 快速开始

### 环境要求

- Node.js `>=22.19`，使用 pnpm。

### 启动

```bash
pnpm install   # postinstall 会自动补齐 Electron 二进制（离线缓存兜底）
pnpm dev       # Vite HMR + Electron 开发窗口
```

启动后：

1. 用 **⌘/Ctrl + O**（或侧边栏）打开一个仓库文件夹；
2. 点击左下角账户区域，配置 DeepSeek API Key（或其它供应商登录）；
3. 在输入框发送「解释这个仓库」，或点击首页的快捷建议。

> 没有打开文件夹时也可以直接对话（非项目会话，只读）。

## 脚本

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 开发模式：Vite 热更新 + Electron |
| `pnpm typecheck` | TypeScript 类型检查 |
| `pnpm test` | 运行 Vitest 单元测试 |
| `pnpm build` | 构建主进程（tsup）+ 渲染进程（vite build） |
| `pnpm check` | 完整校验：typecheck + test + build |
| `pnpm run pack` | 构建并产出 macOS `.dmg` 与 Windows `.zip`（`release/`，未签名） |
| `pnpm start` | 直接运行已构建产物 |

> `pnpm install` 的 postinstall 钩子（`scripts/ensure-electron.mjs`）会在 Electron 二进制缺失时自动补齐：先走官方 install.js，失败则回退到 `~/Library/Caches/electron` 里的离线缓存 zip。

## 使用说明

### 权限档位

| 档位 | 输入框显示 | 行为 |
| --- | --- | --- |
| `plan` | plan 只读 | 只规划，不执行修改 |
| `ask` | ask 询问 | 每次写操作前征求确认 |
| `auto` | auto 可改 | 自动执行，无需逐次确认 |
| `full` | full 全开 | 放开全部权限 |

### 模型与供应商

输入框左侧可切换模型（模型列表来自当前供应商的 `get_available_models`）。默认模型为 `deepseek-v4-flash`；DeepSeek 使用 `max` 推理档位，其余供应商使用 `medium`。

## 架构

```
┌──────────────────────────── Electron 主进程 ────────────────────────────┐
│  src/main/index.ts        窗口、菜单、IPC、权限/沙箱策略、密钥管理        │
│  src/main/agent-host.ts   通过 stdin/stdout 管理 RPC worker 子进程        │
└───────────────┬──────────────────────────────────────────────────────────┘
                │ JSON-RPC over stdio（spawn tether 的 rpc-entry）
┌───────────────▼──────────────────────────────────────────────────────────┐
│  Agent 子进程（tether-agent-core）  agent 循环 / sandbox / 会话存储       │
│  以 ELECTRON_RUN_AS_NODE=1 运行，禁用遥测                                  │
└──────────────────────────────────────────────────────────────────────────┘
        ▲                                ▲
        │ contextBridge (window.harness) │ IPC (invoke / event)
┌───────┴────────────────────────────────┴───────────┐
│  React 渲染进程（src/renderer）                      │
└──────────────────────────────────────────────────────┘
```

- 主进程把 `tether-agent-core` 的 RPC 入口以子进程方式拉起，消息通过结构化 JSON 行协议收发，请求超时 45 秒；
- 渲染进程通过 preload 暴露的 `window.harness` 调用 **app / workspace / sessions / auth / agent** 五组能力，不直接接触 Node。

## 目录结构

```
src/
  main/               Electron 主进程
    index.ts          窗口 / 菜单 / IPC / 工作区 / 认证 / 会话 / 权限策略
    agent-host.ts     RPC worker 子进程宿主（spawn + JSON 行协议）
  preload/
    index.ts          contextBridge，暴露 window.harness API
  renderer/           React 界面
    App.tsx           应用状态与流程编排
    conversation.ts   会话消息归一化 / 事件应用 / 工具与文件变更解析
    conversation.test.ts
    ui.tsx            组件（聊天、侧边栏、登录、审批卡片、文件预览、输入框）
    styles.css
  shared/
    types.ts          跨进程共享类型与 DesktopApi 契约
scripts/
  ensure-electron.mjs 安装时补齐 Electron 二进制（离线缓存兜底）
```

## 数据与互操作

- **会话与密钥**：写入 Tether 自有目录 `~/.tether`，由 `tether-agent-core` 管理；
- **最近项目**：记录在 Electron `userData`（macOS 下为 `~/Library/Application Support/Tether`）的 `recent-workspaces.json`，权限 `0600`，最多保留 12 条；
- **非项目会话**：工作目录为 `<userData>/tasks`，沙箱固定为只读。

## 打包与发布

`electron-builder` 配置在 `electron-builder.yml`：

- `asar: false` —— RPC worker 与原生 keyring 需要真实文件系统路径；
- 目标为未签名的目录包（`dir` target）：macOS (arm64)、Linux (x64)、Windows (x64)；
- `publish: null`，不自动发布（无自动更新）。

## 安全模型

- 渲染进程与主进程通过 `contextBridge` 白名单 API 通信，无 `nodeIntegration`；
- `workspace:read` 对相对路径做解析校验，杜绝路径穿越；读取超过 200 KB 截断、检测二进制；
- `workspace:list` 只返回当前项目根目录内的文件，跳过 `.git`、`node_modules`、构建产物等目录；
- `setWindowOpenHandler` 拒绝所有新窗口，仅放行 http(s) 链接并交给系统浏览器；
- 子进程以 `ELECTRON_RUN_AS_NODE=1` 运行（使用 Electron 内置 Node），并显式禁用遥测与版本检查。

## 开发

- **IPC 契约**：`src/shared/types.ts` 中的 `DesktopApi` 是渲染进程可见的唯一能力面，preload 逐项实现并透出；
- **新增供应商**：供应商列表与认证流程由 `tether-agent-core` 提供（`SUPPORTED_PROVIDER_IDS` 等），应用层只需消费 `auth:status` / `auth:login` / `auth:save-api-key`；
- **测试**：`pnpm test` 使用 Vitest（`src/**/*.test.ts`）。

## 已知限制

- 同一时间只运行一个活动 agent 会话（单 RPC 子进程），切换项目会终止当前会话；
- 未打开项目时是只读会话，无法直接修改本地文件；
- 删除会话在底层是 `tether-agent-core` 的 archive 语义；
- `danger-full-access` 沙箱底层已支持，但界面暂未直接暴露；
- 打包产物为 ad-hoc 签名、未公证（无 Apple Developer ID），且无自动更新。

## 常见问题

- **会话 / 密钥存在哪里？** `~/.tether`。
- **没有打开仓库能对话吗？** 可以，但属于非项目会话：工作目录为 `<userData>/tasks`，固定只读。
- **为什么切换项目后会话结束了？** 当前实现是单 RPC 子进程，同一时间只支持一个活动 agent 会话。
- **无法连接模型？** 在左下角账户区域检查是否已配置 API Key / 完成登录，或通过环境变量注入密钥。
- **macOS 打开报「已损坏」？** 未公证的包会被 Gatekeeper 拦截。本机打开：右键 → 打开。从网盘/浏览器下载后先执行 `xattr -cr /path/to/Tether.app`。

## License

MIT
