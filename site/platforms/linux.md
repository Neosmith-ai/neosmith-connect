# Platform Setup: Linux

## Shell profile

| Shell | File |
|---|---|
| bash (default on Ubuntu/Debian) | `~/.bashrc` |
| zsh | `~/.zshrc` |
| Login shells / display managers | `~/.profile` |

## Set the variables

For Claude Code (Anthropic format):

```bash
# Add to ~/.bashrc (or ~/.zshrc)
export ANTHROPIC_BASE_URL=https://router.neosmith.ai
export ANTHROPIC_API_KEY=sk-plus-yourname-xxxxxx
```

For OpenAI-format agents (Codex, OpenAI SDK):

```bash
export OPENAI_BASE_URL=https://router.neosmith.ai/v1
export OPENAI_API_KEY=sk-plus-yourname-xxxxxx
```

Apply without restarting:

```bash
source ~/.bashrc
```

Verify:

```bash
echo $ANTHROPIC_BASE_URL      # → https://router.neosmith.ai
```

## GUI apps and env vars

GUI IDEs launched from the desktop menu read env vars from `~/.profile` (or the display manager's environment), **not** `~/.bashrc`. Two reliable options:

1. **Put vars in `~/.profile`** and log out / log back in.
2. **Launch the IDE from a terminal** that has the vars set (`code .`, `idea .`, etc.).

For a system-wide value (all users):

```bash
# /etc/environment (no 'export', KEY=VALUE only)
ANTHROPIC_BASE_URL=https://router.neosmith.ai
ANTHROPIC_API_KEY=sk-plus-yourname-xxxxxx
```

## One-command Claude Code setup

```bash
npx @neosmithai/cli init sk-plus-yourname-xxxxxx
```

This writes `~/.claude/settings.json`, independent of shell profiles.

## Prerequisites

```bash
# Node (Debian/Ubuntu)
sudo apt-get install -y nodejs npm
# or via nvm for a current version:
#   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash && nvm install --lts

# Claude Code CLI
npm install -g @anthropic-ai/claude-code

# Verify connectivity
curl -s https://router.neosmith.ai/whoami -H "Authorization: Bearer sk-plus-yourname-xxxxxx"
```

## Enterprise rollout

Push env vars via your config-management tool:

```bash
# Ansible / Chef / Puppet → drop a file in /etc/profile.d/
# /etc/profile.d/neosmith.sh
export ANTHROPIC_BASE_URL=https://router.neosmith.ai
export ANTHROPIC_API_KEY=<org-neosmith-key>
```

## Next

Pick your IDE or agent guide from the [main README](../README.md).
