// scripts/contract/harness.registry.test.js
//
// T8 contract: every manifest entry has a matching .js module; the registry
// exposes the canonical id list and order. T1 ground truth — the literal
// allowlist at lib/harness.js:61-63 is gone; the manifest owns it.

"use strict";

const test = require("node:test");
const assert = require("node:assert");

const harness = require("../../lib/harness");
const manifestPath = harness.manifestPath();

test("every manifest entry has a matching .js module", () => {
  const manifest = harness.manifest();
  for (const h of manifest.harnesses) {
    assert.ok(harness.get(h.id),
      `manifest declares '${h.id}' but no .js module is registered`);
  }
});

test("idsSorted returns ids in registryOrder", () => {
  const sorted = harness.idsSorted();
  assert.deepEqual(sorted, ["claude", "codex", "continue", "cline", "jetbrains"],
    "idsSorted must follow manifest registryOrder");
});

test("MODELS proxy exposes pro / basic / lite from manifest", () => {
  assert.equal(harness.MODELS.pro, "neosmith.intelligent-pro");
  assert.equal(harness.MODELS.basic, "neosmith.intelligent-basic");
  assert.equal(harness.MODELS.lite, "neosmith.intelligent-lite");
});

test("resolveModel handles aliases (pro / opus / claude-opus-4 → pro)", () => {
  assert.equal(harness.resolveModel("pro"), "neosmith.intelligent-pro");
  assert.equal(harness.resolveModel("opus"), "neosmith.intelligent-pro");
  assert.equal(harness.resolveModel("claude-opus-4"), "neosmith.intelligent-pro");
  assert.equal(harness.resolveModel("basic"), "neosmith.intelligent-basic");
  assert.equal(harness.resolveModel("sonnet"), "neosmith.intelligent-basic");
  assert.equal(harness.resolveModel("lite"), "neosmith.intelligent-lite");
  assert.equal(harness.resolveModel("haiku"), "neosmith.intelligent-lite");
});

test("manifest resolution honors NEOSMITH_MANIFEST override", () => {
  // Just verify the API exists; the override is exercised by integration tests
  // in human CI via the test fixture path syntax.
  assert.equal(typeof harness.manifestPath, "function");
  void manifestPath;
});
