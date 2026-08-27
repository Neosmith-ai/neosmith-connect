# Security Policy

`@neosmithai/cli` sits between your editor and a paid inference router. It reads
and writes API keys on your machine, and it edits the config files of eight
different coding harnesses. That makes two classes of bug security-relevant here
that would be cosmetic elsewhere:

- **Key disclosure** — a key printed to a terminal, written to a world-readable
  file, included in a crash dump, or uploaded in a CI artifact.
- **Config tampering** — the CLI pointing a harness at an endpoint that is not
  the one the user asked for.

Please report either privately.

## Reporting a vulnerability

**Do not open a public issue, discussion, or pull request for a security bug.**
Doing so tells everyone about it at the same time it tells us.

Use one of these instead:

1. **GitHub private vulnerability reporting** — preferred.
   Go to the [Security tab](https://github.com/Neosmith-ai/neosmith-connect/security)
   and choose **Report a vulnerability**. This opens a private advisory that only
   the maintainers can see, and it gives us a place to draft the fix and the CVE
   together with you.
2. **Email** — <contact-us@neosmith.ai>, subject line starting `[security]`.

Whichever route you pick, please include:

- what an attacker can do, in one sentence;
- the version (`neosmith --version`) and platform;
- the smallest set of steps that reproduces it;
- **redacted output only** — if you have to show a key to make the point,
  replace all but the first eight characters with `***`.

## What happens next

| When | What we do |
|---|---|
| Within 5 business days | Acknowledge the report and tell you whether we can reproduce it. |
| Within 10 business days | Give you a severity assessment and a target fix date. |
| On fix | Ship a patch release, credit you in the release notes unless you'd rather we didn't, and publish a GitHub Security Advisory. |
| 90 days after the report | Coordinated public disclosure, whether or not a fix has shipped. If you need to disclose sooner, tell us and we will work to your timeline. |

We do not run a paid bug bounty.

## Supported versions

Only the latest published minor of `@neosmithai/cli` receives security fixes.
Check yours with `neosmith --version` and upgrade with `neosmith update`.

| Version | Supported |
|---|---|
| Latest published minor | ✅ |
| Anything older | ❌ — upgrade first, then re-report if it still reproduces |

## Scope

**In scope**

- The published `@neosmithai/cli` package and everything under `packages/cli/`.
- The install scripts `packages/cli/install.sh` and `packages/cli/install.ps1`.
- This repository's GitHub Actions workflows and their handling of secrets.
- The published guide at <https://neosmith-ai.github.io/neosmith-connect/>.

**Out of scope**

- The NeoSmith router service itself — report those to <contact-us@neosmith.ai>
  directly; they are not tracked in this repository.
- Vulnerabilities in the third-party harnesses the CLI configures (Claude Code,
  Codex, Continue, Cline, Copilot, Cursor, JetBrains AI, Zed). Report those
  upstream.
- Findings that require an attacker who already has local code execution as your
  user — at that point they can read the harness config files directly.
- Missing hardening headers or rate limits on the docs site.

## If you have leaked your own key

Rotate it. `neosmith keys` shows what is configured; mint a replacement in the
NeoSmith console and re-run `neosmith login`. A leaked key is a billing problem
for you, not a vulnerability in this project — but tell us anyway if the CLI is
what leaked it, because that *is* a vulnerability.
