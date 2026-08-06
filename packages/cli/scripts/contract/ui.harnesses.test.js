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
  return {
    io: require("../../lib/io"),
    cline: require("../../lib/harnesses/cline"),
    jetbrains: require("../../lib/harnesses/jetbrains"),
  };
}

test("cline and jetbrains are UI-driven (writable false, configFile null)", () => {
  const { cline, jetbrains } = loadUiHarnesses();
  assert.equal(cline.writable, false);
  assert.equal(cline.configFile, null);
  assert.equal(jetbrains.writable, false);
  assert.equal(jetbrains.configFile, null);
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
