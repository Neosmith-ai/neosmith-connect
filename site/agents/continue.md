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
  - name: NeoSmith
    provider: openai
    apiBase: https://router.neosmith.ai/v1
    model: neosmith.intelligent-pro
    apiKey: sk-plus-yourname-xxxxxx
```

Save. Select **NeoSmith** in the Continue model dropdown.

---

## Optional: autocomplete model

Continue uses a separate model for inline autocomplete. To route that through NeoSmith too, add a `tabAutocompleteModel`:

```yaml
tabAutocompleteModel:
  title: NeoSmith Autocomplete
  provider: openai
  apiBase: https://router.neosmith.ai/v1
  model: neosmith.intelligent-lite      # fast, low-cost for completions
  apiKey: sk-plus-yourname-xxxxxx
```

> Use `intelligent-lite` for autocomplete — completions are latency-sensitive and don't need Opus escalation.

---

## Verify

Open the Continue chat panel, select **NeoSmith**, and ask a question. To confirm it routed through NeoSmith, curl `/whoami` with your key (see Verify Connection in the Reference section).

## Troubleshooting

- **No response / 404:** Ensure `apiBase` ends in `/v1`.
- **400 Unknown model:** Use a `neosmith.*` SKU.
- More: [reference/troubleshooting.md](../reference/troubleshooting.md)
