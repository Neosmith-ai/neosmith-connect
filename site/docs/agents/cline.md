---
title: Cline
layout: default
parent: Agents
nav_order: 3
---

# Cline + NeoSmith

Cline is an agentic plan/act extension for VS Code and JetBrains IDEs. It supports OpenAI-compatible endpoints, so it points at NeoSmith directly.

- **Endpoint:** `https://router.neosmith.ai/v1`
- **Format:** OpenAI Compatible
- **Model:** `neosmith.intelligent-pro`

---

## Install

- **VS Code / forks:** Extensions → search **"Cline"** → Install
- **JetBrains:** Settings → Plugins → Marketplace → search **"Cline"** → Install → restart IDE

---

## Configure

Open Cline's settings (gear icon in the Cline panel) and set:

```
API Provider:  OpenAI Compatible
Base URL:      https://router.neosmith.ai/v1
API Key:       sk-plus-yourname-xxxxxx
Model ID:      neosmith.intelligent-pro
```

Save. Cline's plan/act/verify loops now run on NeoSmith.

---

## Recommended settings

| Setting | Value | Why |
|---|---|---|
| Model ID | `neosmith.intelligent-pro` | Default tier; escalates to Opus on hard tasks |
| Enable streaming | On | NeoSmith supports SSE streaming |
| Tool/function calling | On | Required for Cline's agentic actions |

> For lower-cost, non-escalating use, set Model ID to `neosmith.intelligent-basic` (Sonnet-tier, no Opus) or `neosmith.intelligent-lite` (SLM-only).

---

## Verify

Open the Cline panel and ask it to read and summarize a file in your project. To confirm it routed through NeoSmith, curl `/whoami` with your key (see Verify Connection in the Reference section).

## Troubleshooting

- **Connection test fails:** Confirm the Base URL is exactly `https://router.neosmith.ai/v1` (include `/v1`, no trailing slash).
- **400 Unknown model:** Use `neosmith.intelligent-pro`, not a `gpt-*` name.
- More: [Troubleshooting](../reference/troubleshooting)
