# Claude Code + NeoSmith

Claude Code is Anthropic's CLI/IDE agent. It speaks the Anthropic Messages API and supports a configurable base URL — so it points cleanly at NeoSmith.

- **Endpoint:** `https://router.neosmith.ai` (bare host — Claude Code appends `/v1/messages`)
- **Format:** Anthropic Messages API
- **Works in:** terminal, VS Code, all JetBrains IDEs, Cursor, Antigravity, Neovim — anywhere the Claude Code CLI/extension runs

---

## Option 1: One-command setup (recommended)

The NeoSmith CLI configures Claude Code for you and runs a live connection check.

```bash
npx @neosmithai/cli init sk-plus-yourname-xxxxxx
```

This writes the right env keys into `~/.claude/settings.json` and verifies against `/whoami`. Open a **new** Claude Code session — done.

> **Accepted key formats:** NeoSmith issues keys as `sk-plus-*` (Pro / Opus-tier), `sk-slm-*` (Lite / SLM-only), and `sk-std-*` (Basic / Sonnet-tier), plus a Cognito JWT (starts with `eyJ`) for SSO. The CLI does not gate on prefix — whatever value you paste is stored and round-tripped against `/whoami`, which is the server-side source of truth for key validity (a `401` or `403` response means the key wasn't accepted).

> **Interactive mode:** run `npx @neosmithai/cli init` with **no key** and it prompts you to paste one securely instead of putting it in your shell history.

What `init` does, in order:
1. Round-trips the key against `https://router.neosmith.ai/whoami` for server-side validation (the router is the authoritative validator — the CLI does not inspect the prefix).
2. Backs up any existing Claude Code config to `~/.claude/settings.json.neosmith-backup` (so `uninstall` can restore it).
3. Writes the full NeoSmith config into `~/.claude/settings.json` (file mode `0600` — owner read/write only):
   - **Connection:** `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_MODEL`
   - **Per-tier model ladder** so the `/model` picker shows branded NeoSmith SKUs: `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU,FABLE}_MODEL` plus `_NAME` and `_DESCRIPTION` for each
   - **Top-level defaults:** `model` (from your `--model` flag) and `advisorModel` (`opus`)
4. Live-verifies the key against `https://router.neosmith.ai/whoami` and prints your dev slug, org, tier, and 30-day cap usage.

### The settings.json the CLI writes

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://router.neosmith.ai",
    "ANTHROPIC_AUTH_TOKEN": "sk-plus-yourname-xxxxxx",
    "ANTHROPIC_MODEL": "neosmith.intelligent-pro",

    "ANTHROPIC_DEFAULT_OPUS_MODEL": "neosmith.intelligent-pro",
    "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME": "NeoSmith Pro",
    "ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION": "Cost-optimised with Opus escalation",

    "ANTHROPIC_DEFAULT_SONNET_MODEL": "neosmith.intelligent-basic",
    "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME": "NeoSmith Basic",
    "ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION": "Cost-optimised with Sonnet ceiling",

    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "neosmith.neolite",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME": "NeoSmith NeoLite",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION": "Sealed budget tier · 512K · cheapest",

    "ANTHROPIC_DEFAULT_FABLE_MODEL": "neosmith.intelligent-maestro",
    "ANTHROPIC_DEFAULT_FABLE_MODEL_NAME": "NeoSmith Maestro",
    "ANTHROPIC_DEFAULT_FABLE_MODEL_DESCRIPTION": "Highest-accuracy agentic coding"
  },
  "model": "opus",
  "advisorModel": "opus"
}
```

`--model` selects which tier is the default: `--model maestro` (or `fable`) sets
`ANTHROPIC_MODEL=neosmith.intelligent-maestro` and `model: "fable"`. `neosmith off`
restores your prior config byte-for-byte from the snapshot.

### IDE extension (VS Code / Cursor) auto-wiring

If the **Claude Code extension** is installed in VS Code and/or Cursor, `neosmith claude on`
detects it and also writes the `claudeCode.*` block into that editor's `settings.json` —
including `claudeCode.environmentVariables`, which the extension injects into the model
process. So the extension panel uses NeoSmith too, not just the terminal CLI:

```json
{
  "claudeCode.preferredLocation": "panel",
  "claudeCode.disableLoginPrompt": true,
  "claudeCode.environmentVariables": [
    { "name": "ANTHROPIC_BASE_URL", "value": "https://router.neosmith.ai" },
    { "name": "ANTHROPIC_API_KEY", "value": "sk-plus-yourname-xxxxxx" },
    { "name": "CLAUDE_CODE_USE_BEDROCK", "value": "0" },
    { "name": "CLAUDE_CODE_USE_VERTEX", "value": "0" },
    { "name": "ANTHROPIC_DEFAULT_OPUS_MODEL", "value": "neosmith.intelligent-pro" }
  ]
}
```

Each editor's `settings.json` is snapshotted before the write and restored byte-for-byte by
`neosmith claude off`. Reload the editor window (or fully restart) for the extension to pick
up the change. `neosmith claude status` reports which editors are wired.

To check your installed key any time:

```bash
npx @neosmithai/cli verify
```

To revert to Anthropic-direct (restores your pre-NeoSmith config from the backup if present):

```bash
npx @neosmithai/cli uninstall
```

---

## Option 2: Manual env vars

Set these in your shell profile (see your [platform guide](../README.md#platform-setup-operating-system) for the exact file and OS specifics):

```bash
export ANTHROPIC_BASE_URL=https://router.neosmith.ai
export ANTHROPIC_API_KEY=sk-plus-yourname-xxxxxx
export ANTHROPIC_MODEL=claude-opus-4      # optional; maps to intelligent-pro
```

Then launch Claude Code:

```bash
claude
```

> Claude Code reads these variables at startup. If you set them after the IDE/terminal was already open, restart it.

---

## Option 3: Claude Code settings file

`~/.claude/settings.json` (minimal — the CLI writes the full ladder shown in Option 1):

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://router.neosmith.ai",
    "ANTHROPIC_API_KEY":  "sk-plus-yourname-xxxxxx",
    "ANTHROPIC_MODEL":    "neosmith.intelligent-pro"
  }
}
```

## Per-project override

To use NeoSmith only in a specific repo, add `.claude/settings.json` in the project root with the same `env` block. This overrides the global config for that project — handy for A/B comparing NeoSmith vs Anthropic-direct.

---

## What works unchanged

All Claude Code features operate normally with NeoSmith as the backend:

- Plan mode and inline diffs (accept / reject)
- Checkpoint rewind
- `@terminal`, `@browser` context references
- MCP tool use
- Multi-file agentic sessions
- `/compact` and all slash commands

The only change: model calls route through NeoSmith's ensemble. For genuinely hard tasks, the router escalates to Claude Opus automatically.

---

## Verify it's working

In a Claude Code session, run `/status`, or simply ask it to explain a function. To confirm the request was routed by NeoSmith, curl `/whoami` with your key (see [verify-connection.md](../reference/verify-connection.md)).

## Troubleshooting

See [reference/troubleshooting.md](../reference/troubleshooting.md). Most common issue: env vars set in `~/.zshrc` aren't seen by GUI apps launched from the Dock on macOS — use `~/.zprofile` or launch the IDE from a terminal.
