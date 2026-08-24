---
title: Zed
layout: default
parent: Agents
nav_order: 10
---

# Zed + NeoSmith

Zed is a high-performance native editor with a built-in agent panel. It accepts OpenAI-compatible providers, so it points at NeoSmith directly.

- **Endpoint:** `https://router.neosmith.ai/v1`
- **Format:** OpenAI Compatible
- **Model:** `neosmith.intelligent-pro`

Settings live in one JSON file, per OS:

```
Linux    ~/.config/zed/settings.json
macOS    ~/Library/Application Support/Zed/settings.json
Windows  %APPDATA%\Zed\settings.json
```

## Configure

### With the NeoSmith CLI (recommended)

```bash
neosmith zed on
```

That writes the OpenAI provider block, registers **every** NeoSmith SKU with its real context window, and leaves the rest of your `settings.json` alone. `neosmith zed off` restores your pre-connect settings byte-for-byte.

### By hand

```json
{
  "language_models": {
    "openai": {
      "api_url": "https://router.neosmith.ai/v1",
      "api_key": "sk-plus-yourname-xxxxxx",
      "available_models": [
        { "name": "neosmith.intelligent-pro",     "display_name": "NeoSmith Pro",     "max_tokens": 1000000, "tool_calling": true },
        { "name": "neosmith.intelligent-basic",   "display_name": "NeoSmith Basic",   "max_tokens": 1000000, "tool_calling": true },
        { "name": "neosmith.neolite",             "display_name": "NeoSmith NeoLite", "max_tokens": 512000,  "tool_calling": true },
        { "name": "neosmith.intelligent-maestro", "display_name": "NeoSmith Maestro", "max_tokens": 1000000, "tool_calling": true }
      ]
    }
  }
}
```

Restart Zed, then pick a NeoSmith model in the agent panel's model selector.

---

## `max_tokens` is the context window, not the output cap

This is the field most people get wrong, and getting it wrong is invisible.

Zed's documentation is explicit: *"you must provide the model's context window in `max_tokens`"* ([Use API Access](https://zed.dev/docs/ai/use-api-access)). It is **not** a per-response output limit — that is `max_completion_tokens`, and it is optional.

So a NeoSmith SKU declared with a small `max_tokens` behaves like a small-context model: Zed starts compacting the conversation almost immediately, and nothing in the UI tells you why. The correct values are `1000000` for Pro / Basic / Maestro and `512000` for NeoLite, the sealed budget tier.

> Versions of the NeoSmith CLI **before 0.10.0** wrote a flat `max_tokens: 8192` and registered only the tier you wired. If you connected Zed with an older CLI, run `neosmith zed off && neosmith zed on` to pick up the real windows and all four SKUs.

`tool_calling: true` matters too — Zed's agent panel needs it for edits and terminal actions.

---

## Choosing a tier

> All four SKUs are registered, so you can switch in Zed's own model selector without re-running `on`. `neosmith zed on --model neosmith.intelligent-basic` only changes which one is written first.

---

## Verify

- `neosmith zed status` — reports the wired environment, how many SKUs are registered, and the range of context windows declared.
- Open Zed's agent panel, pick a NeoSmith model, and send a prompt.
- `neosmith doctor` round-trips a 1-token probe against the router with your stored key.

To confirm the traffic routed through NeoSmith, curl `/whoami` with your key (see Verify Connection in the Reference section).

## Troubleshooting

- **404 on every request:** the Base URL must be `https://router.neosmith.ai/v1` — include `/v1`, no trailing slash. Zed reads it from `api_url`.
- **400 Unknown model:** use a `neosmith.*` SKU, not a `gpt-*` name.
- **Conversation compacts after a few messages:** `max_tokens` is too small. See above — it is the context window.
- **Only one NeoSmith model in the picker:** a pre-0.10.0 connect registered only the wired tier. `neosmith zed off && neosmith zed on`.
- **Your own OpenAI provider disappeared:** it should not have. `on` merges and `off` restores; if something looks wrong, `neosmith originals --show zed` prints your pre-connect `settings.json`.
- More: [reference/troubleshooting.md](../reference/troubleshooting)
