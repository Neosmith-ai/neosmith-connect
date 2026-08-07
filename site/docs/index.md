---
title: Home
layout: default
nav_order: 1
---

# NeoSmith Developer Guide
{: .fs-9 }

Connect your IDE and AI coding agent to NeoSmith in under 5 minutes. Keep your existing tools. Change one URL and one API key. Pay ~60% less.
{: .fs-6 .fw-300 }

[Quick Start](#quick-start){: .btn .btn-primary .fs-5 .mb-4 .mb-md-0 .mr-2 }
[Compatibility Matrix](compatibility){: .btn .fs-5 .mb-4 .mb-md-0 }

---

NeoSmith is an **intelligent model routing layer** that sits behind whichever AI coding agent you already use. It dispatches each request to the most cost-effective capable model and escalates to Claude Opus only when a task genuinely needs frontier reasoning. Your IDE, your agent, your workflow — all unchanged.

```
Your IDE  →  Your Agent  →  NeoSmith Router  →  best model per task
(VS Code,    (Claude Code,    router.neosmith.ai   (cost-optimized SLM
 JetBrains,   Cline,                                + Claude Opus when
 Cursor…)     Continue…)                             genuinely needed)
```

---

## Quick Start

You need a NeoSmith API key (`sk-plus-*`, `sk-slm-*`, or `sk-std-*` — or a Cognito JWT). No key yet? Email **[contact-us@neosmith.ai](mailto:contact-us@neosmith.ai)** for a free 3-week trial (25M tokens/dev, no credit card).

### The two endpoints

| Endpoint | Use it for | Agents |
|---|---|---|
| `https://router.neosmith.ai` | **Anthropic-format** (`/v1/messages`) | Claude Code |
| `https://router.neosmith.ai/v1` | **OpenAI-format** (`/v1/chat/completions`, `/v1/responses`) | Cline, Continue, JetBrains AI, Cursor, Codex |

### Fastest path — install the CLI, then connect Claude Code

**macOS / Linux / WSL2:**

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/Neosmith-ai/neosmith-connect/main/packages/cli/install.sh)"
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
> Equivalent to `login` + `claude on` in one step. Omit the key to be prompted
> interactively: `npx @neosmithai/cli init`.

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

## Where to next

- **[IDEs](ides/)** — VS Code, JetBrains, Cursor, Antigravity
- **[Agents](agents/)** — Claude Code, Codex, Cline, Continue, JetBrains AI
- **[Platforms](platforms/)** — macOS, Linux, Windows (native + WSL2)
- **[Reference](reference/)** — endpoints, connection verification, troubleshooting

---

## Support

- **Trial / sales:** [contact-us@neosmith.ai](mailto:contact-us@neosmith.ai)
