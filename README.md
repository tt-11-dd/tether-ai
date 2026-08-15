<div align="center">

<img src="build/icon.png" width="96" alt="Tether logo" />

# Tether

**The Open, Local-First AI Coding Workbench for Developers & Repositories**

*Empowering developers with native DeepSeek & domestic LLM deep integration, arbitrary custom endpoints, and complete privacy.*

[English](README.md) · [简体中文](README.zh-CN.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.19-blue)](https://nodejs.org)
[![Electron](https://img.shields.io/badge/Electron-37-blueviolet)](https://www.electronjs.org)
[![Platform: macOS / Windows](https://img.shields.io/badge/platform-macOS%20(arm64)%20%7C%20Windows%20(x64)-lightgrey)](https://github.com/tt-11-dd/tether-ai)

</div>

Tether is a native desktop AI coding workbench engineered for repository-scale development. Built on Electron, React 19, and a dedicated local agent core (`tether-agent-core`, a local pnpm workspace package at `../tether-runtime/packages/core`), Tether gives you full autonomy to inspect codebases, execute scoped terminal operations, edit complex files with transactional checkpoints, and interact through rich diff previews—**all with complete privacy and zero cloud lock-in on your machine**. The agent core is built on the open-source **Pi ecosystem** (`@earendil-works/pi-agent-core`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `@earendil-works/pi-tui`), extended with Tether's own DeepSeek adaptation, custom endpoints, permission model, checkpoint rollback, desktop RPC, and local-first data management.

---

## ⚡ Key Features at a Glance

**Tether is engineered from the ground up for developers who value model choice, data privacy, and full control:**

| Capability | What You Get |
| :--- | :--- |
| **DeepSeek & Domestic LLMs** | 🌟 **Native deep optimization** — reasoning effort control, Kimi, MiniMax, Zhipu GLM |
| **Custom Endpoints & Proxies** | ✅ **100% open Base URL / OneAPI / Ollama / vLLM** — connect any OpenAI-compatible gateway |
| **Zero-Config OCR Engine** | ✅ **Built-in free MinerU OCR** — no API key, no vision tokens |
| **Data Privacy & Telemetry** | 🔒 **100% local-first storage** (`~/.tether`) — zero telemetry, zero cloud relay |
| **OS-Level Sandboxing** | 🛡️ **macOS Seatbelt & Windows guard** — native process isolation |
| **Transactional Undo** | ⏪ **Atomic checkpoint rollback (`/undo`)** — restore file changes in one step |
| **Modern Desktop UI** | 🎨 **Attached top tab + clean warm conversation layout** (1080p–4K responsive) |

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
- Combines a **structured attached project header** with a **clean, warm conversational breathing room**.
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
- Supported OS for packaged builds: **macOS** (Apple Silicon / arm64), **Windows 10/11** (x64). Linux and Intel Mac are not packaged yet; `pnpm dev` may still work for local development.
- **tether-runtime repo**: `tether-agent-core` is linked from a sibling repository. Keep `tether-runtime` next to `tether-ai` (`../tether-runtime`); `pnpm dev` compiles its `packages/core` and links it as `node_modules/tether-agent-core`.

### Installation & Run

```bash
# Clone the repository (tether-agent-core depends on the local tether-runtime repo;
# place both repositories in the same parent directory)
git clone https://github.com/tt-11-dd/tether-ai.git
cd tether-ai

# If tether-runtime is not prepared yet: clone it (its packages/core is tether-agent-core)
# into a sibling directory of tether-ai, then continue with the steps below.

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
- **Built on Pi (open-source)**: `tether-agent-core` reuses Pi's agent loop, model, TUI, and coding-agent capabilities instead of rewriting the loop from scratch. Tether adds the desktop product layer, local-first data, DeepSeek / domestic model adapters, permission sandboxing, checkpoint rollback, and custom endpoints.

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
│   │   ├── vision.ts         # Multimodal GLM + MinerU OCR plugin
│   │   └── vision.test.ts    # Vision extension unit tests
│   └── shared/               # Shared types & contract interfaces
│       ├── types.ts          # DesktopApi & agent protocol types
│       ├── chat-profiles.ts  # Chat model configuration profiles
│       ├── openai-models.ts  # Dynamic model discovery for OpenAI-compatible endpoints
│       ├── vision-api.ts     # Vision and OCR data formatting
│       └── *.test.ts         # Shared module unit tests
├── .agents/skills/           # Long-running workflow skills (init / continue-long-run)
├── tsup.config.ts            # Main-process bundling (Electron)
├── electron-builder.yml      # Desktop installer build config
├── vite.config.ts            # Renderer bundling config
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
| `pnpm pack` | Build production installers: macOS arm64 `.dmg` and Windows x64 `.exe` |
| `pnpm start` | Launch the compiled production package |

---

## 📦 Packaging & Distribution

Packaging is powered by `electron-builder`:

```bash
# Local packaging (requires sibling tether-runtime checkout)
pnpm pack:mac   # macOS arm64 .dmg only
pnpm pack:win   # Windows x64 .exe only (more reliable on Windows)
pnpm pack       # mac + win together (cross-packaging may need extra tooling)
```

- **Output Directory**: `release/`
- **Targets** (matches `electron-builder.yml`):
  - macOS: `Tether-*-arm64.dmg` (Apple Silicon only)
  - Windows: `Tether-Setup-*.exe` (x64 NSIS)
  - Linux / Intel Mac: not shipped yet

### Automated GitHub Releases

Push a tag like `v0.1.0` and Actions builds macOS / Windows installers, then uploads them to [Releases](https://github.com/tt-11-dd/tether-ai/releases):

```bash
# 1. Bump package.json version to match the tag (e.g. 0.1.0)
# 2. Commit and push
git add package.json && git commit -m "release 0.1.0" && git push

# 3. Create and push the tag (triggers .github/workflows/release.yml)
git tag v0.1.0
git push origin v0.1.0
```

Installers land at: `https://github.com/tt-11-dd/tether-ai/releases/tag/v0.1.0`  
Each release uploads **only two files**: the macOS `.dmg` and Windows `.exe` (no blockmaps / debug yaml).

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
