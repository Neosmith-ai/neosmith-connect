---
title: VS Code
layout: default
parent: IDEs
nav_order: 1
---

# VS Code + NeoSmith

VS Code has the richest dual-path story. You can run **both** paths at once: Claude Code for agentic work, and an OpenAI-compatible agent (Cline/Continue) for chat and completions.

| Path | Agent | Endpoint | Best for |
|---|---|---|---|
| **A** | Claude Code | `router.neosmith.ai` | Plan mode, multi-file edits, MCP |
| **B** | Cline / Continue | `router.neosmith.ai/v1` | Chat, completions, agentic loops |

---

## Path A — Claude Code extension

### 1. Set environment variables

Follow your platform guide for the exact mechanism:
- [macOS](../platforms/macos) · [Linux](../platforms/linux) · [Windows native](../platforms/windows-native) · [Windows WSL](../platforms/windows-wsl)

```bash
export ANTHROPIC_BASE_URL=https://router.neosmith.ai
export ANTHROPIC_API_KEY=sk-plus-yourname-xxxxxx
```

Or use the one-command CLI:

```bash
npx @neosmithai/cli init sk-plus-yourname-xxxxxx
```

### 2. Install the extension

```bash
code --install-extension anthropic.claude-code
```

### 3. Open the Claude panel

Press **Cmd+Esc** (Mac) / **Ctrl+Esc** (Windows/Linux). The extension picks up the env vars automatically.

> Full Claude Code setup details: [Claude Code setup](../agents/claude-code)

---

## Path B — Cline or Continue

Pick one (or both):

- **Cline** (agentic plan/act): [Cline setup](../agents/cline)
- **Continue** (chat + completions): [Continue setup](../agents/continue)

Both install from the VS Code Extensions panel and point at `https://router.neosmith.ai/v1`.

---

## Path C — GitHub Copilot BYOK (optional)

If your org uses GitHub Copilot with BYOK (GA April 2026), you can register NeoSmith as an OpenAI-compatible model provider in Copilot's model settings:

```
Copilot → Models → Add model → OpenAI Compatible
  Base URL: https://router.neosmith.ai/v1
  API Key:  sk-plus-yourname-xxxxxx
  Model:    neosmith.intelligent-pro
```

> Availability depends on your Copilot plan and org BYOK enablement.

---

## Running both paths together

```
VS Code
  ├── Claude Code        ──► ANTHROPIC_BASE_URL=router.neosmith.ai   (Path A)
  │   (plan mode, agentic tasks, MCP)
  └── Cline / Continue   ──► router.neosmith.ai/v1                    (Path B)
      (chat, completions, commit messages)
```

No conflict — both route to NeoSmith.

---

## Works in all VS Code forks

Path A (Claude Code) works identically in **Cursor**, **Windsurf**, **Kiro**, and **Google Antigravity** — they all inherit VS Code's extension ecosystem. See [Cursor](cursor) and [Antigravity](antigravity) for fork-specific notes.

## Troubleshooting

[Troubleshooting](../reference/troubleshooting)
