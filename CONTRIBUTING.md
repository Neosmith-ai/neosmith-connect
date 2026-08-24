# Contributing to NeoSmith Connect

Development guide for the monorepo — how to build the CLI package locally, test
it exactly as a customer would receive it, and get your change merged.

For *using* the CLI, see [`packages/cli/README.md`](packages/cli/README.md).

- [Prerequisites](#prerequisites)
- [Repo layout](#repo-layout)
- [Build the complete npm package locally](#build-the-complete-npm-package-locally)
- [Test against a throwaway HOME](#test-against-a-throwaway-home)
- [Fast inner loop with npm link](#fast-inner-loop-with-npm-link)
- [Full registry rehearsal with Verdaccio](#full-registry-rehearsal-with-verdaccio)
- [Cleaning up](#cleaning-up)
- [Troubleshooting a local install](#troubleshooting-a-local-install)
- [Tests](#tests)
- [Adding a command, harness, or flag](#adding-a-command-harness-or-flag)
- [Releasing](#releasing)

---

## Prerequisites

- **Node.js 18+** (`engines` minimum; CI covers 18 and 20)
- **npm 9+**
- Git

No global tooling beyond that — the CLI has exactly two runtime dependencies
(`smol-toml`, `yaml`) and the test suite is stdlib-only (`node:test`).

```bash
git clone https://github.com/Neosmith-ai/neosmith-connect.git
cd neosmith-connect
npm install                       # workspace-aware; installs packages/cli deps too
```

## Repo layout

| Path | What it is |
|---|---|
| `harnesses.json` | Single source of truth for supported harnesses; drives CLI **and** docs |
| `packages/cli/` | The `@neosmithai/cli` package — this is what gets published |
| `packages/cli/bin/neosmith.js` | Entry point (the `neosmith` binary) |
| `packages/cli/lib/harnesses/` | One module per harness (`on`/`off`/`status`/`help`) |
| `packages/cli/scripts/contract/` | Contract test suite |
| `site/` | Jekyll developer guide |

---

## Build the complete npm package locally

**This is the highest-fidelity local test.** `npm pack` produces the exact
tarball `npm publish` would upload, so installing it globally exercises the real
customer path — including the [`files`](packages/cli/package.json) allowlist,
which is the single most common source of "worked locally, broken on npm" bugs
(a `lib/` module that never shipped, a missing `harnesses.json`).

`npm pack` prints the tarball name on **stdout** and its notices on stderr, so
capture it rather than typing a version that goes stale the next time you bump.

**Git Bash / macOS / Linux:**

```bash
cd packages/cli
DEST="${TEMP:-/tmp}"

# 1. Build the tarball. Write it OUTSIDE the repo — *.tgz is not gitignored.
TGZ=$(npm pack --pack-destination "$DEST")

# 2. Install it globally, exactly as a customer would receive it
npm install -g "$DEST/$TGZ"

# 3. Confirm you're running the installed copy, not your working tree
which neosmith        # should be your npm global bin, NOT ~/.local/bin
neosmith --version
```

**PowerShell:**

```powershell
Set-Location packages\cli
$tgz = npm pack --pack-destination $env:TEMP
npm install -g (Join-Path $env:TEMP $tgz)

(Get-Command neosmith).Source
neosmith --version
```

> **Windows note:** `$TEMP` is the Git Bash form. In PowerShell it's
> `$env:TEMP`; in cmd, `%TEMP%`. Mixing them produces a confusing
> `ENOENT ... \:TEMP\...` path error.

> A global install **replaces** whatever `@neosmithai/cli` is already there,
> including the published release. `npm ls -g --depth=0` tells you what you
> have before you overwrite it; `npm install -g @neosmithai/cli` puts the
> registry version back afterwards.

Then actually drive it — real config, real router, real editors:

```bash
neosmith login
neosmith setup            # detect installed tools, wire the ones you pick
neosmith status
neosmith originals --show
neosmith doctor           # live per-harness protocol check
```

Finally, open the harness you wired (Claude Code, Codex, …) and send a real
prompt. **No test covers that step**, and it is where integration bugs surface.

### Inspect the tarball before you install

```bash
npm pack --dry-run        # lists every file, no tarball written
```

Read the file list. If a module you added isn't there, it's missing from
`files` in `packages/cli/package.json` and would ship broken.

### Install to a sandbox prefix instead of your real global

To avoid touching your everyday global npm:

```bash
npm install -g --prefix /tmp/npm-sandbox "$DEST/$TGZ"
/tmp/npm-sandbox/bin/neosmith --version      # macOS / Linux
/tmp/npm-sandbox/neosmith.cmd --version      # Windows
```

---

## Test against a throwaway HOME

The CLI writes to real locations — `~/.neosmith`, `~/.codex/config.toml`,
`~/.claude/settings.json`, VS Code `settings.json`. Point `HOME` at a temp
directory and it will read and write there instead, leaving your machine alone.

**Git Bash / macOS / Linux:**

```bash
export HOME=/tmp/fakehome USERPROFILE=/tmp/fakehome APPDATA=/tmp/fakehome
mkdir -p "$HOME"
neosmith codex on --key sk-plus-test-key
cat "$HOME/.codex/config.toml"
```

**PowerShell:**

```powershell
$h = "$env:TEMP\fakehome"; New-Item -ItemType Directory -Force $h | Out-Null
$env:HOME = $h; $env:USERPROFILE = $h; $env:APPDATA = $h
neosmith codex on --key sk-plus-test-key
Get-Content "$h\.codex\config.toml"
```

Use a **fake key** here. A real key printed to your terminal ends up in
scrollback, and from there into pasted logs and bug reports.

Set all four variables — `io.js` resolves the home directory differently per
platform, and setting only `HOME` on Windows leaves some paths pointing at your
real profile. `scripts/contract/_sandbox.js` does exactly this for tests.

`npm run smoke` automates a full `on → status → off` rehearsal against a
throwaway HOME and saves every file written plus before/after diffs into
`.smoke/<timestamp>/` — see [Tests](#tests).

### `--dry-run`

Every command accepts `--dry-run`, which prints what would be written without
touching disk. Good for a quick check; not a substitute for a real run, since it
skips the merge and snapshot logic.

---

## Fast inner loop with npm link

For rapid iteration, symlink the working tree onto your PATH so edits take
effect with no repack:

```bash
cd packages/cli
npm link
neosmith status           # runs your working tree, live
```

Unlink when done:

```bash
npm unlink -g @neosmithai/cli
```

> **`npm link` ignores the `files` allowlist.** A module you forgot to add to
> `files` works perfectly under `link` and is absent from the published package.
> Always do a real `npm pack` + global install before opening a release PR.

---

## Full registry rehearsal with Verdaccio

Only needed when you're testing the registry interaction itself — the literal
`npm install -g @neosmithai/cli` command string, version resolution, dist-tags,
or upgrade-from-previous-version behavior:

```bash
npx verdaccio                                          # starts on :4873
cd packages/cli
npm publish --registry http://localhost:4873
npm install -g @neosmithai/cli --registry http://localhost:4873
```

Nothing reaches the public registry. Stop Verdaccio and the local registry
contents disappear with it.

---

## Cleaning up

```bash
neosmith reset --all             # disconnect every harness, clear stored key
neosmith uninstall               # the above + remove ~/.neosmith
npm uninstall -g @neosmithai/cli
```

`off` and `reset` restore each harness from the pre-connect snapshot in
`~/.neosmith/snapshots/`, so your original editor settings come back
byte-for-byte. `neosmith originals --show` prints where they live.

---

## Troubleshooting a local install

### `Cannot find module '.../.neosmith/cli/bin/neosmith.js'`

A **stale launcher from a previous `install.sh` run** is shadowing your npm
install. The shell installer puts the CLI in `~/.neosmith/cli` and a launcher in
`~/.local/bin` that hardcodes an absolute path into that tree; it also *prepends*
`~/.local/bin` to `PATH`. If `~/.neosmith` is removed while the launcher stays,
the dead launcher outranks your npm global bin and wins.

`neosmith uninstall` now removes an orphaned launcher automatically, so this
only affects installs uninstalled by an older CLI (≤ 0.7.0). Clean up by hand:

```bash
which neosmith                   # if this shows ~/.local/bin, that's the culprit
rm -f ~/.local/bin/neosmith ~/.local/bin/neosmith.cmd
hash -r
```

### `bash: /c/Users/you/.local/bin/neosmith: No such file or directory` — but `which` looks right

Bash caches resolved command paths per shell session, so it keeps calling the
old location even after `PATH` resolution changes:

```bash
hash -r                          # clear the cache (hash -d neosmith for one entry)
```

A new terminal also works.

### Changes to `lib/` aren't taking effect

A global install is a **copy**, not a symlink. Re-run `npm pack` +
`npm install -g`, or switch to [`npm link`](#fast-inner-loop-with-npm-link) for
iteration.

### An env var you just set isn't visible to your editor

A process reads its environment **once, at launch**, and passes a copy to every
child. VS Code's integrated terminal is a child of VS Code, so a new terminal
panel inherits the environment VS Code started with. You must quit and relaunch
the whole application — and not via `code .` from a terminal opened before the
change, which hands the stale environment straight back. `neosmith codex on`
prints the platform-correct steps; the logic lives in
[`packages/cli/lib/envsetup.js`](packages/cli/lib/envsetup.js).

---

## Tests

```bash
cd packages/cli
npm test                 # every scripts/contract/*.test.js, auto-discovered
npm run test:all         # same thing — kept as an alias for muscle memory
npm run smoke            # tests + isolated on/off rehearsal, opens the report
npm run smoke:ci         # exit-code only, for hooks and CI
npm run e2e:offline      # all 8 harnesses against the offline contract mock
npm run test:router-facing   # just the suites the router's deploy gate runs

# One suite at a time, by filename without .test.js:
node scripts/run-contract.js --only env,env-flag
```

The smoke gate writes `.smoke/<timestamp>/` containing `SUMMARY.txt`, the named
test list, the rehearsal console output, and the actual settings files the CLI
produced — including before/after copies proving your settings are preserved and
restored. Nothing outside `.smoke/<timestamp>/home/` is touched.

**Install the pre-push hook once** and the gate runs automatically:

```bash
npm run install-hook     # points core.hooksPath at hooks/; git push runs smoke:ci
```

Override a single push with `git push --no-verify`; remove with
`git config --unset core.hooksPath`.

CI (`.github/workflows/test.yml`) runs the suite and the smoke gate across
Linux/macOS/Windows × Node 18/20 on every push and PR.

### Writing tests

Use `scripts/contract/_sandbox.js` — `withSandbox()` redirects `HOME`,
`USERPROFILE`, `APPDATA`, and `XDG_CONFIG_HOME` at a fresh temp dir per test and
restores them after, so tests never touch your real config.

**Prefer pure functions of an injected platform over `process.platform`.** CI
runs on all three OSes, but a contributor's local run does not — and a bug that
only reproduces on a platform your test host never exercises is exactly the kind
that reaches customers. `lib/envsetup.js` takes `{platform, shell}` as a
parameter for this reason, so `envsetup.test.js` asserts the Windows output
while running on Linux.

New `*.test.js` files under `scripts/contract/` are picked up automatically —
every entrypoint (`npm test`, `npm run test:all`, both CI workflows) routes
through `scripts/run-contract.js`, which globs the directory. Nothing to
register.

`node --test <glob>` is deliberately not used: glob args need Node 22+ (this
repo supports 18), and directory recursion also matches helper files like
`_sandbox.js`, which then run as failing "tests".

---

## Testing against staging

> Step-by-step runbook for both loops, including how to boot a local
> router and mint keys: [docs/CROSS-REPO-TESTING.md](docs/CROSS-REPO-TESTING.md)

`neosmith` talks to production by default. `--env staging` points it at
`staging.router.neosmith.ai`, and `--env local` at a router you are running
yourself on `:4008`:

```bash
neosmith --env staging login sk-slm-...   # per-environment key slot
neosmith --env staging claude on
neosmith status                           # shows on(staging) and flags mismatches
neosmith claude off                       # finds staging wiring without --env
```

Three things worth knowing:

- **Keys are stored per environment.** A staging key never lands in the slot a
  production invocation reads, so you can be logged into both at once.
- **`off` is environment-blind on purpose.** Ownership matches *any* known
  environment, so a plain `neosmith claude off` always finds and removes
  staging wiring. If it did not, you would be silently left on staging while
  believing you had disconnected.
- **`on` refuses to re-point across environments** without `--force`. The
  snapshot and the restore ledger are write-once; re-pointing would strand the
  pre-connect baseline and leave `off` unable to restore either environment.

`NEOSMITH_BASE_URL=<url>` still works for an address with no name (a branch
deploy, an ephemeral test port). It outranks `--env` and says so out loud.

### The full local loop (router + CLI, no cloud, no cost)

```bash
# terminal 1 — the router candidate
cd ../router_v4 && python3 -m router_v4.app          # :4008

# terminal 2 — the CLI against it
cd packages/cli
node bin/neosmith.js --env local login "$LOCAL_KEY"
node bin/neosmith.js --env local verify
node bin/neosmith.js --env local claude on && claude -p "reply OK"
node bin/neosmith.js claude off
```

## The router contract

`contract/router-contract.v1.json` is a byte-identical copy of the file owned
by `router_v4`. It pins the endpoints, auth model, response shapes, headers and
SKU catalogue this CLI is built against. **Do not edit this copy** — change it
in `router_v4/contract/`, then re-vendor:

```bash
cp ../../../router_v4/contract/router-contract.v1.json packages/cli/contract/
```

`router_v4`'s deploy workflow runs `contract/check_sync.py` against this copy
and blocks its own staging deploy if the two disagree, so drift surfaces on the
router's PR rather than in a user's terminal.

Two rules keep the cross-repo CI graph acyclic — do not break either:

- The router's CLI gate never depends on staging being up (it boots a local
  uvicorn against the candidate commit).
- This repo's staging e2e never gates the router's deploy.

Breaking changes are always sequenced, never simultaneous: the router lands an
additive minor, this repo adopts it, the router removes the old behavior in a
later major. See `router_v4/contract/README.md`.

## Real-harness e2e

`scripts/e2e/run.js` drives the **installed** `neosmith` binary — never the
source tree — through one harness end to end. Three tiers, by what can honestly
be automated:

| tier | harnesses | what it asserts |
|---|---|---|
| real prompt | claude, codex | the actual binary sends a real prompt through the router and gets an answer |
| config write | continue, zed, copilot | `on` merged correctly and points at the right environment; `off` restores byte-for-byte |
| printed | cline, jetbrains, cursor | the printed instructions are correct **for this platform** |

Rehearse the whole thing locally with no secrets and no cost:

```bash
cd packages/cli && npm run e2e:offline
```

That runs every harness against the contract-driven mock router and is also a
step in `test.yml`, so the driver is proven on all three OSes before the paid
workflow uses it. Real prompts are reported as *skipped* there — a canned
response proves nothing about inference.

`.github/workflows/e2e-staging.yml` is the paid version: macOS and Windows
runners, the real Claude Code and Codex binaries, the tarball rather than the
checkout, and real prompts through staging. It ships **`workflow_dispatch`-only
on purpose**; the header comment explains what to enable after it has proven
itself. It needs a `NEOSMITH_STAGING_KEY` repo secret — mint it as `sk-slm-*`
(cheapest tier, and the shape the CLI's audit redaction covers) with a small
server-side `dev_hard_ceiling_tokens`.

---

## Adding a command, harness, or flag

**Every new route or feature lands with a test in the same PR.**

| Change | Where the test goes |
|---|---|
| New harness | `scripts/contract/<harness>.test.js` — cover `on`, `off`, `status`, and the on/off round-trip preserving pre-connect content |
| New command | `scripts/contract/` — assert behavior, not just that it doesn't throw |
| New flag | Extend the existing test for that command |
| Config-merge change | `scripts/contract/env-preservation.test.js` — the round-trip must be byte-for-byte |
| User-facing copy the user must act on | Assert the substance (see `envsetup.test.js`) |

Also:

- **Harness metadata belongs in `harnesses.json`**, not hardcoded. Run
  `npm run generate-docs -- --check`; CI fails
  if the docs drift from the manifest.
- **Never bake a key into a config file** when the harness supports env-var
  indirection — Codex's contract is `env_key`.
- **Snapshot before you write.** `io.snapshot()` must run before the first write
  so `off` can restore, and only once per connect (re-snapshotting an
  already-connected config makes `off` restore the NeoSmith state).
- **Platform-specific instructions must branch on platform.** Printing POSIX
  `export` on Windows sends users down a path that silently fails in PowerShell,
  cmd, and GUI-launched editors.

---

## Releasing

Publishing is tag-driven — never `npm publish` from a laptop.

1. Bump `version` in `packages/cli/package.json`.
2. `npm run test:all && npm run smoke:ci` locally.
3. `npm pack` + global install, and run the CLI for real (above).
4. Merge to `main`.
5. Tag and push: `git tag v0.7.1 && git push origin v0.7.1`.

`.github/workflows/publish.yml` verifies the tag matches `package.json`,
re-runs the contract suite, and publishes with `--access public`. A mismatched
tag fails the job before anything is published.
