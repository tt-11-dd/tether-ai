---
name: continue-long-run
description: 仓库里已有 .agents/features.json，或用户要继续跨会话任务时使用。一次只做一条未完成项，验证通过才勾 passes。
---

# 继续跨会话任务

1. `pwd`。读 `.agents/progress.md`、`.agents/features.json`、最近 `git log`。
2. 只挑一条 `passes: false` 的最高优先级项。不要同时开几条。
3. 做完后跑仓库里已有的检查（本仓库是 `pnpm test` 和 `pnpm typecheck`；其它仓库用它 README / package.json 里的测试命令）。失败则修，不准改 `passes`。
4. 验收通过才把该项 `passes` 改为 `true`。只许改 `passes`，不要删条目、不要改 `description`。
5. 在 `.agents/progress.md` 末尾追加：做了哪条、改了哪些文件、下一条是什么。
6. 有 git 则提交，说明完成了哪条 feature。
