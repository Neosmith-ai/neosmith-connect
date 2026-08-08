# NeoSmith Connect — User Guide

> Take any AI coding tool you already use and route it through the NeoSmith router. Same experience, ~60% lower inference cost. One CLI, one key, every major harness.

This guide is written **for the developer sitting at the terminal**, not the operator. It tells you what to type, what you'll see, and what to do if something goes wrong.

If you only have 60 seconds, jump to **[The 4-step flow](#the-4-step-flow)** below. Everything else is reference material.

---

## Before you start

You'll need three things:

1. **Node.js 18 or newer** on your machine (`node --version` should print `v18` or higher).
2. **A NeoSmith API key** — `sk-plus-…` (Pro, Opus-tier), `sk-std-…` (Basic, Sonnet-tier), or `sk-slm-…` (Lite, SLM-only). Get one from your team lead or email `contact-us@neosmith.ai`.
3. **At least one AI coding tool already installed** — Claude Code, Codex, Continue, Cline, JetBrains AI, Copilot Chat, Zed, or Cursor. (NeoSmith works alongside the tool you already use; it doesn't replace any of them.)

Supported platforms: macOS, Linux, Windows (use **Git Bash** for the installer — see the [Windows note](#windows-note)).

---

## The 4-step flow

### Step 1 — Install the CLI

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/Neosmith-ai/neosmith-connect/main/packages/cli/install.sh)"
```

**What you should see** (≈10 seconds):

```
  NeoSmith CLI installer

  Downloading NeoSmith CLI…
  Installing dependencies…
  ✓ Installed launcher → /Users/you/.local/bin/neosmith
  ✓ NeoSmith CLI ready

  Next steps:
    1. neosmith login            # paste your sk-plus-* / sk-std-* / sk-slm-* key
    2. neosmith claude on        # wire Claude Code (or: codex, continue, cline, jetbrains)
    3. neosmith claude status    # confirm it's connected
```

If the installer prints any line starting with **`Node.js 18+ is required`**, install Node first (Homebrew on macOS: `brew install node`; everywhere else: <https://nodejs.org/>).

Once the installer finishes, open a **new terminal** so the `PATH` change takes effect, then:

```bash
neosmith help
```

You should see a list of commands and harnesses. If you get `neosmith: command not found`, see [[#the-launcher-isnt-on-my-path]].

### Step 2 — Sign in with your key

```bash
neosmith login sk-plus-yourname-xxxxxx
```

`sk-plus-…` = Pro tier, `sk-std-…` = Basic, `sk-slm-…` = Lite. Paste your actual key where the placeholder is.

**What you should see:**

```
  ── NeoSmith · login ──

  ✓ key accepted
  ✓ verified against router.neosmith.ai
    dev:  yourname@yourorg
    tier: pro
    cap:  3 of 30 days used this cycle

  Next: connect a harness — e.g. neosmith claude on
  Supported: claude, codex, continue, cline, jetbrains. Run `neosmith help` for all.
```

What this did:

- Saved your key to `~/.neosmith/config.json` (mode `0600`, visible only to your user account).
- Round-tripped it against the router's `/whoami` so we know it actually works — not just that it's shaped right.

If you'd rather just keep the key in your shell, you can also do `export NEOSMITH_API_KEY=sk-plus-…` and skip this step. But the `[config.json]` path is what the rest of the commands expect.

### Step 3 — Connect a harness

Pick the tool you actually use. These are the four most common — see [[#every-supported-harness]] for the rest.

```bash
neosmith claude on      # Claude Code
neosmith codex on       # Codex
neosmith continue on    # Continue
neosmith cline on       # Cline
neosmith jetbrains on   # JetBrains AI
```

**What you should see** (example for Claude Code):

```
  ── NeoSmith · claude on ──

  ✓ wrote ~/.claude/settings.json
  Restart Claude Code for the change to take effect.
```

What this did:

- Snapshotted your pre-existing config to `~/.neosmith/snapshots/claude.bak` (the CLI keeps it byte-for-byte so `off` is fully reversible).
- Wrote the new config with NeoSmith's router URL and your key inside. If the file already had your favorite permissions, hooks, or MCP servers, those are preserved — the CLI only merges in the NeoSmith entries.
- Did **not** delete anything. Your existing key, settings, and shortcuts all stay where they were.

**Now fully quit and reopen Claude Code** (or whichever tool you wired). The new model only takes effect on a fresh session.

### Step 4 — Verify it works

```bash
neosmith status
```

**What you should see:**

```
  ── NeoSmith · status ──

  ✓ claude        on      model=neosmith.intelligent-pro
  ⨯ codex         off
  ⨯ continue      off
  ⨯ cline         off

  ✓ key stored (tier=pro, dev=yourname@yourorg)
```

`✓ claude   on   …` means your harness is wired up.

Then run a **comprehensive live probe** — this hits the router on your behalf to make sure the actual round-trip works, not just the config file:

```bash
neosmith doctor
```

**What you should see:**

```
  ── NeoSmith · doctor ──

  ✓  claude           pass (model=neosmith.intelligent-pro)
  ✓  codex            not connected (skipped)
  ✓  continue         not connected (skipped)
  ✓  cline            not connected (skipped)
  ✓  audit-log        no audit log yet

  All checks passed.
```

If your harness shows `pass`, you're done. Open the tool, send it any prompt, and you should get a normal response routed through NeoSmith.

---

## If your tool asks for the key through its UI (Copilot, Cline, JetBrains)

Some harnesses don't expose a config file the CLI can write to — their key is kept inside the tool's UI or its OS-keychain. For these, `neosmith <harness> on` writes what it can and then **prints the remaining manual step**. The exact step differs per harness:

### GitHub Copilot Chat (partial-UI — most common case)

**What `on` does for you:**

- Writes VS Code's `chatLanguageModels.json` with the NeoSmith provider entry (vendor, base URL `https://router.neosmith.ai/v1`, model IDs, tool calling + vision enabled).
- Sets the `apiKey` field to a VS Code **input-variable reference** — literally `${input:neosmithApiKey}` — because VS Code stores actual API keys in OS-keychain SecretStorage, not in the config file.

**What you have to do in VS Code:**

1. Restart VS Code (the `chatLanguageModels.json` change is read at extension activation).
2. Open the Copilot Chat panel → click the model picker → **Manage Language Models**.
3. Pick **"NeoSmith"**.
4. VS Code prompts *"Enter API key for NeoSmith"* → paste your `sk-plus-…` key.

The key prompt only triggers the **first time** you pick NeoSmith in the model picker. After that, VS Code stores it in the OS-keychain and asks no more.

**Confirming the manual step:**

```bash
neosmith copilot status        # will say: models registered; key not yet entered — open Copilot Chat → Models → Manage Language Models, pick NeoSmith, paste the key
# … after you paste the key in VS Code …
neosmith copilot status --confirmed     # flips state to "on"
```

Then `neosmith doctor` (or `neosmith status`) will report `copilot: on`.

### Cline (fully UI-driven)

```bash
neosmith cline on
```

`on` writes nothing — Cline stores provider config inside its extension, not in a file. It **prints** the exact values at the top of its output:

```
Open Cline's settings (gear icon in the Cline panel) and set:
  API Provider:  OpenAI Compatible
  Base URL:      https://router.neosmith.ai/v1
  API Key:       sk-plus-yourname-xxxxxx
  Model ID:      neosmith.intelligent-pro

Enable streaming + tool/function calling (required for Cline's agentic actions).
Save. Cline's plan/act/verify loops now run on NeoSmith.
```

Open the Cline panel → click the **gear icon** → paste each value → save. Done.

To disconnect later, run `neosmith cline off` then **switch Cline back** in the same settings UI (any provider that isn't NeoSmith, or remove the entry). NeoSmith also clears its local on-flag so `status` reports `off`.

### JetBrains AI Assistant (fully UI-driven)

```bash
neosmith jetbrains on
```

Same pattern as Cline — nothing is written to a file. `on` prints the values plus a per-feature model map:

```
Settings → Tools → AI Assistant → Providers & API Keys
  Provider:   OpenAI-compatible
  URL:        https://router.neosmith.ai/v1
  API Key:    sk-plus-yourname-xxxxxx
  Enable:     ✅ Tool calling

Then assign models per feature (Settings → Tools → AI Assistant → Models):
  Chat              → neosmith.intelligent-pro
  Inline completion → neosmith.intelligent-lite        (fast, low-cost)
  Commit message    → neosmith.intelligent-lite
  Test/doc gen      → neosmith.intelligent-basic       (Sonnet-tier)
```

**Works in:** IntelliJ, PyCharm, GoLand, WebStorm, Rider, CLion, DataGrip, RubyMine, RustRover, PhpStorm, and JetBrains Air.

### Quick reference table — where the key actually lives

| Harness | Config file? | Manual step? | Where the key ends up |
|---|---|---|---|
| Claude Code | yes (`~/.claude/settings.json`, 0600) | none | config file literal |
| Codex | yes (`~/.codex/config.toml`, 0600) | run the `export` line in your shell | env var (`$OPENAI_API_KEY`) |
| Continue | yes (`~/.continue/config.yaml`, 0600) | none | config file literal |
| **Copilot Chat** | yes (`chatLanguageModels.json`) | **yes — paste into VS Code picker** | **OS-keychain (SecretStorage)** |
| **Cline** | no | **yes — paste into Cline's settings UI** | Cline extension internal state |
| **JetBrains AI** | no | **yes — paste into IDE Settings** | IDE internal storage |
| Zed | yes (`~/.config/zed/settings.json`, 0600) | none | config file literal |
| **Cursor** | no | **yes — paste into Settings → Models (needs Cursor Pro/Ultra)** | Cursor's encrypted, server-synced BYOK store (not settings.json) |

The "Manual step?" column is the one that breaks first. Run `neosmith doctor` after the manual step — if a row says `models-written` (Copilot) or `UI-configured model=…` (Cline, JetBrains), you're fine; if it says anything else, the key didn't actually land in the tool's store.

---

## Day-to-day commands

Once you're set up, these are the only commands you'll reach for:

| You want… | Run |
|---|---|
| See which harnesses are connected | `neosmith status` |
| Live-check that the router works | `neosmith doctor` |
| Whoami / cap usage | `neosmith verify` |
| Switch Claude Code to a cheaper model | `neosmith claude off && neosmith claude on --model neosmith.intelligent-lite` |
| Disconnect a tool without losing your key | `neosmith claude off` |
| Switch tools (e.g. from Claude Code to Codex) | `neosmith claude off && neosmith codex on` |
| Rotate your API key | `neosmith login sk-plus-NEWKEY` (overwrites old one) |
| Completely uninstall | `neosmith uninstall --all` |

Every command supports `--help`. Run `neosmith help` or `neosmith <tool> help` to see options.

---

## Choosing a model tier

The default tier (`pro` / Opus-tier) routes cheap work to a distilled model and escalates to Claude Opus only when a task actually needs it. If you want to cap that:

| Tier | Command suffix | What you get |
|---|---|---|
| Pro (default) | *(nothing)* | SLM-first, escalates to Opus on hard tasks |
| Basic / Sonnet | `--model neosmith.intelligent-basic` | SLM-first with Sonnet fallback, **no Opus** |
| Lite / SLM-only | `--model neosmith.intelligent-lite` | Lowest cost, no frontier escalation |
| Maestro / Fable | `--model neosmith.intelligent-maestro` | Highest-accuracy agentic coding lane |

Examples:

```bash
neosmith claude on --model basic       # Sonnet-tier
neosmith claude on --model lite        # SLM-only
neosmith claude on --model maestro     # Fable-tier, highest-accuracy agentic
neosmith claude on --model claude-opus-4   # force Opus, no escalation
```

You can change tiers any time by re-running `on` with a new `--model`. The CLI updates only the model line; your other settings stay.

---

## Every supported harness

| # | Harness | What gets written | Do you need a restart? |
|---|---|---|---|
| 1 | **Claude Code** | `~/.claude/settings.json` (0600) | Yes — quit and reopen |
| 2 | **Codex** | `~/.codex/config.toml` (0600) + `export OPENAI_API_KEY=…` for your shell | Yes — restart Codex |
| 3 | **Continue** | `~/.continue/config.yaml` (0600) | Yes — reload VS Code window |
| 4 | **Cline** | *(none — Cline stores in its own extension state)* | Yes — paste values into Cline's gear-icon UI |
| 5 | **JetBrains AI** | *(none — JetBrains stores in IDE settings)* | Yes — paste into **Settings → Tools → AI Assistant → Providers & API Keys** |
| 6 | **Copilot Chat** | VS Code `chatLanguageModels.json` (key in OS-keychain) | Yes — reload window |
| 7 | **Zed** | `~/.config/zed/settings.json` (0600) | Yes — restart Zed |
| 8 | **Cursor** | *(none — native BYOK is UI-only, needs Cursor Pro/Ultra)* `on` prints the Settings → Models paste-in values | Yes — enter in Cursor → Settings → Models; for a scriptable path use `neosmith claude on` + the Claude Code extension |

Use `neosmith <harness> help` for per-harness notes (e.g. `--autocomplete` is a Continue-only flag).

---

## Troubleshooting

Run `neosmith doctor` first — it gives you one sentence per failed harness explaining what's wrong and a one-line fix below it.

### "Tool still uses the old model"

This is the most common one. Each tool reads its config at startup. If a session is already running, it has the **old** config cached.

Fix: fully quit the tool, reopen it. For Claude Code, run a fresh `claude` from the terminal — `claude --resume <id>` keeps the resumed session's original config.

### `claude off` didn't restore my config

`off` expects `~/.neosmith/snapshots/claude.bak` to exist (created the first time you ran `on`). If you deleted it, `off` will still strip the NeoSmith keys but your other settings won't be restored automatically.

Fix: re-run `on` again then `off` immediately — that creates a fresh snapshot, then restores it.

### Codex: `400 Unknown model`

You used a `gpt-*` id. **Don't.** Use `neosmith.intelligent-pro`. The router only knows NeoSmith SKUs and the Claude family ids.

### Continue: `404` or no response

Your `apiBase` is probably missing `/v1`. The CLI adds it automatically; if you hand-edited `~/.continue/config.yaml`, check the `apiBase:` line ends exactly with `/v1`.

### Cline / JetBrains: "`on` didn't change anything"

These two harnesses are **UI-driven** — Cline and JetBrains store their provider config in their own internal state, and there's no public config file. `on` prints the exact values (URL, key, model) at the top of its output. **You have to paste them into the tool's settings UI.** Look for the values between the `──` banner and the `✓` line.

### macOS GUI app doesn't see the env vars

macOS GUI apps don't read `~/.zshrc`. They read `~/.zshenv` (or `~/.zprofile`). If Codex asks you for `OPENAI_API_KEY` even after `on`, either:

- Launch the IDE from your terminal (`codex` from a shell that has the export), or
- Add the `export OPENAI_API_KEY=…` line to `~/.zshenv`.

### The launcher isn't on my PATH

The installer adds `~/.local/bin` to your shell's rc file. Open a **new terminal** to pick up the change. If you still can't find it:

```bash
echo "$PATH" | tr ':' '\n' | grep '.local/bin'   # confirm path is there
which neosmith                                   # where it's looking
```

If `which neosmith` returns nothing, your `$HOME` differs between shells. Set `$HOME` consistently or symlink `~/.local/bin/neosmith` into a directory already on your path.

### The installer says `Node.js 18+ is required`

Install Node first (Homebrew on macOS: `brew install node`; everywhere else: <https://nodejs.org/>), then re-run the installer.

### `npm error 403 403 Forbidden` during publish / internal

You're seeing a developer-side error, not a user-side one. See the operator note in <https://github.com/Neosmith-ai/neosmith-connect/blob/main/.github/workflows/publish.yml> — the token needs `Bypass 2FA` permission for the `@neosmithai` scope on npm.

### Something else not in this list

Run, in order:

```bash
neosmith status          # what's currently wired
neosmith verify          # does the key authenticate
neosmith doctor          # does each harness actually round-trip
```

If `doctor` still doesn't tell you what's wrong, file an issue with the **all three** outputs at <https://github.com/Neosmith-ai/neosmith-connect/issues>.

---

## Windows note

The curl-pipe-bash approach doesn't work cleanly in PowerShell because of line-ending issues. Two paths that work:

**Git Bash (recommended):**

```bash
bash -c "curl -fsSL https://raw.githubusercontent.com/Neosmith-ai/neosmith-connect/main/packages/cli/install.sh | bash"
```

**From an SSH-style checkout:**

```bash
mkdir -p ~/.neosmith && git clone https://github.com/Neosmith-ai/neosmith-connect.git ~/.neosmith/connect
bash ~/.neosmith/connect/packages/cli/install.sh
```

The installer also writes a `neosmith.cmd` shim alongside the bash launcher so `neosmith` works in `cmd.exe` and PowerShell.

---

## How your key is stored

Your key is stored as a **plaintext literal** (mode `0600` — readable only by your user account) in `~/.neosmith/config.json`. There is **no** OS-keychain integration. This is intentional: it makes the CLI sandbox-friendly and lets it work after a system restart without prompting.

For most harnesses, the literal is also baked into the tool's own config file (also mode `0600`). The exception is **Codex**, which uses an env-key reference (`env_key = "OPENAI_API_KEY"`) and reads `$OPENAI_API_KEY` at runtime — the CLI prints the `export` line for your shell profile so the next shell you open sees it.

To wipe the key, run `neosmith uninstall --all`.

---

## What's next

Once you're running:

- **Rotate your key** any time at <https://router.neosmith.ai/me/login>.
- **Re-run the installer** to upgrade — it's idempotent, it re-downloads a fresh tarball and overwrites `~/.neosmith/cli` cleanly.
- **Add another tool** — `neosmith codex on` after you've installed Codex, etc.
- **Read the developer guide** at <https://neosmith-ai.github.io/neosmith-connect/> for per-harness deep dives, the router contract, and the verifier model.
