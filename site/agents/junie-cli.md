# Junie CLI + NeoSmith

Junie is JetBrains' coding agent. The CLI supports **custom models** — self-hosted or third-party endpoints declared as profile files — so it points at NeoSmith directly, with no JetBrains AI subscription involved.

- **Endpoint:** `https://router.neosmith.ai/v1/chat/completions` — the **full** path, not the `/v1` root (see below)
- **Format:** OpenAI Compatible (`apiType: "OpenAICompletion"`)
- **Model:** `neosmith.intelligent-pro`

Custom model profiles are one JSON file each, discovered from:

```
$JUNIE_HOME/models/<profile>.json     # user scope; JUNIE_HOME defaults to ~/.junie
.junie/models/<profile>.json          # project scope
```

The filename without `.json` **is** the profile id, so NeoSmith's profile lives at `~/.junie/models/neosmith.json` and is selected as `custom:neosmith`.

---

## Install

See [junie.jetbrains.com](https://junie.jetbrains.com/docs/junie-cli.html) for the CLI install.

---

## Configure

### With the NeoSmith CLI (recommended)

```bash
neosmith junie on
```

That writes the profile and prints the two ways to select it. `neosmith junie off` restores your pre-connect state — removing the file if it did not exist before you connected.

### By hand

`~/.junie/models/neosmith.json`:

```json
{
  "id": "neosmith.intelligent-pro",
  "displayName": "NeoSmith Pro",
  "providerName": "NeoSmith",
  "baseUrl": "https://router.neosmith.ai/v1/chat/completions",
  "apiType": "OpenAICompletion",
  "apiKey": "sk-plus-yourname-xxxxxx",
  "maxContextLength": 1000000,
  "fasterModel": { "id": "neosmith.neolite" }
}
```

Then:

```bash
junie --model custom:neosmith
```

Notes on the fields that matter:

- **`baseUrl` is the full endpoint URL, not a base.** This is the one place NeoSmith's usual `/v1` answer is wrong. JetBrains' own example for a local model is `http://localhost:11434/v1/chat/completions`, and Junie sends to exactly the URL you give it. Point it at `/v1` alone and every request 404s.
- **`apiType`** — `OpenAICompletion` for NeoSmith. The other legal values are `OpenAIResponses`, `Google` and `Anthropic`.
- **`apiKey`** — a literal is used as-is, or use `${VAR}` to pull it from the environment. `neosmith junie on` writes a literal at mode `0600`; `neosmith keys` reports either form.
- **`fasterModel`** — the model Junie uses for helper tasks, the counterpart to its main reasoning model. NeoLite is the right tier for that. `primaryModel` exists as the matching override for the main role; leaving it out means the top-level `id` is used.
- **`maxContextLength`** — `1000000` for Pro / Basic / Maestro, `512000` for NeoLite (the sealed budget tier).

---

## Selecting the profile

There is no documented way to make a custom profile the persistent default, so pick one of:

```bash
junie --model custom:neosmith          # per run
```

or set it once in your environment:

```bash
export JUNIE_MODEL=custom:neosmith     # macOS / Linux — add to your rc file
setx JUNIE_MODEL "custom:neosmith"     # Windows — user level, every shell and GUI app
```

`neosmith junie on` prints the platform-correct form of the second one. On Windows this matters: a POSIX `export` in `~/.bashrc` is invisible to PowerShell, cmd, and anything launched from the Start menu.

> `JUNIE_MODEL` selects a *model*, not a credential. The key is in the profile file; Junie works via `--model custom:neosmith` whether or not the variable is set.

---

## Choosing a tier

> `neosmith junie on --model neosmith.intelligent-basic` for Sonnet-tier with no Opus escalation, or `--model neosmith.neolite` for the sealed 512K budget tier. Junie takes one model per profile, so switching tiers means re-running `on` (which rewrites the profile in place and keeps any fields you added to it).

---

## Verify

- `neosmith junie status` — reports the wired environment, the model, and whether `JUNIE_MODEL` selects the profile.
- `junie --model custom:neosmith` with a trivial prompt.
- `neosmith doctor` round-trips a 1-token probe against the router with your stored key.

To confirm the traffic routed through NeoSmith, curl `/whoami` with your key (see Verify Connection in the Reference section).

## Troubleshooting

- **404 on every request:** `baseUrl` is almost certainly `.../v1` instead of `.../v1/chat/completions`. Junie wants the full endpoint.
- **Profile not listed:** the filename stem is the profile id — the file must be `neosmith.json`, and `--model` takes `custom:neosmith`. Check `JUNIE_HOME` if you have set it; the profile has to be under *that* directory's `models/`.
- **400 Unknown model:** `id` must be a `neosmith.*` SKU, not a `gpt-*` name.
- **Works from one terminal and not another:** you set `JUNIE_MODEL` in a shell rc file rather than at the user level. On Windows use `setx`, then open a new terminal.
- **Junie still uses a JetBrains AI model:** you did not pass `--model custom:neosmith` and `JUNIE_MODEL` is unset. There is no persistent default for custom profiles.
- More: [reference/troubleshooting.md](../reference/troubleshooting.md)
