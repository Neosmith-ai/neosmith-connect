# OpenAI Codex + NeoSmith

Codex (OpenAI's CLI coding agent) speaks the **OpenAI Responses API** (`/v1/responses`). NeoSmith implements this surface, so Codex can route through NeoSmith with a base-URL + key change.

- **Endpoint:** `https://router.neosmith.ai/v1`
- **Format:** OpenAI Responses API (`/v1/responses`)
- **Model:** `neosmith.intelligent-pro`

---

## Setup

Codex reads OpenAI environment variables. Set them in your shell profile (see your [platform guide](../README.md#platform-setup-operating-system)):

```bash
export OPENAI_BASE_URL=https://router.neosmith.ai/v1
export OPENAI_API_KEY=sk-plus-yourname-xxxxxx
```

Then point Codex at the NeoSmith model. In Codex's config (`~/.codex/config.toml` or equivalent), set the model and base URL:

```toml
model = "neosmith.intelligent-pro"
model_provider = "neosmith"

[model_providers.neosmith]
name = "NeoSmith"
base_url = "https://router.neosmith.ai/v1"
env_key = "OPENAI_API_KEY"
wire_api = "responses"
```

> The exact config key names depend on your Codex version. The essentials are: **base URL `https://router.neosmith.ai/v1`**, **API key = your NeoSmith key**, **wire format = `responses`**, **model = `neosmith.intelligent-pro`**.

---

## What NeoSmith supports for Codex

NeoSmith's `/v1/responses` implementation covers the surface Codex's agentic loop needs:

| Codex requirement | Supported |
|---|---|
| `POST /v1/responses` endpoint | ✅ |
| SSE streaming with Responses event types | ✅ |
| Function/tool calls in Responses format | ✅ |
| `id` + `status` fields on output items (multi-turn replay) | ✅ |
| `store: true` parameter | ✅ (accepted; router is stateless) |
| `reasoning.effort` passthrough | ✅ (routed/ignored per backend) |
| `previous_response_id` (conversation continuity) | ✅ (accepted) |

---

## Verify

```bash
curl -s https://router.neosmith.ai/v1/responses \
  -H "Authorization: Bearer sk-plus-yourname-xxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "neosmith.intelligent-pro",
    "input": "Write a haiku about caching.",
    "max_output_tokens": 60
  }'
```

Expected: a Responses-API body with an `output` array of items, plus `neosmith_meta`.

## Notes & limits

- Codex's built-in tools (`apply_patch`, `shell`) are passed through in Responses format; NeoSmith accepts function-type tools. Non-function built-in tool types are accepted without error but may be handled by Codex client-side.
- File-input items and server-side storage are accepted but not persisted (the router is stateless by design — conversation state is reconstructed from the input each turn).

## Troubleshooting

See [reference/troubleshooting.md](../reference/troubleshooting.md). If Codex errors on model validation, confirm you set `model = "neosmith.intelligent-pro"` (not `gpt-*`, which NeoSmith rejects with 400).
