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
3. Writes `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, and `ANTHROPIC_MODEL` into `~/.claude/settings.json` (file mode `0600` — owner read/write only).
4. Live-verifies the key against `https://router.neosmith.ai/whoami` and prints your dev slug, org, tier, and 30-day cap usage.

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

`~/.claude/settings.json`:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://router.neosmith.ai",
    "ANTHROPIC_API_KEY":  "sk-plus-yourname-xxxxxx",
    "ANTHROPIC_MODEL":    "claude-opus-4"
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
