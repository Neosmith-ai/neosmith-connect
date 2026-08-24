# Reference: Endpoints, Model SKUs & Headers

## Base Endpoints

<!-- BEGIN manifest:endpoints -->
| Endpoint | Format | Path examples | Used by |
|---|---|---|---|
| `https://router.neosmith.ai` | **Anthropic Messages API** | `/v1/messages` | Claude Code |
| `https://router.neosmith.ai/v1` | **OpenAI API** | `/v1/chat/completions`, `/v1/responses`, `/v1/models` | Codex, Continue, Cline, JetBrains AI, Copilot Chat, Zed, Cursor, OpenCode, OpenClaw, Junie CLI |
<!-- END manifest:endpoints -->

> **Important:** The OpenAI-format clients need the **`/v1`** suffix in the base URL. The Anthropic-format client (Claude Code) uses the **bare** host (it appends `/v1/messages` itself).

## Supported API Surfaces

| Route | Method | Format | Notes |
|---|---|---|---|
| `/v1/messages` | POST | Anthropic | Claude Code, Anthropic SDK |
| `/v1/chat/completions` | POST | OpenAI | Most BYOM agents |
| `/v1/responses` | POST | OpenAI Responses | OpenAI Codex, newer agents |
| `/v1/models` | GET | OpenAI | Model list (for clients that query it) |
| `/whoami` | GET | — | Auth + identity check |

## Model SKUs

NeoSmith exposes branded model SKUs. Set whichever your agent requires in its `model` field. Routing is automatic behind each SKU.

<!-- BEGIN manifest:skus -->
| Model SKU | Tier | Context | Behaviour |
|---|---|---|---|
| `neosmith.intelligent-pro` | NeoSmith Pro (**default**) | 1M | Cost-optimised with Opus escalation |
| `neosmith.intelligent-basic` | NeoSmith Basic | 1M | Cost-optimised with Sonnet ceiling |
| `neosmith.neolite` | NeoSmith NeoLite | 512K | Sealed budget tier · 512K · cheapest |
| `neosmith.intelligent-maestro` | NeoSmith Maestro | 1M | Highest-accuracy agentic coding |
<!-- END manifest:skus -->

> Anthropic-style model ids (e.g. `claude-opus-4`) are also accepted for Claude Code compatibility and map to the `intelligent-pro` tier. Unknown model names (e.g. `gpt-4o`) are **rejected** with HTTP 400.

## Authentication

All requests authenticate with your NeoSmith API key. Keys come in three prefixes by tier — `sk-plus-*`, `sk-slm-*`, `sk-std-*` — and a Cognito JWT (starts with `eyJ`) is also accepted. Examples below use `sk-plus-yourname-xxxxxx`.

| Format | Header |
|---|---|
| Anthropic (`/v1/messages`) | `x-api-key: sk-plus-...` **or** `Authorization: Bearer sk-plus-...` |
| OpenAI (`/v1/...`) | `Authorization: Bearer sk-plus-...` |

## Optional NeoSmith Headers

These headers add attribution and governance metadata (all optional):

| Header | Purpose |
|---|---|
| `x-neosmith-session` | Group requests into a session for routing stickiness |
| `x-neosmith-project` | Attribute cost to a project/repo |
| `x-neosmith-agent` | Tag which agent/tool sent the request (e.g. `github-actions`) |
| `x-neosmith-customer` | Explicit customer/dev id override |
| `x-neosmith-tier` | Request a specific tier |

## Response Metadata

Every response includes a `neosmith_meta` side-channel object (clients that don't recognize it ignore it):

```json
{
  "neosmith_meta": {
    "model": "neosmith.intelligent-pro",
    "model_class": "slm",
    "reason": "default_codegen",
    "verdict": "pass",
    "escalated": false,
    "latency_ms": 850
  }
}
```

Use this to see which model served the request and whether it escalated to Opus.

## Environment Variable Summary

| Variable | Value | Used by |
|---|---|---|
| `ANTHROPIC_BASE_URL` | `https://router.neosmith.ai` | Claude Code |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` | `sk-plus-yourname-xxxxxx` | Claude Code |
| `ANTHROPIC_MODEL` | `neosmith.intelligent-pro` (default SKU) | Claude Code |
| `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU,FABLE}_MODEL` | per-tier NeoSmith SKU (see ladder below) | Claude Code `/model` picker |
| `ANTHROPIC_DEFAULT_{...}_MODEL_NAME` / `_DESCRIPTION` | branded label + description per tier | Claude Code `/model` picker |
| `OPENAI_BASE_URL` | `https://router.neosmith.ai/v1` | OpenAI SDK clients, Codex |
| `OPENAI_API_KEY` | `sk-plus-yourname-xxxxxx` | OpenAI SDK clients, Codex |

**Claude Code per-tier ladder** (written by `neosmith claude on`):

| Slot | SKU | Display name |
|---|---|---|
| OPUS | `neosmith.intelligent-pro` | NeoSmith Pro |
| SONNET | `neosmith.intelligent-basic` | NeoSmith Basic |
| HAIKU | `neosmith.neolite` | NeoSmith NeoLite |
| FABLE | `neosmith.intelligent-maestro` | NeoSmith Maestro |
