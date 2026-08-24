---
title: "Reference: Troubleshooting"
layout: default
parent: Reference
nav_order: 2
---

# Reference: Troubleshooting

Common issues across all IDEs, agents, and platforms. Always start by confirming raw connectivity with [verify-connection.md](verify-connection) — this tells you whether the problem is your **key/endpoint** or your **agent config**.

---

## Authentication

| Symptom | Cause | Fix |
|---|---|---|
| `401 Unauthorized` | Wrong/missing key | Re-check the key; ensure no leading/trailing whitespace; confirm it against `/whoami` (see verify-connection.md) |
| `401` only in IDE, curl works | Agent sending wrong header | OpenAI agents use `Authorization: Bearer`; Anthropic (Claude Code) uses `x-api-key`. The NeoSmith endpoints accept the right header per format automatically — just ensure the key is set in the agent |
| Key worked, now fails | Key rotated or cap exhausted | Re-verify with `/whoami`; contact your admin to rotate or raise the cap |

## Endpoint / URL

| Symptom | Cause | Fix |
|---|---|---|
| `404` on `/v1/chat/completions` | Missing `/v1` in base URL | OpenAI agents need `https://router.neosmith.ai/v1` |
| Claude Code can't connect | Wrong base URL shape | Claude Code uses the **bare** host `https://router.neosmith.ai` (it appends `/v1/messages`) |
| Trailing-slash issues | Double slash in path | Use the URL exactly as documented, no trailing slash |

## Model

| Symptom | Cause | Fix |
|---|---|---|
| `400 Unknown model` | Sent a `gpt-*` or unsupported name | Use a `neosmith.*` SKU (`intelligent-pro`/`-basic`/`-lite`/`-maestro`) or a `claude-*` id |
| Want cheaper routing | Using `intelligent-pro` (can escalate to Opus) | Switch to `intelligent-basic` (Sonnet-tier) or `intelligent-lite` (SLM-only) |

## Cursor

| Symptom | Cause | Fix |
|---|---|---|
| Wrote `cursor.models.*` to `settings.json`, nothing changed | Cursor ignores those keys — native BYOK lives in an encrypted, server-synced store, not the settings file | Enter it in **Cursor → Settings → Models** (see [ides/cursor.md](../ides/cursor)), or use the Claude Code extension via `neosmith claude on` |
| No "OpenAI API Key" / "Override Base URL" option in Settings → Models | Custom OpenAI endpoints require Cursor **Pro/Ultra** (not on the free tier) | Upgrade Cursor, or use the scriptable Claude Code path (`neosmith cursor on` prints both) |

## Environment variables not picked up

| Platform | Most common cause | Fix |
|---|---|---|
| **macOS** | Vars in `~/.zshrc` not seen by Dock-launched apps | Use `~/.zprofile`, or launch the IDE from a terminal |
| **Linux** | GUI apps read `~/.profile`, not `~/.bashrc` | Put vars in `~/.profile` or `/etc/environment`; re-login |
| **Windows native** | IDE started before var was set | Set user-level var, then fully quit + relaunch the IDE |
| **Windows WSL** | IDE running Windows-native, not in WSL context | Use VS Code Remote-WSL; launch IDE from the WSL terminal |
| **All** | Window reload instead of full restart | Fully quit the IDE process and relaunch |

## Network / firewall

| Symptom | Cause | Fix |
|---|---|---|
| Connection refused / timeout | Outbound HTTPS blocked | Allow outbound to `router.neosmith.ai:443` |
| Corporate proxy interferes | TLS interception / proxy | Add `router.neosmith.ai` to proxy allowlist; configure your agent's proxy settings |
| Works on home network, fails at office | Egress firewall | Ask IT to allowlist `router.neosmith.ai` |

## Performance / latency

| Symptom | Explanation | Action |
|---|---|---|
| Chat responses 2–10s for hard tasks | Expected — complex multi-file tasks route to the stronger model | Normal; simple queries are fast (sub-second) |
| All responses consistently >10s | Network path to `router.neosmith.ai` | Check connectivity; test with curl and compare |
| Slow git/file-watching on Windows | Project on `/mnt/c` under WSL | Move project to WSL home `~/...` |

## Streaming

| Symptom | Cause | Fix |
|---|---|---|
| Agent shows nothing then dumps all at once | NeoSmith streams as a single block in some modes | Expected for the current streaming mode; functionally correct |
| Agent requires streaming, errors without it | Streaming flag off | Enable streaming in the agent (NeoSmith supports SSE) |

## Tool / function calling

| Symptom | Cause | Fix |
|---|---|---|
| Agentic actions don't fire (JetBrains AI, Cline) | Tool calling disabled | Enable "Tool calling" in the provider settings |
| Codex tools error | Wrong wire format | Ensure Codex uses `wire_api = "responses"` and `neosmith.intelligent-pro` |

---

## Still stuck?

1. Run all five checks in [verify-connection.md](verify-connection).
2. Email **contact-us@neosmith.ai** with: the agent, IDE, OS, the exact error, and which verify-connection checks passed/failed.
