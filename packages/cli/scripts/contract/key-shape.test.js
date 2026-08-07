// scripts/contract/key-shape.test.js
//
// Consolidated regression test for the "the router is the authority, the CLI
// does not gate on prefix shape" change. Three claims, one test:
//
//   1. key.describe() returns the canonical four shape descriptions.
//   2. claude.on() writes whichever key shape it's handed into
//      ANTHROPIC_AUTH_TOKEN unchanged, including sk-slm-* and a JWT.
//   3. The same is true for an unknown-shape key, since the router is now
//      the sole authority on validity; the CLI must not pre-reject.
//
// Before this change, claude.js hasNeoSmith() / on() and key.js online
// paths used to inspect the ANTHROPIC_API_KEY prefix or warn on
// non-canonical shapes. That logic was removed. This test pins the new
// contract: any byte-string you hand to claude.on() ends up in
// ANTHROPIC_AUTH_TOKEN verbatim, and describe() still names the four
// canonical shapes the developer guide documents.

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const { withSandbox } = require("./_sandbox");

function loadCli() {
  // Re-require so the HOME override is picked up by io.js lazy resolution.
  delete require.cache[require.resolve("../../lib/io")];
  delete require.cache[require.resolve("../../lib/harness")];
  delete require.cache[require.resolve("../../lib/key")];
  delete require.cache[require.resolve("../../lib/harnesses/claude")];
  const io = require("../../lib/io");
  const harness = require("../../lib/harness");
  const key = require("../../lib/key");
  const claude = require("../../lib/harnesses/claude");
  return { io, harness, key, claude };
}

test("key shape is preserved end-to-end - router is the authority", () => withSandbox((home) => {
  const { io, harness, key, claude } = loadCli();
  const cfg = path.join(home, ".claude", "settings.json");
  const resolved = harness.resolveModel("pro");

  // 1. describe() names every canonical shape the developer guide documents.
  assert.equal(key.describe("sk-plus-test-aaaa"), "sk-plus-* (Pro / Opus-tier)");
  assert.equal(key.describe("sk-std-test-aaaa"),  "sk-std-* (Basic / Sonnet-tier)");
  assert.equal(key.describe("sk-slm-test-aaaa"),  "sk-slm-* (Lite / SLM-only)");
  assert.equal(key.describe("eyJabc.def.ghi"),    "Cognito JWT");
  assert.equal(key.describe(""),                  "none");
  // An unknown shape must NOT throw - describe() is a label, not a gate.
  assert.equal(typeof key.describe("totally-unrecognized-shape"),
    "string", "describe() must always return a string label");

  // 2. claude.on() writes each canonical shape verbatim - no prefix-gating
  // anywhere in the harness path. We repeat on/off so each iteration gets a
  // fresh settings.json (the snapshot/restore pair leaves the file absent
  // on empty pre-connect state, matching the existing tombstone contract).
  const canonical = [
    ["sk-plus-test-aaaaaaaaaaaa", "Pro"],
    ["sk-std-test-aaaaaaaaaaaaa", "Basic"],
    ["sk-slm-test-aaaaaaaaaaaaa", "Lite"],
    ["eyJabc.def.ghi",            "JWT"],
  ];
  for (const pair of canonical) {
    const k = pair[0];
    const label = pair[1];
    claude.on({ key: k, model: resolved });
    assert.ok(io.fileExists(cfg),
      "settings.json must exist after on() with " + label + " key");
    const parsed = io.readJSON(cfg);
    assert.equal(parsed.env.ANTHROPIC_BASE_URL, "https://router.neosmith.ai",
      "ANTHROPIC_BASE_URL must be the router for " + label + " key");
    assert.equal(parsed.env.ANTHROPIC_AUTH_TOKEN, k,
      "ANTHROPIC_AUTH_TOKEN must equal the literal " + label + " key (no prefix gating)");
    assert.equal(parsed.env.ANTHROPIC_MODEL, "neosmith.intelligent-pro",
      "ANTHROPIC_MODEL must be pro for " + label + " key");
    claude.off({});
    assert.ok(!io.fileExists(cfg),
      "off() must restore pre-connect absence after " + label + " key round-trip");
  }

  // 3. An unknown shape must also flow through - the router is the only
  // validator. If the CLI ever re-introduces prefix sniffing in claude.on,
  // this is the assertion that will catch it.
  const odd = "definitely-neosmith-but-not-a-known-shape-zzz";
  claude.on({ key: odd, model: resolved });
  const parsed = io.readJSON(cfg);
  assert.equal(parsed.env.ANTHROPIC_AUTH_TOKEN, odd,
    "unknown-shape key must round-trip into ANTHROPIC_AUTH_TOKEN verbatim");
}));
