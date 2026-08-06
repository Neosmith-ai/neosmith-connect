# Compatibility Matrix

A single-glance view of what works where. ✅ = supported and documented · ⚠️ = works with caveats · ❌ = not available.

## IDEs × Integration Paths

| IDE | Claude Code (Path A) | Native BYOM (Path B) | Guide |
|---|:---:|:---:|---|
| **VS Code** | ✅ | ✅ Cline / Continue / Copilot BYOK | [ides/vscode.md](ides/vscode.md) |
| **JetBrains** (all 10) | ✅ Plugin 27310 | ✅ AI Assistant / Cline | [ides/jetbrains.md](ides/jetbrains.md) |
| **Cursor** | ✅ | ✅ Native BYOM | [ides/cursor.md](ides/cursor.md) |
| **Google Antigravity** | ✅ | ❌ URL blocked | [ides/antigravity.md](ides/antigravity.md) |

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
<!-- END manifest:agents-endpoint -->

## Agents × IDEs

| Agent ↓ / IDE → | VS Code | JetBrains | Cursor | Antigravity |
|---|:---:|:---:|:---:|:---:|
| **Claude Code** | ✅ | ✅ | ✅ | ✅ |
| **Codex** (CLI) | ✅ terminal | ✅ terminal | ✅ terminal | ✅ terminal |
| **Cline** | ✅ ext | ✅ plugin | ✅ ext | ⚠️ if extensible |
| **Continue** | ✅ ext | ✅ plugin | ✅ ext | ⚠️ if extensible |
| **JetBrains AI** | ❌ | ✅ | ❌ | ❌ |

## Platforms (OS)

| OS | Claude Code | OpenAI agents | Notes | Guide |
|---|:---:|:---:|---|---|
| **macOS** | ✅ | ✅ | Use `~/.zprofile` for Dock apps | [platforms/macos.md](platforms/macos.md) |
| **Linux** | ✅ | ✅ | `~/.profile` or `/etc/environment` for GUI | [platforms/linux.md](platforms/linux.md) |
| **Windows native** | ⚠️ | ✅ | Works; WSL smoother for agents | [platforms/windows-native.md](platforms/windows-native.md) |
| **Windows WSL2** | ✅ | ✅ | **Recommended** for Windows | [platforms/windows-wsl.md](platforms/windows-wsl.md) |

## Model SKUs

| SKU | Tier | Escalates to Opus | Best for |
|---|---|:---:|---|
| `neosmith.intelligent-pro` | Opus-tier (default) | ✅ | General coding, agentic work |
| `neosmith.intelligent-basic` | Sonnet-tier | ❌ (Sonnet fallback) | Mid-complexity, cost-conscious |
| `neosmith.intelligent-lite` | SLM-only | ❌ | Autocomplete, commit msgs, low-cost |
