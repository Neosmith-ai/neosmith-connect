# NeoSmith Developer Guide

> **Connect your IDE and AI coding agent to NeoSmith in under 5 minutes.**
> Keep your existing tools. Change one URL and one API key. Pay ~60% less.

> 📖 **Published site:** the developer-facing guide is served via GitHub Pages from the [`docs/`](docs/) folder.
> The Markdown files in the repo root are the source of truth; `docs/` contains the Jekyll (Just-the-Docs) version with navigation and search.
> Internal-only files (e.g. `CONTRIBUTING.md`) are **not** published.

NeoSmith is an **intelligent model routing layer** that sits behind whichever AI coding agent you already use. It dispatches each request to the most cost-effective capable model and escalates to Claude Opus only when a task genuinely needs frontier reasoning. Your IDE, your agent, your workflow — all unchanged.

```
Your IDE  →  Your Agent  →  NeoSmith Router  →  best model per task
(VS Code,    (Claude Code,    router.neosmith.ai   (cost-optimized SLM
 JetBrains,   Cline,                                + Claude Opus when
 Cursor…)     Continue…)                             genuinely needed)
```

---

## Quick Start (TL;DR)

You need a NeoSmith API key (`sk-plus-*`, `sk-slm-*`, or `sk-std-*` — or a Cognito JWT). No key yet? Email **contact-us@neosmith.ai** for a free 3-week trial (25M tokens/dev, no credit card).

### The two endpoints

| Endpoint | Use it for | Agents |
|---|---|---|
| `https://router.neosmith.ai` | **Anthropic-format** (`/v1/messages`) | Claude Code |
| `https://router.neosmith.ai/v1` | **OpenAI-format** (`/v1/chat/completions`, `/v1/responses`) | Cline, Continue, JetBrains AI, Cursor, Codex |

### Fastest path — install the CLI, then connect Claude Code

**macOS / Linux / WSL2:**

```bash
sh -c "$(curl -fsSL https://raw.githubusercontent.com/Neosmith-ai/neosmith-connect/main/packages/cli/install.sh)"
```

**Windows, native PowerShell:**

```powershell
irm https://raw.githubusercontent.com/Neosmith-ai/neosmith-connect/main/packages/cli/install.ps1 | iex
```

Open a new shell, then:

```bash
neosmith login sk-plus-yourname-xxxxxx
neosmith claude on
```

That's it. Open a new Claude Code session — your next prompt routes through NeoSmith.

> **Power-user shortcut (assumes Node 18+ already installed):**
> ```bash
> npx @neosmithai/cli init sk-plus-yourname-xxxxxx
> ```
> This is equivalent to `login` + `claude on` in one step. Omit the key to be
> prompted interactively: `npx @neosmithai/cli init`.

---

## Pick Your Guide

### IDEs

| IDE | Guide | Native AI | Via Agent |
|---|---|---|---|
| **VS Code** | [ides/vscode.md](ides/vscode.md) | Copilot BYOK | Claude Code, Cline, Continue |
| **JetBrains** (IntelliJ, PyCharm, GoLand, WebStorm, Rider…) | [ides/jetbrains.md](ides/jetbrains.md) | AI Assistant (BYOM) | Claude Code, Cline |
| **Cursor** | [ides/cursor.md](ides/cursor.md) | Native BYOM | Claude Code |
| **Antigravity** (Google) | [ides/antigravity.md](ides/antigravity.md) | — | Claude Code |

### AI Coding Agents

<!-- BEGIN manifest:agents -->
| Agent | Guide | Format | Endpoint |
|---|---|---|---|
| **Claude Code** | [agents/claude-code.md](agents/claude-code.md) | Anthropic | `router.neosmith.ai` |
| **Codex** | [agents/codex.md](agents/codex.md) | OpenAI Responses | `router.neosmith.ai/v1` |
| **Continue** | [agents/continue.md](agents/continue.md) | OpenAI | `router.neosmith.ai/v1` |
| **Cline** | [agents/cline.md](agents/cline.md) | OpenAI | `router.neosmith.ai/v1` |
| **JetBrains AI** | [agents/jetbrains-ai.md](agents/jetbrains-ai.md) | OpenAI | `router.neosmith.ai/v1` |
| **Copilot Chat** | [agents/copilot.md](agents/copilot.md) | OpenAI | `router.neosmith.ai/v1` |
| **Zed** | [agents/zed.md](agents/zed.md) | OpenAI | `router.neosmith.ai/v1` |
| **Cursor** | [ides/cursor.md](ides/cursor.md) | OpenAI | `router.neosmith.ai/v1` |
<!-- END manifest:agents -->

### Platform Setup (Operating System)

| Platform | Guide | Notes |
|---|---|---|
| **macOS** | [platforms/macos.md](platforms/macos.md) | Native; shell profile env vars |
| **Linux** | [platforms/linux.md](platforms/linux.md) | Native; shell profile env vars |
| **Windows (native)** | [platforms/windows-native.md](platforms/windows-native.md) | PowerShell / System env vars |
| **Windows (WSL2)** | [platforms/windows-wsl.md](platforms/windows-wsl.md) | Recommended for Windows devs |

### Reference

- [reference/endpoints.md](reference/endpoints.md) — All endpoints, model SKUs, headers
- [reference/troubleshooting.md](reference/troubleshooting.md) — Common issues across all setups
- [reference/verify-connection.md](reference/verify-connection.md) — Test your connection with curl

---

## How the Two Integration Paths Work

Most IDEs support **both** paths simultaneously, with no conflict:

| Path | What it is | Best for |
|---|---|---|
| **Path A — Claude Code** | Point Claude Code at `router.neosmith.ai` via `ANTHROPIC_BASE_URL` | Agentic tasks: plan mode, multi-file edits, MCP |
| **Path B — Native BYOM** | Point any OpenAI-compatible agent at `router.neosmith.ai/v1` | Completions, chat, Codex, Cline, Continue |

```
VS Code / JetBrains IDE
  ├── Claude Code        ──► ANTHROPIC_BASE_URL=router.neosmith.ai      (Path A)
  └── Cline / Continue / ──► router.neosmith.ai/v1                       (Path B)
      JetBrains AI
```

Both call NeoSmith. Unified routing across all your AI interactions.

---

## Support

- **Trial / sales:** contact-us@neosmith.ai

---

*NeoSmith Developer Guide · Compatible with macOS, Linux, Windows (native + WSL2)*
