// Platform-correct instructions for persisting environment variables.
//
// Some harnesses (Codex) never store the key in their config file — the config
// holds only an `env_key` reference and the process reads the real value from
// the environment at runtime. That makes "set this env var, permanently, in the
// place your editor will actually see it" a load-bearing step: if the user only
// sets it for the current prompt, the harness works once and silently fails on
// the next launch.
//
// The instructions differ per platform in ways that MATTER:
//
//   win32  → `setx` (user-level, every shell + GUI-launched apps). POSIX
//            `export` does nothing outside Git Bash, and a `~/.bashrc` export
//            is invisible to PowerShell, cmd, and anything launched from the
//            Start menu — including VS Code.
//   posix  → `export` in the login shell's rc file.
//
// Everything here is a PURE FUNCTION of (vars, platform) returning display
// lines, so the contract tests can assert the Windows output while running on
// Linux CI and vice versa. Nothing here prints; callers own the ui calls.

"use strict";

// Which rc file to name for a POSIX shell. $SHELL is a hint, not a guarantee,
// so the copy hedges rather than asserting the wrong file.
function profileFile(shell) {
  const s = String(shell || "");
  if (s.includes("zsh")) return "~/.zshrc";
  if (s.includes("fish")) return "~/.config/fish/config.fish";
  return "~/.bashrc";
}

// vars: array of [NAME, value] pairs, in the order they should be displayed.
function envSetupLines(vars, opts = {}) {
  const platform = opts.platform || process.platform;
  const shell = "shell" in opts ? opts.shell : process.env.SHELL;
  const lines = [];

  if (platform === "win32") {
    lines.push(`Set them at the Windows user level so every shell — and every`);
    lines.push(`GUI-launched app, including VS Code — inherits them:`);
    lines.push(``);
    for (const [name, value] of vars) lines.push(`    setx ${name} "${value}"`);
    lines.push(``);
    lines.push(`setx writes them permanently but does NOT affect the window you`);
    lines.push(`are in right now. Open a new terminal, then verify with:`);
    lines.push(``);
    lines.push(`    echo $env:${vars[0][0]}        # PowerShell`);
    lines.push(`    echo $${vars[0][0]}            # Git Bash`);
    lines.push(``);
    lines.push(`(Git-Bash-only alternative: add the POSIX \`export\` lines to`);
    lines.push(`~/.bashrc. They will NOT apply in PowerShell, cmd, or VS Code.)`);
    return lines;
  }

  const rc = profileFile(shell);
  lines.push(`Add them to your shell profile (${rc}) so they persist across`);
  lines.push(`sessions, then reload it:`);
  lines.push(``);
  for (const [name, value] of vars) lines.push(`    export ${name}=${value}`);
  lines.push(``);
  lines.push(`    source ${rc}`);
  lines.push(``);
  lines.push(`Verify with:  echo $${vars[0][0]}`);
  return lines;
}

// A GUI app inherits its environment from whatever launched it, and it caches
// that environment for the life of the process. Reopening a terminal PANEL
// inside VS Code does not help: the panel is a child of the same VS Code
// process and inherits the same stale environment. The whole app has to go.
function vscodeRestartLines(opts = {}) {
  const platform = opts.platform || process.platform;
  const lines = [
    `Restarting the integrated terminal panel is NOT enough — the panel is a`,
    `child of the VS Code process and inherits its (stale) environment. Close`,
    `the application completely:`,
    ``,
  ];

  if (platform === "win32") {
    lines.push(`  1. Close every VS Code window (File → Exit, not just the X on`);
    lines.push(`     one window — the X leaves other windows and the process up).`);
    lines.push(`  2. Confirm nothing survived:`);
    lines.push(``);
    lines.push(`         Get-Process Code -ErrorAction SilentlyContinue`);
    lines.push(``);
    lines.push(`     If it prints rows, force them down:`);
    lines.push(``);
    lines.push(`         Stop-Process -Name Code -Force`);
    lines.push(``);
    lines.push(`     (Note: this discards unsaved editor state — save first.)`);
    lines.push(`  3. Relaunch VS Code from the Start menu, NOT with \`code .\``);
    lines.push(`     from an old terminal — that terminal has the stale env too`);
    lines.push(`     and would pass it straight back to the new process.`);
  } else if (platform === "darwin") {
    lines.push(`  1. Cmd-Q to quit VS Code (closing the window is not quitting).`);
    lines.push(`  2. Confirm nothing survived:  pgrep -fl "Visual Studio Code"`);
    lines.push(`     If it prints rows:  pkill -f "Visual Studio Code"`);
    lines.push(`  3. Relaunch from Spotlight/Dock, NOT \`code .\` from an old`);
    lines.push(`     terminal — that terminal has the stale env too.`);
  } else {
    lines.push(`  1. Quit VS Code entirely (File → Exit).`);
    lines.push(`  2. Confirm nothing survived:  pgrep -fl code`);
    lines.push(`     If it prints rows:  pkill -f "code --"`);
    lines.push(`  3. Relaunch from your application launcher, NOT \`code .\` from`);
    lines.push(`     an old terminal — that terminal has the stale env too.`);
  }

  lines.push(``);
  lines.push(`Same rule for any other GUI editor, and for Codex itself if you`);
  lines.push(`launched it from a terminal opened before the change.`);
  return lines;
}

module.exports = { envSetupLines, vscodeRestartLines, profileFile };
