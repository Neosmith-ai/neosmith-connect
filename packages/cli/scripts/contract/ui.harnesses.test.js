// scripts/contract/ui.harnesses.test.js
//
// T8 contract for cline.js and jetbrains.js (UI-driven harnesses). They
// never write to disk; they round-trip their on/off flag via io.setHarnessFlag
// in ~/.neosmith/state.json.

"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { withSandbox } = require("./_sandbox");

function loadUiHarnesses() {
  delete require.cache[require.resolve("../../lib/io")];
  delete require.cache[require.resolve("../../lib/harness")];
  delete require.cache[require.resolve("../../lib/harnesses/cline")];
  delete require.cache[require.resolve("../../lib/harnesses/jetbrains")];
  delete require.cache[require.resolve("../../lib/harnesses/cursor")];
  return {
    io: require("../../lib/io"),
    cline: require("../../lib/harnesses/cline"),
    jetbrains: require("../../lib/harnesses/jetbrains"),
    cursor: require("../../lib/harnesses/cursor"),
  };
}

test("cline, jetbrains and cursor are UI-driven (writable false, configFile null)", () => {
  const { cline, jetbrains, cursor } = loadUiHarnesses();
  assert.equal(cline.writable, false);
  assert.equal(cline.configFile, null);
  assert.equal(jetbrains.writable, false);
  assert.equal(jetbrains.configFile, null);
  // Cursor native BYOK cannot be written to settings.json (verified against the
  // installed Cursor build); it must be entered in Settings → Models UI.
  assert.equal(cursor.writable, false);
  assert.equal(cursor.configFile, null);
});

test("cline on/off round-trips the on-flag in state.json", () => withSandbox(() => {
  const { io, cline } = loadUiHarnesses();
  assert.equal(io.getHarnessFlag("cline"), false, "fresh state");
  cline.on({ key: "sk-plus-test-aaaaaaaaaaaa", model: "pro" });
  assert.equal(io.getHarnessFlag("cline"), true, "after on");
  cline.off({});
  assert.equal(io.getHarnessFlag("cline"), false, "after off");
}));

test("jetbrains on/off round-trips the on-flag in state.json", () => withSandbox(() => {
  const { io, jetbrains } = loadUiHarnesses();
  assert.equal(io.getHarnessFlag("jetbrains"), false, "fresh state");
  jetbrains.on({ key: "sk-plus-test-aaaaaaaaaaaa", model: "pro" });
  assert.equal(io.getHarnessFlag("jetbrains"), true, "after on");
  jetbrains.off({});
  assert.equal(io.getHarnessFlag("jetbrains"), false, "after off");
}));

test("cline status reports UI-configured state", () => withSandbox(() => {
  const { cline } = loadUiHarnesses();
  assert.equal(cline.status({}).on, false);
  cline.on({ key: "sk-plus-test-aaaaaaaaaaaa", model: "pro" });
  assert.equal(cline.status({}).on, true);
}));

test("cursor on/off round-trips the on-flag in state.json", () => withSandbox(() => {
  const { io, cursor } = loadUiHarnesses();
  assert.equal(io.getHarnessFlag("cursor"), false, "fresh state");
  const res = cursor.on({ key: "sk-plus-test-aaaaaaaaaaaa", model: "neosmith.intelligent-pro" });
  assert.equal(res.ui, true, "cursor on() is UI-driven, not a file write");
  assert.equal(res.wrote, false, "cursor on() must not write a config file");
  assert.equal(io.getHarnessFlag("cursor"), true, "after on");
  cursor.off({});
  assert.equal(io.getHarnessFlag("cursor"), false, "after off");
}));

test("cursor status reports UI-configured state", () => withSandbox(() => {
  const { cursor } = loadUiHarnesses();
  assert.equal(cursor.status({}).on, false);
  cursor.on({ key: "sk-plus-test-aaaaaaaaaaaa", model: "neosmith.intelligent-pro" });
  assert.equal(cursor.status({}).on, true);
}));
