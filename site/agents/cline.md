# Cline + NeoSmith

Cline is an agentic plan/act coding agent with three front ends — the **VS Code extension**, the **JetBrains plugin**, and the **standalone `cline` CLI**. It supports OpenAI-compatible endpoints, so it points at NeoSmith directly.

- **Endpoint:** `https://router.neosmith.ai/v1`
- **Format:** OpenAI Compatible
- **Model:** `neosmith.intelligent-pro`

Since Cline 4.x, all three front ends read the **same global config**, so wiring it once covers the editor and the terminal:

```
($CLINE_DIR || ~/.cline)/data/settings/providers.json   # provider, key, model, baseUrl
($CLINE_DIR || ~/.cline)/data/settings/models.json      # context window + capabilities
```

---

## Install

- **VS Code / forks:** Extensions → search **"Cline"** → Install
- **JetBrains:** Settings → Plugins → Marketplace → search **"Cline"** → Install → restart IDE
- **Standalone CLI:** `npm i -g @cline/cli` → run `cline` (add `-i` for the TUI)

---

## Configure

### With the NeoSmith CLI (recommended)

```bash
neosmith cline on
```

That writes both files above, registers the `openai-compatible` provider, and sets `lastUsedProvider` so the provider it wrote is the one Cline actually uses. `neosmith cline off` restores your pre-connect config byte-for-byte, including which provider was selected.

### By hand — standalone CLI

`cline auth` is fully non-interactive and writes the same `providers.json`:

```bash
cline auth -p openai-compatible \
  -k sk-plus-yourname-xxxxxx \
  -m neosmith.intelligent-pro \
  -b https://router.neosmith.ai/v1
```

Check it with `cline config` (needs a TTY), or read `~/.cline/data/settings/providers.json` directly.

### By hand — VS Code / JetBrains

Open Cline's settings (gear icon in the Cline panel) and set:

```
API Provider:  OpenAI Compatible
Base URL:      https://router.neosmith.ai/v1
API Key:       sk-plus-yourname-xxxxxx
Model ID:      neosmith.intelligent-pro
```

Save. Cline's plan/act/verify loops now run on NeoSmith.

> **On Cline 3.x?** The provider lived in VS Code's extension state (`state.vscdb`) back then, not in `~/.cline` — the gear-icon UI above is the only way in, and `neosmith cline on` prints these values for exactly that case.

---

## Recommended settings

| Setting | Value | Why |
|---|---|---|
| Model ID | `neosmith.intelligent-pro` | Default tier; escalates to Opus on hard tasks |
| Enable streaming | On | NeoSmith supports SSE streaming |
| Tool/function calling | On | Required for Cline's agentic actions |

> For lower-cost, non-escalating use, set Model ID to `neosmith.intelligent-basic` (Sonnet-tier, no Opus) or `neosmith.neolite` (SLM-only).

---

## Verify

- **Editor:** open the Cline panel and ask it to read and summarize a file in your project.
- **CLI:** `cline "Reply with exactly the word NEOSMITHOK and nothing else."`
- **Either:** `neosmith cline status` reports the wired environment, the model, and whether the NeoSmith provider is the *selected* one.

To confirm the traffic routed through NeoSmith, curl `/whoami` with your key (see Verify Connection in the Reference section).

## Troubleshooting

- **Connection test fails:** Confirm the Base URL is exactly `https://router.neosmith.ai/v1` (include `/v1`, no trailing slash).
- **400 Unknown model:** Use `neosmith.intelligent-pro`, not a `gpt-*` name.
- **Config written, nothing changed:** `neosmith cline status` — if it says *NOT the active provider*, something switched `lastUsedProvider` after the connect. Re-run `neosmith cline off && neosmith cline on`, or pick NeoSmith in Cline's provider dropdown.
- **The CLI and the editor disagree:** they share one file. Check `$CLINE_DIR` and `$CLINE_PROVIDER_SETTINGS_PATH` — either one relocates the config for whichever process has it set.
- More: [reference/troubleshooting.md](../reference/troubleshooting.md)
