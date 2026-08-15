# Tether

面向仓库的 AI 编程桌面工作台。Agent 循环、沙箱、会话在本地 `tether-agent-core`；本仓库只做 Electron 壳和中文工作流界面。

## 地图

- 产品说明与架构：[README.md](README.md)
- 主进程（窗口 / IPC / 权限 / 工作区）：[src/main/index.ts](src/main/index.ts)
- RPC 子进程宿主：[src/main/agent-host.ts](src/main/agent-host.ts)
- 界面状态：[src/renderer/App.tsx](src/renderer/App.tsx)
- 组件：[src/renderer/ui.tsx](src/renderer/ui.tsx)
- 会话归并：[src/renderer/conversation.ts](src/renderer/conversation.ts)
- IPC 契约：[src/shared/types.ts](src/shared/types.ts)
- 长任务协议：`.agents/skills/init-long-run`、`.agents/skills/continue-long-run`

## 约定

- 新对话必须先选项目；绑定 cwd，发第一条消息才 `startAgent`。
- 权限：`plan` / `ask` / `auto` / `full`。有项目时 `sandbox: workspace-write`。
- 跨会话进度写在 `.agents/features.json` 和 `.agents/progress.md`，不要只写在聊天里。
- `features.json` 只改 `passes`，不要删条目或改 `description`。
- 面向用户的文案用简体中文；代码、路径、命令保持原文。

## 检查

```bash
pnpm test
pnpm typecheck
```
