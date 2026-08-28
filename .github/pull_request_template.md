## What this changes

<!-- One or two sentences. What is different after this merges? -->

## Why

<!-- The problem, or the issue number. "Fixes #123" closes it automatically. -->

## How to verify

<!-- The commands a reviewer runs to see it working. Be specific:
     `neosmith codex on --dry-run` beats "test the codex command". -->

---

## Checklist

- [ ] I ran `npm run smoke` locally and it passed
      (`npm run install-hook` makes this automatic on every push)
- [ ] **No secrets in this diff** — no API keys, tokens, `sk-…` strings,
      customer identifiers, or real endpoint credentials, in code, tests,
      fixtures, or commit messages
- [ ] A new command, harness, or flag comes with a test in
      `packages/cli/scripts/contract/` — see
      [CONTRIBUTING.md § Adding a command, harness, or flag](../CONTRIBUTING.md#adding-a-command-harness-or-flag)
- [ ] If `harnesses.json` changed, I re-ran `node scripts/generate-docs.js`
      and committed the regenerated blocks
- [ ] If a file was added to `packages/cli/`, it is in the `files` allowlist in
      `packages/cli/package.json` — otherwise it works locally and is missing
      from the published tarball

## Anything else

<!-- Trade-offs you made, things you deliberately left out, questions for the
     reviewer. If there's nothing, delete this section. -->
