# NeoSmith Connect

[![test](https://github.com/Neosmith-ai/neosmith-connect/actions/workflows/test.yml/badge.svg)](https://github.com/Neosmith-ai/neosmith-connect/actions/workflows/test.yml)
[![security](https://github.com/Neosmith-ai/neosmith-connect/actions/workflows/security.yml/badge.svg)](https://github.com/Neosmith-ai/neosmith-connect/actions/workflows/security.yml)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/Neosmith-ai/neosmith-connect/badge)](https://scorecard.dev/viewer/?uri=github.com/Neosmith-ai/neosmith-connect)
[![npm](https://img.shields.io/npm/v/@neosmithai/cli)](https://www.npmjs.com/package/@neosmithai/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Monorepo for NeoSmith's CLI and developer-facing guide. A single
`harnesses.json` manifest drives both:

- `packages/cli/` — the `@neosmithai/cli` Node CLI that wires IDEs and AI
  coding agents to NeoSmith's routing layer.
- `site/docs/` — the developer guide, published at
  [neosmith-ai.github.io/neosmith-connect](https://neosmith-ai.github.io/neosmith-connect/).
  One tree: what you edit is what Jekyll builds and Pages serves.

## Layout

```
neosmith-connect/
├── harnesses.json                 # single source of truth for all supported harnesses
├── packages/cli/                  # @neosmithai/cli source (the CLI package)
├── site/
│   ├── CONTRIBUTING.md            # how to contribute to the guide
│   └── docs/                      # THE developer guide — Jekyll builds this, Pages serves it
│       ├── index.md  compatibility.md
│       └── agents/  ides/  platforms/  reference/
├── scripts/
│   ├── generate-docs.js           # regenerates the manifest-driven tables in site/docs/
│   └── check-published-docs.js    # fetches the LIVE site; asserts every harness page and every link resolves
├── tools/
│   └── scaffold-monorepo.js       # Phase-0 scaffolder — re-run from scratch
└── .github/
    ├── workflows/                 # CI (test.yml) and Pages Actions (pages.yml)
    └── ISSUE_TEMPLATE/            # issue templates (sourced from developer-guide)
```

## Quick start

This monorepo is intended to be developed inside `packages/cli/` and `site/`.
The orchestrating `package.json` here exposes workspace-aware scripts:

```bash
npm run generate-docs -- --check   # verify the guide's tables match harnesses.json
npm test                            # run the contract test suite
npm run smoke                       # smoke gate: tests + isolated on/off rehearsal, opens report
npm run scaffold                    # re-stamp from the source repos (deletes everything first)
```

See **[CONTRIBUTING.md](CONTRIBUTING.md)** for the full development guide —
building the CLI package locally with `npm pack`, installing and testing it
exactly as a customer receives it (no registry upload), testing against a
throwaway HOME, the test suite, and the release process.

## Contributing

Fork, branch, open a pull request against `main`. `main` is protected — nobody
pushes to it directly, including maintainers.

- **[CONTRIBUTING.md § How to contribute](CONTRIBUTING.md#how-to-contribute)** —
  the five commands from fork to pull request, what CI runs, what a reviewer
  looks for.
- **[GOVERNANCE.md](GOVERNANCE.md)** — who maintains this, how decisions get
  made, which paths need a conversation before code.
- **[SECURITY.md](SECURITY.md)** — found a security bug? Report it privately.
  Please do not open a public issue.
- **[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)** · **[MAINTAINERS.md](MAINTAINERS.md)**

Licensed [MIT](LICENSE).

## Filing feedback or an issue

The fastest way to tell us something isn't working (or open an enhancement request) is
`neosmith feedback` — it opens the right GitHub issue template in your default browser
with a prefilled body so all you have to do is review and submit:

```bash
neosmith feedback                      # defaults to the Bug template
neosmith feedback bug "Tab autocomplete broken in Cursor"
neosmith feedback idea                 # opens the Enhancement template instead
neosmith feedback --no-open            # print the URL + body for headless / SSH use
neosmith feedback --message "..."      # set the message via flag instead of positional
```

The command auto-fills a non-sensitive Environment block (CLI version, Node, OS, router
host — **never** your API key, never a query string), so reviewers have the context they
need without you having to copy it. The full body and URL are also printed, so the
deep-link is recoverable on systems where the browser launch fails.

The CLI's correctness gate is `npm run smoke`. It runs **all** contract tests
(`packages/cli/scripts/contract/*.test.js`, verbose) **and** rehearses a real
`claude on → status → off` cycle against a throwaway HOME, then drops a
human-readable report into `packages/cli/.smoke/<timestamp>/` (auto-opened).
See `packages/cli/README.md` for what each artifact file shows.

**When does it run?**

| Where | Trigger | What runs |
|---|---|---|
| **Your machine** | **Manual — you run it** | `npm run smoke` (from root or `packages/cli`) |
| **Your machine (optional)** | automatic on `git push` | run `npm run install-hook` once → pre-push hook runs `npm run smoke:ci` and blocks the push on failure |
| **CI (GitHub Actions)** | automatic on every push & PR | `test.yml` runs the contract suite + `npm run smoke:ci` on Linux/macOS/Windows × Node 18/20 |

Local commits do **not** auto-run anything — either run `npm run smoke` before
pushing, or opt into the pre-push gate once:

```bash
npm run install-hook    # one-time; sets core.hooksPath to the repo's hooks/ dir
```

After that, `git push` runs the smoke gate first and blocks on failure
(`git push --no-verify` overrides a single push; `git config --unset core.hooksPath`
removes the gate). CI always runs it regardless, so nothing untested reaches `main`.

## Install paths

- macOS / Linux / WSL2:

  ```bash
  bash -c "$(curl -fsSL https://raw.githubusercontent.com/Neosmith-ai/neosmith-connect/main/packages/cli/install.sh)"
  ```

- Windows, native PowerShell:

  ```powershell
  irm https://raw.githubusercontent.com/Neosmith-ai/neosmith-connect/main/packages/cli/install.ps1 | iex
  ```

## The CLI guide

The canonical, code-verified guide for the `@neosmithai/cli` package is
[`packages/cli/README.md`](packages/cli/README.md) — it's what `npm view @neosmithai/cli`
renders and what ships inside the published package. It covers all eight
harnesses, every command, the model tiers, key storage, troubleshooting, and
the smoke gate. The Jekyll site under `site/` mirrors it for per-harness deep
dives; if the two ever disagree, **`packages/cli/README.md` is authoritative**.
