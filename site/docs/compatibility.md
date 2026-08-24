---
title: Compatibility
layout: default
nav_order: 6
---

# Compatibility Matrix

A single-glance view of what works where. ✅ = supported and documented · ⚠️ = works with caveats · ❌ = not available.

## IDEs × Integration Paths

| IDE | Claude Code (Path A) | Native BYOM (Path B) | Guide |
|---|:---:|:---:|---|
| **VS Code** | ✅ | ✅ Cline / Continue / Copilot BYOK | [ides/vscode.md](ides/vscode) |
| **JetBrains** (all 10) | ✅ Plugin 27310 | ✅ AI Assistant / Cline | [ides/jetbrains.md](ides/jetbrains) |
| **Cursor** | ✅ | ⚠️ Native BYOM (UI-only · needs Cursor Pro/Ultra) | [ides/cursor.md](ides/cursor) |
| **Google Antigravity** | ✅ | ❌ URL blocked | [ides/antigravity.md](ides/antigravity) |

## Agents × Endpoint

<!-- BEGIN manifest:agents-endpoint -->

| Agent | Format | Endpoint | Guide |
|---|---|---|---|
| **Claude Code** | Anthropic | `router.neosmith.ai` | [agents/claude-code.md](agents/claude-code.md) |
| **Codex** | OpenAI Responses | `router.neosmith.ai/v1` | [agents/codex.md](agents/codex.md) |
| **Continue** | OpenAI | `router.neosmith.ai/v1` | [agents/continue.md](agents/continue.md) |
| **Cline** | OpenAI | `router.neosmith.ai/v1` | [agents/cline.md](agents/cline.md) |
| **JetBrains AI** | OpenAI | `router.neosmith.ai/v1` | [agents/jetbrains-ai.md](agents/jetbrains-ai.md) |
| **Copilot Chat** | OpenAI | `router.neosmith.ai/v1` | [agents/copilot.md](agents/copilot.md) |
| **Zed** | OpenAI | `router.neosmith.ai/v1` | [agents/zed.md](agents/zed.md) |
| **Cursor** | OpenAI | `router.neosmith.ai/v1` | [ides/cursor.md](ides/cursor.md) |
| **OpenCode** | OpenAI | `router.neosmith.ai/v1` | [agents/opencode.md](agents/opencode.md) |
| **OpenClaw** | OpenAI | `router.neosmith.ai/v1` | [agents/openclaw.md](agents/openclaw.md) |
| **Junie CLI** | OpenAI | `router.neosmith.ai/v1` | [agents/junie-cli.md](agents/junie-cli.md) |

<!-- END manifest:agents-endpoint -->

## Agents × IDEs

| Agent ↓ / IDE → | VS Code | JetBrains | Cursor | Antigravity |
|---|:---:|:---:|:---:|:---:|
| **Claude Code** | ✅ | ✅ | ✅ | ✅ |
| **Codex** (CLI) | ✅ terminal | ✅ terminal | ✅ terminal | ✅ terminal |
| **Cline** | ✅ ext | ✅ plugin | ✅ ext | ⚠️ if extensible |
| **Cline** (standalone CLI) | ✅ terminal | ✅ terminal | ✅ terminal | ✅ terminal |
| **Continue** | ✅ ext | ✅ plugin | ✅ ext | ⚠️ if extensible |
| **JetBrains AI** | ❌ | ✅ | ❌ | ❌ |
| **Copilot Chat** | ✅ ext | ❌ | ⚠️ fork-dependent | ⚠️ if extensible |
| **OpenCode** (CLI) | ✅ terminal | ✅ terminal | ✅ terminal | ✅ terminal |
| **OpenClaw** (gateway) | ✅ terminal | ✅ terminal | ✅ terminal | ✅ terminal |
| **Junie CLI** | ✅ terminal | ✅ terminal | ✅ terminal | ✅ terminal |

> **Zed** and **Cursor** are absent from this table on purpose: each is an editor
> in its own right, not an agent hosted inside the four above. See
> [agents/zed.md](agents/zed) and [ides/cursor.md](ides/cursor).
>
> **OpenClaw** is a self-hosted gateway rather than an in-editor agent — it fronts
> coding agents from chat apps, so the IDE columns mean "the terminal you start it
> from". See [agents/openclaw.md](agents/openclaw).

## Platforms (OS)

| OS | Claude Code | OpenAI agents | Notes | Guide |
|---|:---:|:---:|---|---|
| **macOS** | ✅ | ✅ | Use `~/.zprofile` for Dock apps | [platforms/macos.md](platforms/macos) |
| **Linux** | ✅ | ✅ | `~/.profile` or `/etc/environment` for GUI | [platforms/linux.md](platforms/linux) |
| **Windows native** | ⚠️ | ✅ | Works; WSL smoother for agents | [platforms/windows-native.md](platforms/windows-native) |
| **Windows WSL2** | ✅ | ✅ | **Recommended** for Windows | [platforms/windows-wsl.md](platforms/windows-wsl) |

## Model SKUs

| SKU | Tier | Escalates to Opus | Best for |
|---|---|:---:|---|
| `neosmith.intelligent-pro` | Opus-tier (default) | ✅ | General coding, agentic work |
| `neosmith.intelligent-basic` | Sonnet-tier | ❌ (Sonnet fallback) | Mid-complexity, cost-conscious |
| `neosmith.intelligent-lite` | SLM-only | ❌ | Autocomplete, commit msgs, low-cost |
| `neosmith.intelligent-maestro` | Fable-tier | ❌ | Highest-accuracy agentic coding |
