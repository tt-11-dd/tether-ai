<div align="center">

<img src="build/icon.png" width="96" alt="Tether logo" />

# Tether

**A local-first AI coding workbench built on the Pi ecosystem**

Let DeepSeek and OpenAI-compatible models inspect, edit, and verify your repositories with explicit safety boundaries.

[English](README.md) · [简体中文](README.zh-CN.md) · [Download latest](https://github.com/tt-11-dd/tether-ai/releases/latest)

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Agent Core](https://img.shields.io/npm/v/tether-agent-core?label=tether-agent-core)](https://www.npmjs.com/package/tether-agent-core)
[![Platform](https://img.shields.io/badge/platform-macOS%20arm64%20%7C%20Windows%20x64-lightgrey)](https://github.com/tt-11-dd/tether-ai/releases/latest)

</div>

Tether is an Electron desktop agent for real codebases. It brings model calls, workspace tools, terminal commands, permission prompts, session history, and diff review into one local workbench. The UI and session data stay on your machine; model requests go directly to the provider or local gateway you configure, without a Tether relay.

## Why Tether

- **DeepSeek first** — custom Base URL, model discovery, and reasoning-level controls, plus OpenAI-compatible endpoints such as OneAPI, Ollama, and vLLM.
- **Visible and controllable** — inspect tool calls, command output, file changes, and context usage as work happens.
- **Permission boundaries** — Plan, Ask, Workspace, and Full Access modes.
- **Recoverable edits** — patch checkpoints let `/undo` restore the previous turn's file changes.
- **Local-first state** — settings, credentials, and sessions live under `~/.tether`; no telemetry or Tether-hosted model proxy.
- **Desktop workflow** — project threads, `@` file mentions, image input, diff previews, and Chinese/English UI.

## What Tether uses from Pi

Tether does not reimplement the agent foundations. [`tether-agent-core`](https://www.npmjs.com/package/tether-agent-core) wraps the [Pi ecosystem](https://github.com/earendil-works/pi) and extends it:

| Pi package | Used by Tether for |
| --- | --- |
| `@earendil-works/pi-agent-core` | Agent state, message streams, tool calls, and thinking-level types |
| `@earendil-works/pi-ai` | Model/provider contracts, message/image/usage types, and OpenAI API foundations |
| `@earendil-works/pi-coding-agent` | Coding-agent extensions, sessions/settings, project trust, and RPC client/worker |
| `@earendil-works/pi-tui` | Text components, themes, and terminal interaction used by the Runtime CLI |

Tether adds:

- DeepSeek defaults and an OpenAI-compatible gateway workflow
- Four permission modes, macOS Seatbelt, and an experimental Windows sandbox helper (install + enable)
- Workspace-scoped tools, managed commands, file patches, and durable checkpoints
- MCP, Hooks, Skills, planning, and subagent integration
- The `~/.tether` local data conventions and Electron/React desktop workbench

Pi provides the runtime foundations; Tether defines the product boundary, safety policy, and desktop experience. We are grateful to the Pi maintainers for the open-source foundation.

## Architecture

```text
React Renderer
  conversation, diff, settings, project and session UI
        │  contextBridge / Electron IPC
        ▼
Electron Main
  windows, workspace, credentials, agent process host
        │  JSON-RPC over stdio
        ▼
tether-agent-core
  Tether permissions, sandbox, tools, checkpoints, MCP, sessions
        │
        ▼
Pi ecosystem
  agent loop · model protocol · coding-agent extensions · RPC · TUI
```

The renderer has no direct Node.js access; desktop capabilities cross the typed IPC contract in `src/shared/types.ts`. The agent runs in a separate worker process. After a crash, an on-disk session can continue as a conversation, but Tether does not silently replay unfinished commands.

## Models and images

The desktop app currently focuses on DeepSeek and custom OpenAI-compatible Base URLs. `tether-agent-core` also includes provider foundations for OpenAI, Anthropic, OpenRouter, Z.AI, Kimi, MiniMax, and xAI; the desktop settings UI will expose these progressively.

For pasted images:

- Optional GLM-4V visual understanding requires a user-provided API key.
- MinerU performs OCR by sending the image to the MinerU service; it is not offline local OCR.

## Permission modes

| Mode | Behaviour |
| --- | --- |
| `plan` | Read-only analysis and planning; diagnostic commands may run in a read-only sandbox |
| `ask` | Ask before writes, network access, or boundary escalation |
| `auto` | Run ordinary workspace operations automatically; ask on escalation |
| `full` | Disable workspace sandboxing for explicitly trusted projects |

Sandboxing is defense in depth, not a replacement for reviewing commands in an unfamiliar repository.

## Agent Skills

Skills are loaded by the Pi runtime (Tether does not ship a separate loader). Standard locations:

| Scope | Path |
| --- | --- |
| Project (trusted) | `.agents/skills/<name>/SKILL.md`, `.pi/skills/<name>/SKILL.md` |
| User-global | `~/.tether/skills/<name>/SKILL.md`, `~/.agents/skills/<name>/SKILL.md` |

Each skill is a directory with a `SKILL.md` file. Frontmatter must include `name` and `description` (Pi validates; invalid skills are skipped).

- Invoke with `/skill:name`; type `/` in the composer to see loaded skills
- List paths and loaded skills under **Settings → Agent Skills**
- Project skills require trusting the workspace; `@` mentions only scan project `.agents/skills` and `.pi/skills`

## Use Tether

Download from [GitHub Releases](https://github.com/tt-11-dd/tether-ai/releases/latest):

- macOS: Apple Silicon / arm64
- Windows: Windows 10/11 x64

Then:

1. Open a project folder.
2. Configure a DeepSeek API key or compatible endpoint.
3. Describe a task, review tool activity and diffs, and use `/undo` when needed.

The current macOS package uses development signing. If Gatekeeper blocks it, right-click the app and choose **Open**, or run:

```bash
xattr -cr /Applications/Tether.app
```

## Develop locally

Requires Node.js `>=22.19` and pnpm.

```bash
git clone https://github.com/tt-11-dd/tether-ai.git
cd tether-ai
pnpm install
pnpm dev
```

Checks:

```bash
pnpm typecheck
pnpm test
pnpm build
```

The app consumes `tether-agent-core` from npm. When developing the Runtime itself, temporarily link `../tether-runtime/packages/core`.

## Acknowledgments

Tether's agent runtime is built on the open-source [Pi ecosystem](https://github.com/earendil-works/pi) (`@earendil-works/pi-agent-core`, `pi-ai`, `pi-coding-agent`, `pi-tui`). [`tether-agent-core`](https://www.npmjs.com/package/tether-agent-core) wraps Pi with Tether's DeepSeek defaults, permission modes, sandboxing, checkpoints, MCP, Hooks, and local data layout. Pi dependencies retain their own licenses and copyright.

## Privacy

Tether runs no telemetry or model relay service. Sessions, settings, and credentials stay local. To perform a task, prompts, relevant code context, and images are still sent to the model, gateway, or OCR service you choose. Review third-party privacy policies; sensitive projects can use a compatible local endpoint.

## License

[MIT](LICENSE). Pi ecosystem dependencies retain their own licenses and copyright notices.
