---
title: Windows (WSL2)
layout: default
parent: Reference
nav_order: 7
---

# Platform Setup: Windows with WSL2 (Recommended)

WSL2 (Windows Subsystem for Linux) gives you a real Linux environment on Windows. This is the **recommended** setup for Claude Code and most AI coding agents, because they assume a POSIX shell and Unix tooling.

```
Windows 11 / 10
  └── WSL2 (Ubuntu)  ──► Claude Code / Codex / Cline  ──► router.neosmith.ai
       │
       └── Your IDE can run either inside WSL (VS Code Remote-WSL)
           or on Windows connecting into WSL.
```

---

## 1. Install WSL2

In an **Administrator PowerShell**:

```powershell
wsl --install
```

This installs WSL2 + Ubuntu by default. Reboot when prompted, then set a Linux username/password on first launch. Confirm version 2:

```powershell
wsl -l -v        # VERSION column should show 2
```

---

## 2. Set up the Linux environment (inside WSL)

Open the **Ubuntu** terminal (Start → Ubuntu) and treat it exactly like Linux:

```bash
# Node via nvm (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install --lts

# Claude Code CLI
npm install -g @anthropic-ai/claude-code
```

## 3. Set environment variables (inside WSL)

```bash
# Add to ~/.bashrc
export ANTHROPIC_BASE_URL=https://router.neosmith.ai
export ANTHROPIC_API_KEY=sk-plus-yourname-xxxxxx
```

For OpenAI-format agents (Codex):

```bash
export OPENAI_BASE_URL=https://router.neosmith.ai/v1
export OPENAI_API_KEY=sk-plus-yourname-xxxxxx
```

Apply and verify:

```bash
source ~/.bashrc
echo $ANTHROPIC_BASE_URL
curl -s https://router.neosmith.ai/whoami -H "Authorization: Bearer sk-plus-yourname-xxxxxx"
```

## 4. One-command Claude Code setup (inside WSL)

```bash
npx @neosmithai/cli init sk-plus-yourname-xxxxxx
```

---

## 5. Connect your IDE

### VS Code + Remote-WSL (recommended)

1. Install **VS Code on Windows** (native).
2. Install the **WSL** extension (`ms-vscode-remote.remote-wsl`).
3. From the WSL terminal, in your project folder, run `code .` — VS Code opens connected to WSL.
4. Install the **Claude Code** extension *in the WSL context* (VS Code prompts you per-context).
5. The extension now reads the env vars from your WSL `~/.bashrc`. Open the panel with **Ctrl+Esc**.

> This is the cleanest setup: the agent runs in Linux, the editor UI runs on Windows. Everything "just works" with the Linux env vars.

### JetBrains + WSL

JetBrains IDEs can open projects located in the WSL filesystem (`\\wsl$\Ubuntu\home\...`). For:
- **Path A (Claude Code plugin):** Set the env vars in WSL and launch the JetBrains IDE from the WSL terminal, or use the JetBrains Gateway/WSL backend so the plugin inherits the WSL environment.
- **Path B (JetBrains AI Assistant):** No env vars needed — configure `https://router.neosmith.ai/v1` directly in Settings (works the same whether the IDE is Windows-native or WSL-backed). See [harnesses/jetbrains-ai.md](../harnesses/jetbrains-ai).

---

## 6. Keep projects in the Linux filesystem

For best performance, keep your code under the WSL home directory (`~/projects/...`), **not** under `/mnt/c/...`. Cross-filesystem access (`/mnt/c`) is significantly slower for git and file-watching.

---

## WSL vs Native Windows — which to choose

| | WSL2 | Native Windows |
|---|---|---|
| Claude Code / Codex / Cline | ✅ Best | ⚠️ Works, occasional rough edges |
| JetBrains AI Assistant (Path B) | ✅ | ✅ (no shell needed) |
| Tooling (git, npm, shell scripts) | ✅ Native Linux | ⚠️ Some assume POSIX |
| Setup effort | Slightly more (install WSL) | Less |
| **Recommendation** | **Default choice** | Use if WSL unavailable |

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `curl` works in WSL but IDE can't connect | Ensure the IDE is running *in the WSL context* (Remote-WSL), not Windows-native against WSL env vars |
| Env vars not seen | `source ~/.bashrc`; relaunch the IDE from the WSL terminal |
| Slow git / file watching | Move the project from `/mnt/c/...` to `~/...` inside WSL |
| `wsl --install` fails | Enable "Virtual Machine Platform" + "Windows Subsystem for Linux" in Windows Features, reboot |

More: [reference/troubleshooting.md](troubleshooting)

## Next

Pick your IDE or agent guide from the [main README]({{ site.baseurl }}/).
