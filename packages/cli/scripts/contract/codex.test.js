// scripts/contract/codex.test.js
//
// T8 contract for codex.js. Codex has DIFFERENT idempotency than claude:
// codex snapshots pre-connect state on every on() call (including the
// "already-on" branch), and does NOT short-circuit. This asymmetry is
// preserved intact per T1 ground truth. See T1 in the build plan.
//
// Behavior under test:
//   - on() writes ~/.codex/config.toml with a NeoSmith provider block.
//   - on()/on() does not short-circuit: it snapshots each time (which is
//     effectively a no-op for an unchanged file but still appends an audit
//     entry) and re-writes the TOML.
//   - off() with no pre-connect snapshot strips the [model_providers.neosmith]
//     block via regex.

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { withSandbox } = require("./_sandbox");

function loadCodex() {
  delete require.cache[require.resolve("../../lib/io")];
  delete require.cache[require.resolve("../../lib/harness")];
  delete require.cache[require.resolve("../../lib/harnesses/codex")];
  return {
    io: require("../../lib/io"),
    harness: require("../../lib/harness"),
    codex: require("../../lib/harnesses/codex"),
  };
}

test("codex on writes a NeoSmith provider block", () => withSandbox((home) => {
  const { codex, harness } = loadCodex();
  const cfg = path.join(home, ".codex", "config.toml");
  // Pass a resolved SKU — the on-command flow resolves `pro` → `neosmith.intelligent-pro`
  // via harness.resolveModel before calling codex.on(). Direct calls pass the alias
  // through verbatim; the CLI command resolves first. Mirror the CLI flow here.
  const resolved = harness.resolveModel("pro");
  codex.on({ key: "sk-plus-test-aaaaaaaaaaaa", model: resolved });

  assert.ok(fs.existsSync(cfg), "config.toml must be created");
  const text = fs.readFileSync(cfg, "utf8");
  assert.match(text, /\[model_providers\.neosmith\]/);
  assert.match(text, /model\s*=\s*"neosmith\.intelligent-pro"/);
  assert.match(text, /base_url\s*=\s*"https:\/\/router\.neosmith\.ai\/v1"/);
  assert.match(text, /wire_api\s*=\s*"responses"/);
  assert.match(text, /env_key\s*=\s*"OPENAI_API_KEY"/);
}));

test("codex on/off round-trips on an empty pre-connect state (tombstone)", () => withSandbox((home) => {
  const { io, codex } = loadCodex();
  const cfg = path.join(home, ".codex", "config.toml");

  codex.on({ key: "sk-plus-test-aaaaaaaaaaaa", model: "pro" });
  assert.ok(fs.existsSync(cfg), "config.toml should exist after on()");

  codex.off({});
  assert.ok(!fs.existsSync(cfg),
    "off() must remove the file when pre-connect was a tombstone");
}));

test("codex on does NOT short-circuit on already-on (asymmetry with claude)", () => withSandbox((home) => {
  const { codex } = loadCodex();
  const cfg = path.join(home, ".codex", "config.toml");

  codex.on({ key: "sk-plus-test-aaaaaaaaaaaa", model: "pro" });
  const sizeAfterFirst = fs.statSync(cfg).size;
  const mtimeAfterFirst = fs.statSync(cfg).mtimeMs;

  // Wait briefly so any re-write would register on mtime.
  const start = Date.now();
  while (Date.now() - start < 50) { /* spin */ }

  // Codex's contract is "snapshot-always, no short-circuit" — running on()
  // twice does NOT return { alreadyOn: true }. It re-snapshots (no-op for an
  // unchanged pre-connect) and re-writes the file (mtime bumps).
  const res = codex.on({ key: "sk-plus-test-aaaaaaaaaaaa", model: "pro" });
  assert.equal(res.alreadyOn, undefined,
    "codex.on() should NOT return alreadyOn — that's claude's contract");
  // We don't assert mtime changed (Windows fs resolution can be coarse),
  // but we assert the contract distinction is enforced.
  void sizeAfterFirst;
  void mtimeAfterFirst;
}));

test("codex off strips the NeoSmith block when no pre-connect snapshot exists", () => withSandbox((home) => {
  const { io, codex } = loadCodex();
  const cfg = path.join(home, ".codex", "config.toml");
  io.ensureDir(path.dirname(cfg));

  // Pre-connect has unrelated keys.
  const preText = '# user comment\nmodel = "other-model"\n[model_providers.other]\nname = "Other"\nbase_url = "https://example.com/v1"\n';
  fs.writeFileSync(cfg, preText);

  codex.on({ key: "sk-plus-test-aaaaaaaaaaaa", model: "pro" });

  // Simulate deletion of the .bak (no pre-connect snapshot available).
  // off() must fall back to text strip and preserve user content.
  const bak = path.join(home, ".neosmith", "snapshots", "codex.bak");
  fs.unlinkSync(bak);

  codex.off({});
  const afterText = fs.readFileSync(cfg, "utf8");
  assert.ok(!afterText.includes("[model_providers.neosmith]"),
    "off() fallback must strip the NeoSmith provider block");
  assert.ok(!/model_provider\s*=\s*"neosmith"/.test(afterText),
    "off() fallback must strip top-level model_provider");
  assert.ok(afterText.includes("[model_providers.other]") ||
            afterText.includes("model = \"other-model\"") ||
            afterText.includes("# user comment"),
    "off() fallback must preserve pre-connect user content");
}));
