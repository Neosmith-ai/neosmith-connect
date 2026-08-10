# Testing `neosmith-connect` against local and staging routers

A runbook for the two loops this repo supports:

- **Local** — you have `router_v4` running on your own machine. Free, fast,
  and the loop for developing a router change and a CLI change together.
- **Staging** — the shared `staging.router.neosmith.ai` deployment. Real
  infrastructure, real inference, small real cost.

Production is the default and needs no flag. Nothing here changes that.

---

## 0 · One-time concepts

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

## 1 · Local loop (no cloud, no cost)

### 1.1 Start the router

The router must run through the mirror layout: `app.py` mixes package imports
(`router_v4.app`) with flat ones (`bedrock_models`), so the package directory
itself has to be on `PYTHONPATH`. Running `uvicorn` from inside the checkout
fails with `ModuleNotFoundError: No module named 'bedrock_models'`.

**macOS / Linux / WSL:**

```bash
cd /path/to/router_v4
make serve-local          # mirrors, then serves :4008 with ENVIRONMENT=local
```

**Windows (PowerShell — the native path):**

```powershell
cd C:\neosmith-ai\projects\router_v4-cli-contract
.\scripts\serve-local.ps1
```

It mirrors with `robocopy /MIR` (the native equivalent of `rsync -a --delete`),
sets `ENVIRONMENT=local`, and serves on :4008. `-Port` and `-AdminDb` are
overridable; `-SkipMirror` re-serves without re-copying.

> ClickHouse `WinError 10061` warnings on startup are expected — there is no
> ClickHouse running locally, so spans simply are not exported.

**Windows (Git Bash — no `make`/`rsync`):**

```bash
REPO=/c/neosmith-ai/projects/router_v4
rm -rf /tmp/pkg/router_v4 && mkdir -p /tmp/pkg
cp -r "$REPO" /tmp/pkg/router_v4 && rm -rf /tmp/pkg/router_v4/.git

cd /tmp/pkg
NEOSMITH_ADMIN_DB=/tmp/neosmith-local-admin.db \
NEOSMITH_COOKIE_SECURE=0 \
NEOSMITH_ROUTER_URL=http://127.0.0.1:4008 \
ENVIRONMENT=local \
PYTHONPATH=/tmp/pkg/router_v4 \
python -m uvicorn router_v4.app:app --host 127.0.0.1 --port 4008
```

Confirm it is up and identifying itself correctly:

```bash
curl -s http://127.0.0.1:4008/health          # {"status":"ok",...}
```

Port **4008 is not arbitrary** — `harnesses.json` declares `local` as
`127.0.0.1:4008`, and host matching includes the port so the CLI does not
mistake an unrelated localhost service (an Ollama server on `:11434`, say) for
its own.

### 1.2 Mint a local key

```bash
cd /path/to/router_v4 && make local-key        # prints the raw token once
```

**Windows (PowerShell):**

```powershell
$env:LOCAL_KEY = .\scripts\local-key.ps1
```

Safe to run repeatedly — each run mints a new key with a millisecond-stamped
label. Labels must be unique within a dev's *active* key set, so a fixed label
makes the second run fail.

**Git Bash:**

```bash
cd /tmp/pkg
NEOSMITH_ADMIN_DB=/tmp/neosmith-local-admin.db PYTHONPATH=/tmp/pkg/router_v4 \
python -c "
import time
from router_v4.admin import store
store.upsert_org('local','Local Dev','dev@localhost')
raw,_ = store.mint_key('local','dev','slm','dev@localhost',
                       label='local-cli-%d' % (time.time()*1000))
print(raw)
"
```

Keep it in a shell variable: `export LOCAL_KEY=sk-slm-...`

### 1.3 Point the CLI at it

Always use a throwaway `HOME` while testing, so your real config is never
touched. On Windows set all of `HOME`, `USERPROFILE` and `APPDATA` — setting
only `HOME` leaves several paths pointing at your real profile.

**PowerShell:**

```powershell
$h = Join-Path $env:TEMP ("nsdev-" + [guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Force $h | Out-Null
$env:HOME = $h; $env:USERPROFILE = $h; $env:APPDATA = $h

cd C:\neosmith-ai\projects\neosmith-connect\packages\cli
node bin/neosmith.js --env local login $env:LOCAL_KEY
node bin/neosmith.js --env local verify       # hits /whoami
node bin/neosmith.js --env local models       # hits /v1/models
node bin/neosmith.js --env local status       # banner shows env=local
```

**Git Bash / macOS / Linux:**

```bash
export HOME=$(mktemp -d); export USERPROFILE="$HOME"; export APPDATA="$HOME"

cd /path/to/neosmith-connect/packages/cli
node bin/neosmith.js --env local login "$LOCAL_KEY"
node bin/neosmith.js --env local verify      # hits /whoami
node bin/neosmith.js --env local models      # hits /v1/models
node bin/neosmith.js --env local status      # banner shows env=local
```

### 1.4 Wire a harness and send a real prompt

```bash
node bin/neosmith.js --env local claude on
claude -p "Reply with exactly the word NEOSMITHOK"
node bin/neosmith.js claude off              # no --env needed; finds it anyway
```

Codex needs one extra step by design: `codex on` writes
`env_key = "OPENAI_API_KEY"` — a *name*, never the secret — so the key has to
be in the environment at runtime.

```bash
node bin/neosmith.js --env local codex on
export OPENAI_API_KEY="$LOCAL_KEY"           # `setx` on Windows does NOT
                                             # affect the current shell
codex exec "Reply with exactly the word NEOSMITHOK"
node bin/neosmith.js codex off
```

### 1.5 Or drive the whole thing automatically

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

Each run creates its own sandbox HOME, asserts `on` wrote the right thing,
sends a real prompt where the harness supports one, asserts `off` restores
byte-for-byte, and checks no key leaked into a harness config or the audit log.

---

## 2 · Offline loop (no router at all)

Everything above minus the router, using the contract-driven mock:

```bash
cd packages/cli && npm run e2e:offline    # all 8 harnesses, ~30s, zero cost
```

This also runs in CI on Linux, macOS and Windows. Real prompts are reported as
**skipped** — a canned response proves nothing about inference.

> If it fails with `mock router could not bind 127.0.0.1:4008`, you still have
> a real local router on that port. Stop it first.

---

## 3 · Staging loop

### 3.1 Get a staging key

Mint it against the **staging** admin database — via the staging admin portal,
or `admin/cli.py` pointed at that DB:

```bash
python -m router_v4.admin.cli mint-key --org <org> --dev <you> --tier slm
```

Use `--tier slm`. It is the cheapest tier, and `sk-slm-*` is one of the shapes
the CLI's audit-log redactor covers — a key shape that is accepted but not
redacted would leak into `~/.neosmith/audit.log`.

For a CI key, also set a spend ceiling so no bug can run up a bill:

```bash
python -m router_v4.admin.cli set-dev-cap --org <org> --dev ci-e2e --cap 2000000
```

### 3.2 Use it

Identical to the local loop, with `--env staging`:

```bash
export HOME=$(mktemp -d); export USERPROFILE="$HOME"; export APPDATA="$HOME"

neosmith --env staging login sk-slm-...
neosmith --env staging verify
neosmith --env staging claude on
claude -p "Reply with exactly the word NEOSMITHOK"
neosmith claude off
```

### 3.3 Confirm you reached the environment you asked for

```bash
curl -s -H "Authorization: Bearer $STAGING_KEY" \
  https://staging.router.neosmith.ai/whoami | grep environment
# "environment": "staging"
```

The router reports which deployment answered. A stale DNS entry, a corporate
proxy, or a `NEOSMITH_BASE_URL` left exported in a shell all return a healthy
`200` from the *wrong* environment, and no amount of client-side hostname
matching can detect that.

### 3.4 Full real-harness run in CI

```bash
gh workflow run e2e-staging.yml            # macOS + Windows, real binaries
gh run watch
```

Requires a `NEOSMITH_STAGING_KEY` repo secret. It ships
`workflow_dispatch`-only; enable the `schedule` and label-gated
`pull_request` triggers (commented at the top of the file) after three
consecutive green manual runs on both OSes.

---

## 4 · Deploying a change

### 4.1 A router change

1. `make smoke` locally — now includes `test_cli_contract.py`.
2. If you changed a response shape, header, status code or SKU, update
   `contract/router-contract.v1.json` **and** re-vendor it:
   ```bash
   cp contract/router-contract.v1.json \
      ../neosmith-connect/packages/cli/contract/
   ```
   Both copies must be byte-identical or the gate fails.
3. Open the PR. `deploy.yml` runs the **CLI compatibility gate**: contract
   sync, `test_cli_contract.py`, and the real CLI driving a locally-booted
   candidate router. You get the signal at review time; nothing deploys.
4. Merge to `main` → automatic staging deploy (the gate must be green).
5. Verify staging, then promote:
   `gh workflow run deploy-prod.yml -f image_tag=<tag>`

**Breaking changes are sequenced, never simultaneous.** The gate reads
`neosmith-connect@main`, so a change needing edits in both repos at once cannot
land. Instead: router ships an additive minor → CLI adopts → router removes the
old behavior in a later major. For a genuinely coordinated change,
`contract/connect-ref.txt` points the gate at an unmerged CLI branch while both
are in review; it must read `main` before merge.

### 4.2 A CLI change

1. `npm test && npm run smoke && npm run e2e:offline`
2. If it touches the router surface, run the local loop (§1) against a
   candidate router.
3. Open the PR — `test.yml` runs 3 OSes × Node 18/20 plus the tarball job.
4. Merge, bump `packages/cli/package.json`, tag:
   ```bash
   git tag v0.9.0 && git push origin v0.9.0
   ```
   Publishing is tag-driven; never `npm publish` from a laptop. A
   `-rc`/`-beta`/`-alpha` tag publishes to the `next` dist-tag instead of
   `latest`.

---

## 5 · Troubleshooting

| Symptom | Cause |
|---|---|
| `Unknown environment 'stagng'` | Typo. The error lists the valid names; a typo never falls back to production. |
| `No key found for env=staging` | You are logged into production only. Keys are per environment — run `neosmith --env staging login`. |
| `... is already connected to NeoSmith prod` | Cross-environment re-point. Run `off` first, or pass `--force`. |
| `NEOSMITH_BASE_URL=... overrides --env staging` | A stale `NEOSMITH_BASE_URL` is exported in your shell. `unset` it. |
| `ModuleNotFoundError: bedrock_models` | You ran the router from inside its checkout. Use the mirror layout (§1.1). |
| `mock router could not bind 127.0.0.1:4008` | A real local router is already on that port. |
| `neosmith models` disagrees with `--model` | Contract drift. `npm run test:router-facing` names the mismatch. |
| Harness reads the wrong config in an e2e run | `CODEX_HOME` / `CLAUDE_CONFIG_DIR` outrank `HOME`. `scripts/e2e/run.js` sets both; a hand-rolled test must too. |
| `make: The term 'make' is not recognized` | Windows has no `make`. Use `.\scripts\serve-local.ps1`, and check you are in the **`router_v4-cli-contract`** worktree — the original `router_v4` checkout does not have these targets. |
| `already has an active key labeled ...` | You pinned a fixed `-Label`. Omit it; the default is millisecond-stamped and re-runnable. |
| ClickHouse `WinError 10061` when the router starts | Expected locally — no ClickHouse is running, so spans are not exported. Harmless. |
