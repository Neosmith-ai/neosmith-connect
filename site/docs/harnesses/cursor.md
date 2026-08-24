---
title: Cursor
layout: default
parent: Harnesses
nav_order: 8
---

# Cursor + NeoSmith

Cursor is a VS Code fork with strong native BYOM support. You have two paths:

| Path | What | Endpoint | Needs Cursor Pro? | Notes |
|---|---|---|---|---|
| **A** | Claude Code extension | `router.neosmith.ai` | No | Full agentic features, scriptable via CLI |
| **B** | Cursor native BYOM | `router.neosmith.ai/v1` | **Yes (Pro/Ultra)** | Chat + inline edits, UI-only |

---

## Path A — Claude Code (recommended; scriptable, no Pro needed)

Cursor inherits VS Code's extension ecosystem, so the Claude Code extension works:

```bash
npx @neosmithai/cli init sk-plus-yourname-xxxxxx
```

(or `neosmith claude on` if you're already logged in)

This writes the full NeoSmith config — connection vars plus the branded per-tier
model ladder — into `~/.claude/settings.json`. Then install the extension
(Cursor's Extensions panel → search "Claude Code"), and press **Cmd+Esc** /
**Ctrl+Esc** to open the panel.

> Full details: [harnesses/claude-code.md](claude-code)

---

## Path B — Cursor native BYOM (requires Cursor Pro/Ultra)

> **Important:** Cursor's native BYOK **cannot** be configured by writing to
> `settings.json`. Keys like `cursor.models.openai.*` are **silently ignored** —
> Cursor stores the custom OpenAI endpoint, API key, and model list in an
> encrypted, server-synced store that is only editable through the UI. Custom
> OpenAI endpoints also require an **active Cursor Pro or Ultra subscription**
> (not available on the free tier).

Configure it in the UI:

```
Settings (Ctrl+,) → Models
  → scroll to "OpenAI API Key" and toggle it on
  → paste your key: sk-plus-yourname-xxxxxx
  → enable "Override OpenAI Base URL" → https://router.neosmith.ai/v1
  → "Add model": neosmith.intelligent-pro  (then Verify)
     optionally also: neosmith.intelligent-basic, neosmith.neolite
  → pick the model in the chat model picker
```

The CLI prints these exact values for you:

```bash
neosmith cursor on
```

> **Note:** Cursor's **Tab autocomplete** may still use Cursor's own backend regardless of this setting. **Chat** and **inline edits (Ctrl+K)** route to NeoSmith.

---

## Which to use

- Want full agentic plan-mode + MCP, scriptable setup, no Pro license? → **Path A** (Claude Code)
- Have Cursor Pro and want Cursor's native chat/edit on NeoSmith? → **Path B**
- Both run side-by-side without conflict.

## Troubleshooting

- **Wrote `cursor.models.*` to settings.json and nothing changed:** expected — Cursor ignores those keys. Use the Settings → Models UI (Path B) or the Claude Code extension (Path A).
- **No "OpenAI API Key" / "Override Base URL" option in Settings → Models:** you're on the free tier. Native BYOM needs Cursor Pro/Ultra — use Path A instead.
- **Path B verify fails:** Base URL must be exactly `https://router.neosmith.ai/v1`.
- **400 Unknown model:** Use `neosmith.intelligent-pro`, not a `gpt-*` name.
- More: [reference/troubleshooting.md](../reference/troubleshooting)
