---
title: JetBrains AI Assistant
layout: default
parent: Harnesses
nav_order: 5
---

# JetBrains AI Assistant + NeoSmith

JetBrains AI Assistant (built into IntelliJ IDEA, PyCharm, GoLand, WebStorm, Rider, CLion, DataGrip, RubyMine, RustRover, PhpStorm) supports an OpenAI-compatible provider — so it points at NeoSmith natively.

- **Endpoint:** `https://router.neosmith.ai/v1`
- **Format:** OpenAI Compatible
- **Requires:** JetBrains IDE 2024.1+

---

## Individual developer setup

```
Settings (Cmd+, / Ctrl+Alt+S)
  → Tools → AI Assistant → Providers & API Keys
    → Provider:  OpenAI-compatible
    → URL:       https://router.neosmith.ai/v1
    → API Key:   sk-plus-yourname-xxxxxx
    → Enable:    ✅ Tool calling
    → Click:     Test Connection → green checkmark
```

Then assign the NeoSmith model to features:

```
  → Models & API Keys tab
    → Assign neosmith.intelligent-pro to:
        Chat · Inline completion · Commit message ·
        Test generation · Documentation
```

Click **Apply** → **OK**.

> **Tool calling must be enabled** — it's required for agent-mode features and multi-step actions.

---

## Enterprise setup (IDE Services — one admin, entire org)

Propagate the NeoSmith config to all developers automatically:

```
IDE Services Web UI
  → Config → AI Enterprise → OpenAI Compatible
    → URL:     https://router.neosmith.ai/v1
    → API Key: <org-level NeoSmith key>
    → Assign to user profiles → Save
```

All connected JetBrains IDEs (and JetBrains Air cloud environments) receive the config on next start. No per-developer setup.

> Use an **org-level** NeoSmith key here, not an individual one. Contact your NeoSmith account team to provision one with appropriate limits.

---

## Which model for which feature

| Feature | Suggested SKU | Why |
|---|---|---|
| Chat | `neosmith.intelligent-pro` | May need Opus for hard questions |
| Inline completion | `neosmith.neolite` | Latency-critical, SLM-only |
| Commit message | `neosmith.neolite` | Short, structured |
| Test / doc generation | `neosmith.intelligent-basic` | Mid-complexity, no Opus |

---

## Verify

Open the AI Assistant chat panel (**View → Tool Windows → AI Assistant**) and ask a question. For a planning-heavy test, ask it to describe a multi-file component's architecture — this routes to the stronger model in NeoSmith's ensemble.

## Troubleshooting

- **Test Connection fails:** URL must be exactly `https://router.neosmith.ai/v1` (include `/v1`, no trailing slash); ensure Tool calling is enabled.
- More: [reference/troubleshooting.md](../reference/troubleshooting)
