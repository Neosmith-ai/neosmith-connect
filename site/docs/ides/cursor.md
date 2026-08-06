---
title: Cursor
layout: default
parent: IDEs
nav_order: 3
---

# Cursor + NeoSmith

Cursor is a VS Code fork with the best native BYOM support of any AI-native editor. You have two paths:

| Path | What | Endpoint | Notes |
|---|---|---|---|
| **A** | Claude Code extension | `router.neosmith.ai` | Full agentic features |
| **B** | Cursor native BYOM | `router.neosmith.ai/v1` | Chat + inline edits |

---

## Path A — Claude Code (recommended for agentic work)

Cursor inherits VS Code's extension ecosystem, so the Claude Code extension works:

```bash
export ANTHROPIC_BASE_URL=https://router.neosmith.ai
export ANTHROPIC_API_KEY=sk-plus-yourname-xxxxxx
```

Or:

```bash
npx @neosmithai/cli init sk-plus-yourname-xxxxxx
```

Install the extension (Cursor's Extensions panel → search "Claude Code"), then **Cmd+Esc** / **Ctrl+Esc** to open the panel.

> Full details: [Claude Code setup](../agents/claude-code)

---

## Path B — Cursor native BYOM

```
Settings → Models
  → Enable "OpenAI API Key"
  → Toggle "Override OpenAI Base URL" → https://router.neosmith.ai/v1
  → Add Custom Model → enter: neosmith.intelligent-pro → Verify
```

> **Note:** Cursor's **Tab autocomplete** may still use Cursor's own backend regardless of this setting. **Chat** and **inline edits (Cmd+K)** route to NeoSmith.

---

## Which to use

- Want full agentic plan-mode + MCP? → **Path A** (Claude Code)
- Just want Cursor's chat/edit on NeoSmith? → **Path B**
- Both run side-by-side without conflict.

## Troubleshooting

- **Path B verify fails:** Base URL must be exactly `https://router.neosmith.ai/v1`.
- **400 Unknown model:** Use `neosmith.intelligent-pro`, not a `gpt-*` name.
- More: [Troubleshooting](../reference/troubleshooting)
