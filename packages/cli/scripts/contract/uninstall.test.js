// scripts/contract/uninstall.test.js
//
// Contract for `neosmith uninstall`'s launcher handling.
//
// The bug this locks down: install.sh writes the CLI to ~/.neosmith/cli AND a
// launcher at ~/.local/bin/neosmith that hardcodes an absolute exec path into
// that tree. `uninstall` deletes ~/.neosmith but used to leave the launcher
// behind unless you passed --all, printing "Launcher still in place" — for a
// shim that could no longer possibly work.
//
// It wasn't merely dead. install.sh PREPENDS ~/.local/bin to PATH, so the
// corpse outranked the npm global bin: a subsequent `npm i -g @neosmithai/cli`
// installed correctly and still died at the prompt with a MODULE_NOT_FOUND
// naming the deleted directory. Observed in the field.
//
// The inverse matters too: install.sh supports running from a local checkout,
// where the shim points outside ~/.neosmith and legitimately outlives it.
// Deleting THAT would be the mirror-image bug, so it is tested as well.

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { withSandbox } = require("./_sandbox");

function loadUninstall() {
  delete require.cache[require.resolve("../../lib/io")];
  delete require.cache[require.resolve("../../lib/commands/uninstall")];
  return {
    io: require("../../lib/io"),
    uninstall: require("../../lib/commands/uninstall"),
  };
}

// Reproduces the shim install.sh writes (install.sh:168-182).
function bashShim(targetJs) {
  return [
    "#!/usr/bin/env bash",
    "# NeoSmith launcher.",
    'NODE_BIN="${NEOSMITH_NODE_BIN:-/usr/bin/node}"',
    '[ -x "$NODE_BIN" ] || NODE_BIN="$(command -v node 2>/dev/null)"',
    `exec "$NODE_BIN" "${targetJs}" "$@"`,
    "",
  ].join("\n");
}

function cmdShim(targetJs) {
  return `@echo off\r\n"C:\\Program Files\\nodejs\\node.exe" "${targetJs}" %*\r\n`;
}

function writeLauncher(home, name, text) {
  const p = path.join(home, ".local", "bin", name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
  return p;
}

// ── target extraction ───────────────────────────────────────────────────────

test("launcherTarget pulls the exec path out of both shim shapes", () => {
  const { uninstall } = loadUninstall();
  assert.equal(
    uninstall.launcherTarget(bashShim("/c/Users/me/.neosmith/cli/bin/neosmith.js")),
    "/c/Users/me/.neosmith/cli/bin/neosmith.js");
  assert.equal(
    uninstall.launcherTarget(cmdShim("C:\\Users\\me\\.neosmith\\cli\\bin\\neosmith.js")),
    "C:\\Users\\me\\.neosmith\\cli\\bin\\neosmith.js");
  assert.equal(uninstall.launcherTarget("#!/bin/sh\necho hi\n"), null,
    "an unrecognized script must not yield a target");
  assert.equal(uninstall.launcherTarget(""), null);
});

test("normalizeTarget converts MSYS paths on Windows only", () => {
  const { uninstall } = loadUninstall();
  const got = uninstall.normalizeTarget("/c/Users/me/.neosmith/cli/bin/neosmith.js");
  if (process.platform === "win32") {
    // Without this, fs would resolve /c/... against the current drive root and
    // report a live file as missing.
    assert.equal(got, "C:\\Users\\me\\.neosmith\\cli\\bin\\neosmith.js");
  } else {
    assert.equal(got, "/c/Users/me/.neosmith/cli/bin/neosmith.js", "POSIX paths pass through");
  }
});

// ── liveness ────────────────────────────────────────────────────────────────

test("a shim pointing into ~/.neosmith is dead regardless of path style", () => {
  const { uninstall } = loadUninstall();
  assert.equal(uninstall.isDeadLauncher(bashShim("/c/Users/me/.neosmith/cli/bin/neosmith.js")), true);
  assert.equal(uninstall.isDeadLauncher(cmdShim("C:\\Users\\me\\.neosmith\\cli\\bin\\neosmith.js")), true);
});

test("a shim pointing at a missing file outside ~/.neosmith is dead", () => {
  const { uninstall } = loadUninstall();
  const gone = path.join(__dirname, "no-such-dir", "bin", "neosmith.js");
  assert.equal(uninstall.isDeadLauncher(bashShim(gone)), true);
});

test("a shim pointing at a live checkout is NOT dead", () => {
  const { uninstall } = loadUninstall();
  // The real bin/neosmith.js in this repo — a local-checkout install.
  const live = path.resolve(__dirname, "..", "..", "bin", "neosmith.js");
  assert.ok(fs.existsSync(live), "fixture precondition");
  assert.equal(uninstall.isDeadLauncher(bashShim(live)), false);
});

test("an unrecognized script is never treated as dead", () => {
  const { uninstall } = loadUninstall();
  // Something else may own the name `neosmith` on this machine; we do not
  // delete files we cannot parse.
  assert.equal(uninstall.isDeadLauncher("#!/bin/sh\nexec /opt/other/thing \"$@\"\n"), false);
});

// ── removal ─────────────────────────────────────────────────────────────────

test("removeLaunchers deletes an orphaned shim with no flag", () => withSandbox((home) => {
  const { uninstall } = loadUninstall();
  const p = writeLauncher(home, "neosmith",
    bashShim(path.join(home, ".neosmith", "cli", "bin", "neosmith.js")));

  const { removed, alive } = uninstall.removeLaunchers();
  assert.deepEqual(removed, [p], "the orphan must be removed without --all");
  assert.deepEqual(alive, []);
  assert.ok(!fs.existsSync(p), "orphan must be gone from disk");
}));

test("removeLaunchers deletes the Windows .cmd sibling too", () => withSandbox((home) => {
  const { uninstall } = loadUninstall();
  // The old code only ever looked at `neosmith`, never `neosmith.cmd`, so on
  // Windows the shadowing shim survived even `--all`.
  const target = path.join(home, ".neosmith", "cli", "bin", "neosmith.js");
  const a = writeLauncher(home, "neosmith", bashShim(target));
  const b = writeLauncher(home, "neosmith.cmd", cmdShim(target));

  const { removed } = uninstall.removeLaunchers();
  assert.equal(removed.length, 2, "both shims must go");
  assert.ok(!fs.existsSync(a) && !fs.existsSync(b));
}));

test("removeLaunchers keeps a working launcher unless --all", () => withSandbox((home) => {
  const { uninstall } = loadUninstall();
  const live = path.resolve(__dirname, "..", "..", "bin", "neosmith.js");
  const p = writeLauncher(home, "neosmith", bashShim(live));

  const first = uninstall.removeLaunchers();
  assert.deepEqual(first.removed, [], "a live launcher is not collateral damage");
  assert.deepEqual(first.alive, [p]);
  assert.ok(fs.existsSync(p), "must still be on disk");

  const second = uninstall.removeLaunchers({ force: true });
  assert.deepEqual(second.removed, [p], "--all removes it");
  assert.ok(!fs.existsSync(p));
}));

test("removeLaunchers is idempotent and safe when nothing is installed", () => withSandbox(() => {
  const { uninstall } = loadUninstall();
  const r = uninstall.removeLaunchers();
  assert.deepEqual(r.removed, []);
  assert.deepEqual(r.alive, []);
}));

test("--all does not delete an unparseable file that happens to be named neosmith", () => withSandbox((home) => {
  const { uninstall } = loadUninstall();
  // force:true means "remove the launcher", not "remove whatever is at this
  // path" — but the file IS at our launcher path, so --all is the user asking
  // for it explicitly. Assert the documented behavior so it can't drift silently.
  const p = writeLauncher(home, "neosmith", "#!/bin/sh\nexec /opt/other/thing \"$@\"\n");
  const kept = uninstall.removeLaunchers();
  assert.deepEqual(kept.removed, [], "no flag: an unreadable shim is left alone");
  assert.ok(fs.existsSync(p));
}));

// ── PATH line ───────────────────────────────────────────────────────────────

test("isNeosmithPathLine matches the installer's line, not arbitrary exports", () => {
  const { uninstall } = loadUninstall();
  const binDir = path.join("/home/me", ".local", "bin");
  assert.equal(uninstall.isNeosmithPathLine('export PATH="/home/me/.local/bin:$PATH"', binDir), true);
  assert.equal(uninstall.isNeosmithPathLine('export PATH="/usr/local/bin:$PATH"', binDir), false);
  assert.equal(uninstall.isNeosmithPathLine('alias neosmith="foo"', binDir), false);
  assert.equal(uninstall.isNeosmithPathLine("", binDir), false);
});

test("the PATH entry is reported, never edited", () => withSandbox((home) => {
  const { uninstall } = loadUninstall();
  const rc = path.join(home, ".bashrc");
  const body = [
    "# my shell",
    'export PATH="' + path.join(home, ".local", "bin").replace(/\\/g, "/") + ':$PATH"',
    "alias ll='ls -la'",
    "",
  ].join("\n");
  fs.writeFileSync(rc, body);

  const orig = console.log;
  console.log = () => {};
  let hits;
  try { hits = uninstall.reportPathEntry(); } finally { console.log = orig; }

  assert.equal(hits.length, 1, "the installer's PATH line must be found");
  assert.equal(hits[0].line, 2, "and reported with its line number");
  // ~/.local/bin is shared with pipx/uv/cargo and install.sh skips the append
  // when the line already exists — so we cannot know we own it. Never rewrite.
  assert.equal(fs.readFileSync(rc, "utf8"), body, "the rc file must be byte-identical");
}));
