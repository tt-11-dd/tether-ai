<div align="center">

<img src="build/icon.png" width="96" alt="Tether logo" />

# Tether

**基于 Pi 生态构建的本地优先 AI 编程工作台**

让 DeepSeek 与 OpenAI 兼容模型安全地阅读、修改和验证你的代码仓库。

[English](README.md) · [简体中文](README.zh-CN.md) · [下载最新版](https://github.com/tt-11-dd/tether-ai/releases/latest)

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Agent Core](https://img.shields.io/npm/v/tether-agent-core?label=tether-agent-core)](https://www.npmjs.com/package/tether-agent-core)
[![Platform](https://img.shields.io/badge/platform-macOS%20arm64%20%7C%20Windows%20x64-lightgrey)](https://github.com/tt-11-dd/tether-ai/releases/latest)

</div>

Tether 是一个面向真实代码仓库的 Electron 桌面 Agent。它把模型调用、文件工具、终端命令、权限审批、会话记录与 Diff 审查放进同一个本地工作台；你的界面与会话数据保存在本机，模型请求直接发送到你配置的服务商或本地网关，不经过 Tether 中转。

## 为什么是 Tether

- **DeepSeek 优先**：支持自定义 Base URL、模型发现和推理强度设置，也可连接 OneAPI、Ollama、vLLM 等 OpenAI 兼容端点。
- **可见、可控**：实时展示工具调用、命令输出、文件改动和上下文用量。
- **权限隔离**：提供仅规划、编辑时询问、工作区权限与完全访问四种模式。
- **安全改动**：每次补丁保存文件检查点，可通过 `/undo` 恢复上一轮修改。
- **本地优先**：设置、凭据与会话存放在 `~/.tether`，无遥测、无 Tether 云端代理。
- **桌面体验**：项目会话树、`@` 文件引用、生成中后续排队、图片输入、Diff 预览和中英文界面。

## 基于 Pi 的哪些部分

Tether 没有重复实现 Agent 基础设施，而是通过 [`tether-agent-core`](https://www.npmjs.com/package/tether-agent-core) 基于 [Pi 生态](https://github.com/earendil-works/pi) 封装并扩展：

| Pi 包 | Tether 使用的能力 |
| --- | --- |
| `@earendil-works/pi-agent-core` | Agent 状态、消息流、工具调用与思考级别类型 |
| `@earendil-works/pi-ai` | 模型与提供商协议、消息/图片/用量类型、OpenAI API 适配基础 |
| `@earendil-works/pi-coding-agent` | Coding Agent 扩展系统、会话与设置、项目信任、RPC Client/Worker |
| `@earendil-works/pi-tui` | Runtime CLI 的文本组件、主题与终端交互基础 |

在此之上，Tether 增加：

- DeepSeek 默认配置与 OpenAI 兼容网关体验
- 四级权限模型、macOS Seatbelt 与实验性 Windows sandbox helper（需安装并启用）
- 工作区约束工具、托管命令、文件补丁与持久化 Checkpoint
- MCP、Hooks、Skills、计划与子 Agent 集成
- `~/.tether` 本地数据约定和 Electron/React 桌面工作台

Pi 提供运行基础；Tether 负责产品边界、安全策略和桌面交互。感谢 Pi 生态维护者提供的开源基础。

## 架构

```text
React Renderer
  对话、Diff、设置、项目与会话 UI
        │  contextBridge / Electron IPC
        ▼
Electron Main
  窗口、工作区、凭据与 Agent 进程托管
        │  JSON-RPC over stdio
        ▼
tether-agent-core
  Tether 权限、沙箱、工具、Checkpoint、MCP、会话
        │
        ▼
Pi ecosystem
  Agent loop · model protocol · coding-agent extensions · RPC · TUI
```

渲染进程不直接访问 Node.js；所有桌面能力都通过 `src/shared/types.ts` 定义的 IPC 契约进入主进程。Agent 在独立工作进程中运行，崩溃后可以从已落盘会话继续对话，但不会自动重放未完成命令。

## 模型与图片

桌面端默认面向 DeepSeek，并允许填写自定义 OpenAI 兼容 Base URL。`tether-agent-core` 还包含 OpenAI、Anthropic、OpenRouter、Z.AI、Kimi、MiniMax、xAI 等 provider 基础能力；桌面设置页会逐步开放这些配置。

粘贴图片时：

- 可选 GLM-4V 进行视觉理解，需要用户配置对应 API Key。
- MinerU 用于 OCR 解析，目前会将图片发送到 MinerU 服务，不应视为离线本地 OCR。

## 权限模式

| 模式 | 行为 |
| --- | --- |
| `plan` | 只读分析与规划；诊断命令可在只读沙箱中运行 |
| `ask` | 写入、网络或越界操作前请求确认 |
| `auto` | 自动执行工作区内的常规操作，越界时请求确认 |
| `full` | 关闭工作区沙箱，适用于用户明确授权的可信项目 |

沙箱是纵深防御，不替代代码审查。执行未知仓库中的命令前仍应检查 Agent 给出的操作。

## Agent Skills

Skills 由 Pi 运行时加载。标准路径：

| 范围 | 路径 |
| --- | --- |
| 项目（需信任） | `.agents/skills/<name>/SKILL.md`、`.pi/skills/<name>/SKILL.md` |
| 用户全局 | `~/.tether/skills/<name>/SKILL.md`、`~/.agents/skills/<name>/SKILL.md` |

每个 skill 目录包含 `SKILL.md`，frontmatter 需有 `name` 与 `description`。输入 `/skill:名称` 调用；设置 → Agent Skills 可查看已加载列表；输入 `/` 时也会出现在补全里。

## 使用

从 [GitHub Releases](https://github.com/tt-11-dd/tether-ai/releases/latest) 下载：

- macOS：Apple Silicon / arm64
- Windows：Windows 10/11 x64

首次启动后：

1. 打开项目目录。
2. 在设置中填写 DeepSeek API Key 或自定义兼容端点。
3. 输入任务，审查工具执行与文件 Diff；需要时使用 `/undo`。

### 后续排队

生成过程中仍可输入下一条，回车后进入输入框上方的排队（最多 5 条），当前回答结束后按顺序自动发送。点停止会中止本轮并**保留**排队，可用「立即发送」或条目上的上箭头发出；生成中点上箭头只把该条提到队首。`/` 命令不会进队。换对话、新对话或换项目会清空排队（不写进会话文件）。

当前 macOS 包使用开发签名。若 Gatekeeper 拦截，请右键应用选择“打开”，或执行：

```bash
xattr -cr /Applications/Tether.app
```

## 本地开发

要求 Node.js `>=22.19` 和 pnpm。

```bash
git clone https://github.com/tt-11-dd/tether-ai.git
cd tether-ai
pnpm install
pnpm dev
```

常用检查：

```bash
pnpm typecheck
pnpm test
pnpm build
```

Agent 核心通过 npm 依赖 `tether-agent-core`。开发 Runtime 本身时，可在本地临时 link `../tether-runtime/packages/core`。

## 致谢

Tether 的 Agent 运行时基于开源 [Pi 生态](https://github.com/earendil-works/pi)（`@earendil-works/pi-agent-core`、`pi-ai`、`pi-coding-agent`、`pi-tui`）构建。[`tether-agent-core`](https://www.npmjs.com/package/tether-agent-core) 在 Pi 之上封装 DeepSeek 默认体验、权限模式、沙箱、Checkpoint、MCP、Hooks 与本地数据层。Pi 依赖保留各自的许可证与版权。

## 隐私说明

Tether 不运行遥测或模型代理服务器。会话、设置与凭据保存在本机；但为了完成任务，提示词、相关代码上下文与图片会发送给你选择的模型、网关或 OCR 服务。使用第三方服务前请阅读其隐私政策，敏感项目可连接本地兼容端点。

## License

[MIT](LICENSE)。Pi 生态依赖保留各自的许可证与版权。
