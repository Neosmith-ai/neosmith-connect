# Contributing to the NeoSmith Developer Guide

This guide is published for NeoSmith customers and prospects. Contributions that improve clarity, fix errors, or add coverage for new IDEs/agents/platforms are welcome.

## Structure

```
neosmith-developer-guide/
├── README.md              # Entry point — quick start + navigation
├── COMPATIBILITY.md       # At-a-glance matrix
├── ides/                  # Per-IDE setup (vscode, jetbrains, cursor, antigravity)
├── agents/                # Per-agent setup (claude-code, codex, cline, continue, jetbrains-ai)
├── platforms/             # Per-OS setup (macos, linux, windows-native, windows-wsl)
├── reference/             # endpoints, verify-connection, troubleshooting
└── assets/                # Images / screenshots
```

## Conventions

- **Endpoints:** Always use the real production values:
  - Anthropic format (Claude Code): `https://router.neosmith.ai`
  - OpenAI format (everything else): `https://router.neosmith.ai/v1`
- **Model SKUs:** `neosmith.intelligent-pro` / `-basic` / `-lite`. Never reference internal vendor model names.
- **Keys:** Use the placeholder `sk-plus-yourname-xxxxxx` in all examples.
- **Cross-links:** Use relative paths so links work on GitHub.
- Keep each page self-contained but link to platform/reference pages instead of repeating OS-specific steps.

## When adding a new agent or IDE

1. Add the page under `agents/` or `ides/`.
2. Add a row to `README.md` and `COMPATIBILITY.md`.
3. Verify every command against [reference/verify-connection.md](reference/verify-connection.md).

## Accuracy

Before publishing changes, confirm endpoints and SKUs against the running router (`/v1/models`, `/whoami`). Don't document features that aren't live.
