// scripts/contract/envsetup.test.js
//
// Contract for lib/envsetup.js — the platform-correct env-var instructions
// printed by needsEnv harnesses (Codex).
//
// Why this file exists: `codex on` used to print POSIX `export` lines
// unconditionally. On Windows those are dead copy outside Git Bash — a user
// who follows them exactly still ends up with a Codex that reports no
// credentials, because PowerShell, cmd, and GUI-launched VS Code never read
// ~/.bashrc. The failure is silent and the error message points nowhere near
// the cause.
//
// Everything under test is a pure function of (vars, {platform, shell}), so
// these assertions run identically on Linux CI and a Windows laptop.

"use strict";

const test = require("node:test");
const assert = require("node:assert");

const envsetup = require("../../lib/envsetup");

const VARS = [
  ["OPENAI_API_KEY", "sk-plus-test-aaaaaaaaaaaa"],
  ["OPENAI_BASE_URL", "https://router.neosmith.ai/v1"],
];

const text = (lines) => lines.join("\n");

test("windows instructions use setx, never a bare POSIX export", () => {
  const out = text(envsetup.envSetupLines(VARS, { platform: "win32" }));
  assert.match(out, /setx OPENAI_API_KEY "sk-plus-test-aaaaaaaaaaaa"/);
  assert.match(out, /setx OPENAI_BASE_URL "https:\/\/router\.neosmith\.ai\/v1"/);
  // A line that STARTS with `export` is the failure mode. The trailing note
  // mentions the word in prose ("the POSIX `export` lines"), which is fine —
  // anchor on the command form so the prose stays editable.
  for (const line of envsetup.envSetupLines(VARS, { platform: "win32" })) {
    assert.ok(!/^\s+export\s/.test(line), `windows output must not offer an export command: ${line}`);
  }
});

test("windows instructions warn that setx does not affect the current window", () => {
  const out = text(envsetup.envSetupLines(VARS, { platform: "win32" }));
  // Without this, the user runs setx, checks $env: in the same shell, sees
  // nothing, and concludes the CLI is broken.
  assert.match(out, /does NOT affect the window/i);
  assert.match(out, /new terminal/i);
});

test("posix instructions use export plus the matching rc file", () => {
  const out = text(envsetup.envSetupLines(VARS, { platform: "linux", shell: "/bin/bash" }));
  assert.match(out, /export OPENAI_API_KEY=sk-plus-test-aaaaaaaaaaaa/);
  assert.match(out, /export OPENAI_BASE_URL=https:\/\/router\.neosmith\.ai\/v1/);
  assert.match(out, /~\/\.bashrc/);
  assert.match(out, /source ~\/\.bashrc/);
  assert.ok(!/setx/.test(out), "posix output must not mention setx");
});

test("posix rc file follows $SHELL", () => {
  assert.equal(envsetup.profileFile("/bin/zsh"), "~/.zshrc");
  assert.equal(envsetup.profileFile("/usr/bin/fish"), "~/.config/fish/config.fish");
  assert.equal(envsetup.profileFile("/bin/bash"), "~/.bashrc");
  assert.equal(envsetup.profileFile(undefined), "~/.bashrc", "unknown shell falls back to bash");

  const zsh = text(envsetup.envSetupLines(VARS, { platform: "darwin", shell: "/bin/zsh" }));
  assert.match(zsh, /~\/\.zshrc/);
  assert.ok(!/\.bashrc/.test(zsh), "zsh users must not be told to edit .bashrc");
});

test("every platform names the first var in its verify step", () => {
  for (const platform of ["win32", "darwin", "linux"]) {
    const out = text(envsetup.envSetupLines(VARS, { platform }));
    assert.match(out, /OPENAI_API_KEY/, `${platform} must show how to verify the key var`);
  }
});

test("vscode restart says a terminal-panel restart is not enough", () => {
  for (const platform of ["win32", "darwin", "linux"]) {
    const out = text(envsetup.vscodeRestartLines({ platform }));
    assert.match(out, /NOT enough/i, `${platform}: must rule out the panel restart`);
    assert.match(out, /inherits/i, `${platform}: must explain why (env inheritance)`);
    // Relaunching with `code .` from a pre-change terminal re-injects the stale
    // environment — the single most likely way to "restart" and see no change.
    assert.match(out, /code \./, `${platform}: must warn against relaunching via \`code .\``);
  }
});

test("vscode restart gives a platform-correct way to confirm the process is gone", () => {
  const win = text(envsetup.vscodeRestartLines({ platform: "win32" }));
  assert.match(win, /Get-Process Code/);
  assert.match(win, /Stop-Process -Name Code -Force/);
  assert.match(win, /unsaved/i, "force-kill must carry the data-loss caveat");
  assert.ok(!/pkill/.test(win), "windows output must not suggest pkill");

  const mac = text(envsetup.vscodeRestartLines({ platform: "darwin" }));
  assert.match(mac, /Cmd-Q/);
  assert.match(mac, /pgrep|pkill/);
  assert.ok(!/Get-Process/.test(mac), "macOS output must not suggest Get-Process");

  const linux = text(envsetup.vscodeRestartLines({ platform: "linux" }));
  assert.match(linux, /pgrep|pkill/);
  assert.ok(!/Cmd-Q/.test(linux), "linux output must not suggest Cmd-Q");
});

test("defaults come from the live process when no platform is passed", () => {
  const out = text(envsetup.envSetupLines(VARS));
  const expected = process.platform === "win32" ? /setx/ : /export OPENAI_API_KEY/;
  assert.match(out, expected);
});
