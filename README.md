<div align="center">

<img src="build/icon.png" width="96" alt="Tether logo" />

# Tether

**The Local-First AI Coding Workbench for Developers & Repositories**

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.19-blue)](https://nodejs.org)
[![Electron](https://img.shields.io/badge/Electron-37-blueviolet)](https://www.electronjs.org)
[![Platform: macOS / Linux / Windows](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey)](https://github.com/tt-11-dd/tether-ai)

</div>

Tether is a native desktop AI coding workbench engineered for repository-scale development. Built on Electron, React, and a dedicated local agent core ([`tether-agent-core`](https://github.com/tt-11-dd/tether-ai)), Tether gives you full autonomy to inspect codebases, execute scoped terminal operations, edit complex files with transactional checkpoints, and interact through rich diff previews—all with complete privacy on your machine.

---

## ⚡ Why Tether? (Key Advantages)

- 🔒 **True Local-First Privacy**: All chats, checkpoints, credentials, and settings are stored locally in `~/.tether` with owner-only (`0600`) permissions. Zero telemetry, no cloud relays, no tracking.
- 🧠 **Universal Multi-Model Matrix**: Native support for **DeepSeek** (with customized reasoning effort), **OpenAI**, **Anthropic**, **OpenRouter**, **Kimi**, **MiniMax**, **xAI**, **ZAI**, and custom OpenAI-compatible endpoints.
- 👁️ **Hybrid Vision & Free Built-in OCR**: Out-of-the-box text extraction from screenshots and documents powered by zero-config **MinerU OCR** (no API key needed), paired with optional **GLM-4V** multimodal visual understanding.
- 🛡️ **Granular Permission & OS Sandbox**: 4-tier security levels (`Plan`, `Ask on Edit`, `Workspace Safe`, `Full Access`) backed by local OS sandboxing (macOS Seatbelt, Windows workspace guard) and atomic checkpoint undo.
- 🎨 **Adaptive High-DPI Desktop UX**: Responsive conversation layout optimized for wide/ultrawide displays (1080p to 4K), adaptive macOS traffic light placement, Windows TitleBarOverlay integration, and fullscreen awareness.
- ⚡ **Streamlined Workflow**: `@` file auto-completion, slash commands (`/new`, `/open`, `/undo`, `/login`), interactive file change previews, and approval dialogs for agent operations.

---

## 📑 Table of Contents

- [Features](#-features)
- [Quick Start](#-quick-start)
- [Permission & Safety Model](#-permission--safety-model)
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
- **DeepSeek First-Class Support**: Custom Base URL, API key authentication, and reasoning level control.
- **Top-Tier LLM Ecosystem**: Connect to Claude (Anthropic), GPT-4o / Codex (OpenAI), OpenRouter, Kimi Coding, MiniMax, xAI, and custom proxy gateways.
- **Real-Time Token & Cost Telemetry**: Live tracking of token consumption, context window usage, and duration per turn.

### 2. Multi-Project Workspace
- Seamlessly open any local git repository or project folder (**⌘/Ctrl + O**).
- Project-isolated thread trees organized cleanly in the sidebar.
- Zero-project quick sandbox for scratchpad tasks and general coding queries.

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

1. Press **⌘/Ctrl + O** (or click the folder button) to open your project directory.
2. Click the gear / account icon in the bottom-left corner to configure your DeepSeek API Key or custom model endpoint.
3. Type your prompt (e.g. `"Explain the architecture of this project"`) or pick one of the quick suggestions!

---

## 🛡️ Permission & Safety Model

Tether provides 4 distinct permission modes selectable directly from the bottom prompt bar:

| Mode | Label | Icon | Behavior & Sandbox Scope |
| :--- | :--- | :---: | :--- |
| `plan` | **Plan Only** | 💬 | Read-only analysis & planning. File edits and commands are strictly disabled. |
| `ask` | **Ask on Edit** | ⚠️ | Prompts for user approval before modifying external files or making network requests. |
| `auto` | **Workspace Safe** | 🛡️ | Automatically applies safe changes within the workspace; requests confirmation only for high-risk operations. |
| `full` | **Full Access** | 🌐 | Unrestricted execution without sandbox boundaries (prompts for host confirmation on startup). |

---

## 👁️ Hybrid Vision & OCR Engine

Tether features a two-tiered multimodal system designed specifically for developer workflows:

1. **MinerU OCR (Built-in, Zero-Config)**:
   - Extracts clean markdown text from uploaded screenshots, documentation images, and code snippets.
   - Fully enabled by default—**no API key required**.
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
│  Tailored UI, responsive conversation area, Monaco-free │
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

#### Q: Can I use Tether without opening a folder?
Yes! When no folder is opened, Tether operates in a safe, read-only scratchpad session (working directory inside `<userData>/tasks`).

#### Q: macOS Gatekeeper reports "Tether is damaged and cannot be opened"?
Because development builds are ad-hoc signed, macOS Gatekeeper may quarantine downloaded binaries. Run the following in your terminal:
```bash
xattr -cr /Applications/Tether.app
```

#### Q: How do I customize custom OpenAI-compatible endpoints?
In **Settings → Chat Provider**, select **Custom OpenAI-Compatible**, and enter your Base URL (e.g. `https://api.together.xyz/v1`), Model Name, and API Key.

---

## 📄 License

Distributed under the **MIT License**. See [LICENSE](LICENSE) for more details.
