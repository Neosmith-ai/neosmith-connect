// scripts/contract/opencode.test.js
//
// Contract for opencode.js. The merge/restore contract it shares with every
// other writable harness lives in env-preservation.test.js; this file keeps the
// OpenCode-specific shape tests and the two things nothing else covers:
//
//   - the model catalogue. OpenCode cannot discover a context window
//     (GET /v1/models returns ids only), so an unregistered SKU silently
//     compacts at a conservative default. Every SKU has to be in the file,
//     with neolite at its real 512K rather than the 1M the others get.
//
//   - the .jsonc guard. OpenCode reads opencode.jsonc in preference when it
//     exists, and .jsonc legally has comments and trailing commas. io.readJSON
//     returns {} on a parse failure, so a naive write replaces the user's
//     entire config with our block. `on` must refuse.

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { withSandbox } = require("./_sandbox");

const KEY = "sk-plus-opencode-test-aaaa";

function loadOpencode() {
  for (const m of ["../../lib/io", "../../lib/harness", "../../lib/harnesses/opencode"]) {
    delete require.cache[require.resolve(m)];
  }
  return {
    io: require("../../lib/io"),
    harness: require("../../lib/harness"),
    oc: require("../../lib/harnesses/opencode"),
  };
}

const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

test("opencode on writes a custom provider pointing at the router", () => withSandbox(() => {
  const { harness, oc } = loadOpencode();
  const res = oc.on({ key: KEY, model: harness.resolveModel("pro") });
  assert.equal(res.wrote, true);

  const cfg = read(oc.configFile);
  const p = cfg.provider.neosmith;
  // @ai-sdk/openai-compatible is the /v1/chat/completions package. @ai-sdk/openai
  // is for /v1/responses and would be the wrong wire format for this router.
  assert.equal(p.npm, "@ai-sdk/openai-compatible");
  assert.equal(p.name, "NeoSmith");
  assert.equal(p.options.baseURL, "https://router.neosmith.ai/v1");
  assert.equal(p.options.apiKey, KEY);
  assert.equal(cfg.model, "neosmith/neosmith.intelligent-pro");
  assert.equal(cfg.small_model, "neosmith/neosmith.neolite");
}));

test("opencode registers EVERY SKU, with neolite at its real 512K window", () => withSandbox(() => {
  const { harness, oc } = loadOpencode();
  oc.on({ key: KEY, model: harness.resolveModel("pro") });

  const models = read(oc.configFile).provider.neosmith.models;
  const specs = harness.manifest().modelSpecs;
  for (const [sku, spec] of Object.entries(specs)) {
    assert.ok(models[sku], `${sku} must be registered — switching tiers inside OpenCode does not re-run \`on\``);
    assert.equal(models[sku].limit.context, spec.contextWindow, `${sku}: context window`);
    assert.equal(models[sku].limit.output, spec.maxTokens, `${sku}: output limit`);
  }
  assert.equal(models["neosmith.neolite"].limit.context, 512000,
    "neolite is the sealed 512K budget tier, not 1M");
  assert.equal(models["neosmith.intelligent-pro"].name, "NeoSmith Pro",
    "the picker label comes from the manifest's tier map, not the raw SKU");
}));

test("opencode on with an unknown --model still catalogues it", () => withSandbox(() => {
  const { oc } = loadOpencode();
  oc.on({ key: KEY, model: "neosmith.something-new" });
  const cfg = read(oc.configFile);
  assert.ok(cfg.provider.neosmith.models["neosmith.something-new"],
    "a SKU the manifest does not know about must still be usable, not left uncatalogued");
  assert.equal(cfg.model, "neosmith/neosmith.something-new");
}));

test("opencode on/off round-trips on empty pre-connect state (tombstone)", () => withSandbox(() => {
  const { oc } = loadOpencode();
  oc.on({ key: KEY, model: "neosmith.intelligent-pro" });
  assert.ok(fs.existsSync(oc.configFile));
  oc.off({});
  assert.ok(!fs.existsSync(oc.configFile),
    "off() must remove the file when pre-connect was a tombstone");
}));

test("opencode on short-circuits when it is already wired", () => withSandbox(() => {
  const { oc } = loadOpencode();
  oc.on({ key: KEY, model: "neosmith.intelligent-pro" });
  const res = oc.on({ key: KEY, model: "neosmith.intelligent-pro" });
  assert.equal(res.alreadyOn, true, "warn-noop idempotency, same as zed");
}));

test("opencode status reports the environment, the model and the SKU count", () => withSandbox(() => {
  const { harness, oc } = loadOpencode();
  assert.equal(oc.status({}).on, false, "nothing on disk yet");

  oc.on({ key: KEY, model: harness.resolveModel("pro") });
  const s = oc.status({});
  assert.equal(s.on, true);
  assert.equal(s.env, "prod");
  assert.match(s.detail, /model=neosmith\/neosmith\.intelligent-pro/);
  assert.match(s.detail, /small_model=neosmith\/neosmith\.neolite/);
  assert.match(s.detail, /4 SKU\(s\)/);
}));

// ── the .jsonc guard ────────────────────────────────────────────────────────

const JSONC = `{
  // my own tweaks — this file is JSONC and that is legal
  "theme": "tokyonight",
  "model": "anthropic/claude-sonnet-4-5",
}
`;

test("opencode targets opencode.jsonc when it exists — that is the file OpenCode reads", () => withSandbox(() => {
  const { oc } = loadOpencode();
  fs.mkdirSync(path.dirname(oc.jsoncConfigFile), { recursive: true });
  fs.writeFileSync(oc.jsoncConfigFile, '{ "theme": "tokyonight" }\n');
  assert.equal(oc.configPath(), oc.jsoncConfigFile);
}));

test("opencode: a strict-JSON .jsonc is merged into normally", () => withSandbox(() => {
  const { oc } = loadOpencode();
  fs.mkdirSync(path.dirname(oc.jsoncConfigFile), { recursive: true });
  fs.writeFileSync(oc.jsoncConfigFile, '{\n  "theme": "tokyonight"\n}\n');

  const res = oc.on({ key: KEY, model: "neosmith.intelligent-pro" });
  assert.equal(res.wrote, true, "no comments, so it parses — the normal path applies");
  const cfg = read(oc.jsoncConfigFile);
  assert.equal(cfg.theme, "tokyonight");
  assert.ok(cfg.provider.neosmith);
  assert.ok(!fs.existsSync(oc.configFile), "and the .json sibling must not be created");
}));

test("opencode: a .jsonc with comments is NEVER rewritten", () => withSandbox(() => {
  const { io, oc } = loadOpencode();
  fs.mkdirSync(path.dirname(oc.jsoncConfigFile), { recursive: true });
  fs.writeFileSync(oc.jsoncConfigFile, JSONC);

  const res = oc.on({ key: KEY, model: "neosmith.intelligent-pro" });
  assert.equal(res.wrote, false, "a config we cannot parse is a config we must not write");
  assert.equal(res.manual, true, "the block is printed for the user to merge by hand");
  assert.equal(fs.readFileSync(oc.jsoncConfigFile, "utf8"), JSONC,
    "the user's file must come through byte-for-byte unchanged");
  assert.ok(io.hasSnapshot("opencode"),
    "a copy is still kept — the user has to be able to get back to this");
}));

test("opencode: off leaves an unparseable config alone rather than guessing", () => withSandbox(() => {
  const { oc } = loadOpencode();
  fs.mkdirSync(path.dirname(oc.jsoncConfigFile), { recursive: true });
  fs.writeFileSync(oc.jsoncConfigFile, JSONC);
  oc.on({ key: KEY, model: "neosmith.intelligent-pro" });

  const res = oc.off({});
  assert.equal(res.manual, true);
  assert.equal(res.partial, true, "we did not finish the job, and must not claim we did");
  assert.equal(fs.readFileSync(oc.jsoncConfigFile, "utf8"), JSONC);
}));

test("opencode status on an unparseable config does not claim to have inspected it", () => withSandbox(() => {
  const { oc } = loadOpencode();
  fs.mkdirSync(path.dirname(oc.jsoncConfigFile), { recursive: true });
  fs.writeFileSync(oc.jsoncConfigFile, JSONC);

  const before = oc.status({});
  assert.equal(before.on, false);
  assert.match(before.detail, /not strict JSON/);

  oc.on({ key: KEY, model: "neosmith.intelligent-pro" });
  const after = oc.status({});
  assert.equal(after.on, "manual", "the manual step is outstanding — that is neither on nor off");
}));

test("opencode: a config that is valid JSON but not an object is backed up, not merged into", () => withSandbox(() => {
  const { io, oc } = loadOpencode();
  fs.mkdirSync(path.dirname(oc.configFile), { recursive: true });
  fs.writeFileSync(oc.configFile, '["not", "an", "object"]\n');

  const res = oc.on({ key: KEY, model: "neosmith.intelligent-pro" });
  assert.equal(res.wrote, false, "an array root is not something we can merge a provider into");
  assert.ok(io.hasSnapshot("opencode"));
}));
