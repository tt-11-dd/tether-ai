---
name: tether-ui
description: Applies Tether’s paper + ink visual language (tokens, cards, chips, buttons, composer, approvals) for the desktop workbench and marketing site. Use when adding or restyling UI, CSS, landing pages, or cloning this look.
---

# Tether UI

浅色纸面 + 墨色字。桌面工作台和营销站共用这一套，不要做成 IDE、深色终端或 Discord。

先读 [tokens.md](tokens.md) 里的色板和组件，再动最少 CSS。新界面必须看起来像同一张纸上多了一块。

## 配色（先抄这里）

产品与网站的**纸和墨必须一致**。强调色就是墨，不要另起蓝/紫。

| 角色 | 色 | 用在 |
| --- | --- | --- |
| 纸底 | `#f6f4f0` | 页面、侧栏、页脚底 |
| 卡片 | `#fffcf8` | 浮卡、气泡、面板 |
| 凹槽 | `#f3f0eb` / `#efece7` | 代码块、输入、内嵌 |
| 墨 | `#1c1917` | 正文、主按钮、焦点 |
| 次墨 | `#5c574f` / `#9a948b` | 说明、时间戳 |
| 线 | `#e8e4dc` / `#ddd8ce` | 发丝边 |
| 绿 / 红 | `#2f7d4a` / `#c4473a` | 成功、危险、diff |

营销站可以把 Logo / 链接做成皮革棕 `#8a6f5a`（`--brand`）。**桌面壳不要用它当按钮色**，桌面强调仍是墨。

桌面 CSS 变量：`--page` `--surface` `--ink` `--accent`（= ink）。站点现用 `--bg-page` `--bg-card` `--ink-primary`，语义对齐上表，新代码优先用桌面这套名字，或加一层 alias，不要第三套 hex。

阴影只用发丝和一层轻抬：`--shadow-hairline` 卡片/输入，`--shadow-overlay` 弹层。不要大投影、彩条顶栏、霓虹边。

## 字

- Inter Variable + 中文系统黑体。等宽只用 `--mono`。
- 工作台正文 `14px / 1.5`，tracking `-0.011em`。站点长文可以 `15px / 1.6`。
- Markdown / 预览标题压到 16 / 15 / 14，不要浏览器默认大标题。
- Hero 产品名可以更大（站点、空态）。
- 用户可见文案走 i18n，简体中文 + English；代码、路径、命令、模型名保持原文。

## 组件

圆角：控件 7–10px，卡片 12–16px，用户气泡 16px。

**全圆可以用在**：发送键、建议胶囊、权限 tag、计数徽章。不要把普通 `.ghost` / `.primary` 做成胶囊。

| 组件 | 做法 |
| --- | --- |
| 页面 | `--page` 底，无深色 mode（除非明确要求） |
| 卡片 | `--surface` + `--shadow-hairline` |
| 主按钮 `.primary` | 墨底、纸色字 |
| 次按钮 `.ghost` | 纸底 + 发丝 |
| 发送键 | 30px 墨色圆钮 |
| 链接 chip | 图标 + host/path，点开外链，复制仍是完整 URL |
| Composer | 底部浮卡，不要贴底通栏 IDE 输入条 |
| 审批 | 人话标题；命令收到「查看命令」；不要 `window.confirm` |
| 弹层 | 墨 40% 罩 + `.panel` 纸卡 |
| 图标 | 24 视口描边 SVG，`strokeWidth 1.75`，`currentColor` |
| Logo | 开口绳子 path；站点可用 `--brand`，桌面跟顶栏墨色 |

工作台壳（侧栏 252、对话贴底、权限四档）只约束 **tether-ai**。营销站用 section / card / header，不要硬抄 Electron 壳。

克隆同气质产品：抄色板和上表组件，不要抄 Tether 商标与绳子 Logo。

## 桌面改 UI 时

`src/renderer/styles.css`、`ui.tsx`、`App.tsx`、`src/shared/i18n.ts`。站点：`tether-site/src/styles.css` 与 `src/components/`。
