---
name: init-long-run
description: 用户要把需求拆成可跨会话的任务清单、初始化长任务、或第一次铺 features.json 时使用。只摸底、写清单，不开始大改代码。
---

# 初始化跨会话任务

只在用户明确要跨会话做、或点了「拆成可跨会话的任务清单」时使用。普通问答不要跑。

1. 只读：当前工作目录、README、`AGENTS.md` / `CLAUDE.md`、相关入口。不要 write / edit / patch 业务代码。
2. 按用户目标写出 `.agents/features.json`：JSON 数组，每项 `{ "id", "description", "passes": false }`。条目要能单独验收，不要一项里塞整盘改造。
3. 写出 `.agents/progress.md`，第一段写：摸了什么、清单在哪、下一轮该做哪一条。
4. 若已有 git 仓库，做一次提交，说明是初始化任务清单。没有 git 就跳过。
5. 停。告诉用户下一轮用 continue-long-run，一次只做一条。
