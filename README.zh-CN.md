<div align="center">

<img src="build/icon.png" width="96" alt="Tether logo" />

# Tether

**面向开发者的开放式、本地优先 AI 编程工作台**

*深度适配 DeepSeek 与国产大模型生态 · 自由配置自定义接口 · 纯粹本地隐私与安全*

[English](README.md) · [简体中文](README.zh-CN.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.19-blue)](https://nodejs.org)
[![Electron](https://img.shields.io/badge/Electron-37-blueviolet)](https://www.electronjs.org)
[![Platform: macOS / Windows](https://img.shields.io/badge/platform-macOS%20(arm64)%20%7C%20Windows%20(x64)-lightgrey)](https://github.com/tt-11-dd/tether-ai)

</div>

Tether 是一款专为代码仓库级开发打造的原生桌面 AI 编程工作台。桌面端基于 Electron、React 19 和独立的本地 Agent 核心（`tether-agent-core`，本地 pnpm workspace 包，位于 `../tether-runtime/packages/core`）构建；Agent 内核当前基于 **Pi 生态包**（`@earendil-works/pi-agent-core`、`@earendil-works/pi-coding-agent`、`@earendil-works/pi-ai`、`@earendil-works/pi-tui`，均为开源项目）封装，并在此基础上加入 Tether 自己的 DeepSeek 适配、自定义接口、权限模型、Checkpoint 撤回、桌面 RPC 与本地数据管理。Tether 赋予你自主阅读工程代码库、在受限环境中执行终端命令、通过事务级检查点精确修改复杂文件以及查看精美 Diff 预览的能力——**所有数据均在你的本地电脑运行，完全保护隐私，绝无任何厂商锁定**。

---

## ⚡ 核心特性一览

**Tether 从架构底层出发，为重视模型选择、数据隐私与完全掌控权的开发者而设计：**

| 核心能力 | Tether 为你提供 |
| :--- | :--- |
| **DeepSeek 与国产大模型** | 🌟 **原生深度适配** — 推理强度（Effort）控制、Kimi、MiniMax、智谱 GLM |
| **自定义接口与中转** | ✅ **100% 开放 Base URL / OneAPI / Ollama / vLLM** — 任意 OpenAI 兼容网关直连 |
| **免配置内置 OCR** | ✅ **内置 MinerU OCR 引擎** — 免配 API Key、不消耗视觉 Token |
| **数据隐私与遥测** | 🔒 **100% 本地存储**（`~/.tether`）— 零遥测、零云端中转 |
| **操作系统级沙箱** | 🛡️ **macOS Seatbelt 与 Windows 防护** — 原生进程隔离 |
| **事务级一键撤销** | ⏪ **原子级 Checkpoint 事务回滚（`/undo`）** — 一步还原文件改动 |
| **现代桌面体验** | 🎨 **外置顶栏 + 极简温润对话布局**（1080p~4K 适配） |

---

### 1. 🇨🇳 深度适配 DeepSeek 与国产大模型生态
- **DeepSeek 原生深度优化**：支持设置 DeepSeek 思考强度（`high` / `medium` / `low`）、实时思维链流式展示、长上下文大仓库分析。
- **主流国产大模型全面兼容**：开箱即用支持 **Kimi**、**MiniMax**、**智谱 GLM-4V**，以及内置 **MinerU OCR**。

### 2. 🔌 自由配置任意接口（完全告别厂商锁定）
- **自定义 Base URL 与中转**：支持配置任意 OpenAI 兼容接口、OneAPI、NewAPI、企业内部私有网关或代理中转。
- **本地大模型部署**：无缝直连本地运行的 **Ollama**、**vLLM**、**LM Studio** 或 **LocalAI**。
- **动态模型列表发现**：根据填写的 Base URL 自动拉取和刷新可用模型列表。

### 3. 👁️ 混合多模态视觉与内置免配 OCR
- **内置 MinerU OCR 引擎**：无需配置 API Key，开箱即可从设计稿截图、报错图片中高精度提取 Markdown 代码与文字，不消耗模型 Token。
- **可选 GLM-4V 视觉理解**：支持配置智谱 API Key，用于设计稿还原、UI 组件布局与视觉架构分析。

### 4. 🔒 真正的本地优先与安全沙箱
- **本地数据隔离**：所有会话、凭据密钥、配置和 Checkpoint 均保存在本机 `~/.tether`（`0600` 权限），不上传任何外部服务器。
- **4 级精细权限模式**：`仅规划`、`编辑时询问`、`工作区权限`、`完全访问`，配合操作系统原生沙箱机制。
- **原子级 Checkpoint 回滚（`/undo`）**：随时一键撤回 Agent 所做的文件改动，保障代码仓库安全无虞。

### 5. 🎨 原生轻量现代桌面体验
- 融合了 **结构清晰的外置项目顶栏** 与 **极简温润的人性化对话布局**。
- 完美适配 1080p 至 4K 大屏显示，具备 macOS 红绿灯/全屏高度动态自适应与 Windows 原生标题栏集成。

---

## 📑 目录

- [核心功能](#-核心功能)
- [快速开始](#-快速开始)
- [安全与权限模式](#-安全与权限模式)
- [自定义接口与模型配置](#-自定义接口与模型配置)
- [多模态视觉与 OCR 引擎](#-多模态视觉与-ocr-引擎)
- [架构设计](#-架构设计)
- [项目目录结构](#-项目目录结构)
- [开发与常用脚本](#-开发与常用脚本)
- [构建打包与分发](#-构建打包与分发)
- [常见问题与排查](#-常见问题与排查)
- [开源协议](#-开源协议)

---

## ✨ 核心功能

### 1. 多模型智能大脑
- **DeepSeek 第一梯队支持**：支持配置自定义 Base URL、API Key 与推理强度。
- **全球与国产模型矩阵**：支持 DeepSeek、OpenAI、Anthropic、OpenRouter、Kimi、MiniMax、xAI、ZAI 或私有接口。
- **实时 Token 与耗时遥测**：每轮对话均直观展示 Token 消耗量、上下文窗口占比与生成耗时。

### 2. 多项目工作区
- 快速打开任意本地 Git 仓库或项目文件夹（**⌘/Ctrl + O**）。
- 侧边栏多项目会话树隔离管理，随时切换。
- 支持无项目草稿模式，用于临时代码测试与通用问答。

### 3. Agent 执行与原子级撤销
- **实时活动流式呈现**：清晰查看 Agent 的思考步骤、工具执行细节与终端调用命令。
- **交互式 Diff 预览**：支持高亮查看代码行级增删改动与变更文件列表。
- **事务级检查点回滚**：通过输入 `/undo` 或点击界面按钮，一键还原误改代码。

### 4. 快捷键与高频开发交互
- **模糊文件引用（`@`）**：在输入框任意位置输入 `@` 即可模糊检索并挂载项目文件。
- **快捷指令（Slash Commands）**：支持 `/new`（新建会话）、`/open`（打开项目）、`/login`（配置模型）、`/undo`（撤销修改）。
- **全局快捷键支持**：快速切换标签、新建对话与发送提示词。

---

## 🚀 快速开始

### 环境依赖
- **Node.js**：`>= 22.19.0`
- **pnpm**：`>= 10.x` 或 `11.x`
- 安装包支持系统：**macOS**（Apple Silicon / arm64）、**Windows 10/11**（x64）。Linux 与 Intel Mac 暂未打包；本地开发仍可用 `pnpm dev`。
- **tether-runtime 仓库**：`tether-agent-core` 以本地链接方式引入，需将 `tether-runtime` 仓库放在与 `tether-ai` 同级目录（`../tether-runtime`）；`pnpm dev` 会自动编译其 `packages/core` 并链接为 `node_modules/tether-agent-core`。

### 安装与运行

```bash
# 克隆仓库（tether-agent-core 依赖本地 tether-runtime 仓库，请将两个仓库放在同一父目录下）
git clone https://github.com/tt-11-dd/tether-ai.git
cd tether-ai

# 若尚未准备 tether-runtime：将 tether-runtime 仓库（packages/core 即为 tether-agent-core）
# 克隆到与 tether-ai 同级的目录，再执行下面的安装步骤

# 安装依赖
pnpm install

# 启动开发模式（支持热重载）
pnpm dev
```

1. 点击顶栏 **📁 选择项目**（或快捷键 **⌘/Ctrl + O**）选择本地项目目录。
2. 点击左下角齿轮/账户图标打开设置，配置你的 DeepSeek API Key 或自定义接口。
3. 输入需求（例如：“*分析这个项目的整体架构和入口*”），开启高效 Agent 编程！

---

## 🛡️ 安全与权限模式

Tether 提供 4 种可在输入栏随时切换的权限模式：

| 模式 | 名称 | 图标 | 行为与沙箱范围 |
| :--- | :--- | :---: | :--- |
| `plan` | **仅规划** | 💬 | 只读模式。仅分析代码和规划方案，严禁修改任何文件或执行命令。 |
| `ask` | **编辑时询问** | ⓘ | 修改外部文件或访问网络时，必须由用户弹窗确认后方可执行。 |
| `auto` | **工作区权限** | 🛡️ | 自动执行工作区内的安全文件改动，仅对高危操作（如破坏性脚本）请求批准。 |
| `full` | **完全访问** | 🌐 | 开放无沙箱限制的执行权限（开启时需主机确认），适用于全功能构建与调试。 |

---

## 🔌 自定义接口与模型配置

点击界面左下角 **设置 (⚙️) → 聊天模型配置** 即可自定义：

### 1. DeepSeek 配置（默认）
- **Base URL**：`https://api.deepseek.com/v1`（或你的代理网关地址）
- **模型**：`deepseek-reasoner`（DeepSeek-R1 / V3）
- **API Key**：`sk-...`

### 2. 自定义 OpenAI 兼容接口（OneAPI / Ollama / vLLM / NewAPI）
- **Base URL**：如 `http://localhost:11434/v1`（Ollama）或 `https://api.your-relay.com/v1`
- **模型**：输入网关提供的任意模型标识（如 `qwen-2.5-72b`、`claude-3-5-sonnet` 等）
- **API Key**：你的网关 Token（如本地无需认证可随意填写）

---

## 👁️ 多模态视觉与 OCR 引擎

1. **MinerU OCR 识别引擎（免配内置）**：
   - 专为代码与技术文档优化，精准识别截图中的代码块与格式化文本。
   - **无需配置任何 API Key**，全自动本地提取。
2. **GLM-4V 视觉理解（可选增强）**：
   - 深度理解复杂 UI 设计图、线框图和页面交互逻辑。
   - 可在 **设置 → 视觉模型配置** 中填写智谱 API Key。

---

## 🏗️ 架构设计

```
┌──────────────────────────── Electron 主进程 ─────────────────────────────────┐
│  src/main/index.ts         窗口生命周期管理、IPC 通信、菜单、工作区安全策略   │
│  src/main/agent-host.ts    RPC 子进程管理器（管理 Agent 核心进程）           │
└───────────────┬───────────────────────────────────────────────────────────────┘
                │ JSON-RPC over stdio（调度 tether-agent-core）
┌───────────────▼───────────────────────────────────────────────────────────────┐
│  Agent 工作进程 (tether-agent-core)                                            │
│  基于 Pi Agent/Coding Agent 内核封装，扩展 Tether 权限、Checkpoint 与 DeepSeek │
└───────────────────────────────────────────────────────────────────────────────┘
        ▲                                ▲
        │ contextBridge (window.harness) │ IPC 事件与双向调用
┌───────┴────────────────────────────────┴────────────────┐
│  React 渲染进程 (src/renderer)                          │
│  外置顶栏 Tab 布局、自适应会话流、无 Monaco 轻量高亮    │
└─────────────────────────────────────────────────────────┘
```

- **严格的进程隔离**：渲染进程不直接引入 Node.js 原生模块，全部通过 `src/shared/types.ts` 中定义的强类型安全 IPC 接口进行通信。
- **状态流式恢复**：界面状态完全基于会话 `.jsonl` 流还原，崩溃即恢复。
- **Pi 依赖说明**：`tether-agent-core` 并不是从零重写 Agent 运行循环，而是复用 Pi 的 Agent、模型、TUI 与 Coding Agent 基础能力；Tether 负责桌面产品化、本地优先数据层、DeepSeek/国产模型适配、权限沙箱、Checkpoint 撤回与自定义接口体验。

---

## 📂 项目目录结构

```text
tether-ai/
├── src/
│   ├── main/                 # Electron 主进程源码
│   │   ├── index.ts          # 窗口管理、系统菜单、IPC 注册、权限沙箱
│   │   └── agent-host.ts     # Agent 工作进程托管与 RPC 调度
│   ├── preload/              # 安全 Preload 脚本
│   │   └── index.ts          # 向 window.harness 暴露安全的桌面 API
│   ├── renderer/             # React 19 渲染端工作台
│   │   ├── App.tsx           # 主应用状态与交互调度
│   │   ├── ui.tsx            # UI 组件、顶栏、权限选择器、弹窗
│   │   ├── conversation.ts   # 消息归一化、补丁解析、Diff 计算
│   │   ├── highlight.ts      # 零外部依赖轻量语法高亮引擎
│   │   └── styles.css        # 响应式自适应样式表
│   ├── extensions/           # Agent 扩展插件
│   │   ├── vision.ts         # 多模态 GLM + MinerU OCR 扩展
│   │   └── vision.test.ts    # 视觉扩展单元测试
│   └── shared/               # 共享类型与契约定义
│       ├── types.ts          # DesktopApi 与 Agent 通信协议类型
│       ├── chat-profiles.ts  # 聊天模型配置档案
│       ├── openai-models.ts  # OpenAI 兼容端点动态模型发现
│       ├── vision-api.ts     # 视觉与 OCR 数据整合
│       └── *.test.ts         # 共享模块单元测试
├── .agents/skills/           # 长任务工作流 Skill（init / continue-long-run）
├── tsup.config.ts            # 主进程打包配置（Electron）
├── electron-builder.yml      # 桌面安装包构建配置
├── vite.config.ts            # 渲染进程构建配置
└── package.json
```

---

## 🛠️ 开发与常用脚本

| 命令 | 说明 |
| :--- | :--- |
| `pnpm dev` | 启动开发服务器（Vite 热重载 + Electron） |
| `pnpm typecheck` | 执行全工程 TypeScript 类型检查 |
| `pnpm test` | 执行 Vitest 单元测试套件 |
| `pnpm build` | 编译主进程（`tsup`）并打包渲染端（`vite`） |
| `pnpm check` | 执行全量 CI 校验（类型检查 + 测试 + 构建） |
| `pnpm pack` | 构建生产安装包：macOS arm64 `.dmg` 与 Windows x64 `.exe` |
| `pnpm start` | 启动已编译的生产包预览 |

---

## 📦 构建打包与分发

基于 `electron-builder` 进行自动化打包：

```bash
# 本机打包（需同时准备同级目录的 tether-runtime）
pnpm pack:mac   # 仅 macOS arm64 .dmg
pnpm pack:win   # 仅 Windows x64 .exe（在 Windows 上更稳）
pnpm pack       # 同时打 mac + win（跨平台打包可能需要额外环境）
```

- **打包输出目录**：`release/`
- **支持目标格式**（与 `electron-builder.yml` 一致）：
  - macOS：`Tether-*-arm64.dmg`（仅 Apple Silicon）
  - Windows：`Tether-Setup-*.exe`（x64 NSIS）
  - Linux / Intel Mac：暂未提供安装包

### GitHub Releases 自动发版

推送形如 `v0.1.0` 的 tag 后，Actions 会在 macOS / Windows runner 上分别打包，并上传到 [Releases](https://github.com/tt-11-dd/tether-ai/releases)：

```bash
# 1. 把 package.json 的 version 改成与 tag 一致，例如 0.1.0
# 2. 提交并推送
git add package.json && git commit -m "发布 0.1.0" && git push

# 3. 打 tag 并推送（触发 .github/workflows/release.yml）
git tag v0.1.0
git push origin v0.1.0
```

完成后安装包会出现在：`https://github.com/tt-11-dd/tether-ai/releases/tag/v0.1.0`  
每个 Release **只上传 2 个文件**：macOS `.dmg` + Windows `.exe`（不上传 blockmap / 调试 yaml）。

---

## ❓ 常见问题与排查

#### Q: 我的会话记录和 API Key 保存在哪里？
所有数据均仅保存在本地的 `~/.tether` 目录中（包含 `config.json`、`settings.json`、`auth.json` 和 `sessions/`），不会向任何第三方云端传输。

#### Q: 我可以直接连接自己本地的 Ollama 或 vLLM 吗？
完全可以。在 **设置 → 聊天模型配置** 中选择 **自定义 OpenAI 兼容接口**，将 Base URL 设为 `http://localhost:11434/v1`（Ollama）或 `http://localhost:8000/v1`（vLLM）即可。

#### Q: 不打开任何文件夹可以使用 Tether 吗？
可以。未打开项目时，Tether 会进入安全的临时草稿会话（工作目录位于本地缓存沙箱中），适合用于通用代码咨询或简单算法验证。

#### Q: macOS 提示“Tether 已损坏，无法打开”？
开发自签名的二进制应用可能会被 macOS Gatekeeper 隔离，在终端执行以下命令即可解除：
```bash
xattr -cr /Applications/Tether.app
```

---

## 📄 开源协议

本项目基于 **MIT License** 开源。详情参见 [LICENSE](LICENSE)。
