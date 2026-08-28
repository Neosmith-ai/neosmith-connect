# Governance

NeoSmith Connect is **single-vendor open source**. NeoSmith AI develops it,
pays for it, and is accountable for what ships to npm as `@neosmithai/cli`.
The source is public, contributions are welcome, and the licence is MIT — but
final say on what lands rests with the maintainers listed in
[MAINTAINERS.md](MAINTAINERS.md).

That model is stated plainly here so nobody has to guess. Most disagreements in
open source are really disagreements about who decides, and the fix is to write
it down before there is anything to disagree about.

## Roles

| Role | Who | What they can do |
|---|---|---|
| **User** | Anyone | Open issues, ask questions, use the CLI. |
| **Contributor** | Anyone who opens a pull request | Propose changes. No repository permissions are needed or granted. |
| **Maintainer** | Listed in [MAINTAINERS.md](MAINTAINERS.md) | Review and merge pull requests, cut releases, administer the repository. |

There is deliberately no tier between Contributor and Maintainer. Outside
contributors do **not** receive push access to this repository — see
[How changes get in](#how-changes-get-in).

## How changes get in

Everyone, maintainers included, goes through the same path:

```
fork  →  branch on your fork  →  pull request against main  →  review  →  squash merge
```

1. **Fork** `Neosmith-ai/neosmith-connect` to your own account.
2. **Branch** on your fork. Name it `fix/…`, `feat/…`, `docs/…`, or `chore/…`.
3. **Push to your fork** and open a pull request against `main`.
4. **CI runs automatically.** The contract matrix, the smoke gate, the security
   scans, and the docs-drift check all have to pass. None of them need secrets,
   so they run in full on a fork pull request.
5. **A maintainer reviews.** At least one approving review is required, and
   `main` enforces it — nobody merges their own work unreviewed, including
   admins.
6. **Squash merge.** `main` stays linear and every commit on it corresponds to
   one reviewed pull request.

`main` is protected: it cannot be pushed to directly, force-pushed, or deleted,
by anyone. If you find you *can* do one of those things, that is a
misconfiguration — please report it as described in [SECURITY.md](SECURITY.md).

Practical detail on building, testing, and running the CLI locally lives in
[CONTRIBUTING.md](CONTRIBUTING.md). Read that before your first pull request.

## How decisions get made

**Lazy consensus.** A proposal that draws no objection within a reasonable time
is accepted. Most pull requests never need more than this.

**When there is disagreement**, the maintainers discuss it in the issue or pull
request thread. If they cannot converge, the maintainer who owns the affected
area under [CODEOWNERS](.github/CODEOWNERS) decides, and writes down why. Silence
is not a veto; an unexplained "no" is not a decision.

Anything that changes the router contract, the public CLI surface, or the
security posture of a release should start as an **issue**, not as a pull
request. It is cheaper to disagree about a design in prose than after somebody
has written the code.

## What is open to contribution, and what is not

Most of this repository is open to anyone. Bug fixes, new harness support,
documentation, tests, and platform-portability work are all welcome — those are
the contributions we get the most value from.

Some paths carry consequences beyond this repository, and pull requests touching
them will be redirected to an issue first rather than reviewed on the spot:

| Path | Why it is restricted |
|---|---|
| `packages/cli/contract/router-contract.v1.json` | It is a **contract with the router service**, versioned on both sides. Changing it here without the corresponding server change breaks every installed CLI. |
| `packages/cli/harnesses.json` — SKU, pricing, and environment entries | These describe what NeoSmith bills for and where requests are sent. New *harness* entries are welcome; changed *commercial* entries are not a community decision. |
| `.github/workflows/**` | These workflows hold credentials. A change here is a change to who can spend money and publish packages. |
| `LICENSE`, `SECURITY.md`, `GOVERNANCE.md` | Legal and policy documents. Corrections welcome; changes of substance are NeoSmith's to make. |

This is not a statement that outside input is unwelcome on these — it is a
statement that the conversation has to happen before the code does.

## Releases

Maintainers cut releases. The process is documented in
[CONTRIBUTING.md](CONTRIBUTING.md#releasing). Publishing to npm requires a
maintainer to approve the deployment on a protected environment, so no single
tag push can ship a package on its own.

Versioning is semantic. Breaking changes to the CLI surface get a major bump and
a migration note in the release body.

## Becoming a maintainer

There is no application form. Maintainers are added by existing maintainers, by
consensus, on the strength of a track record:

- a handful of merged pull requests that needed little rework;
- reviews of other people's pull requests that caught real problems;
- sustained engagement over months rather than a single large drop.

If that describes you, an existing maintainer will most likely raise it before
you do. If they don't, ask.

Maintainers who become inactive for six months are moved to an *emeritus*
section of [MAINTAINERS.md](MAINTAINERS.md) and their repository access is
removed. This is bookkeeping, not a judgement, and it is reversible on request.

## Changing this document

By pull request, approved by a majority of the maintainers listed in
[MAINTAINERS.md](MAINTAINERS.md).
