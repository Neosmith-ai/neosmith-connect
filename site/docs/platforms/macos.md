---
title: macOS
layout: default
parent: Platforms
nav_order: 1
---

# Platform Setup: macOS

## Shell profile

macOS uses **zsh** by default (since Catalina). Add env vars to the right file:

| File | When it's read |
|---|---|
| `~/.zshrc` | Interactive terminals |
| `~/.zprofile` | Login shells **and GUI apps launched from the Dock** |

> **Critical macOS gotcha:** apps launched from the **Dock** (VS Code, IntelliJ, Cursor) do **not** read `~/.zshrc`. Put the vars in `~/.zprofile`, or always launch the IDE from a terminal.

## Set the variables

For Claude Code (Anthropic format):

```bash
# Add to ~/.zprofile
export ANTHROPIC_BASE_URL=https://router.neosmith.ai
export ANTHROPIC_API_KEY=sk-plus-yourname-xxxxxx
```

For OpenAI-format agents (Codex, OpenAI SDK):

```bash
export OPENAI_BASE_URL=https://router.neosmith.ai/v1
export OPENAI_API_KEY=sk-plus-yourname-xxxxxx
```

Apply without restarting:

```bash
source ~/.zprofile
```

Verify:

```bash
echo $ANTHROPIC_BASE_URL      # → https://router.neosmith.ai
```

## One-command Claude Code setup

The NeoSmith CLI writes config into `~/.claude/settings.json` (independent of shell profiles, so it works for Dock-launched apps too):

```bash
npx @neosmithai/cli init sk-plus-yourname-xxxxxx
```

## Launching IDEs so they see env vars

| IDE | Command |
|---|---|
| VS Code | `code .` |
| Cursor | `cursor .` |
| IntelliJ | `open -a "IntelliJ IDEA"` (from a terminal with vars set) |

Or set the vars in `~/.zprofile` and fully quit + relaunch the app.

## Prerequisites

```bash
# Node (for the NeoSmith CLI and Claude Code)
brew install node

# Claude Code CLI
npm install -g @anthropic-ai/claude-code

# Verify connectivity
curl -s https://router.neosmith.ai/whoami -H "Authorization: Bearer sk-plus-yourname-xxxxxx"
```

## Next

Pick your IDE or agent guide from the [Home]({{ site.baseurl }}/).
