---
title: Reference
layout: default
nav_order: 5
has_children: true
---

# Reference

The contract behind the walkthroughs — what the endpoints are, how to prove a
connection works, what to do when it doesn't, and the per-OS and per-editor
notes that don't belong on any one harness page.

## The contract

- [Endpoints, Model SKUs & Headers](endpoints) — base URLs, the SKU ladder and
  its context windows, auth headers
- [Verify Your Connection](verify-connection) — raw `curl` round-trips that tell
  you whether the problem is your key/endpoint or your agent config
- [Troubleshooting](troubleshooting) — symptom-first tables for auth, endpoint,
  model, env-var, network and streaming failures

## Per-OS notes

Where environment variables have to go, and why the answer differs. This matters
most for **Codex**, which reads its key from `$OPENAI_API_KEY` at runtime rather
than from its config file.

- [macOS](platform-macos) — GUI apps read `~/.zshenv`, not `~/.zshrc`
- [Linux](platform-linux)
- [Windows (native)](platform-windows) — `setx`, not a POSIX `export`
- [Windows (WSL2)](platform-wsl)

## Per-editor notes

Which harness to reach for inside a given editor. The harness pages under
[Harnesses]({{ site.baseurl }}/harnesses/) are the setup instructions; these two
just help you pick.

- [VS Code](editors-vscode)
- [JetBrains IDEs](editors-jetbrains)
