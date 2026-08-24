---
title: Compatibility
layout: default
nav_order: 6
---

# Compatibility Matrix

A single-glance view of what works where. ✅ = supported and documented · ⚠️ = works with caveats · ❌ = not available.

## How each harness runs

NeoSmith wires **harnesses**, not editors — the same list `neosmith help` prints.
Where a harness happens to live is a property of that harness, not a category:

| Runs as | Harnesses |
|---|---|
| A terminal CLI | Claude Code, Codex, Cline (standalone), OpenCode, Junie CLI |
| An editor extension | Cline, Continue, Copilot Chat |
| The editor's own assistant | JetBrains AI, Zed, Cursor |
| A self-hosted gateway | OpenClaw |

A terminal harness works in any editor's terminal, and in a plain shell. An
extension works wherever that extension installs. Editor-specific notes that are
worth writing down live in [VS Code](reference/editors-vscode) and
[JetBrains IDEs](reference/editors-jetbrains).

## Harnesses × Endpoint

<!-- BEGIN manifest:harnesses-endpoint -->

| Harness | Format | Endpoint | Guide |
|---|---|---|---|
| **Claude Code** | Anthropic | `router.neosmith.ai` | [harnesses/claude-code.md](harnesses/claude-code.md) |
| **Codex** | OpenAI Responses | `router.neosmith.ai/v1` | [harnesses/codex.md](harnesses/codex.md) |
| **Continue** | OpenAI | `router.neosmith.ai/v1` | [harnesses/continue.md](harnesses/continue.md) |
| **Cline** | OpenAI | `router.neosmith.ai/v1` | [harnesses/cline.md](harnesses/cline.md) |
| **JetBrains AI** | OpenAI | `router.neosmith.ai/v1` | [harnesses/jetbrains-ai.md](harnesses/jetbrains-ai.md) |
| **Copilot Chat** | OpenAI | `router.neosmith.ai/v1` | [harnesses/copilot.md](harnesses/copilot.md) |
| **Zed** | OpenAI | `router.neosmith.ai/v1` | [harnesses/zed.md](harnesses/zed.md) |
| **Cursor** | OpenAI | `router.neosmith.ai/v1` | [harnesses/cursor.md](harnesses/cursor.md) |
| **OpenCode** | OpenAI | `router.neosmith.ai/v1` | [harnesses/opencode.md](harnesses/opencode.md) |
| **OpenClaw** | OpenAI | `router.neosmith.ai/v1` | [harnesses/openclaw.md](harnesses/openclaw.md) |
| **Junie CLI** | OpenAI | `router.neosmith.ai/v1` | [harnesses/junie-cli.md](harnesses/junie-cli.md) |

<!-- END manifest:harnesses-endpoint -->

## Platforms (OS)

| OS | Claude Code | OpenAI agents | Notes | Guide |
|---|:---:|:---:|---|---|
| **macOS** | ✅ | ✅ | Use `~/.zprofile` for Dock apps | [reference/platform-macos.md](reference/platform-macos) |
| **Linux** | ✅ | ✅ | `~/.profile` or `/etc/environment` for GUI | [reference/platform-linux.md](reference/platform-linux) |
| **Windows native** | ⚠️ | ✅ | Works; WSL smoother for agents | [reference/platform-windows.md](reference/platform-windows) |
| **Windows WSL2** | ✅ | ✅ | **Recommended** for Windows | [reference/platform-wsl.md](reference/platform-wsl) |

## Model SKUs

| SKU | Tier | Escalates to Opus | Best for |
|---|---|:---:|---|
| `neosmith.intelligent-pro` | Opus-tier (default) | ✅ | General coding, agentic work |
| `neosmith.intelligent-basic` | Sonnet-tier | ❌ (Sonnet fallback) | Mid-complexity, cost-conscious |
| `neosmith.neolite` | SLM-only | ❌ | Autocomplete, commit msgs, low-cost |
| `neosmith.intelligent-maestro` | Fable-tier | ❌ | Highest-accuracy agentic coding |
