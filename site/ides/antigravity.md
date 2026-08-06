# Google Antigravity + NeoSmith

Google Antigravity is a VS Code fork. Like Windsurf and Kiro, it **blocks arbitrary native BYOM URLs** — so the integration path is via the **Claude Code extension** (Path A), which it inherits from the VS Code ecosystem.

| Path | What | Endpoint | Status |
|---|---|---|---|
| **A** | Claude Code extension | `router.neosmith.ai` | ✅ Full coverage |
| **B** | Native BYOM | — | ❌ Arbitrary URLs blocked |

---

## Setup (Path A — Claude Code)

### 1. Set environment variables

See your platform guide for the exact file/mechanism:
- [macOS](../platforms/macos.md) · [Linux](../platforms/linux.md) · [Windows native](../platforms/windows-native.md) · [Windows WSL](../platforms/windows-wsl.md)

```bash
export ANTHROPIC_BASE_URL=https://router.neosmith.ai
export ANTHROPIC_API_KEY=sk-plus-yourname-xxxxxx
```

Or the one-command CLI:

```bash
npx @neosmithai/cli init sk-plus-yourname-xxxxxx
```

### 2. Install the Claude Code extension

In Antigravity's Extensions panel, search **"Claude Code"** and install `anthropic.claude-code`. (Or from a terminal: `code --install-extension anthropic.claude-code` if the `code` command is wired to Antigravity.)

### 3. Open the Claude panel

Press **Cmd+Esc** (Mac) / **Ctrl+Esc** (Windows/Linux). The extension picks up the env vars automatically and routes through NeoSmith.

> Full Claude Code details: [agents/claude-code.md](../agents/claude-code.md)

---

## Why Path A only

Antigravity does not expose a setting to override the model base URL for its built-in AI. The Claude Code extension is a self-contained agent that reads `ANTHROPIC_BASE_URL` directly — it bypasses Antigravity's BYOM restriction entirely and gives you full NeoSmith routing (plan mode, diffs, MCP, multi-file edits).

## Troubleshooting

- **Panel "Not connected":** Confirm `echo $ANTHROPIC_BASE_URL` prints `https://router.neosmith.ai`; restart Antigravity from a shell that has the env vars (or set them at system level — see platform guides).
- More: [reference/troubleshooting.md](../reference/troubleshooting.md)
