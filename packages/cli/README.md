# @neosmithai/cli

Route AI coding agents through the [NeoSmith router](https://router.neosmith.ai) — same experience, ~60% lower inference cost. One CLI, one key, eight harnesses: **Claude Code, Codex, Continue, Cline, JetBrains AI, Copilot Chat, Zed, Cursor**.

NeoSmith routes cheap traffic to a distilled SLM and escalates to Claude Opus only when a task actually needs it. A verifier catches regressions, so output quality stays Opus-class.

> **This is the canonical NeoSmith CLI guide.** It is the file `npm view @neosmithai/cli` renders and the README shipped inside the package. The developer-guide site (<https://neosmith-ai.github.io/neosmith-connect/>) mirrors it for per-harness deep dives; if anything here and the site disagree, **this file is authoritative**.

---

## Quick start

**1. Install** — use the command for your OS from the root
[`README.md`](https://github.com/Neosmith-ai/neosmith-connect#install-paths)
(both the bash and the PowerShell installer are shipped; they're the only
authoritative source for install commands — this README points instead of
duplicating, which is how it drifted before).

Or, if you already have Node 18+ and want to skip the installer:

```bash
npx @neosmithai/cli login sk-plus-yourname-xxxxxx
```

**What you should see** (≈10 seconds):

```
  NeoSmith CLI installer

  Downloading NeoSmith CLI…
  Installing dependencies…
  ✓ Installed launcher → /Users/you/.local/bin/neosmith     (or %USERPROFILE%\.neosmith\bin on Windows PowerShell)
  ✓ NeoSmith CLI ready

  Next steps:
    1. neosmith login            # paste your sk-plus-* / sk-std-* / sk-slm-* key
    2. neosmith claude on        # wire Claude Code (or: codex, continue, cline, opencode, junie, …)
    3. neosmith claude status    # confirm it's connected
```

If the installer prints any line starting with **`Node.js 18+ is required`**, install Node first (Homebrew on macOS: `brew install node`; Windows: `winget install OpenJS.NodeJS.LTS`; everywhere else: <https://nodejs.org/>).

Once the installer finishes, open a **new terminal** so the `PATH` change takes effect, then `neosmith help` — you should see the command + harness list. If you get `neosmith: command not found`, see [The launcher isn't on my PATH](#the-launcher-isnt-on-my-path) below.

**2. Sign in**

```bash
neosmith login        # paste an sk-plus-* / sk-std-* / sk-slm-* key (or a Cognito JWT)
```

**What you should see:**

```
  ── NeoSmith · login ──

  ✓ key accepted
  ✓ verified against router.neosmith.ai
    dev:  yourname@yourorg
    tier: pro
    cap:  3 of 30 days used this cycle

  Next: connect a harness — e.g. neosmith claude on
  Supported: claude, codex, continue, cline, jetbrains, copilot, zed, cursor, opencode, openclaw, junie. Run `neosmith help` for all.
```

What this did: saved your key to `~/.neosmith/config.json` (mode `0600`, visible only to your user account) and round-tripped it against the router's `/whoami` so we know it actually works — not just that it's shaped right.

**3. Connect a harness**

```bash
neosmith claude on      # Claude Code
```

```
✓ Wrote ~/.claude/settings.json
Restart Claude Code for the change to take effect.
```

Swap `claude` for any harness: `codex`, `continue`, `cline`, `jetbrains`, `copilot`, `zed`, `cursor`, `opencode`, `openclaw`, `junie`. For the UI-driven ones (`jetbrains`, `cursor`), `on` prints the exact values to paste into the tool's settings — see [UI-driven harnesses](#ui-driven-harnesses-copilot-jetbrains-cursor) below.

**Now fully quit and reopen the tool** — it only reads the new config on a fresh session.

**4. Verify it works**

```bash
neosmith status        # what's currently wired
neosmith doctor        # live round-trip per connected harness + audit-log integrity
neosmith verify        # hits /whoami — prints your dev slug, org, tier, 30-day cap usage
```

**What `doctor` should show:**

```
  ── NeoSmith · doctor ──

  ✓  claude           pass (model=neosmith.intelligent-pro)
  ✓  codex            not connected (skipped)
  ✓  continue         not connected (skipped)
  ✓  cline            not connected (skipped)
  ✓  audit-log        no audit log yet

  All checks passed.
```

If a harness shows `pass`, you're done. Open the tool, send any prompt, and you get a normal response routed through NeoSmith.

---

## Commands

| Command | What it does |
|---|---|
| `neosmith login [key]` | Store + verify a key (prompts to paste if omitted). |
| `neosmith <harness> on [--model X] [--autocomplete]` | Connect a harness. Snapshots pre-state for `off`. |
| `neosmith <harness> off` | Restore a harness's pre-connect config, keeping any edits you made while connected. |
| `neosmith <harness> status` | Show one harness's on/off state + model. |
| `neosmith status` | Show all harnesses + stored key, and which of your settings files are backed up. |
| `neosmith keys [--reveal] [--json]` | Reprint the keys this machine is configured with, per environment, and say which harness is holding which. Masked by default. |
| `neosmith originals [--show <harness>] [--export <dir>] [--json]` | Show where your pre-connect settings are stored, read one, or copy them all out. |
| `neosmith verify` | Hit `/whoami` with the stored key. |
| `neosmith doctor` | Per-harness live protocol check + audit-log integrity. |
| `neosmith models` | List available NeoSmith model SKUs (from `GET /v1/models`, offline fallback to the manifest). |
| `neosmith setup` | Detect installed tools, wire the ones you pick, run doctor. |
| `neosmith reset [--all] [--keep-audit]` | Disconnect every harness (clears key; `--all` also removes install + launcher; `--keep-audit` preserves the audit log). |
| `neosmith feedback [bug\|idea] [--message "..."]` | Open the right GitHub issue template in your browser with a prefilled environment block. `--no-open` prints the URL + body for headless use. |
| `neosmith uninstall [--all]` | Disconnect all harnesses, remove `~/.neosmith` (+ launcher with `--all`). |
| `neosmith help [harness]` | Top-level or per-harness help. |
| `neosmith init <key>` | *(Back-compat)* login + `claude on` in one shot — the original one-liner. |

Every command supports `--help`. Run `neosmith help` or `neosmith <harness> help` to see all options.

---

## Supported harnesses

| Harness | Command | What gets written | Key storage | Before `on` / `off` |
|---|---|---|---|---|
| **Claude Code** | `neosmith claude` | `~/.claude/settings.json` (0600) + VS Code/Cursor `claudeCode.*` if the extension is installed | `ANTHROPIC_AUTH_TOKEN` literal (0600) | Restart after |
| **Codex** | `neosmith codex` | `~/.codex/config.toml` (0600) | `$OPENAI_API_KEY` (env-key ref) | Restart after; export the printed line |
| **Continue** | `neosmith continue` | `~/.continue/config.yaml` (0600) — one model entry per SKU | `apiKey` literal (0600) | Reload VS Code window |
| **Cline** | `neosmith cline` | `~/.cline/data/settings/providers.json` (the **selected** provider + model) + `models.json` (the **catalogue**, all SKUs) — read by Cline 4.x in VS Code/JetBrains **and** the standalone Cline CLI | `apiKey` literal (0600) | Reload the Cline panel |
| **JetBrains AI** | `neosmith jetbrains` | *(none — UI-driven)* | JetBrains IDE storage | Paste into Settings UI |
| **Copilot Chat** | `neosmith copilot` | VS Code `chatLanguageModels.json` — one model entry per SKU (key in OS-keychain) | OS-keychain (SecretStorage) | Reload window; paste key in picker once |
| **Zed** | `neosmith zed` | `~/.config/zed/settings.json` (0600) — one `available_models` entry per SKU | literal (0600) | Restart Zed |
| **Cursor** | `neosmith cursor` | *(none — native BYOK is UI-only, needs Cursor Pro/Ultra)* | Cursor's encrypted, server-synced BYOK store (not `settings.json`) | Enter in Cursor → Settings → Models; or use `neosmith claude on` + the Claude Code extension |
| **OpenCode** | `neosmith opencode` | `~/.config/opencode/opencode.json` (0600) — `provider.neosmith` plus `model`/`small_model` | `apiKey` literal (0600) | Restart OpenCode |
| **OpenClaw** | `neosmith openclaw` | `~/.openclaw/openclaw.json` (0600) — `models.providers.neosmith` plus `agents.defaults.model.primary` | `apiKey` literal (0600) | Restart the gateway |
| **Junie CLI** | `neosmith junie` | `~/.junie/models/neosmith*.json` (0600) — five custom model profiles: one per SKU plus a wired-tier alias | `apiKey` literal (0600) | Select one: `junie --model custom:neosmith` |

Every harness supports `on`, `off`, `status`, and `help`. `off` restores your pre-connect configuration — file-based harnesses from a snapshot under `~/.neosmith/snapshots/`, and the UI-driven ones by clearing the on-flag and telling you what to switch back in the IDE.

### Your existing settings are merged, never clobbered

For every file-writable harness:

- **`on` merges.** Variables you defined yourself are left exactly as they are. Only the NeoSmith-owned keys are added or overwritten — including inside list-shaped settings like `claudeCode.environmentVariables`, which is merged **by variable name**, so your own `HTTPS_PROXY` (or anything else) stays put.
- **The pre-connect snapshot is taken once.** Re-running `on` — to switch tiers with `--model`, or just by accident — refreshes the config but never overwrites the baseline captured the first time. `off` therefore restores what you had *before you ever connected*, not what the previous `on` left behind.
- **`off` restores, it doesn't just delete.** Alongside the snapshot, `on` records each key's prior value in `~/.neosmith/state.json`. If the snapshot is gone (you cleaned `~/.neosmith`, or moved machines), `off` replays that ledger: your values come back and only the keys NeoSmith introduced are removed.
- **Edits you make *while connected* survive `off` too.** `on` also stamps a checksum of the file as it left it. If nothing has changed since, `off` puts the pre-connect file back **byte-for-byte** — formatting, comments and key order included. If you *have* edited it — a new hook, a permission, a proxy variable, another provider — `off` keeps your file and takes back only the keys NeoSmith owns. Your work is never the price of disconnecting.

Which keys are NeoSmith's is stated where you can see it: `on` prints them, and in `~/.codex/config.toml` they sit inside a commented **NeoSmith managed block**. Keep your own settings outside that block — anything in it is rewritten by `on` and deleted by `off`.

`npm run smoke` rehearses all of this against a throwaway `HOME` and saves before/wired/after copies you can diff yourself.

### Where your original settings are kept

Before `on` writes anything, it copies the whole pre-connect file to `~/.neosmith/snapshots/<harness>.bak`. `neosmith originals` shows you what's there:

```
$ neosmith originals

  NeoSmith · your original settings

  Stored in ~/.neosmith/snapshots/ · restored by `neosmith <harness> off`.

  Claude Code  · 98 B · 8 Aug, 20:44
    from   ~/.claude/settings.json
    kept   ~/.neosmith/snapshots/claude.bak

  Codex  · 21 B · 8 Aug, 20:44
    from   ~/.codex/config.toml
    kept   ~/.neosmith/snapshots/codex.bak
```

- `neosmith originals --show codex` prints the stored file as it was before you connected.
- `neosmith originals --export ./backup` copies them all out with a `MANIFEST.json` recording where each one belongs.
- `neosmith originals --json` for scripting.

Claude Code lists two entries when the IDE extension is wired — the CLI config and the editor's own `settings.json` are snapshotted independently.

**These copies don't last forever.** `off` puts the file back and consumes the copy; `neosmith uninstall` deletes `~/.neosmith` outright. Both name what they're about to remove before asking you to confirm. If you want a copy that survives, export it first.

### Cline: one file, every surface

Cline is a single product with three front ends — the VS Code extension, the JetBrains plugin, and the standalone `cline` CLI — and since 4.x they share one global config:

```
($CLINE_DIR || ~/.cline)/data/settings/providers.json   # provider, key, baseUrl, SELECTED model
($CLINE_DIR || ~/.cline)/data/settings/models.json      # the CATALOGUE — every SKU + its window
```

The split trips people up: `providers.json` carries a single `model` field, so
reading only that file makes it look as though one model was registered. It is
the model currently *in use*. `models.json` is the registry Cline enumerates,
and `on` puts all four NeoSmith SKUs there — which is what makes the other
tiers selectable without re-running it.

`neosmith cline on` writes both, registers the `openai-compatible` provider, and sets `lastUsedProvider` so the provider it wrote is the one Cline actually uses — a wired-but-unselected provider is a no-op, and `neosmith cline status` says so explicitly if you switch away in the UI later. `CLINE_PROVIDER_SETTINGS_PATH` relocates `providers.json`; the CLI follows it.

Your other providers and their settings are merged, not replaced, and `off` restores the pre-connect file byte-for-byte — including which provider was selected.

> **Cline 3.x:** provider config lived in VS Code's extension state (`state.vscdb`), which no CLI can safely write. `on` still prints the paste-in values for that case — API Provider **OpenAI Compatible**, Base URL `https://router.neosmith.ai/v1`, your key, Model ID `neosmith.intelligent-pro`, with streaming and tool calling enabled.

### UI-driven harnesses (Copilot, JetBrains, Cursor)

Some harnesses don't expose a config file the CLI can write to — their key lives inside the tool's UI or its OS-keychain. For these, `neosmith <harness> on` writes what it can and **prints the remaining manual step**.

**GitHub Copilot Chat** (partial-UI): `on` writes VS Code's own `chatLanguageModels.json` — which lives at the **profile root** (`%APPDATA%\Code\User\` on Windows, `~/Library/Application Support/Code/User/` on macOS, `~/.config/Code/User/` on Linux), *not* in the extension's `globalStorage`. VS Code keeps one copy per profile, so `on` writes the default profile plus every named profile under `profiles/` that doesn't inherit language models from it; otherwise a user on a named profile gets an empty model picker. The file is a top-level **array** of provider entries, with the endpoint as `url` on each *model*.

`apiKey` is deliberately left unset. VS Code mints its own SecretStorage handle when you enter the key — verified against a live build, it rewrites the file and appends `"apiKey": "${input:chat.lm.secret.<hash>}"`, leaving everything else as written. The hash is **per entry**, not global (the same router URL in a second profile gets a different one), so a handle can never be copied between profiles or synthesized — an invented `${input:…}` name is not something VS Code resolves.

So: restart VS Code → Copilot Chat → model picker → **Manage Language Models** → pick **NeoSmith** → paste your key when prompted. Do this **once per profile** — a key entered in one profile does not carry to another.

`neosmith copilot status` reports three states: `off` / `models-written` (entry registered, no key handle yet) / `on` (VS Code has stamped a handle onto the entry). The third state is detected from disk — no confirmation step needed — and names any profile whose key is still outstanding. `--confirmed` remains as a manual override for builds that store the reference elsewhere. Note that a handle proves a key was *entered*, not that it is *valid*; `neosmith doctor` is what round-trips it against the router.

**JetBrains AI Assistant** (fully UI-driven): `on` prints the values to paste into **Settings → Tools → AI Assistant → Providers & API Keys** (OpenAI-compatible, URL `https://router.neosmith.ai/v1`, tool calling enabled), plus the recommended per-feature model assignments (Chat → pro, inline/commit → lite, test/doc → basic). Works in IntelliJ, PyCharm, GoLand, WebStorm, Rider, CLion, DataGrip, RubyMine, RustRover, PhpStorm, and JetBrains Air.

**Cursor** (fully UI-driven, Pro-gated): Cursor's native BYOK **cannot** be set from `settings.json` — it lives in an encrypted, server-synced store and custom OpenAI endpoints require **Cursor Pro/Ultra**. `on` prints the Settings → Models paste-in values (OpenAI API Key, Override Base URL → `…/v1`, the NeoSmith SKUs to Add + Verify). The fully scriptable alternative — no Pro license needed — is `neosmith claude on` plus the Claude Code extension in Cursor.

---

## Every tier is installed, not just the one you wired

`GET /v1/models` returns model **ids only** — no context window, no capabilities. A client with a custom endpoint therefore has no way to discover that `neosmith.intelligent-pro` holds 1M tokens, and falls back to a conservative default that compacts far too early.

So `on` writes the whole catalogue, with each SKU's real window, for every harness whose config has somewhere to put it:

| Harness | Where | Field that carries the window |
|---|---|---|
| Claude Code | tier ladder in `settings.json` | *(none — the Anthropic client knows)* |
| Cline | `models.json` (**not** `providers.json`) | `contextWindow` |
| Continue | `config.yaml` | `defaultCompletionOptions.contextLength` |
| Copilot Chat | `chatLanguageModels.json` | `maxInputTokens` |
| Zed | `available_models` | `max_tokens` — **Zed's name for the context window** |
| OpenCode | `provider.neosmith.models` | `limit.context` |
| OpenClaw | `models.providers.neosmith.models` | `contextWindow` |
| Junie CLI | one profile file per SKU | `maxContextLength` |

`neosmith.neolite` is 512K — the sealed budget tier — and the other three are 1M. Codex is the one exception: `config.toml` has no catalogue to populate, just `model = "…"` and a generic provider, and you type any SKU at `/model`.

The practical payoff: switching tiers inside these tools does **not** re-run `on`, so an unregistered SKU is not selectable at all. With all four registered you switch in the tool's own picker.

`tests/../scripts/contract/model-catalogue.test.js` enforces this — every harness is either in the catalogue table or exempt with a written reason.

---

## Choosing a model tier

The default tier (`pro` / Opus-tier) routes cheap work to a distilled model and escalates to Claude Opus only when a task actually needs it. To cap that:

| Tier | `--model` suffix | What you get |
|---|---|---|
| Pro (default) | *(nothing)* | SLM-first, escalates to Opus on hard tasks / verifier-fail |
| Basic / Sonnet | `--model neosmith.intelligent-basic` | SLM-first with Sonnet fallback, **no Opus** |
| Lite / SLM-only | `--model neosmith.intelligent-lite` | Lowest cost, no frontier escalation |
| Maestro / Fable | `--model neosmith.intelligent-maestro` | Highest-accuracy agentic coding lane |

| Model SKU | Tier | Behavior |
|---|---|---|
| `neosmith.intelligent-pro` | Opus-tier (**default**) | SLM-first, escalates to Claude Opus on hard tasks / verifier-fail |
| `neosmith.intelligent-basic` | Sonnet-tier | SLM-first with Sonnet fallback; **no Opus** |
| `neosmith.intelligent-lite` | Haiku/SLM-only | Lowest cost, SLM-only, no frontier escalation |
| `neosmith.intelligent-maestro` | Highest-accuracy agentic coding | Fable-tier; top-of-ladder agentic lane |

Anthropic-style ids (`claude-opus-4`, `claude-sonnet-4-6`) are also accepted for Claude Code and map to the corresponding tier. For Claude Code, `on` also writes the branded per-tier ladder (`ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU,FABLE}_MODEL` + `_NAME`/`_DESCRIPTION`) and top-level `model`/`advisorModel` — see [agents/claude-code.md](https://neosmith-ai.github.io/neosmith-connect/docs/agents/claude-code).

Examples:

```bash
neosmith claude on --model basic       # Sonnet-tier
neosmith claude on --model lite        # SLM-only
neosmith claude on --model maestro     # Fable-tier, highest-accuracy agentic
neosmith claude on --model claude-opus-4   # force Opus, no escalation
```

Change tiers any time by re-running `on` with a new `--model`. The CLI updates only the model line; your other settings stay.

### Default models per harness

| Harness | Default model |
|---|---|
| Claude Code | `neosmith.intelligent-pro` (via `ANTHROPIC_MODEL`) |
| Codex | `neosmith.intelligent-pro` |
| Continue | `neosmith.intelligent-pro` (autocomplete: `neosmith.intelligent-lite`) |
| Cline | `neosmith.intelligent-pro` |
| JetBrains AI | Chat → `neosmith.intelligent-pro`, inline/commit → `intelligent-lite`, test/doc → `intelligent-basic` |
| Copilot Chat | `neosmith.intelligent-pro` |
| Zed | `neosmith.intelligent-pro` |
| Cursor | `neosmith.intelligent-pro` (paste-in) |

---

## Per-harness config reference

### Claude Code

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://router.neosmith.ai",
    "ANTHROPIC_AUTH_TOKEN": "sk-plus-yourname-xxxxxx",
    "ANTHROPIC_MODEL": "neosmith.intelligent-pro",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "neosmith.intelligent-pro",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "neosmith.intelligent-basic",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "neosmith.neolite",
    "ANTHROPIC_DEFAULT_FABLE_MODEL": "neosmith.intelligent-maestro"
  },
  "model": "opus",
  "advisorModel": "opus"
}
```

`on` **merges** into `~/.claude/settings.json` — your existing `permissions`, `hooks`, MCP config, and any env vars of your own are preserved. The pre-connect file is snapshotted to `~/.neosmith/snapshots/claude.bak`, and `off` restores it byte-for-byte unless you have edited the file since connecting, in which case it keeps your file and removes only the keys `on` printed as NeoSmith-managed. If the **Claude Code IDE extension** is installed in VS Code and/or Cursor, `on` also writes the `claudeCode.*` block into that editor's `settings.json`, snapshotted/restored the same way; `claudeCode.environmentVariables` is merged **by variable name** on the way in *and* unmerged by name on the way out, so entries you added yourself survive both. File mode `0600`.

### Codex

```toml
model = "neosmith.intelligent-pro"  # NeoSmith managed - see the block below
model_provider = "neosmith"  # NeoSmith managed - see the block below

# --------------------------------------------------------------------------
# NeoSmith managed block - please don't put your own settings in here.
# `neosmith codex off` deletes exactly these lines and puts back whatever was
# here before. Anything you add ELSEWHERE in this file is kept when you
# disconnect, so that is where your own settings belong.
# --------------------------------------------------------------------------
[model_providers.neosmith]
name = "NeoSmith"
base_url = "https://router.neosmith.ai/v1"
env_key = "OPENAI_API_KEY"
wire_api = "responses"
```

Your other providers, top-level settings and comments are merged around that block, not replaced. `off` removes exactly the marked lines and restores the `model` / `model_provider` you had before — everything you added to the file since connecting, comments included, stays where you put it.

Codex reads the key from `$OPENAI_API_KEY` at runtime, so `on` also prints the export line for your shell profile:

```bash
export OPENAI_API_KEY=sk-plus-yourname-xxxxxx
export OPENAI_BASE_URL=https://router.neosmith.ai/v1
```

### Continue

```yaml
models:
  - name: NeoSmith
    provider: openai
    apiBase: https://router.neosmith.ai/v1
    model: neosmith.intelligent-pro
    apiKey: sk-plus-yourname-xxxxxx
```

Add `--autocomplete` to also route inline completions through `neosmith.intelligent-lite` (fast, low-cost, latency-sensitive): `neosmith continue on --autocomplete`.

### OpenCode

```json
{
  "provider": {
    "neosmith": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "NeoSmith",
      "options": {
        "baseURL": "https://router.neosmith.ai/v1",
        "apiKey": "sk-plus-yourname-xxxxxx"
      },
      "models": {
        "neosmith.intelligent-pro": { "name": "NeoSmith Pro", "limit": { "context": 1000000, "output": 128000 } }
      }
    }
  },
  "model": "neosmith/neosmith.intelligent-pro",
  "small_model": "neosmith/neosmith.neolite"
}
```

Every SKU is registered with its real context window, not just the one you wired — OpenCode cannot discover those (`GET /v1/models` returns ids only), and switching tiers inside OpenCode does not re-run `on`. `neolite` is the sealed 512K tier; the rest are 1M.

OpenCode reads `opencode.jsonc` in preference to `opencode.json` when both exist, and `.jsonc` legally contains comments and trailing commas. **A config this CLI cannot parse as strict JSON is never rewritten** — `on` snapshots it, prints the block, and leaves your file alone.

### OpenClaw

```json
{
  "models": {
    "providers": {
      "neosmith": {
        "baseUrl": "https://router.neosmith.ai/v1",
        "apiKey": "sk-plus-yourname-xxxxxx",
        "api": "openai-completions",
        "models": [
          { "id": "neosmith.intelligent-pro", "name": "NeoSmith Pro",
            "contextWindow": 1000000, "maxTokens": 128000,
            "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 } }
        ]
      }
    }
  },
  "agents": { "defaults": { "model": { "primary": "neosmith/neosmith.intelligent-pro" } } }
}
```

OpenClaw refuses to start on a config that does not match its schema — unknown keys, wrong types and invalid values are all fatal to the gateway, not merely ignored. So `on` writes exactly the documented keys and nothing else: no version stamp, no timestamps, no NeoSmith bookkeeping.

`~/.openclaw/openclaw.json` is **JSON5**. If yours has comments, trailing commas or unquoted keys, `on` will not rewrite it — it prints the equivalent `openclaw config set` / `openclaw models set` commands, which go through OpenClaw's own parser.

### Junie CLI

`~/.junie/models/` (or `$JUNIE_HOME/models/` if you have set it) — one file per custom model profile, where the filename stem *is* the profile id.

A Junie profile holds **one** model. There is no catalogue field the way OpenCode and OpenClaw have, so registering every NeoSmith tier means writing a file per tier. `neosmith junie on` writes five:

| Profile | Model |
|---|---|
| `custom:neosmith` | the tier you connected with (the alias) |
| `custom:neosmith-pro` | `neosmith.intelligent-pro` |
| `custom:neosmith-basic` | `neosmith.intelligent-basic` |
| `custom:neosmith-lite` | `neosmith.neolite` |
| `custom:neosmith-maestro` | `neosmith.intelligent-maestro` |

The alias means `--model custom:neosmith` keeps working whichever tier you wired; the four tier profiles let you switch inside Junie without re-running `on`. The list is generated from the manifest, so a new SKU shows up here automatically.

Each file looks like this (`neosmith-lite.json`):

```json
{
  "id": "neosmith.neolite",
  "displayName": "NeoSmith NeoLite",
  "providerName": "NeoSmith",
  "baseUrl": "https://router.neosmith.ai/v1/chat/completions",
  "apiType": "OpenAICompletion",
  "apiKey": "sk-plus-yourname-xxxxxx",
  "maxContextLength": 512000
}
```

`maxContextLength` is per profile and is the real window — 512K for NeoLite, 1M for the rest. The pro/basic/maestro profiles also carry `"fasterModel": { "id": "neosmith.neolite" }` for helper tasks; the lite profile does not, because a `fasterModel` pointing at its own primary is noise.

Two things are unlike every other harness here:

- **`baseUrl` is the full endpoint, not the `/v1` root.** That is Junie's contract — JetBrains' own example for a local model is `http://localhost:11434/v1/chat/completions`.
- **There is no persistent default for a custom profile.** Select it per run with `junie --model custom:neosmith`, or set `JUNIE_MODEL=custom:neosmith` — `on` prints the platform-correct way to do that (`setx` on Windows, an `export` in your rc file on POSIX).

`on` merges rather than replaces, so a `temperature` or `extraHeaders` you added to any of these profiles survives; `off` takes back only the fields NeoSmith wrote, removes each file outright if nothing of yours is left on it, and leaves every other profile in the directory alone. A profile that already existed at one of those names before you connected is restored byte-for-byte rather than deleted.

---

## Keys and storage

- `~/.neosmith/config.json` holds your key as a plaintext literal (mode `0600`). No OS keychain — the CLI stores all harness keys as `0600` literals, intentionally, so it's sandbox-friendly and works after a restart without prompting.
- Each file-writable harness bakes the key into its own config (also `0600`). **Codex** is the exception: it uses an `env_key` reference and reads `$OPENAI_API_KEY` at runtime. **Copilot Chat** is the other exception: the model entry is file-writable but the key goes into VS Code's OS-keychain SecretStorage.
- `neosmith keys` reprints what you have — every environment with a stored key, and which harness is holding which. Values are masked (`sk-plus-…f3a1`) until you pass `--reveal`; `--json` is there for scripting. A harness whose config holds a key that matches **none** of your stored keys is flagged, which is how you catch a harness still sitting on a rotated credential.
- `off` removes the harness-specific keys but leaves your stored key intact — re-run `<harness> on` to reconnect.
- `neosmith uninstall` disconnects every harness, then removes `~/.neosmith` (add `--all` to also remove the launcher).

**Accepted key formats:** `sk-plus-*` (Pro), `sk-std-*` (Basic), `sk-slm-*` (Lite), or a Cognito JWT starting with `eyJ`. The CLI does not gate on prefix — the router's `/whoami` is the authority on key validity.

To wipe the key: `neosmith uninstall --all`.

---

## Troubleshooting

Run `neosmith doctor` first — it gives one sentence per failed harness explaining what's wrong and a one-line fix below it.

| Symptom | Fix |
|---|---|
| Tool still uses the old model | Fully restart the harness. In Claude Code, exit and `claude --resume <id>` keeps the resumed session's original config — start a fresh `claude` instead. |
| `claude off` didn't restore my config | `off` restores from `~/.neosmith/snapshots/claude.bak` (created on the first `on` and never overwritten by later ones). If you deleted it, `off` falls back to the restore ledger in `~/.neosmith/state.json` and puts your prior values back; your other settings stay either way. |
| `off` didn't put my file back *exactly* | By design, if you edited it while connected. `off` only replaces the file wholesale when it is byte-identical to what `on` wrote; otherwise it keeps your version and removes just the NeoSmith keys, so your edits aren't lost. The untouched original is in `~/.neosmith/snapshots/` until `off` runs — `neosmith originals --export <dir>` copies it out first. |
| Codex: `400 Unknown model` | Use `neosmith.intelligent-pro`, not a `gpt-*` name. The router only knows NeoSmith SKUs and the Claude family ids. |
| Continue: `404` or no response | Ensure `apiBase` ends in `/v1` (the CLI does this for you; if you hand-edited `~/.continue/config.yaml`, check that line). |
| JetBrains / Cursor: `on` didn't change anything | These are UI-driven — `on` prints the exact values to paste. Look between the `──` banner and the `✓` line, then paste them into the tool's settings UI. |
| Cline: `on` wrote the file but nothing changed in the panel | Two causes. On Cline 3.x the provider lives in VS Code's extension state, so paste the values `on` printed instead. On 4.x, reload the Cline panel, then check `neosmith cline status` — if it says *NOT the active provider*, something switched `lastUsedProvider` after the connect; re-run `neosmith cline off && neosmith cline on`. |
| Cursor: wrote `cursor.models.*` to `settings.json`, nothing changed | Expected — Cursor ignores those keys (native BYOK is encrypted + server-synced, needs Pro/Ultra). Use the Settings → Models UI, or `neosmith claude on` + the Claude Code extension. |
| Copilot: `neosmith copilot status` says `models-written` forever | You haven't entered the key in VS Code yet. Copilot Chat → Models → Manage Language Models → pick NeoSmith → paste key. Then `neosmith copilot status --confirmed`. |
| macOS GUI app doesn't see the env vars | GUI apps read `~/.zprofile` (or `~/.zshenv`), not `~/.zshrc`. Launch the IDE from a terminal, or put the `export OPENAI_API_KEY=…` line in `~/.zprofile`. |
| Something else | `neosmith status` shows every harness's state + whether a key is stored; `neosmith doctor` round-trips each connected one. |

### The launcher isn't on my PATH

The installer adds `~/.local/bin` (POSIX) or `%USERPROFILE%\.neosmith\bin` (Windows) to your shell's rc file. Open a **new terminal** to pick up the change. If you still can't find it:

```bash
echo "$PATH" | tr ':' '\n' | grep '.local/bin'   # confirm path is there (POSIX)
which neosmith                                   # where it's looking
```

If `which neosmith` returns nothing, your `$HOME` differs between shells. Set `$HOME` consistently or symlink the launcher into a directory already on your path.

### The installer says `Node.js 18+ is required`

Install Node first (Homebrew on macOS: `brew install node`; Windows: `winget install OpenJS.NodeJS.LTS`; everywhere else: <https://nodejs.org/>), then re-run the installer.

### Windows note

The root `README.md` lists the native PowerShell installer (`irm … | iex`) as the first-path option — that's the simplest. Git Bash and the manual git-clone flow both work too. For PowerShell-specific pitfalls (`curl` = `Invoke-WebRequest`, env-var launch behavior, `curl.exe` vs `curl` alias), see [site/platforms/windows-native.md](https://github.com/Neosmith-ai/neosmith-connect/blob/main/site/platforms/windows-native.md); for WSL2, see [site/platforms/windows-wsl.md](https://github.com/Neosmith-ai/neosmith-connect/blob/main/site/platforms/windows-wsl.md).

---

## Upgrade and uninstall

```bash
# Upgrade — re-run the installer for your OS (see root README → Install paths).
# The installers are idempotent: they re-download a fresh tarball/zip and
# safely replace the CLI in place (~/.neosmith/cli), preserving your key.

# Or, if you installed via npx, just bump to latest:
npx @neosmithai/cli@latest login

# Uninstall — disconnect every harness, remove ~/.neosmith (+ launcher with --all):
neosmith uninstall --all
```

---

## Portal

Manage your key, rotate it, and see cap usage at **<https://router.neosmith.ai/me/login>**.

## Filing feedback or an issue

```bash
neosmith feedback                      # defaults to the Bug template
neosmith feedback bug "Tab autocomplete broken in Cursor"
neosmith feedback idea                 # opens the Enhancement template instead
neosmith feedback --no-open            # print the URL + body for headless / SSH use
```

Opens the right GitHub issue template in your default browser with a prefilled environment block (CLI/Node/OS version + router host — **never** your API key). Repo: <https://github.com/Neosmith-ai/neosmith-connect/issues>.

---

## Developing: the smoke gate

> Full development guide — building this package locally with `npm pack`,
> installing it as a customer would without publishing, testing against a
> throwaway HOME, and releasing — is in
> **[CONTRIBUTING.md](../../CONTRIBUTING.md)**.

Before pushing changes to the CLI, run the smoke suite — it runs every contract
test (verbose, named) **and** rehearses a real `claude on → status → off` cycle
against a throwaway HOME (never your real config), then drops everything into a
timestamped folder you can open and read:

```bash
npm run smoke        # full report + opens .smoke/<timestamp>/
npm run smoke:ci     # exit-code only, for CI / pre-push hooks
```

Each run writes `.smoke/<timestamp>/` with `SUMMARY.txt`, the named test list
(`contract-tests.txt`), the rehearsal console output (`rehearsal.log`), and the
actual settings files the CLI produced — `cli.settings.wired.json`,
`editor-wired.*.settings.json` (the injected `claudeCode.*` block), plus
before/after copies proving your settings are preserved and restored
byte-for-byte. Nothing outside `.smoke/<timestamp>/home/` is touched.

**When does it run?** Running it yourself is manual (`npm run smoke`). Two
safety nets sit on top:

- **Optional pre-push hook** — `npm run install-hook` (once) points
  `core.hooksPath` at the repo's `hooks/` dir; then `git push` runs
  `npm run smoke:ci` and blocks on failure. Override one push with
  `git push --no-verify`; remove with `git config --unset core.hooksPath`.
- **CI** — `.github/workflows/test.yml` runs the contract suite **and**
  `npm run smoke:ci` on every push/PR, across Linux/macOS/Windows × Node 18/20.
  So even without the local hook, an untested change can't merge green.

## License

MIT. Source: <https://github.com/Neosmith-ai/neosmith-connect> · Docs: <https://neosmith-ai.github.io/neosmith-connect/>
