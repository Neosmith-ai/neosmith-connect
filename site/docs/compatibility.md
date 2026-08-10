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

| Agent | Format | Endpoint | Guide |
|---|---|---|---|
| **Claude Code** | Anthropic | `router.neosmith.ai` | [agents/claude-code.md](agents/claude-code) |
| **OpenAI Codex** | OpenAI Responses | `router.neosmith.ai/v1` | [agents/codex.md](agents/codex) |
| **Cline** | OpenAI | `router.neosmith.ai/v1` | [agents/cline.md](agents/cline) |
| **Continue** | OpenAI | `router.neosmith.ai/v1` | [agents/continue.md](agents/continue) |
| **JetBrains AI Assistant** | OpenAI | `router.neosmith.ai/v1` | [agents/jetbrains-ai.md](agents/jetbrains-ai) |

## Agents × IDEs

| Agent ↓ / IDE → | VS Code | JetBrains | Cursor | Antigravity |
|---|:---:|:---:|:---:|:---:|
| **Claude Code** | ✅ | ✅ | ✅ | ✅ |
| **Codex** (CLI) | ✅ terminal | ✅ terminal | ✅ terminal | ✅ terminal |
| **Cline** | ✅ ext | ✅ plugin | ✅ ext | ⚠️ if extensible |
| **Cline** (standalone CLI) | ✅ terminal | ✅ terminal | ✅ terminal | ✅ terminal |
| **Continue** | ✅ ext | ✅ plugin | ✅ ext | ⚠️ if extensible |
| **JetBrains AI** | ❌ | ✅ | ❌ | ❌ |

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
