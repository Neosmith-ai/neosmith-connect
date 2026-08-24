# NeoSmith Connect

Monorepo for NeoSmith's CLI and developer-facing guide. A single
`harnesses.json` manifest drives both:

- `packages/cli/` — the `@neosmithai/cli` Node CLI that wires IDEs and AI
  coding agents to NeoSmith's routing layer.
- `site/` — the developer guide, published at
  [neosmith-ai.github.io/neosmith-connect](https://neosmith-ai.github.io/neosmith-connect/).
  Authored in `site/`; **built and served from `site/docs/`** — see below.

## Layout

```
neosmith-connect/
├── harnesses.json                 # single source of truth for all supported harnesses
├── packages/cli/                  # @neosmithai/cli source (the CLI package)
├── site/                          # developer guide — AUTHORING copy
│   ├── README.md                  # root guide
│   ├── COMPATIBILITY.md
│   ├── ides/  agents/  platforms/  reference/
│   └── docs/                      # PUBLISHED copy — Jekyll builds THIS and Pages serves it.
│                                  # Hand-maintained: adding a page under site/ does NOT
│                                  # create it here. CI fails if a mirror is missing.
├── scripts/
│   ├── generate-docs.js           # regenerates site README/COMPATIBILITY from harnesses.json
│   ├── sync-docs-mirror.js        # CHECKS the site/docs/ mirror — reports drift, FAILS on
│   │                              # a missing page. It does not write anything.
│   └── check-published-docs.js    # fetches the LIVE site and asserts every harness has a page
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
npm run generate-docs -- --check   # verify docs site tables are manifest-driven
npm run sync-docs     -- --check   # every site/ page has a site/docs/ mirror (fails if not)
npm test                            # run the contract test suite
npm run smoke                       # smoke gate: tests + isolated on/off rehearsal, opens report
npm run scaffold                    # re-stamp from the source repos (deletes everything first)
```

See **[CONTRIBUTING.md](CONTRIBUTING.md)** for the full development guide —
building the CLI package locally with `npm pack`, installing and testing it
exactly as a customer receives it (no registry upload), testing against a
throwaway HOME, the test suite, and the release process.

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
