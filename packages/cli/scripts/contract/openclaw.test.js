// scripts/contract/openclaw.test.js
//
// Contract for openclaw.js. The merge/restore contract it shares with every
// other writable harness lives in env-preservation.test.js; this file pins the
// two OpenClaw-specific hazards, both taken from its own documentation.
//
//   1. SCHEMA STRICTNESS. "OpenClaw only accepts configurations that fully
//      match the schema. Unknown keys, malformed types, or invalid values
//      cause the Gateway to refuse to start." A stray field is not a cosmetic
//      problem here — it takes the user's gateway down. So the written block is
//      asserted STRUCTURALLY: exactly the documented keys, nothing added.
//
//   2. JSON5. openclaw.json is JSON5, so comments, trailing commas and
//      unquoted keys are all legal, and io.readJSON returns {} on a parse
//      failure. A naive write replaces the user's whole gateway config with
//      our block. `on` must refuse and hand over to `openclaw config set`.

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { withSandbox } = require("./_sandbox");

const KEY = "sk-plus-openclaw-test-aaaa";

function loadOpenclaw() {
  for (const m of ["../../lib/io", "../../lib/harness", "../../lib/harnesses/openclaw"]) {
    delete require.cache[require.resolve(m)];
  }
  return {
    io: require("../../lib/io"),
    harness: require("../../lib/harness"),
    oc: require("../../lib/harnesses/openclaw"),
  };
}

const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

test("openclaw on writes the provider and makes it the default agent model", () => withSandbox(() => {
  const { harness, oc } = loadOpenclaw();
  const res = oc.on({ key: KEY, model: harness.resolveModel("pro") });
  assert.equal(res.wrote, true);

  const cfg = read(oc.configFile);
  const p = cfg.models.providers.neosmith;
  assert.equal(p.baseUrl, "https://router.neosmith.ai/v1");
  assert.equal(p.apiKey, KEY);
  assert.equal(p.api, "openai-completions");
  // A provider that is configured and never selected is wired on disk and dead
  // in practice — the same trap cline.js's lastUsedProvider covers.
  assert.equal(cfg.agents.defaults.model.primary, "neosmith/neosmith.intelligent-pro");
}));

test("openclaw writes EXACTLY the documented keys — the gateway refuses to start otherwise", () => withSandbox(() => {
  const { harness, oc } = loadOpenclaw();
  oc.on({ key: KEY, model: harness.resolveModel("pro") });

  const p = read(oc.configFile).models.providers.neosmith;
  assert.deepEqual(Object.keys(p).sort(), ["api", "apiKey", "baseUrl", "models"],
    "no version stamp, no updatedAt, no NeoSmith bookkeeping — unknown keys are fatal here");

  for (const m of p.models) {
    assert.deepEqual(Object.keys(m).sort(), ["contextWindow", "cost", "id", "maxTokens", "name"],
      `model entry ${m.id} carries an undocumented key`);
    assert.deepEqual(Object.keys(m.cost).sort(), ["cacheRead", "cacheWrite", "input", "output"]);
  }
}));

test("openclaw registers EVERY SKU, with neolite at its real 512K window", () => withSandbox(() => {
  const { harness, oc } = loadOpenclaw();
  oc.on({ key: KEY, model: harness.resolveModel("pro") });

  const entries = read(oc.configFile).models.providers.neosmith.models;
  const byId = new Map(entries.map((m) => [m.id, m]));
  const specs = harness.manifest().modelSpecs;
  for (const [sku, spec] of Object.entries(specs)) {
    assert.ok(byId.has(sku), `${sku} must be registered — OpenClaw cannot discover a context window`);
    assert.equal(byId.get(sku).contextWindow, spec.contextWindow, `${sku}: context window`);
    assert.equal(byId.get(sku).maxTokens, spec.maxTokens, `${sku}: output limit`);
  }
  assert.equal(byId.get("neosmith.neolite").contextWindow, 512000,
    "neolite is the sealed 512K budget tier, not 1M");
  // A fabricated per-token price would show the user fictional numbers in
  // OpenClaw's own usage view. NeoSmith bills per its own contract.
  assert.deepEqual(byId.get("neosmith.intelligent-pro").cost,
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
}));

test("openclaw on/off round-trips on empty pre-connect state (tombstone)", () => withSandbox(() => {
  const { oc } = loadOpenclaw();
  oc.on({ key: KEY, model: "neosmith.intelligent-pro" });
  assert.ok(fs.existsSync(oc.configFile));
  oc.off({});
  assert.ok(!fs.existsSync(oc.configFile),
    "off() must remove the file when pre-connect was a tombstone");
}));

test("openclaw on short-circuits when it is already wired", () => withSandbox(() => {
  const { oc } = loadOpenclaw();
  oc.on({ key: KEY, model: "neosmith.intelligent-pro" });
  assert.equal(oc.on({ key: KEY, model: "neosmith.intelligent-pro" }).alreadyOn, true);
}));

test("openclaw status flags a provider that is wired but not the default model", () => withSandbox(() => {
  const { harness, oc } = loadOpenclaw();
  assert.equal(oc.status({}).on, false, "nothing on disk yet");

  oc.on({ key: KEY, model: harness.resolveModel("pro") });
  const wired = oc.status({});
  assert.equal(wired.on, true);
  assert.equal(wired.env, "prod");
  assert.ok(!/NOT the default/.test(wired.detail), "on() selects the provider it wrote");

  // Simulate the user pointing the default back at another provider.
  const cfg = read(oc.configFile);
  cfg.agents.defaults.model.primary = "anthropic/claude-opus-4-6";
  fs.writeFileSync(oc.configFile, JSON.stringify(cfg, null, 2) + "\n");

  const stale = oc.status({});
  assert.equal(stale.on, true, "the NeoSmith provider is still configured");
  assert.match(stale.detail, /NOT the default agent model/,
    "configured-but-unselected must not read as plain 'connected'");
}));

// ── the JSON5 guard ─────────────────────────────────────────────────────────

const JSON5_CONFIG = `{
  // slack only, for now
  channels: { slack: { allowFrom: ["U1"] } },
}
`;

function seedJson5(oc) {
  fs.mkdirSync(path.dirname(oc.configFile), { recursive: true });
  fs.writeFileSync(oc.configFile, JSON5_CONFIG);
}

test("openclaw: a JSON5 config is NEVER rewritten", () => withSandbox(() => {
  const { io, oc } = loadOpenclaw();
  seedJson5(oc);

  const res = oc.on({ key: KEY, model: "neosmith.intelligent-pro" });
  assert.equal(res.wrote, false, "guessing at JSON5 is how you brick someone's gateway");
  assert.equal(res.manual, true);
  assert.equal(fs.readFileSync(oc.configFile, "utf8"), JSON5_CONFIG,
    "the user's file must come through byte-for-byte unchanged");
  assert.ok(io.hasSnapshot("openclaw"), "a copy is still kept");
}));

test("openclaw: off leaves a JSON5 config alone rather than guessing", () => withSandbox(() => {
  const { oc } = loadOpenclaw();
  seedJson5(oc);
  oc.on({ key: KEY, model: "neosmith.intelligent-pro" });

  const res = oc.off({});
  assert.equal(res.manual, true);
  assert.equal(res.partial, true, "we did not finish the job, and must not claim we did");
  assert.equal(fs.readFileSync(oc.configFile, "utf8"), JSON5_CONFIG);
}));

test("openclaw status on a JSON5 config does not claim to have inspected it", () => withSandbox(() => {
  const { oc } = loadOpenclaw();
  seedJson5(oc);

  assert.equal(oc.status({}).on, false);
  assert.match(oc.status({}).detail, /JSON5/);

  oc.on({ key: KEY, model: "neosmith.intelligent-pro" });
  assert.equal(oc.status({}).on, "manual",
    "the manual step is outstanding — that is neither on nor off");
}));

test("openclaw: with no ledger, off removes only our keys and prunes only empty containers", () => withSandbox(() => {
  const { io, oc } = loadOpenclaw();
  fs.mkdirSync(path.dirname(oc.configFile), { recursive: true });
  fs.writeFileSync(oc.configFile, JSON.stringify({
    channels: { slack: { allowFrom: ["U1"] } },
    models: { providers: { myown: { baseUrl: "https://example.com/v1", api: "openai-completions" } } },
  }, null, 2) + "\n");

  oc.on({ key: KEY, model: "neosmith.intelligent-pro" });
  // Lose state.json — the ledger and the fingerprint go with it, which is the
  // "connected by an older CLI" case. The snapshot is dropped too so the
  // fallback strip is what runs.
  fs.unlinkSync(io.STATE_FILE);
  io.clearSnapshot("openclaw");

  oc.off({});
  const cfg = read(oc.configFile);
  assert.ok(!cfg.models.providers.neosmith, "our provider is gone");
  assert.ok(cfg.models.providers.myown, "the user's provider is not");
  assert.deepEqual(cfg.channels.slack.allowFrom, ["U1"], "and neither is anything else");
  assert.ok(!cfg.agents, "the agents block we created, and nobody added to, is pruned");
}));
