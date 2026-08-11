# Testing NeoSmith locally and on staging

A runbook for the two loops this repo supports:

- **Local** — you have `router_v4` running on your own machine. Free, fast, and the loop for developing a router change and a CLI change together.
- **Staging** — the shared `staging.router.neosmith.ai` deployment. Real infrastructure, real inference, small real cost.

Production is the default and needs no flag. Nothing here changes that.

---

## 0 · One-time concepts (read once)

**Environments are named.** `harnesses.json` declares `prod`, `staging` and
`local`; `--env <name>` or `NEOSMITH_ENV` picks one. `NEOSMITH_BASE_URL=<url>`
still works for an address with no name (a branch deploy, an ephemeral test
port) — it outranks `--env` and prints a warning saying so.

**Keys are stored per environment.** `~/.neosmith/config.json` holds
`{ api_key, keys: { prod, staging, local } }`. A staging key can never reach
the legacy `api_key` slot that production invocations and `install.sh` read, so
you can be logged into all three at once.

**`off` is environment-blind on purpose.** It removes wiring for *any* known
environment. If it only matched the active one, `neosmith claude off` after a
staging connect would report "nothing to disconnect" and silently leave you on
staging.

**`on` refuses to re-point across environments** without `--force`. The
snapshot and restore ledger are write-once, so re-pointing would strand your
pre-NeoSmith baseline and leave `off` unable to restore either environment.

---

## 1 · Pick your shell

Every procedure step in §2 and §4 below is presented twice: once under
**On Windows (PowerShell)** and once under **On macOS / Linux (bash)**.
Each block contains only that shell's syntax — a Windows reader opens only
the Windows blocks, a macOS reader opens only the bash blocks. §3 (offline
loop) and §5 (release checklist) are shell-neutral and without that split.

> **Heads up — Windows users.** `claude`, `codex`, etc. are read from your
> PATH. If you previously installed the neosmith CLI globally via npm and
> ran `neosmith uninstall`, the npm-global shim at
> `C:\Users\<you>\AppData\Roaming\npm\neosmith.ps1` is what `npm` itself
> owns; the in-CLI `uninstall [--all]` cannot remove it. Run
> `npm uninstall -g @neosmithai/cli` separately if needed.

---

## 2 · Local loop (no cloud, no cost)

### 2.1 · Start the router

The router must run through the mirror layout: `app.py` mixes package imports
(`router_v4.app`) with flat ones (`bedrock_models`), so the package directory
itself has to be on `PYTHONPATH`. Running `uvicorn` from inside the checkout
fails with `ModuleNotFoundError: No module named 'bedrock_models'`.

Port **4008 is not arbitrary** — `harnesses.json` declares `local` as
`127.0.0.1:4008`, and host matching includes the port so the CLI does not
mistake an unrelated localhost service (an Ollama server on `:11434`, say) for
its own.

#### On Windows (PowerShell)

You must be in the **`router_v4-cli-contract`** worktree, not the original
`router_v4` checkout — the `serve-local.ps1` / `local-key.ps1` scripts live
only there.

```powershell
cd C:\neosmith-ai\projects\router_v4-cli-contract
.\scripts\serve-local.ps1
```

`serve-local.ps1` mirrors with `robocopy /MIR` (the native equivalent of
`rsync -a --delete`), sets `ENVIRONMENT=local`, and serves on `:4008`. `-Port`
and `-AdminDb` are overridable; `-SkipMirror` re-serves without re-copying.
`Ctrl-C` to stop.

> ClickHouse `WinError 10061` warnings on startup are expected — there is no
> ClickHouse running locally, so spans are simply not exported.

#### On macOS / Linux (bash)

```bash
cd /path/to/router_v4
make serve-local          # mirrors, then serves :4008 with ENVIRONMENT=local
```

### 2.2 · Mint a key

Safe to run repeatedly — each run mints a new key with a
millisecond-stamped label. Labels must be unique within a dev's *active* key
set, so a fixed label makes the second run fail.

#### On Windows (PowerShell)

```powershell
cd C:\neosmith-ai\projects\router_v4-cli-contract
$env:LOCAL_KEY = .\scripts\local-key.ps1
# now $env:LOCAL_KEY contains the raw token (sk-slm-...)
```

#### On macOS / Linux (bash)

```bash
cd /path/to/router_v4
LOCAL_KEY=$(make local-key)          # raw token printed once, captured
export LOCAL_KEY
```

### 2.3 · Throwaway HOME

Always use a throwaway `HOME` while testing, so your real config is never
touched. On Windows, set all three of `HOME`, `USERPROFILE` and `APPDATA` —
setting only `HOME` leaves several paths pointing at your real profile.

#### On Windows (PowerShell)

```powershell
$h = Join-Path $env:TEMP ("nsdev-" + [guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Force $h | Out-Null
$env:HOME = $h; $env:USERPROFILE = $h; $env:APPDATA = $h
```

#### On macOS / Linux (bash)

```bash
export HOME=$(mktemp -d); export USERPROFILE="$HOME"; export APPDATA="$HOME"
```

### 2.4 · Point the CLI at it and verify

The `node` calls are shell-neutral. Only the env-var reference syntax differs.

#### On Windows (PowerShell)

`$env:LOCAL_KEY` was set in step 2.2; `$env:HOME`, `$env:USERPROFILE`,
`$env:APPDATA` were set in step 2.3.

```powershell
cd C:\neosmith-ai\projects\neosmith-connect\packages\cli
node bin/neosmith.js --env local login $env:LOCAL_KEY
node bin/neosmith.js --env local verify       # hits /whoami
node bin/neosmith.js --env local models       # hits /v1/models
node bin/neosmith.js --env local status       # banner shows env=local
```

#### On macOS / Linux (bash)

`$LOCAL_KEY` was set in step 2.2; `$HOME`, `$USERPROFILE`, `$APPDATA` were
set in step 2.3.

```bash
cd /path/to/neosmith-connect/packages/cli
node bin/neosmith.js --env local login "$LOCAL_KEY"
node bin/neosmith.js --env local verify      # hits /whoami
node bin/neosmith.js --env local models      # hits /v1/models
node bin/neosmith.js --env local status      # banner shows env=local
```

### 2.5 · Wire a harness and send a real prompt

#### On Windows (PowerShell)

```powershell
node bin/neosmith.js --env local claude on
claude -p "Reply with exactly the word NEOSMITHOK"
node bin/neosmith.js claude off              # no --env needed; finds it anyway
```

#### On macOS / Linux (bash)

```bash
node bin/neosmith.js --env local claude on
claude -p "Reply with exactly the word NEOSMITHOK"
node bin/neosmith.js claude off              # no --env needed; finds it anyway
```

Codex needs one extra step by design: `codex on` writes
`env_key = "OPENAI_API_KEY"` — a *name*, never the secret — so the key has to
be in the environment at runtime.

#### On Windows (PowerShell)

`setx` writes to the user registry and only takes effect in **future**
PowerShell sessions. It does not affect the current shell — use `$env:` here.

```powershell
node bin/neosmith.js --env local codex on
$env:OPENAI_API_KEY = $env:LOCAL_KEY         # current session only;
                                             # `setx` does NOT apply here
codex exec "Reply with exactly the word NEOSMITHOK"
node bin/neosmith.js codex off
```

#### On macOS / Linux (bash)

```bash
node bin/neosmith.js --env local codex on
export OPENAI_API_KEY="$LOCAL_KEY"
codex exec "Reply with exactly the word NEOSMITHOK"
node bin/neosmith.js codex off
```

### 2.6 · Drive the whole thing automatically

The `scripts/e2e/run.js` driver creates its own sandbox HOME (you do **not**
need step 2.3 here), asserts `on` wrote the right thing, sends a real prompt
where the harness supports one, asserts `off` restores byte-for-byte, and
checks no key leaked into a harness config or the audit log.

#### On Windows (PowerShell)

The harness resolves the real `neosmith` binary on your PATH. To exercise
this checkout specifically, pass `--cli-script "$PWD\bin\neosmith.js"`.

```powershell
cd C:\neosmith-ai\projects\neosmith-connect\packages\cli
$env:NEOSMITH_E2E_KEY = $env:LOCAL_KEY

node scripts/e2e/run.js --harness codex --env local `
  --cli-script "$PWD\bin\neosmith.js"

# every harness, one after another
claude, codex, continue, zed, copilot, cline, jetbrains, cursor |
  ForEach-Object {
    node scripts/e2e/run.js --harness $_ --env local `
      --cli-script "$PWD\bin\neosmith.js"
  }
```

#### On macOS / Linux (bash)

```bash
cd /path/to/neosmith-connect/packages/cli
export NEOSMITH_E2E_KEY="$LOCAL_KEY"

node scripts/e2e/run.js --harness codex --env local \
  --cli-script "$PWD/bin/neosmith.js"

# every harness, one after another
for h in claude codex continue zed copilot cline jetbrains cursor; do
  node scripts/e2e/run.js --harness "$h" --env local --cli-script "$PWD/bin/neosmith.js"
done
```

---

## 3 · Offline loop (no router at all)

Runs identically on Windows and macOS. The contract-driven mock serves
`127.0.0.1:4008`, so the CLI recognizes it as `local` exactly the way it
recognizes a real local router.

```bash
cd packages/cli && npm run e2e:offline    # all 8 harnesses, ~30s, zero cost
```

This also runs in CI on Linux, macOS and Windows. Real prompts are reported as
**skipped** — a canned response proves nothing about inference.

> If it fails with `mock router could not bind 127.0.0.1:4008`, you still have
> a real local router on that port (you started one in §2.1). Stop it first.

---

## 4 · Staging loop

**No `router_v4` checkout, no `admin/cli.py`, no local mirror, no deploy.** The
staging deployment is already up at `https://staging.router.neosmith.ai`; the
CLI's `--env staging` resolves to that URL via `harnesses.json`. Everything in
this section runs against the public staging host from your laptop.

The only thing you cannot skip is a **staging key**.

### 4.1 · Get a staging key

Three ways in, pick one:

**(a) You already have a staging key** — skip to §4.2.

**(b) Your org uses Cognito SSO.** Open
<https://staging.router.neosmith.ai/me/login> in a browser, sign in with your
corporate email. The portal claims you to your org automatically (append
`?org=your-org` if your admin gave you a specific org ID). Whether it issues a
key on first sign-in depends on your org's policy — for most NeoSmith orgs a
key is generated on first login and shown once.

**(c) No key and no SSO — you need an admin to mint one.** This is the case for
most first-time testers. Ask a NeoSmith engineer to run this from a
`router_v4` checkout (not your laptop):

```bash
# on the engineer's machine, from a router_v4 checkout:
python -m router_v4.admin.cli mint-key --org <org> --dev <you> --tier slm
```

They paste the resulting `sk-slm-...` back to you. Use `--tier slm`: it is the
cheapest tier, and `sk-slm-*` is one of the shapes the CLI's audit-log
redactor covers — a key shape that is accepted but not redacted would leak
into `~/.neosmith/audit.log`.

For a key that will be used in CI (the `NEOSMITH_STAGING_KEY` repo secret, or
anything else that runs unattended), also set a spend ceiling so no bug can
run up a bill:

```bash
# on the engineer's machine, from a router_v4 checkout:
python -m router_v4.admin.cli set-dev-cap --org <org> --dev ci-e2e --cap 2000000
```

> **Windows users:** the `python -m router_v4.admin.cli …` lines above are run
> by the engineer on *their* machine — they need a `router_v4` checkout and a
> working mirror layout, which is exactly what §2.1's PowerShell block sets
> up. You do not run these yourself.

### 4.2 · Use it

Identical to §2 in shape; only `--env staging` instead of `--env local`, and
the key is the one you got in §4.1 (from SSO sign-in, or from an admin).

#### On Windows (PowerShell)

```powershell
$h = Join-Path $env:TEMP ("nsdev-" + [guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Force $h | Out-Null
$env:HOME = $h; $env:USERPROFILE = $h; $env:APPDATA = $h
$env:STAGING_KEY = "<the staging key from §4.1 — pasted to you by an admin, or shown after SSO sign-in>"

cd C:\neosmith-ai\projects\neosmith-connect\packages\cli
node bin/neosmith.js --env staging login $env:STAGING_KEY
node bin/neosmith.js --env staging verify
node bin/neosmith.js --env staging claude on
claude -p "Reply with exactly the word NEOSMITHOK"
node bin/neosmith.js claude off
```

#### On macOS / Linux (bash)

```bash
export HOME=$(mktemp -d); export USERPROFILE="$HOME"; export APPDATA="$HOME"
export STAGING_KEY="sk-slm-..."   # the key from §4.1 — pasted to you by an admin, or shown after SSO sign-in

cd /path/to/neosmith-connect/packages/cli
neosmith --env staging login "$STAGING_KEY"
neosmith --env staging verify
neosmith --env staging claude on
claude -p "Reply with exactly the word NEOSMITHOK"
neosmith claude off
```

### 4.3 · Confirm you reached the environment you asked for

The router reports which deployment answered. A stale DNS entry, a corporate
proxy, or a `NEOSMITH_BASE_URL` left exported in a shell all return a healthy
`200` from the *wrong* environment, and no amount of client-side hostname
matching can detect that. Same on Windows and macOS:

```bash
curl -s -H "Authorization: Bearer $STAGING_KEY" \
  https://staging.router.neosmith.ai/whoami | grep environment
# "environment": "staging"
```

### 4.4 · Full real-harness run in CI (optional)

The steps in §4.2 already cover the local verification path. Use this only if
you want to drive the *packaged* CLI (the npm tarball, not the checkout) on
the real Claude Code and Codex binaries, on both macOS and Windows runners,
with the same gating CI uses:

```bash
gh workflow run e2e-staging.yml            # macOS + Windows, real binaries
gh run watch
```

Requires a `NEOSMITH_STAGING_KEY` repo secret. It ships
`workflow_dispatch`-only; enable the `schedule` and label-gated
`pull_request` triggers (commented at the top of the file) after three
consecutive green manual runs on both OSes.

---

## 5 · Pre-NPM release checklist

Same on Windows and macOS — this is a sequence of npm + node + git commands,
no shell-specific syntax.

```bash
cd packages/cli
npm install --omit=dev --no-fund --no-audit   # CI parity sanity

# 1. The part that catches almost everything
npm test                 # node scripts/run-contract.js  — all *.test.js files
npm run smoke            # node scripts/smoke.js         — full rehearsal
npm run e2e:offline      # node scripts/e2e/offline.js   — all 8 harnesses

# 2. If you changed the router surface (response shape, header, status code,
#    SKU), run the local loop against a candidate router — see §2.

# 3. Open the PR.
gh pr create --draft     # or your usual flow
    # test.yml runs 3 OSes × Node 18/20 plus the install-tarball job.

# 4. Merge → bump the version → tag. Publishing is tag-driven; NEVER
#    `npm publish` from a laptop.
npm version 0.9.1 -m "release: %s — see CHANGELOG"
git push --follow-tags
```

`-rc` / `-beta` / `-alpha` tags publish to the `next` dist-tag instead of
`latest`.

---

## 6 · Troubleshooting

### 6.1 · Both OSes

| Symptom | Cause |
|---|---|
| `Unknown environment 'stagng'` | Typo. The error lists the valid names; a typo never falls back to production. |
| `No key found for env=staging` | You are logged into production only. Keys are per environment — run `neosmith --env staging login`. |
| `... is already connected to NeoSmith prod` | Cross-environment re-point. Run `off` first, or pass `--force`. |
| `NEOSMITH_BASE_URL=... overrides --env staging` | A stale `NEOSMITH_BASE_URL` is exported in your shell. `unset NEOSMITH_BASE_URL`. |
| `mock router could not bind 127.0.0.1:4008` | A real local router is already on that port (you started one in §2.1). Stop it first. |
| `neosmith models` disagrees with `--model` | Contract drift. `npm run test:router-facing` names the mismatch. |
| Harness reads the wrong config in an e2e run | `CODEX_HOME` / `CLAUDE_CONFIG_DIR` outrank `HOME`. `scripts/e2e/run.js` sets both; a hand-rolled test must too. |
| `already has an active key labeled ...` | You pinned a fixed `-Label`. Omit it; the default is millisecond-stamped and re-runnable. |

### 6.2 · Windows (PowerShell)

| Symptom | Cause |
|---|---|
| `make: The term 'make' is not recognized` | Windows has no `make`. Use `.\scripts\serve-local.ps1` instead, and check you are in the **`router_v4-cli-contract`** worktree — the original `router_v4` checkout does not have these targets. |
| ClickHouse `WinError 10061` when the router starts | Expected locally — no ClickHouse is running, so spans are not exported. Harmless. |
| `setx OPENAI_API_KEY …` "worked" but the current shell doesn't see it | `setx` only writes to the user registry. The current shell cannot be retro-updated. Use `$env:OPENAI_API_KEY = "…"` in the active shell, then open a new shell if you really need `setx`. |
| `neosmith` still answers after running `neosmith uninstall [--all]` | The in-CLI uninstall removes the curl-pipe artifacts (`~/.neosmith/`, `~/.local/bin/neosmith`) but **not** an `npm install -g`-installed copy — npm owns those shims. Run `npm uninstall -g @neosmithai/cli` separately, and reopen PowerShell so the shim cache is flushed. |

### 6.3 · macOS / Linux (bash)

| Symptom | Cause |
|---|---|
| `ModuleNotFoundError: bedrock_models` | You ran the router from inside its checkout. Use the mirror layout (`make serve-local` does this for you) — see §2.1. |
| `mktemp -d`-created `$HOME` is missing on the next shell line | `$(mktemp -d)` ran in a subshell. `export HOME=$(mktemp -d)` keeps it in the current shell; the bare command without `export` does not. |
| `claude` / `codex` resolves to the old install in `/usr/local/bin` … | Your path puts `/usr/local/bin` ahead of `~/.local/bin`. The neosmith connector does not need anything in `/usr/local/bin`; remove the stale copy there. |
