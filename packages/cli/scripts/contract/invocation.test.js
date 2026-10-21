// scripts/contract/invocation.test.js
//
// `npx @neosmithai/cli setup` installs nothing on PATH, yet setup used to end
// with "Run `neosmith claude on`" — a command the user does not have. Every
// npx user then hit `'neosmith' is not recognized`. These tests pin how the CLI
// recognises an npx run and what it tells the user to type.

"use strict";

const test = require("node:test");
const assert = require("node:assert");

const invocation = require("../../lib/invocation");

const NPX_WIN = "C:\\Users\\you\\AppData\\Local\\npm-cache\\_npx\\1a2b3c\\node_modules\\@neosmithai\\cli\\lib";
const NPX_POSIX = "/home/you/.npm/_npx/1a2b3c/node_modules/@neosmithai/cli/lib";
const GLOBAL_WIN = "C:\\Users\\you\\AppData\\Roaming\\npm\\node_modules\\@neosmithai\\cli\\lib";
const GLOBAL_POSIX = "/usr/local/lib/node_modules/@neosmithai/cli/lib";
const INSTALLER = "/home/you/.neosmith/cli/packages/cli/lib";

test("invocation: a copy in npm's _npx cache is an npx run", () => {
  assert.strictEqual(invocation.viaNpx(NPX_WIN), true);
  assert.strictEqual(invocation.viaNpx(NPX_POSIX), true);
});

test("invocation: global npm and installer copies are not npx runs", () => {
  for (const dir of [GLOBAL_WIN, GLOBAL_POSIX, INSTALLER]) {
    assert.strictEqual(invocation.viaNpx(dir), false, dir);
  }
});

test("invocation: hints name a command the user can actually run", () => {
  assert.strictEqual(invocation.cmd("claude on", GLOBAL_POSIX), "neosmith claude on");
  assert.strictEqual(invocation.cmd("claude on", NPX_WIN), "npx @neosmithai/cli claude on");
  assert.strictEqual(invocation.cmd("", NPX_POSIX), "npx @neosmithai/cli");
});

test("invocation: the install advice is the global npm install, with -g", () => {
  assert.strictEqual(invocation.INSTALL_CMD, "npm install -g @neosmithai/cli");
});
