# Copilot Chat + NeoSmith

GitHub Copilot Chat in VS Code can be pointed at a custom OpenAI-compatible endpoint, so it runs on NeoSmith without a Copilot model subscription.

- **Endpoint:** `https://router.neosmith.ai/v1`
- **Format:** OpenAI Compatible (`apiType: "chat-completions"`)
- **Model:** `neosmith.intelligent-pro`

The file is owned by **VS Code itself**, not by the Copilot Chat extension, and it sits at the profile root:

```
Windows  %APPDATA%\Code\User\chatLanguageModels.json
macOS    ~/Library/Application Support/Code/User/chatLanguageModels.json
Linux    ~/.config/Code/User/chatLanguageModels.json

named profile   <that User dir>/profiles/<location>/chatLanguageModels.json
```

---

## Install

Copilot Chat ships with VS Code, or install the **GitHub Copilot Chat** extension from the Marketplace.

---

## Configure

### With the NeoSmith CLI (recommended)

```bash
neosmith copilot on
```

That registers the NeoSmith provider with all four SKUs — in the default profile **and** in every named profile that does not inherit language models from it — then prints the one manual step.

### The one step a CLI cannot do

**The API key is not written to disk, deliberately.** VS Code keeps it in OS-keychain-backed SecretStorage and mints its own handle for it. Verified against a live build: given an entry with no `apiKey`, VS Code rewrites the file and appends its own —

```json
"apiKey": "${input:chat.lm.secret.70e22ef4}"
```

— leaving everything else exactly as written. That hash is **per provider entry**, not global: the same router URL in a second profile got `${input:chat.lm.secret.-b2c6430}`. So a handle can never be copied between profiles or synthesised, and an invented `${input:…}` name is not something VS Code resolves. Omitting the field is the only correct behaviour.

So, once:

```
Reload the window → Copilot Chat → Models → Manage Language Models
→ pick "NeoSmith" → paste your key when prompted
```

The prompt appears the first time you select a NeoSmith model in the picker.

### By hand

`chatLanguageModels.json` is a top-level **array** of provider entries:

```json
[
  {
    "name": "NeoSmith",
    "vendor": "customendpoint",
    "apiType": "chat-completions",
    "models": [
      { "id": "neosmith.intelligent-pro", "name": "NeoSmith Pro",
        "url": "https://router.neosmith.ai/v1",
        "toolCalling": true, "vision": true,
        "maxInputTokens": 1000000, "maxOutputTokens": 128000 }
    ]
  }
]
```

Note the endpoint lives on **each model** as `url`, not on the provider. `maxInputTokens` is the context window — 1M for Pro / Basic / Maestro, **512000** for NeoLite.

---

## `status` has three states, not two

`neosmith copilot status` reports:

| State | Meaning |
|---|---|
| `off` | no NeoSmith provider registered |
| `models-written` | entries registered, **no key entered yet** |
| `on` | VS Code has stamped a SecretStorage handle onto our entry |

The third state is read from disk — the handle's presence is the only evidence the CLI can see that you completed the manual step. It also names any profile whose key is still outstanding.

A handle proves a key was *entered*, not that it is *valid*. `neosmith doctor` is what round-trips it against the router. `--confirmed` remains a manual override for builds that store the reference elsewhere.

---

## Choosing a tier

> All four SKUs are registered, so switch in VS Code's model picker without re-running `on`.

---

## Verify

- `neosmith copilot status` — one of the three states above, per profile.
- Reload the window, open Copilot Chat, pick a NeoSmith model, send a prompt.
- `neosmith doctor` checks the key against the router.

## Troubleshooting

- **`status` says `models-written` forever:** you have not entered the key in VS Code yet. Copilot Chat → Models → Manage Language Models → NeoSmith → paste key.
- **NeoSmith missing from the model picker:** reload the window. If it is still absent, check you are in the profile the CLI wrote to — `neosmith copilot status` lists them.
- **Nothing changed after connecting:** CLI versions at or below 0.8 wrote to `globalStorage/github.copilot-chat/`, a path VS Code never reads. `neosmith copilot off && neosmith copilot on` re-wires to the profile root and cleans up the stale file.
- **Only one NeoSmith model listed:** a pre-0.10.0 connect registered only the wired tier. `off` then `on`.
- **400 Unknown model:** use a `neosmith.*` SKU, not a `gpt-*` name.
- More: [reference/troubleshooting.md](../reference/troubleshooting.md)
