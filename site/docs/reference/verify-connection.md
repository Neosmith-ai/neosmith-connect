---
title: Verify Connection
layout: default
parent: Reference
nav_order: 2
---

# Reference: Verify Your Connection

Before configuring an IDE or agent, confirm your key and endpoint work with a raw `curl`. This isolates connectivity/auth problems from agent-config problems.

> On **Windows native**, run these from PowerShell (curl.exe is bundled with Windows 10+). On **WSL/macOS/Linux**, use a normal terminal.

## 1. Identity check (`/whoami`)

```bash
curl -s https://router.neosmith.ai/whoami \
  -H "Authorization: Bearer sk-plus-yourname-xxxxxx"
```

Expected: a JSON body with your dev slug, org, tier, and 30-day cap usage. A `401` means the key is wrong or missing.

## 2. Model list (`/v1/models`)

```bash
curl -s https://router.neosmith.ai/v1/models \
  -H "Authorization: Bearer sk-plus-yourname-xxxxxx"
```

Expected: a list including `neosmith.intelligent-pro`, `neosmith.intelligent-basic`, `neosmith.neolite`.

## 3. OpenAI-format chat (`/v1/chat/completions`)

```bash
curl -s https://router.neosmith.ai/v1/chat/completions \
  -H "Authorization: Bearer sk-plus-yourname-xxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "neosmith.intelligent-pro",
    "messages": [{"role": "user", "content": "Say hello in one word."}],
    "max_tokens": 20
  }'
```

Expected: a normal OpenAI chat completion, plus a `neosmith_meta` field.

## 4. OpenAI Responses format (`/v1/responses`) — for Codex

```bash
curl -s https://router.neosmith.ai/v1/responses \
  -H "Authorization: Bearer sk-plus-yourname-xxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "neosmith.intelligent-pro",
    "input": "Say hello in one word.",
    "max_output_tokens": 20
  }'
```

Expected: a Responses-API body with an `output` array.

## 5. Anthropic-format message (`/v1/messages`) — for Claude Code

```bash
curl -s https://router.neosmith.ai/v1/messages \
  -H "x-api-key: sk-plus-yourname-xxxxxx" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-opus-4",
    "max_tokens": 20,
    "messages": [{"role": "user", "content": "Say hello in one word."}]
  }'
```

Expected: an Anthropic-format message with `content` blocks.

---

## Interpreting failures

| Result | Meaning | Fix |
|---|---|---|
| `401 Unauthorized` | Bad/missing key | Check the key; ensure no trailing whitespace |
| `400 Unknown model` | Model name not accepted | Use a `neosmith.*` SKU or `claude-*` id, not `gpt-4o` |
| `Connection refused / timeout` | Network/firewall | Ensure outbound HTTPS to `router.neosmith.ai:443` is allowed |
| `404` on `/v1/chat/completions` | Wrong base URL | Include `/v1` for OpenAI-format clients |
| Works in curl, fails in IDE | Agent config issue | Recheck the agent's base URL + key; see the per-agent guide |
