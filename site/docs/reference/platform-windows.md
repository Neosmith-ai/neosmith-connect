---
title: Windows (native)
layout: default
parent: Reference
nav_order: 6
---

# Platform Setup: Windows (Native)

This guide covers running NeoSmith on **native Windows** (PowerShell, no WSL). If you prefer a Linux-like environment, see [Windows WSL2](platform-wsl) — recommended for most agentic workflows.

> **Recommendation:** Claude Code and most coding agents run more smoothly under **WSL2**. Use native Windows if your IDE (e.g. a JetBrains IDE or VS Code on Windows) and agent are all Windows-native, or if WSL isn't available to you.

---

## Option 1: One-command Claude Code setup (easiest)

In **PowerShell**:

```powershell
npx @neosmithai/cli init sk-plus-yourname-xxxxxx
```

This writes `%USERPROFILE%\.claude\settings.json`. Open a new Claude Code session.

---

## Option 2: Environment variables

### Set for the current PowerShell session (temporary)

```powershell
$env:ANTHROPIC_BASE_URL = "https://router.neosmith.ai"
$env:ANTHROPIC_API_KEY  = "sk-plus-yourname-xxxxxx"
```

For OpenAI-format agents (Codex, OpenAI SDK):

```powershell
$env:OPENAI_BASE_URL = "https://router.neosmith.ai/v1"
$env:OPENAI_API_KEY  = "sk-plus-yourname-xxxxxx"
```

### Set permanently (user-level, survives reboot)

```powershell
[Environment]::SetEnvironmentVariable("ANTHROPIC_BASE_URL", "https://router.neosmith.ai", "User")
[Environment]::SetEnvironmentVariable("ANTHROPIC_API_KEY",  "sk-plus-yourname-xxxxxx",   "User")
```

Then **restart** your terminal and IDE so they pick up the new values.

### Or via System Properties GUI

```
Start → "Edit environment variables for your account"
  → New… →  Name: ANTHROPIC_BASE_URL   Value: https://router.neosmith.ai
  → New… →  Name: ANTHROPIC_API_KEY    Value: sk-plus-yourname-xxxxxx
  → OK → restart IDE
```

### Verify

```powershell
echo $env:ANTHROPIC_BASE_URL      # → https://router.neosmith.ai
```

---

## Prerequisites

```powershell
# Install Node.js (download from nodejs.org or use winget):
winget install OpenJS.NodeJS.LTS

# Claude Code CLI
npm install -g @anthropic-ai/claude-code

# Verify connectivity (curl.exe ships with Windows 10+)
curl.exe -s https://router.neosmith.ai/whoami -H "Authorization: Bearer sk-plus-yourname-xxxxxx"
```

> Use `curl.exe` (not the PowerShell `curl` alias, which is `Invoke-WebRequest` and has different syntax).

---

## IDE-specific notes (native Windows)

| IDE | How env vars reach it |
|---|---|
| **VS Code** | Reads user env vars at launch. Set them user-level (above), then fully restart VS Code. |
| **JetBrains** | Reads user env vars at launch. Restart the IDE after setting them. For Path B (AI Assistant BYOM), env vars aren't needed — configure the URL in Settings directly. |
| **Cursor** | Same as VS Code. |

> If an IDE doesn't pick up a freshly-set variable, fully **quit and relaunch** it (a window reload isn't enough — the process must restart).

---

## Common Windows-native pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| `curl` syntax errors | PowerShell `curl` = `Invoke-WebRequest` | Use `curl.exe` explicitly |
| Var not seen by IDE | IDE started before var was set | Fully quit + relaunch IDE |
| `npx` not found | Node not installed / not on PATH | `winget install OpenJS.NodeJS.LTS`, reopen terminal |
| Claude Code behaves oddly | Some agent tooling assumes a POSIX shell | Consider [WSL2](platform-wsl) |

## Next

Pick your IDE or agent guide from the [main README]({{ site.baseurl }}/).
