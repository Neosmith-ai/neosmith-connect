---
title: Continue
layout: default
parent: Harnesses
nav_order: 3
---

# Continue + NeoSmith

Continue is an open-source AI code assistant for VS Code and JetBrains. It supports OpenAI-compatible providers via a config file.

- **Endpoint:** `https://router.neosmith.ai/v1`
- **Format:** OpenAI (`provider: openai` with custom `apiBase`)
- **Model:** `neosmith.intelligent-pro`

---

## Install

- **VS Code / forks:** Extensions → search **"Continue"** → Install
- **JetBrains:** Settings → Plugins → Marketplace → search **"Continue"** → Install → restart IDE

---

## Configure

Edit `~/.continue/config.yaml` (Continue opens this from its panel — click the gear, or "Configure"):

```yaml
name: Local Config
version: 1.0.0
schema: v1

models:
  # The tier you connected with, under the bare `NeoSmith` name.
  - name: NeoSmith
    provider: openai
    apiBase: https://router.neosmith.ai/v1
    model: neosmith.intelligent-pro
    apiKey: sk-plus-yourname-xxxxxx
    defaultCompletionOptions: { contextLength: 1000000, maxTokens: 128000 }
  # Then one entry per SKU, so every tier is in the dropdown.
  - name: NeoSmith Pro
    provider: openai
    apiBase: https://router.neosmith.ai/v1
    model: neosmith.intelligent-pro
    apiKey: sk-plus-yourname-xxxxxx
    defaultCompletionOptions: { contextLength: 1000000, maxTokens: 128000 }
  - name: NeoSmith Basic
    provider: openai
    apiBase: https://router.neosmith.ai/v1
    model: neosmith.intelligent-basic
    apiKey: sk-plus-yourname-xxxxxx
    defaultCompletionOptions: { contextLength: 1000000, maxTokens: 128000 }
  - name: NeoSmith NeoLite
    provider: openai
    apiBase: https://router.neosmith.ai/v1
    model: neosmith.neolite
    apiKey: sk-plus-yourname-xxxxxx
    defaultCompletionOptions: { contextLength: 512000, maxTokens: 128000 }
  - name: NeoSmith Maestro
    provider: openai
    apiBase: https://router.neosmith.ai/v1
    model: neosmith.intelligent-maestro
    apiKey: sk-plus-yourname-xxxxxx
    defaultCompletionOptions: { contextLength: 1000000, maxTokens: 128000 }
```

`defaultCompletionOptions.contextLength` is the model's context window and is worth
declaring: `GET /v1/models` returns ids only, so Continue cannot discover it and
falls back to a conservative default. NeoLite is the sealed **512K** budget tier;
the other three are 1M.

Save. Select **NeoSmith** in the Continue model dropdown.

---

## Optional: autocomplete model

Continue uses a separate model for inline autocomplete. To route that through NeoSmith too, add a `tabAutocompleteModel`:

```yaml
tabAutocompleteModel:
  title: NeoSmith Autocomplete
  provider: openai
  apiBase: https://router.neosmith.ai/v1
  model: neosmith.neolite               # fast, low-cost for completions
  apiKey: sk-plus-yourname-xxxxxx
```

> Use `neosmith.neolite` for autocomplete — completions are latency-sensitive and
> don't need Opus escalation. (`neosmith.intelligent-lite` is a DE-LISTED alias:
> the router still routes it, but `GET /v1/models` no longer lists it.)

---

## Verify

Open the Continue chat panel, select **NeoSmith**, and ask a question. To confirm it routed through NeoSmith, curl `/whoami` with your key (see Verify Connection in the Reference section).

## Troubleshooting

- **No response / 404:** Ensure `apiBase` ends in `/v1`.
- **400 Unknown model:** Use a `neosmith.*` SKU.
- More: [reference/troubleshooting.md](../reference/troubleshooting)
