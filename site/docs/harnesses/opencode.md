---
title: OpenCode
layout: default
parent: Harnesses
nav_order: 9
---

# OpenCode + NeoSmith

OpenCode is a terminal-first coding agent. It supports custom OpenAI-compatible providers, so it points at NeoSmith directly.

- **Endpoint:** `https://router.neosmith.ai/v1`
- **Format:** OpenAI Compatible
- **Model:** `neosmith.intelligent-pro`

Configuration lives in a JSON (or JSONC) file. The global one is at the same path on every platform:

```
~/.config/opencode/opencode.json          # macOS / Linux
%USERPROFILE%\.config\opencode\opencode.jsonc   # Windows
```

OpenCode merges every config source it finds rather than replacing — remote config, the global file, `$OPENCODE_CONFIG`, a project-level `opencode.json`, `.opencode` directories, `$OPENCODE_CONFIG_CONTENT`, and managed settings, in that order of increasing precedence. Non-conflicting keys from all of them are kept, which is the same merge-never-clobber invariant the NeoSmith CLI's snapshot/restore model enforces.

> Credentials added through OpenCode's own `/connect` flow go somewhere else again — `~/.local/share/opencode/auth.json` (`%USERPROFILE%\.local\share\opencode` on Windows). NeoSmith does not write there; the key goes in the provider block below.

---

## Install

See [opencode.ai](https://opencode.ai) for the current installer. It ships as a single binary and via npm.

---

## Configure

### With the NeoSmith CLI (recommended)

```bash
neosmith opencode on
```

That writes the provider block, registers **every** NeoSmith SKU with its real context window, and sets `model` / `small_model`. `neosmith opencode off` restores your pre-connect config byte-for-byte.

### By hand

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "neosmith": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "NeoSmith",
      "options": {
        "baseURL": "https://router.neosmith.ai/v1",
        "apiKey": "sk-plus-yourname-xxxxxx"
      },
      "models": {
        "neosmith.intelligent-pro":     { "name": "NeoSmith Pro",     "limit": { "context": 1000000, "output": 128000 } },
        "neosmith.intelligent-basic":   { "name": "NeoSmith Basic",   "limit": { "context": 1000000, "output": 128000 } },
        "neosmith.neolite":             { "name": "NeoSmith NeoLite", "limit": { "context": 512000,  "output": 128000 } },
        "neosmith.intelligent-maestro": { "name": "NeoSmith Maestro", "limit": { "context": 1000000, "output": 128000 } }
      }
    }
  },
  "model": "neosmith/neosmith.intelligent-pro",
  "small_model": "neosmith/neosmith.neolite"
}
```

Notes on the fields that matter:

- **`npm`** — use `@ai-sdk/openai-compatible` for a `/v1/chat/completions` backend, which is what NeoSmith serves. `@ai-sdk/openai` is for `/v1/responses` and is the wrong package here.
- **`options.apiKey`** — a literal, or an `{env:VAR}` reference if you would rather keep the key out of the file. Both are accepted; `neosmith opencode on` writes a literal at mode `0600`, and `neosmith keys` reports either form.
- **`models.<sku>.limit`** — declare these. `GET /v1/models` returns ids only, so OpenCode has no way to discover a context window; without `limit.context` it falls back to a conservative default and compacts far too early. `neosmith.neolite` is the sealed 512K budget tier — the others are 1M.
- **`model` / `small_model`** — `"<provider-id>/<sku>"`. `small_model` is used for lightweight work like title generation, which is exactly what NeoLite is for.

---

## The JSONC caveat

If `opencode.jsonc` exists, that is the file OpenCode reads, and `.jsonc` legally contains comments and trailing commas.

`neosmith opencode on` will **not** rewrite a config it cannot parse as strict JSON. It takes a snapshot, prints the block for you to merge by hand, and leaves your file exactly as it was. That is deliberate: silently dropping your comments and hand-written settings to add a provider is a far worse outcome than one manual paste.

To get the automatic path back, either move your settings into a strict-JSON `opencode.json`, or merge the printed block yourself.

---

## Choosing a tier

> `neosmith opencode on --model neosmith.intelligent-basic` for Sonnet-tier with no Opus escalation, or `--model neosmith.neolite` for the sealed 512K budget tier. Every SKU is registered either way, so you can also switch inside OpenCode without re-running `on`.

---

## Verify

- `neosmith opencode status` — reports the wired environment, the selected model, and how many SKUs are registered.
- Open OpenCode and confirm the NeoSmith models appear in the picker, then send any prompt.
- `neosmith doctor` round-trips a 1-token probe against the router with your stored key.

To confirm the traffic routed through NeoSmith, curl `/whoami` with your key (see Verify Connection in the Reference section).

## Troubleshooting

- **404 on every request:** the Base URL must include `/v1` and no trailing slash.
- **400 Unknown model:** use a `neosmith.*` SKU, not a `gpt-*` name.
- **Context compacts far too early:** `limit.context` is missing from the model entry. Re-run `neosmith opencode on`, which registers all four SKUs with their real windows.
- **`on` printed a block instead of writing:** your config is `.jsonc` with comments or trailing commas. See [The JSONC caveat](#the-jsonc-caveat) above.
- **Edited the config and nothing changed:** a project-level `opencode.json` outranks the global one. Check for one in your repo root.
- More: [reference/troubleshooting.md](../reference/troubleshooting)
