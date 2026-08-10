// scripts/contract/ui.harnesses.test.js
//
// T8 contract for the UI-driven harnesses — jetbrains.js and cursor.js. They
// never write to disk; they round-trip their on/off flag via io.setHarnessFlag
// in ~/.neosmith/state.json.
//
// cline.js used to live here. It no longer belongs: Cline 4.x and the
// standalone Cline CLI share a global providers.json, so the harness writes a
// real file (see env-preservation.test.js for the merge/restore contract). The
// two cline tests at the bottom pin the boundary — the file is written, and the
// paste-in fallback for Cline 3.x is still printed.

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");

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

test("jetbrains and cursor are UI-driven (writable false, configFile null)", () => {
  const { jetbrains, cursor } = loadUiHarnesses();
  assert.equal(jetbrains.writable, false);
  assert.equal(jetbrains.configFile, null);
  // Cursor native BYOK cannot be written to settings.json (verified against the
  // installed Cursor build); it must be entered in Settings → Models UI.
  assert.equal(cursor.writable, false);
  assert.equal(cursor.configFile, null);
});

test("jetbrains on/off round-trips the on-flag in state.json", () => withSandbox(() => {
  const { io, jetbrains } = loadUiHarnesses();
  assert.equal(io.getHarnessFlag("jetbrains"), false, "fresh state");
  jetbrains.on({ key: "sk-plus-test-aaaaaaaaaaaa", model: "pro" });
  assert.equal(io.getHarnessFlag("jetbrains"), true, "after on");
  jetbrains.off({});
  assert.equal(io.getHarnessFlag("jetbrains"), false, "after off");
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

// ── cline: no longer UI-driven ──────────────────────────────────────────────

test("cline writes Cline's shared global providers.json", () => withSandbox(() => {
  const { cline } = loadUiHarnesses();
  assert.equal(cline.writable, true);
  assert.match(cline.configFile.replace(/\\/g, "/"), /\.cline\/data\/settings\/providers\.json$/,
    "the path Cline 4.x and the Cline CLI both read");

  const res = cline.on({ key: "sk-plus-test-aaaaaaaaaaaa", model: "neosmith.intelligent-pro" });
  assert.equal(res.wrote, true, "cline on() writes a file — it is not paste-only any more");

  const cfg = JSON.parse(fs.readFileSync(cline.configFile, "utf8"));
  assert.equal(cfg.providers["openai-compatible"].settings.baseUrl, "https://router.neosmith.ai/v1");
  assert.equal(cfg.lastUsedProvider, "openai-compatible");

  // The sibling catalog is what gives each SKU its real context window.
  const models = JSON.parse(fs.readFileSync(cline.modelsFile, "utf8"));
  const catalog = models.providers["openai-compatible"];
  assert.equal(catalog.provider.defaultModelId, "neosmith.intelligent-pro");
  assert.equal(catalog.models["neosmith.intelligent-pro"].contextWindow, 1000000);
  assert.ok(catalog.models["neosmith.intelligent-pro"].capabilities.includes("tools"),
    "Cline's agentic loop needs tool calling");

  // EVERY SKU is registered, not just the wired one — switching tiers inside
  // Cline writes providers.json alone, so an uncatalogued SKU would silently
  // fall back to Cline's conservative defaults.
  const harness = require("../../lib/harness");
  for (const sku of Object.values(harness.manifest().models)) {
    assert.ok(catalog.models[sku], `${sku} must be in the catalog`);
  }
  assert.equal(catalog.models["neosmith.neolite"].contextWindow, 512000,
    "neolite is the sealed 512K budget tier, not 1M");

  cline.off({});
  assert.equal(fs.existsSync(cline.configFile), false,
    "off() removes a providers.json that did not exist pre-connect");
}));

test("cline status reads the file, and flags a provider that is wired but not selected", () => withSandbox(() => {
  const { cline } = loadUiHarnesses();
  assert.equal(cline.status({}).on, false, "nothing on disk yet");

  cline.on({ key: "sk-plus-test-aaaaaaaaaaaa", model: "neosmith.intelligent-pro" });
  const wired = cline.status({});
  assert.equal(wired.on, true);
  assert.ok(!/NOT the active provider/.test(wired.detail), "on() selects the provider it wrote");

  // Simulate the user switching provider in Cline's UI afterwards.
  const cfg = JSON.parse(fs.readFileSync(cline.configFile, "utf8"));
  cfg.lastUsedProvider = "anthropic";
  fs.writeFileSync(cline.configFile, JSON.stringify(cfg, null, 2) + "\n");

  const stale = cline.status({});
  assert.equal(stale.on, true, "the NeoSmith provider is still configured");
  assert.match(stale.detail, /NOT the active provider/,
    "configured-but-unselected must not read as plain 'connected'");
}));
