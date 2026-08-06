# @neosmithai/cli

Route AI coding agents through the [NeoSmith router](https://router.neosmith.ai) — same experience, ~60% lower inference cost. One CLI, five harnesses: **Claude Code, Codex, Continue, Cline, JetBrains AI**.

NeoSmith routes cheap traffic to a distilled SLM and escalates to Claude Opus only when a task actually needs it. A verifier catches regressions, so output quality stays Opus-class.

## Quick start

**1. Install**

```bash
sh -c "$(curl -fsSL https://raw.githubusercontent.com/Neosmith-ai/neosmith-connect/main/packages/cli/install.sh)"
```

Or, without the curl-pipe installer (Node.js 18+ already on your machine):

```bash
npx @neosmithai/cli login sk-plus-yourname-xxxxxx
```

**2. Sign in**

```bash
neosmith login        # paste an sk-plus-* / sk-std-* / sk-slm-* key (or a Cognito JWT)
```

**3. Connect a harness**

```bash
neosmith claude on    # wires ~/.claude/settings.json
```

```
✓ Wrote ~/.claude/settings.json
Restart Claude Code for the change to take effect.
```

Swap `claude` for any harness: `codex`, `continue`, `cline`, `jetbrains`.

**4. Restart the tool, then verify**

```bash
neosmith claude status
neosmith verify        # hits /whoami — prints your dev slug, org, tier, 30-day cap usage
```

Run `neosmith help` or `neosmith <harness> help` for every option.

### Install notes

- Requires **Node.js 18+**. Missing or too old: the installer installs it via Homebrew on macOS, otherwise prints nvm / nodejs.org / NodeSource instructions.
- Clones the CLI to `~/.neosmith/cli`, installs the launcher into `~/.local/bin`, and adds it to your shell `PATH`.
- Does **not** sign you in or touch harness settings — that's steps 2 and 3.

**Windows:** run from Git Bash. Piping `curl | bash` in PowerShell corrupts line endings (`set: pipefail\r: invalid option name`); keep the pipe inside bash:

```bash
bash -c "curl -fsSL https://raw.githubusercontent.com/Neosmith-ai/neosmith-connect/main/packages/cli/install.sh | bash"
```

**From an SSH checkout:**

```bash
mkdir -p ~/.neosmith && git clone git@github.com:Neosmith-ai/neosmith-connect.git ~/.neosmith/connect && bash ~/.neosmith/connect/packages/cli/install.sh
```

## Supported harnesses

| Harness | Command | Config it writes | Key storage | Before `on` / `off` |
|---|---|---|---|---|
| [Claude Code](#claude-code) | `neosmith claude` | `~/.claude/settings.json` | `ANTHROPIC_AUTH_TOKEN` literal (`0600`) | Restart after |
| [Codex](#codex) | `neosmith codex` | `~/.codex/config.toml` | `$OPENAI_API_KEY` (env-key ref) | Restart after |
| [Continue](#continue) | `neosmith continue` | `~/.continue/config.yaml` | `apiKey` literal (`0600`) | Restart after |
| [Cline](#cline) | `neosmith cline` | *(none — UI-driven)* | Cline extension storage | Paste into Cline's UI |
| [JetBrains AI](#jetbrains-ai) | `neosmith jetbrains` | *(none — UI-driven)* | JetBrains IDE storage | Paste into Settings UI |

Every harness supports `on`, `off`, `status`, and `help`. `off` restores your pre-connect configuration — file-based harnesses **byte-for-byte** from a snapshot under `~/.neosmith/snapshots/`, and the UI-driven ones by clearing the on-flag and telling you what to switch back in the IDE.

## Default models

| Harness | Default model |
|---|---|
| Claude Code | `neosmith.intelligent-pro` (via `ANTHROPIC_MODEL`) |
| Codex | `neosmith.intelligent-pro` |
| Continue | `neosmith.intelligent-pro` (autocomplete: `neosmith.intelligent-lite`) |
| Cline | `neosmith.intelligent-pro` |
| JetBrains AI | Chat → `neosmith.intelligent-pro`, inline/commit → `intelligent-lite`, test/doc → `intelligent-basic` |

Override with `--model`:

```bash
neosmith claude on --model neosmith.intelligent-basic   # Sonnet-tier, no Opus escalation
neosmith claude on --model neosmith.intelligent-lite    # SLM-only, lowest cost
```

| Model SKU | Tier | Behavior |
|---|---|---|
| `neosmith.intelligent-pro` | Opus-tier (**default**) | SLM-first, escalates to Claude Opus on hard tasks / verifier-fail |
| `neosmith.intelligent-basic` | Sonnet-tier | SLM-first with Sonnet fallback; **no Opus** |
| `neosmith.intelligent-lite` | Haiku/SLM-only | Lowest cost, SLM-only, no frontier escalation |

Anthropic-style ids (`claude-opus-4`, `claude-sonnet-4-6`) are also accepted for Claude Code and map to the corresponding tier.

## Claude Code

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://router.neosmith.ai",
    "ANTHROPIC_AUTH_TOKEN": "sk-plus-yourname-xxxxxx",
    "ANTHROPIC_MODEL": "neosmith.intelligent-pro"
  }
}
```

`on` **merges** into `~/.claude/settings.json` — your existing `permissions`, `hooks`, and MCP config are preserved. The pre-connect file is snapshotted to `~/.neosmith/snapshots/claude.bak` so `off` restores it byte-for-byte. File mode `0600`.

## Codex

```toml
model = "neosmith.intelligent-pro"
model_provider = "neosmith"

[model_providers.neosmith]
name = "NeoSmith"
base_url = "https://router.neosmith.ai/v1"
env_key = "OPENAI_API_KEY"
wire_api = "responses"
```

Codex reads the key from `$OPENAI_API_KEY` at runtime, so `on` also prints the export line for your shell profile:

```bash
export OPENAI_API_KEY=sk-plus-yourname-xxxxxx
export OPENAI_BASE_URL=https://router.neosmith.ai/v1
```

## Continue

```yaml
models:
  - name: NeoSmith
    provider: openai
    apiBase: https://router.neosmith.ai/v1
    model: neosmith.intelligent-pro
    apiKey: sk-plus-yourname-xxxxxx
```

Add `--autocomplete` to also route inline completions through `neosmith.intelligent-lite` (fast, low-cost, latency-sensitive):

```bash
neosmith continue on --autocomplete
```

## Cline

Cline stores its provider config in extension internal state, so `on` prints the exact values to paste into Cline's settings (gear icon in the Cline panel):

```
API Provider:  OpenAI Compatible
Base URL:      https://router.neosmith.ai/v1
API Key:       sk-plus-yourname-xxxxxx
Model ID:      neosmith.intelligent-pro
```

Enable streaming + tool/function calling. `off` clears the on-flag and reminds you to switch Cline back in its UI.

## JetBrains AI

`on` prints the values to paste into **Settings → Tools → AI Assistant → Providers & API Keys** (OpenAI-compatible, URL `https://router.neosmith.ai/v1`, tool calling enabled), plus the recommended per-feature model assignments (Chat → pro, inline/commit → lite, test/doc → basic). Works in IntelliJ, PyCharm, GoLand, WebStorm, Rider, CLion, DataGrip, RubyMine, RustRover, PhpStorm, and JetBrains Air.

## Keys and storage

- `~/.neosmith/config.json` holds your key as a plaintext literal (mode `0600`). No OS keychain — the developer-guide stores all harness keys as `0600` literals.
- Each file-writable harness bakes the key into its own config (also `0600`). Codex is the exception: it uses an `env_key` reference and reads `$OPENAI_API_KEY` at runtime.
- `off` removes the harness-specific keys but leaves your stored key intact — re-run `<harness> on` to reconnect.
- `neosmith uninstall` disconnects every harness, then removes `~/.neosmith` (add `--all` to also remove the launcher).

**Accepted key formats:** `sk-plus-*` (Pro), `sk-std-*` (Basic), `sk-slm-*` (Lite), or a Cognito JWT starting with `eyJ`.

## Commands

| Command | What it does |
|---|---|
| `neosmith login [key]` | Store + verify a key (prompts to paste if omitted). |
| `neosmith <harness> on [--model X] [--autocomplete]` | Connect a harness. Snapshots pre-state for `off`. |
| `neosmith <harness> off` | Restore a harness's pre-connect config (byte-for-byte for file-writable harnesses). |
| `neosmith <harness> status` | Show one harness's on/off state + model. |
| `neosmith status` | Show all harnesses + stored key. |
| `neosmith verify` | Hit `/whoami` with the stored key. |
| `neosmith uninstall [--all]` | Disconnect all harnesses, remove `~/.neosmith` (+ launcher with `--all`). |
| `neosmith help [harness]` | Top-level or per-harness help. |
| `neosmith init <key>` | *(Back-compat)* login + `claude on` in one shot — the original one-liner. |

## Troubleshooting

| Symptom | Fix |
|---|---|
| Tool still uses the old model | Fully restart the harness. In Claude Code, exit and `claude --resume <id>` — settings apply per session. |
| `claude off` didn't restore my config | `off` restores from `~/.neosmith/snapshots/claude.bak`. If you deleted it, `off` strips the NeoSmith keys instead (your other settings stay). |
| Codex: `400 Unknown model` | Use `neosmith.intelligent-pro`, not a `gpt-*` name. |
| Continue: `404` or no response | Ensure `apiBase` ends in `/v1` (the CLI does this for you). |
| Cline/JetBrains: `on` didn't change anything | These are UI-driven — copy the printed values into the IDE UI manually. |
| macOS GUI app doesn't see the env vars | Launch the IDE from a terminal, or set vars in `~/.zprofile` (GUI apps don't read `~/.zshrc`). |
| Something else | `neosmith status` shows every harness's state + whether a key is stored. |

## Upgrade and uninstall

```bash
# Upgrade — re-run the installer (pulls latest, idempotent):
sh -c "$(curl -fsSL https://raw.githubusercontent.com/Neosmith-ai/neosmith-connect/main/packages/cli/install.sh)"

# Or, if installed via npx, just use the latest:
npx @neosmithai/cli@latest login

# Uninstall — disconnect every harness, remove ~/.neosmith (+ launcher with --all):
neosmith uninstall --all
```

## Portal

Manage your key, rotate it, and see cap usage at **https://router.neosmith.ai/me/login**.

## License

MIT. Source: https://github.com/Neosmith-ai/neosmith-connect · Docs: https://neosmith-ai.github.io/neosmith-connect/
