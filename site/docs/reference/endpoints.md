---
title: Endpoints & SKUs
layout: default
parent: Reference
nav_order: 1
---

# Reference: Endpoints, Model SKUs & Headers

## Base Endpoints

| Endpoint | Format | Path examples | Used by |
|---|---|---|---|
| `https://router.neosmith.ai` | **Anthropic Messages API** | `/v1/messages` | Claude Code |
| `https://router.neosmith.ai/v1` | **OpenAI API** | `/v1/chat/completions`, `/v1/responses`, `/v1/models` | Cline, Continue, JetBrains AI, Cursor, Codex |

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

| Model SKU | Tier | Behavior |
|---|---|---|
| `neosmith.intelligent-pro` | Opus-tier (**default**) | SLM-first, escalates to Claude Opus on hard tasks / verifier-fail |
| `neosmith.intelligent-basic` | Sonnet-tier | SLM-first with Sonnet fallback; **no Opus** |
| `neosmith.intelligent-lite` | Haiku/SLM-only | Lowest cost, SLM-only, no frontier escalation |

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
| `ANTHROPIC_API_KEY` | `sk-plus-yourname-xxxxxx` | Claude Code |
| `ANTHROPIC_MODEL` | `claude-opus-4` (optional) | Claude Code |
| `OPENAI_BASE_URL` | `https://router.neosmith.ai/v1` | OpenAI SDK clients, Codex |
| `OPENAI_API_KEY` | `sk-plus-yourname-xxxxxx` | OpenAI SDK clients, Codex |
