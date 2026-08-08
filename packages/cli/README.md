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
    2. neosmith claude on        # wire Claude Code (or: codex, continue, cline, jetbrains, …)
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
  Supported: claude, codex, continue, cline, jetbrains. Run `neosmith help` for all.
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

Swap `claude` for any harness: `codex`, `continue`, `cline`, `jetbrains`, `copilot`, `zed`, `cursor`. For the UI-driven ones (`cline`, `jetbrains`, `cursor`), `on` prints the exact values to paste into the tool's settings — see [UI-driven harnesses](#ui-driven-harnesses-copilot-cline-jetbrains-cursor) below.

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
| `neosmith <harness> off` | Restore a harness's pre-connect config (byte-for-byte for file-writable harnesses). |
| `neosmith <harness> status` | Show one harness's on/off state + model. |
| `neosmith status` | Show all harnesses + stored key, and which of your settings files are backed up. |
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
| **Continue** | `neosmith continue` | `~/.continue/config.yaml` (0600) | `apiKey` literal (0600) | Reload VS Code window |
| **Cline** | `neosmith cline` | *(none — UI-driven)* | Cline extension storage | Paste into Cline's gear-icon UI |
| **JetBrains AI** | `neosmith jetbrains` | *(none — UI-driven)* | JetBrains IDE storage | Paste into Settings UI |
| **Copilot Chat** | `neosmith copilot` | VS Code `chatLanguageModels.json` (key in OS-keychain) | OS-keychain (SecretStorage) | Reload window; paste key in picker once |
| **Zed** | `neosmith zed` | `~/.config/zed/settings.json` (0600) | literal (0600) | Restart Zed |
| **Cursor** | `neosmith cursor` | *(none — native BYOK is UI-only, needs Cursor Pro/Ultra)* | Cursor's encrypted, server-synced BYOK store (not `settings.json`) | Enter in Cursor → Settings → Models; or use `neosmith claude on` + the Claude Code extension |

Every harness supports `on`, `off`, `status`, and `help`. `off` restores your pre-connect configuration — file-based harnesses **byte-for-byte** from a snapshot under `~/.neosmith/snapshots/`, and the UI-driven ones by clearing the on-flag and telling you what to switch back in the IDE.

### Your existing settings are merged, never clobbered

For every file-writable harness:

- **`on` merges.** Variables you defined yourself are left exactly as they are. Only the NeoSmith-owned keys are added or overwritten — including inside list-shaped settings like `claudeCode.environmentVariables`, which is merged **by variable name**, so your own `HTTPS_PROXY` (or anything else) stays put.
- **The pre-connect snapshot is taken once.** Re-running `on` — to switch tiers with `--model`, or just by accident — refreshes the config but never overwrites the baseline captured the first time. `off` therefore restores what you had *before you ever connected*, not what the previous `on` left behind.
- **`off` restores, it doesn't just delete.** Alongside the snapshot, `on` records each key's prior value in `~/.neosmith/state.json`. If the snapshot is gone (you cleaned `~/.neosmith`, or moved machines), `off` replays that ledger: your values come back and only the keys NeoSmith introduced are removed.

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

### UI-driven harnesses (Copilot, Cline, JetBrains, Cursor)

Some harnesses don't expose a config file the CLI can write to — their key lives inside the tool's UI or its OS-keychain. For these, `neosmith <harness> on` writes what it can and **prints the remaining manual step**.

**GitHub Copilot Chat** (partial-UI): `on` writes `chatLanguageModels.json` with the NeoSmith provider entry, but sets `apiKey` to `${input:neosmithApiKey}` because VS Code stores real keys in OS-keychain SecretStorage. You then restart VS Code → Copilot Chat → model picker → **Manage Language Models** → pick **NeoSmith** → paste your key when prompted. Confirm with `neosmith copilot status --confirmed`. `neosmith copilot status` reports three states: `off` / `models-written` (key not yet entered) / `on` (confirmed).

**Cline** (fully UI-driven): `on` writes nothing. It prints:

```
Open Cline's settings (gear icon in the Cline panel) and set:
  API Provider:  OpenAI Compatible
  Base URL:      https://router.neosmith.ai/v1
  API Key:       sk-plus-yourname-xxxxxx
  Model ID:      neosmith.intelligent-pro

Enable streaming + tool/function calling (required for Cline's agentic actions).
```

Open the Cline panel → gear icon → paste each value → save.

**JetBrains AI Assistant** (fully UI-driven): `on` prints the values to paste into **Settings → Tools → AI Assistant → Providers & API Keys** (OpenAI-compatible, URL `https://router.neosmith.ai/v1`, tool calling enabled), plus the recommended per-feature model assignments (Chat → pro, inline/commit → lite, test/doc → basic). Works in IntelliJ, PyCharm, GoLand, WebStorm, Rider, CLion, DataGrip, RubyMine, RustRover, PhpStorm, and JetBrains Air.

**Cursor** (fully UI-driven, Pro-gated): Cursor's native BYOK **cannot** be set from `settings.json` — it lives in an encrypted, server-synced store and custom OpenAI endpoints require **Cursor Pro/Ultra**. `on` prints the Settings → Models paste-in values (OpenAI API Key, Override Base URL → `…/v1`, the NeoSmith SKUs to Add + Verify). The fully scriptable alternative — no Pro license needed — is `neosmith claude on` plus the Claude Code extension in Cursor.

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

`on` **merges** into `~/.claude/settings.json` — your existing `permissions`, `hooks`, MCP config, and any env vars of your own are preserved. The pre-connect file is snapshotted to `~/.neosmith/snapshots/claude.bak` so `off` restores it byte-for-byte. If the **Claude Code IDE extension** is installed in VS Code and/or Cursor, `on` also writes the `claudeCode.*` block into that editor's `settings.json`, snapshotted/restored the same way; `claudeCode.environmentVariables` is merged **by variable name**, so entries you added yourself survive. File mode `0600`.

### Codex

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

---

## Keys and storage

- `~/.neosmith/config.json` holds your key as a plaintext literal (mode `0600`). No OS keychain — the CLI stores all harness keys as `0600` literals, intentionally, so it's sandbox-friendly and works after a restart without prompting.
- Each file-writable harness bakes the key into its own config (also `0600`). **Codex** is the exception: it uses an `env_key` reference and reads `$OPENAI_API_KEY` at runtime. **Copilot Chat** is the other exception: the model entry is file-writable but the key goes into VS Code's OS-keychain SecretStorage.
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
| Codex: `400 Unknown model` | Use `neosmith.intelligent-pro`, not a `gpt-*` name. The router only knows NeoSmith SKUs and the Claude family ids. |
| Continue: `404` or no response | Ensure `apiBase` ends in `/v1` (the CLI does this for you; if you hand-edited `~/.continue/config.yaml`, check that line). |
| Cline / JetBrains / Cursor: `on` didn't change anything | These are UI-driven — `on` prints the exact values to paste. Look between the `──` banner and the `✓` line, then paste them into the tool's settings UI. |
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
