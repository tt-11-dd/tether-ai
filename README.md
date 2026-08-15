<div align="center">

<img src="build/icon.png" width="96" alt="Tether logo" />

# Tether

**The Open, Local-First AI Coding Workbench for Developers & Repositories**

*Empowering developers with native DeepSeek & domestic LLM deep integration, arbitrary custom endpoints, and complete privacy.*

[English](README.md) · [简体中文](README.zh-CN.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.19-blue)](https://nodejs.org)
[![Electron](https://img.shields.io/badge/Electron-37-blueviolet)](https://www.electronjs.org)
[![Platform: macOS / Linux / Windows](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey)](https://github.com/tt-11-dd/tether-ai)

</div>

Tether is a native desktop AI coding workbench engineered for repository-scale development. Built on Electron, React 19, and a dedicated local agent core ([`tether-agent-core`](https://github.com/tt-11-dd/tether-ai)), Tether gives you full autonomy to inspect codebases, execute scoped terminal operations, edit complex files with transactional checkpoints, and interact through rich diff previews—**all with complete privacy and zero cloud lock-in on your machine**.

---

## ⚡ Tether vs. Codex / Claude Code (Key Advantages)

While products like **OpenAI Codex** and **Anthropic Claude Code / Claude Desktop** provide strong agent capabilities, they frequently lock developers into proprietary closed ecosystems, strict cloud relays, rigid subscription tiers, and fixed API schemas. 

**Tether is engineered from the ground up to solve these constraints:**

| Capability | Tether | Codex / OpenAI | Claude Desktop / Claude Code |
| :--- | :---: | :---: | :---: |
| **DeepSeek & Domestic LLMs** | 🌟 **Native Deep Optimization** (Reasoning effort, Kimi, MiniMax, GLM) | ❌ Restricted to OpenAI | ❌ Restricted to Anthropic |
| **Custom Endpoints & Proxies** | ✅ **100% Custom Base URL / OneAPI / Ollama / vLLM** | ❌ Fixed official endpoints | ❌ Fixed official endpoints |
| **Zero-Config OCR Engine** | ✅ **Built-in Free MinerU OCR** (No API key required) | ❌ Needs vision tokens | ❌ Needs vision tokens |
| **Data Privacy & Telemetry** | 🔒 **100% Local-First** (`~/.tether`), Zero telemetry | ⚠️ Cloud relay / Logging | ⚠️ Cloud relay / Logging |
| **OS-Level Sandboxing** | 🛡️ **macOS Seatbelt & Windows Guard** | ⚠️ Limited container / Remote | ⚠️ Cloud container |
| **Transactional Undo** | ⏪ **Atomic Checkpoint Rollback (`/undo`)** | ❌ Manual git reverts | ❌ Session-level resets |
| **Desktop UI Adaptability** | 🎨 **Codex-style Top Tab + Claude Warm Layout** (1080p–4K responsive) | ⚠️ Web / Fixed layout | ⚠️ Fixed layout |

---

### 1. 🇨🇳 Deep Optimization for DeepSeek & Domestic LLMs
- **DeepSeek First-Class Architecture**: Native control over DeepSeek reasoning intensity (`high` / `medium` / `low`), deep thinking chain streaming, and long-context repository parsing.
- **Domestic Model Ecosystem**: Out-of-the-box first-class compatibility with **Kimi**, **MiniMax**, **Zhipu (GLM-4V)**, and **MinerU OCR**.

### 2. 🔌 Complete Interface Freedom (Any Base URL / Proxy / Local Model)
- **Zero Vendor Lock-In**: Connect to any OpenAI-compatible API gateway, OneAPI, NewAPI, enterprise private proxy, or local inference engines (**Ollama**, **vLLM**, **LM Studio**, **LocalAI**).
- **Dynamic Model Discovery**: Automatically inspects and lists available remote models from your custom Base URL.

### 3. 👁️ Hybrid Multimodal Vision & Built-in Zero-Config OCR
- **Free Built-in MinerU OCR**: Extracts code, structure, and text from design screenshots and error images locally without consuming model tokens or requiring API keys.
- **Optional GLM-4V Reasoning**: Parallel visual layout and UI analysis for design-to-code workflows.

### 4. 🔒 True Local-First Privacy & Safety
- **Local Isolation**: All sessions, settings, auth keys, and checkpoints are stored in `~/.tether` with `0600` user-only permissions.
- **4-Tier Permission Guard**: Granular permission modes (`Plan`, `Ask on Edit`, `Workspace Safe`, `Full Access`) backed by native OS sandboxing.
- **Atomic Rollback (`/undo`)**: Instantly restore modified files and undo agent actions with zero data loss.

### 5. 🎨 Modern Desktop Engineering
- Combines **Codex's structured attached project header** with **Claude's clean, warm conversational breathing room**.
- Full high-DPI scaling across 1080p, 2K, and 4K displays, with dynamic macOS traffic light / fullscreen management and Windows TitleBarOverlay integration.

---

## 📑 Table of Contents

- [Features](#-features)
- [Quick Start](#-quick-start)
- [Permission & Safety Model](#-permission--safety-model)
- [Custom API & Provider Configuration](#-custom-api--provider-configuration)
- [Hybrid Vision & OCR Engine](#-hybrid-vision--ocr-engine)
- [Architecture](#-architecture)
- [Repository Structure](#-repository-structure)
- [Development & Scripts](#-development--scripts)
- [Packaging & Distribution](#-packaging--distribution)
- [FAQ & Troubleshooting](#-faq--troubleshooting)
- [License](#-license)

---

## ✨ Features

### 1. Multi-Provider Intelligence
- **DeepSeek Native Control**: Configure custom Base URL, API key, and reasoning effort.
- **Global & Domestic LLM Matrix**: Connect to DeepSeek, OpenAI, Anthropic, OpenRouter, Kimi, MiniMax, xAI, ZAI, or private LLM endpoints.
- **Real-Time Token & Cost Telemetry**: Live tracking of token consumption, context window usage, and duration per turn.

### 2. Multi-Project Workspace
- Seamlessly open any local git repository or project folder (**⌘/Ctrl + O**).
- Project-isolated thread trees organized cleanly in the sidebar.
- Zero-project quick scratchpad session for general queries and standalone scripts.

### 3. Agent Execution & Atomic Undo
- **Live Activity Streaming**: View real-time thought chains, tool executions, and step-by-step reasoning.
- **Interactive Patch Previews**: Inspect syntax-highlighted git diffs with exact insertion and deletion metrics.
- **Rollback Checkpoints**: Easily revert accidental changes using the built-in undo mechanism (`/undo` or UI button).

### 4. Interactive Input & Developer Shortcuts
- **Fuzzy File Mentions**: Type `@` anywhere in the input prompt to search and attach repository files.
- **Slash Commands**: Rapid action execution via `/new`, `/open`, `/login`, and `/undo`.
- **Keyboard-First Navigation**: Global shortcuts for switching tabs, new threads, and sending prompts.

---

## 🚀 Quick Start

### Prerequisites
- **Node.js**: `>= 22.19.0`
- **pnpm**: `>= 10.x` or `11.x`
- Supported OS: **macOS** (Apple Silicon / Intel), **Windows 10/11** (x64), **Linux** (x64)

### Installation & Run

```bash
# Clone the repository
git clone https://github.com/tt-11-dd/tether-ai.git
cd tether-ai

# Install dependencies
pnpm install

# Start the desktop application in development mode
pnpm dev
```

1. Click **📁 选择项目** (or press **⌘/Ctrl + O**) to bind a project directory.
2. Click the gear / account icon in the bottom-left corner to configure your API Key or custom endpoint.
3. Type your prompt (e.g. `"Explain the entry points of this repository"`) and start building!

---

## 🛡️ Permission & Safety Model

Tether provides 4 distinct permission modes selectable directly from the bottom prompt bar:

| Mode | Label | Icon | Behavior & Sandbox Scope |
| :--- | :--- | :---: | :--- |
| `plan` | **仅规划 (Plan Only)** | 💬 | Read-only analysis & planning. File edits and commands are strictly disabled. |
| `ask` | **编辑时询问 (Ask on Edit)** | ⓘ | Prompts for user approval before modifying external files or making network requests. |
| `auto` | **工作区权限 (Workspace Safe)** | 🛡️ | Automatically applies safe changes within the workspace; requests confirmation only for high-risk operations. |
| `full` | **完全访问 (Full Access)** | 🌐 | Unrestricted execution without sandbox boundaries (prompts for host confirmation on startup). |

---

## 🔌 Custom API & Provider Configuration

Tether is 100% unconstrained by vendor lock-in. Configure your models via **Settings (⚙️) → Chat Provider**:

### 1. DeepSeek (Default)
- **Base URL**: `https://api.deepseek.com/v1` (or your proxy endpoint)
- **Model**: `deepseek-reasoner` (DeepSeek-R1 / V3)
- **API Key**: `sk-...`

### 2. Custom OpenAI-Compatible Gateway (OneAPI / Ollama / vLLM / NewAPI)
- **Base URL**: e.g., `http://localhost:11434/v1` or `https://my-proxy.internal/v1`
- **Model**: Any model name served by your gateway (e.g. `qwen-2.5-72b`, `deepseek-r1-distill`, `claude-3-5-sonnet`)
- **API Key**: Bearer token or placeholder string

---

## 👁️ Hybrid Vision & OCR Engine

1. **MinerU OCR (Built-in, Zero-Config)**:
   - Extracts clean markdown text from uploaded screenshots, documentation images, and code snippets.
   - Fully enabled by default—**no API key or setup required**.
2. **GLM-4V Multimodal Analysis (Optional)**:
   - Deep visual understanding for UI design replication, wireframes, and layout diagnostics.
   - Configurable in **Settings → Vision** with your Zhipu / GLM API Key.

---

## 🏗️ Architecture

```
┌──────────────────────────── Electron Main Process ────────────────────────────┐
│  src/main/index.ts         Window management, IPC, menus, workspace security │
│  src/main/agent-host.ts    RPC process manager for the agent worker           │
└───────────────┬───────────────────────────────────────────────────────────────┘
                │ JSON-RPC over stdio (spawns tether-agent-core worker)
┌───────────────▼───────────────────────────────────────────────────────────────┐
│  Agent Worker Process (tether-agent-core)                                      │
│  Agent loop, tools (exec, patch), session storage, sandboxed runtime          │
└───────────────────────────────────────────────────────────────────────────────┘
        ▲                                ▲
        │ contextBridge (window.harness) │ IPC events / invokes
┌───────┴────────────────────────────────┴────────────────┐
│  React Renderer Process (src/renderer)                  │
│  Attached Top Tab UI, responsive conversation layout    │
└─────────────────────────────────────────────────────────┘
```

- **Clean Process Isolation**: The renderer never touches Node.js APIs directly; all interactions go through strongly-typed IPC contracts in `src/shared/types.ts`.
- **Stateless UI, Persistent State**: The renderer is completely reactive; state recovery is driven by local session `.jsonl` streams.

---

## 📂 Repository Structure

```text
tether-ai/
├── src/
│   ├── main/                 # Electron main process
│   │   ├── index.ts          # Window lifecycle, menus, IPC handlers, permission policies
│   │   └── agent-host.ts     # RPC agent worker process host
│   ├── preload/              # Secure contextBridge API definition
│   │   └── index.ts          # Exposes window.harness API to React
│   ├── renderer/             # React 19 front-end workbench
│   │   ├── App.tsx           # Application state orchestration
│   │   ├── ui.tsx            # Desktop UI components, menus, permission pickers
│   │   ├── conversation.ts   # Stream normalization, patch parsing & diff computation
│   │   ├── highlight.ts      # Zero-dependency syntax tokenizer
│   │   └── styles.css        # Responsive adaptive styles
│   ├── extensions/           # Agent runtime extensions
│   │   └── vision.ts         # Multimodal GLM + MinerU OCR plugin
│   └── shared/               # Shared types & contract interfaces
│       ├── types.ts          # DesktopApi & agent protocol types
│       └── vision-api.ts     # Vision and OCR data formatting
└── package.json
```

---

## 🛠️ Development & Scripts

| Command | Description |
| :--- | :--- |
| `pnpm dev` | Start development server with Vite HMR + Electron |
| `pnpm typecheck` | Run TypeScript type checking across the project |
| `pnpm test` | Execute unit test suite with Vitest |
| `pnpm build` | Compile main process (`tsup`) and bundle renderer (`vite`) |
| `pnpm check` | Full CI verification (`typecheck` + `test` + `build`) |
| `pnpm pack` | Build production binaries for macOS (`.dmg`) & Windows (`.zip`) |
| `pnpm start` | Launch the compiled production package |

---

## 📦 Packaging & Distribution

Packaging is powered by `electron-builder`:

```bash
# Package for the current OS platform
pnpm run pack
```

- **Output Directory**: `release/`
- **Targets**:
  - macOS: `.dmg` / `.zip` (Apple Silicon & Intel)
  - Windows: `.exe` / `.zip` (x64)
  - Linux: `.AppImage` / `.tar.gz` (x64)

---

## ❓ FAQ & Troubleshooting

#### Q: Where are my conversations and API keys stored?
All persistent data is saved strictly inside `~/.tether` (`config.json`, `settings.json`, `auth.json`, and `sessions/`). Nothing is stored on external servers.

#### Q: Can I use Tether with my own Ollama or local vLLM server?
Yes! In **Settings → Chat Provider**, select **Custom OpenAI-Compatible**, and set your Base URL to `http://localhost:11434/v1` (for Ollama) or `http://localhost:8000/v1` (for vLLM).

#### Q: Can I use Tether without opening a folder?
Yes! When no folder is opened, Tether operates in a safe, read-only scratchpad session (working directory inside `<userData>/tasks`).

#### Q: macOS Gatekeeper reports "Tether is damaged and cannot be opened"?
Because development builds are ad-hoc signed, macOS Gatekeeper may quarantine downloaded binaries. Run the following in your terminal:
```bash
xattr -cr /Applications/Tether.app
```

---

## 📄 License

Distributed under the **MIT License**. See [LICENSE](LICENSE) for more details.
