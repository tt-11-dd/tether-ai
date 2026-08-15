---
name: plan-then-act
description: 用户要改代码、优化文档、修 bug 或做多步短任务时使用。跨会话、会跨多次对话的任务改用 init-long-run / continue-long-run。
---

# 先计划再动手

短任务用本技能。若用户要「跨会话」或仓库已有 `.agents/features.json`，改走 continue-long-run；还没有清单则走 init-long-run。

1. 只读：读 README、相关源码、`AGENTS.md` / `CLAUDE.md`。不要 write / edit / patch。
2. 把 3～7 条步骤写成 checklist（`- [ ]`）。
3. 停下来等用户确认，或当前权限是 `plan` 时保持只读。
4. 获准后按条目改文件，完成一项就把 `- [ ]` 改成 `- [x]`。
