---
title: JetBrains
layout: default
parent: Reference
nav_order: 9
---

# JetBrains IDEs + NeoSmith

Applies to: **IntelliJ IDEA · PyCharm · GoLand · WebStorm · Rider · CLion · DataGrip · RubyMine · RustRover · PhpStorm · JetBrains Air**

Two independent paths — use one or both simultaneously:

| Path | What | Endpoint | Best for |
|---|---|---|---|
| **A** | Claude Code [Beta] plugin | `router.neosmith.ai` | Plan mode, multi-file diffs, MCP |
| **B** | JetBrains AI Assistant (BYOM) | `router.neosmith.ai/v1` | Completions, chat, commit msgs |

```
JetBrains IDE
  ├── Claude Code [Beta] plugin ──► ANTHROPIC_BASE_URL=router.neosmith.ai  (Path A)
  └── JetBrains AI Assistant     ──► router.neosmith.ai/v1                  (Path B)
```

---

## Prerequisites

- A NeoSmith API key
- JetBrains IDE **2024.1+** (AI Assistant provider config available from 2024.1)
- For Path A: `claude` CLI (`npm install -g @anthropic-ai/claude-code`)

---

## Path A — Claude Code plugin

### 1. Set environment variables

Add to your shell profile (see your [platform guide]({{ site.baseurl }}/#platform-setup-operating-system)):

```bash
export ANTHROPIC_BASE_URL=https://router.neosmith.ai
export ANTHROPIC_API_KEY=sk-plus-yourname-xxxxxx
```

> **macOS note:** env vars in `~/.zshrc` are only seen by terminals, not apps launched from the Dock. Use `~/.zprofile`, or launch the IDE from a terminal: `open -a "IntelliJ IDEA"`.

### 2. Install the CLI and authenticate

```bash
npm install -g @anthropic-ai/claude-code
claude --version
claude            # first run authenticates against NeoSmith
```

### 3. Install the plugin

```
Settings (Cmd+, / Ctrl+Alt+S)
  → Plugins → Marketplace → search "Claude Code"
  → Install "Claude Code [Beta]" (Plugin ID 27310, by Anthropic)
  → Restart IDE
```

### 4. Open the Claude panel

Press **Cmd+Esc** (Mac) / **Ctrl+Esc** (Windows/Linux).

> Full details + per-project override: [harnesses/claude-code.md](../harnesses/claude-code)

---

## Path B — JetBrains AI Assistant (BYOM)

```
Settings → Tools → AI Assistant → Providers & API Keys
  → Provider:  OpenAI-compatible
  → URL:       https://router.neosmith.ai/v1
  → API Key:   sk-plus-yourname-xxxxxx
  → Enable:    ✅ Tool calling
  → Test Connection → green ✓
  → Models & API Keys tab → assign neosmith.intelligent-pro to all features
```

> Full details incl. enterprise IDE Services: [harnesses/jetbrains-ai.md](../harnesses/jetbrains-ai)

---

## Path B alternative — Cline plugin

For a dedicated agentic plan/act panel alongside JetBrains AI:

```
Settings → Plugins → Marketplace → "Cline" → Install → restart
Cline settings:
  Provider: OpenAI Compatible
  Base URL: https://router.neosmith.ai/v1
  API Key:  sk-plus-yourname-xxxxxx
  Model:    neosmith.intelligent-pro
```

See [harnesses/cline.md](../harnesses/cline).

---

## Enterprise rollout (one admin, entire org)

**Path B via IDE Services:**

```
IDE Services → Config → AI Enterprise → OpenAI Compatible
  URL:     https://router.neosmith.ai/v1
  API Key: <org-level NeoSmith key>
  → Assign to user profiles → Save
```

**Path A via system env vars** (push with Ansible/Chef/Puppet/Group Policy):

```bash
# /etc/environment or /etc/profile.d/neosmith.sh (Linux)
ANTHROPIC_BASE_URL=https://router.neosmith.ai
ANTHROPIC_API_KEY=<org-neosmith-key>
```

Developers with the Claude Code plugin pick up NeoSmith on next IDE restart.

---

## Troubleshooting

- **Path A panel "Not connected":** Verify `echo $ANTHROPIC_BASE_URL`; restart IDE from a shell that has the env vars.
- **Path B "Test Connection" fails:** URL must be exactly `https://router.neosmith.ai/v1`; ensure Tool calling is enabled.
- **IDE started before env vars set:** Quit fully, open a new terminal, relaunch.
- More: [reference/troubleshooting.md](troubleshooting)
