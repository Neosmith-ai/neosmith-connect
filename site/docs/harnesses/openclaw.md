---
title: OpenClaw
layout: default
parent: Harnesses
nav_order: 10
---

# OpenClaw + NeoSmith

OpenClaw is a self-hosted gateway that connects chat apps — Slack, Discord, Telegram, WhatsApp, Teams, Signal, iMessage and more via channel plugins — to AI coding agents. Its own agents run on a model provider you configure, and it accepts OpenAI-compatible endpoints, so it points at NeoSmith directly.

- **Endpoint:** `https://router.neosmith.ai/v1`
- **Format:** OpenAI Compatible (`api: "openai-completions"`)
- **Model:** `neosmith.intelligent-pro`

One config file, every platform:

```
~/.openclaw/openclaw.json
```

---

## Install

See [docs.openclaw.ai](https://docs.openclaw.ai) for the gateway install. `openclaw onboard` walks through first-time setup interactively.

---

## Configure

### With the NeoSmith CLI (recommended)

```bash
neosmith openclaw on
```

That adds the provider under `models.providers.neosmith`, registers every NeoSmith SKU with its real context window, and sets it as the default agent model. `neosmith openclaw off` restores your pre-connect config byte-for-byte.

### By hand

```json5
{
  models: {
    providers: {
      neosmith: {
        baseUrl: "https://router.neosmith.ai/v1",
        apiKey: "${NEOSMITH_API_KEY}",
        api: "openai-completions",
        models: [
          { id: "neosmith.intelligent-pro",     name: "NeoSmith Pro",     contextWindow: 1000000, maxTokens: 128000,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
          { id: "neosmith.intelligent-basic",   name: "NeoSmith Basic",   contextWindow: 1000000, maxTokens: 128000,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
          { id: "neosmith.neolite",             name: "NeoSmith NeoLite", contextWindow: 512000,  maxTokens: 128000,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
          { id: "neosmith.intelligent-maestro", name: "NeoSmith Maestro", contextWindow: 1000000, maxTokens: 128000,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
        ],
      },
    },
  },
  agents: { defaults: { model: { primary: "neosmith/neosmith.intelligent-pro" } } },
}
```

Or with OpenClaw's own CLI, which writes through its parser and validator:

```bash
openclaw config set models.providers.neosmith.baseUrl https://router.neosmith.ai/v1
openclaw config set models.providers.neosmith.apiKey sk-plus-yourname-xxxxxx
openclaw config set models.providers.neosmith.api openai-completions
openclaw models set neosmith/neosmith.intelligent-pro
```

Notes on the fields that matter:

- **`api`** — `openai-completions` for a `/v1/chat/completions` backend, which is what NeoSmith serves. Set `openai-responses` only for a backend that implements `/v1/responses`. A custom provider with a `baseUrl` and no `api` defaults to `openai-completions` anyway, but declaring it is clearer.
- **`apiKey`** — a literal, or a `${VAR}` reference. `neosmith openclaw on` writes a literal at mode `0600`; `neosmith keys` reports either form.
- **`contextWindow` / `maxTokens`** — declare these. `GET /v1/models` returns ids only, so OpenClaw cannot discover them. `neosmith.neolite` is the sealed 512K budget tier; the others are 1M.
- **`cost`** — zeroed. NeoSmith bills per its own contract, and a made-up per-token price would show fictional numbers in OpenClaw's usage view.
- **`agents.defaults.model.primary`** — `"<provider-id>/<model-id>"`. Without it the provider is configured and unused.

---

## Two things to know before editing this file by hand

**It is JSON5.** Comments, trailing commas and unquoted keys are all legal. `neosmith openclaw on` will **not** rewrite a config it cannot parse as strict JSON — it snapshots the file, prints the `openclaw config set` commands above, and leaves your file exactly as it was.

**The schema is enforced, and failure is fatal.** Per OpenClaw's own documentation, it *"only accepts configurations that fully match the schema. Unknown keys, malformed types, or invalid values cause the Gateway to refuse to start."* A stray field does not get ignored — it takes the gateway down. That is why `neosmith openclaw on` writes exactly the four documented provider keys and nothing else: no version stamp, no timestamps, no NeoSmith bookkeeping.

---

## Choosing a tier

> `neosmith openclaw on --model neosmith.intelligent-basic` for Sonnet-tier with no Opus escalation, or `--model neosmith.neolite` for the sealed 512K budget tier. Every SKU is registered either way, so `openclaw models set neosmith/<sku>` can switch without re-running `on`.

---

## Verify

- `neosmith openclaw status` — reports the wired environment, the default agent model, and flags a provider that is configured but *not* selected.
- Start the gateway. If it comes up, the config validated.
- Message the bot from one of your connected channels and check it answers.
- `neosmith doctor` round-trips a 1-token probe against the router with your stored key.

To confirm the traffic routed through NeoSmith, curl `/whoami` with your key (see Verify Connection in the Reference section).

## Troubleshooting

- **The gateway refuses to start after editing the config:** it validates strictly. Restore the pre-connect file — `neosmith openclaw off`, or copy it back from `~/.neosmith/snapshots/openclaw.bak` — and re-apply with `openclaw config set`, which validates as it writes.
- **`on` printed commands instead of writing:** your config is JSON5 this CLI cannot parse. That is the guard working; use the printed `openclaw config set` lines.
- **Provider configured but agents still use the old model:** `agents.defaults.model.primary` was not updated. `openclaw models set neosmith/neosmith.intelligent-pro`.
- **404 on every request:** the Base URL must include `/v1` and no trailing slash.
- **400 Unknown model:** use a `neosmith.*` SKU, not a `gpt-*` name.
- More: [reference/troubleshooting.md](../reference/troubleshooting)
