// scripts/contract/continue.test.js
//
// T8 contract for continue.js. Continue has the same asymmetry as codex:
// snapshot-always, no short-circuit on already-on.
//
// Behavior under test:
//   - on() writes ~/.continue/config.yaml with `name: NeoSmith` model entry.
//   - on()/on() does not short-circuit.
//   - off() restores from snapshot; with no snapshot, regex-strips the
//     `name: NeoSmith` entry.

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { withSandbox } = require("./_sandbox");

function loadContinue() {
  delete require.cache[require.resolve("../../lib/io")];
  delete require.cache[require.resolve("../../lib/harness")];
  delete require.cache[require.resolve("../../lib/harnesses/continue")];
  return {
    io: require("../../lib/io"),
    harness: require("../../lib/harness"),
    cont: require("../../lib/harnesses/continue"),
  };
}

test("continue on writes a NeoSmith model entry to config.yaml", () => withSandbox((home) => {
  const { cont, harness } = loadContinue();
  const cfg = path.join(home, ".continue", "config.yaml");
  const resolved = harness.resolveModel("pro");
  cont.on({ key: "sk-plus-test-aaaaaaaaaaaa", model: resolved });
  const text = fs.readFileSync(cfg, "utf8");
  assert.match(text, /name:\s*NeoSmith/);
  assert.match(text, /model:\s*neosmith\.intelligent-pro/);
}));

test("continue on/off round-trips on empty pre-connect state (tombstone)", () => withSandbox((home) => {
  const { cont } = loadContinue();
  const cfg = path.join(home, ".continue", "config.yaml");
  cont.on({ key: "sk-plus-test-aaaaaaaaaaaa", model: "pro" });
  assert.ok(fs.existsSync(cfg));
  cont.off({});
  assert.ok(!fs.existsSync(cfg),
    "off() must remove the file when pre-connect was a tombstone");
}));

test("continue on does NOT short-circuit on already-on", () => withSandbox(() => {
  const { cont } = loadContinue();
  cont.on({ key: "sk-plus-test-aaaaaaaaaaaa", model: "pro" });
  const res = cont.on({ key: "sk-plus-test-aaaaaaaaaaaa", model: "pro" });
  assert.equal(res.alreadyOn, undefined,
    "continue.on() must NOT return alreadyOn — same asymmetry as codex");
}));
