# Tether tokens

Canonical hex. Desktop: `tether-ai/src/renderer/styles.css` `:root`. Site aliases in `tether-site/src/styles.css`.

## Color

| Role | Hex | Desktop | Site |
| --- | --- | --- | --- |
| Page | `#f6f4f0` | `--page` | `--bg-page` |
| Recessed | `#efece7` | `--canvas` `--field` | — |
| Surface | `#fffcf8` | `--surface` | `--bg-card` |
| Inset | `#f3f0eb` | `--inset` | `--bg-inset` (site is slightly cooler `#ede8e0`) |
| Hover | `#ece8e2` / `#e3ded6` | `--hover` `--hover-2` | `--bg-hover` |
| Ink | `#1c1917` | `--ink` `--accent` | `--ink-primary` |
| Ink hover | `#0c0a09` | `--accent-ink` | — |
| Secondary | `#5c574f` | `--ink-2` | `--ink-secondary` |
| Tertiary | `#9a948b` | `--ink-3` | `--ink-tertiary` (site `#8c857b`) |
| Line | `#e8e4dc` / `#ddd8ce` | `--line` `--line-strong` | `--line-subtle` `--line-strong` |
| Tint | `#efeae3` | `--accent-tint` | — |
| Green | `#2f7d4a` / `#e7f3eb` | `--green` `--green-tint` | same names |
| Red | `#c4473a` / `#f8ecea` | `--red` `--red-tint` | same; site tint `#fbf0ee` |
| Leather (site logo/links only) | `#8a6f5a` / `#f4ece4` | do not use on desktop chrome | `--brand` `--brand-tint` |

Do not add purple/blue brand colors. Syntax highlighting uses ink + green, not a third hue.

## Shadow

| Token | Use |
| --- | --- |
| `--shadow-hairline` | Bubble, input, default card |
| `--shadow-btn` | Compact controls |
| `--shadow-card` | Raised cards (approval) |
| `--shadow-raised` | Menus |
| `--shadow-overlay` | Modal panel, toast |

Site uses `--shadow-sm/md/lg` with the same ink alpha. Prefer hairline on new cards.

## Type

- Sans: `"Inter Variable", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`
- Mono: `ui-monospace, "SF Mono", Menlo, "Cascadia Mono", Consolas, monospace`
- Workbench body: `14px / 1.5`, tracking `-0.011em`
- Site body: `15px / 1.6` is OK
- Markdown: h1 `16px`, h2 `15px`, h3 `14px`

## Desktop classes

| Class | Role |
| --- | --- |
| `.app` | Flex shell |
| `.sidebar` | 252px rail |
| `.prompt-wrap` / `.prompt-shell` | Floating composer |
| `.prompt-wrap.hero` | Empty-state composer |
| `.prompt-tag` / `.prompt-tag.link` | File / URL chips |
| `.user` / `.user-link` | User bubble + URL chip |
| `.turn` / `.markdown` / `.stream` | Assistant reply |
| `.trace` | Thinking + tools |
| `.approval` / `.approval-cmd` | Permission card; command in `<details>` |
| `.combo` / `.permission-combo` | Mode picker |
| `.ghost` / `.primary` / `.send` | Text / filled / round send |
| `.modal` / `.panel` | Overlay + dialog |

## Motion

`prefers-reduced-motion`: stop caret/trace/logo dash. No page-load choreography.
