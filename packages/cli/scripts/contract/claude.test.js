// scripts/contract/claude.test.js
//
// T8 contract for claude.js. Encodes the existing behavior — claude is the
// only harness with the warn-no-op `hasNeoSmith(existing)` short-circuit (see
// T1 ground truth). Other file-writable harnesses (codex, continue) snapshot
// on every on() call and do not short-circuit; their tests live separately.
//
// Behavior under test (per codex.js:21-60 / harness.js:5-6 / harness.js:21-49):
//   - on(): if alreadyNeoSmith(existing) → return { alreadyOn: true }, no write
//   - on(): else snapshot pre-connect state, write new env keys, return { wrote }
//   - off(): restore from snapshot byte-for-byte; if no snapshot, strip keys
//   - on()/on(): second call MUST NOT modify settings.json after first call

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { withSandbox } = require("./_sandbox");

function loadCli() {
  // Re-require so HOME override is picked up by io.js's lazy HOME resolution.
  delete require.cache[require.resolve("../../lib/io")];
  delete require.cache[require.resolve("../../lib/harness")];
  delete require.cache[require.resolve("../../lib/harnesses/claude")];
  const io = require("../../lib/io");
  const harness = require("../../lib/harness");
  const claude = require("../../lib/harnesses/claude");
  return { io, harness, claude };
}

test("claude on writes env keys to settings.json", () => withSandbox((home) => {
  const { io, harness, claude } = loadCli();
  const cfg = path.join(home, ".claude", "settings.json");
  // Mirror the CLI flow: on-command resolves `pro` → `neosmith.intelligent-pro`
  // via harness.resolveModel before passing to claude.on().
  const resolved = harness.resolveModel("pro");
  claude.on({ key: "sk-plus-test-aaaaaaaaaaaa", model: resolved });

  assert.ok(io.fileExists(cfg), "settings.json should be created");
  const parsed = io.readJSON(cfg);
  assert.equal(parsed.env.ANTHROPIC_BASE_URL, "https://router.neosmith.ai");
  assert.equal(parsed.env.ANTHROPIC_AUTH_TOKEN, "sk-plus-test-aaaaaaaaaaaa");
  assert.equal(parsed.env.ANTHROPIC_MODEL, "neosmith.intelligent-pro");
}));

test("claude on is warn-no-op on the second call (no double-write)", () => withSandbox((home) => {
  const { io, claude } = loadCli();
  const cfg = path.join(home, ".claude", "settings.json");
  claude.on({ key: "sk-plus-test-aaaaaaaaaaaa", model: "pro" });
  const beforeMtime = fs.statSync(cfg).mtimeMs;

  // Wait long enough that a write would change mtime on this filesystem.
  // 50ms is sufficient on NTFS/ext4 for sub-ms writes; buffered fs resolution
  // can lag, but Windows mtime resolution is 1ms.
  const waitMs = 50;
  const start = Date.now();
  while (Date.now() - start < waitMs) { /* spin */ }

  const res = claude.on({ key: "sk-plus-test-aaaaaaaaaaaa", model: "pro" });
  assert.equal(res.alreadyOn, true, "second on() should return alreadyOn: true");
  assert.equal(fs.statSync(cfg).mtimeMs, beforeMtime,
    "second on() must not modify settings.json");
}));

test("claude on preserves pre-existing Anthropic env keys; off restores byte-for-byte", () => withSandbox((home) => {
  const { io, claude } = loadCli();
  const cfg = path.join(home, ".claude", "settings.json");
  io.ensureDir(path.dirname(cfg));
  const preConnect = JSON.stringify({
    env: { OTHER_API_KEY: "x-other-anchor" },
    hooks: { "PreToolUse": [] },
    permissions: { "allow": ["Read"] },
  }, null, 2) + "\n";
  fs.writeFileSync(cfg, preConnect);

  claude.on({ key: "sk-plus-test-aaaaaaaaaaaa", model: "pro" });

  // After on: pre-existing keys preserved, NeoSmith keys added.
  const after = io.readJSON(cfg);
  assert.equal(after.env.OTHER_API_KEY, "x-other-anchor",
    "pre-existing env keys must survive on()");
  assert.equal(after.hooks.PreToolUse.length, 0,
    "pre-existing hooks must survive on()");
  assert.deepEqual(after.permissions.allow, ["Read"],
    "pre-existing permissions must survive on()");

  // After off: byte-for-byte restoration from snapshot.
  claude.off({});
  const restored = fs.readFileSync(cfg, "utf8");
  assert.equal(restored, preConnect,
    "off() must restore pre-connect bytes verbatim from snapshot");
}));

test("claude off works when no settings.json existed (tombstone snapshot)", () => withSandbox((home) => {
  const { io, claude } = loadCli();
  const cfg = path.join(home, ".claude", "settings.json");
  claude.on({ key: "sk-plus-test-aaaaaaaaaaaa", model: "pro" });
  assert.ok(io.fileExists(cfg), "settings.json must exist after on()");

  claude.off({});
  assert.ok(!io.fileExists(cfg),
    "off() must remove the file when pre-connect snapshot was a tombstone");
}));

test("claude on / off / on / off cycle converges to clean state", () => withSandbox((home) => {
  const { io, claude } = loadCli();
  const cfg = path.join(home, ".claude", "settings.json");

  // off → on → off → on → off: each off must leave the file in pre-connect
  // state (or absent, if pre-connect was empty).
  claude.on({ key: "sk-plus-test-aaaaaaaaaaaa", model: "pro" });
  claude.off({});
  assert.ok(!io.fileExists(cfg), "no pre-connect state → file absent after off");
  claude.on({ key: "sk-plus-test-aaaaaaaaaaaa", model: "basic" });
  claude.off({});
  assert.ok(!io.fileExists(cfg), "second off() must be idempotent");

  const finalEnv = io.fileExists(cfg) ? io.readJSON(cfg).env : null;
  assert.ok(!finalEnv || !finalEnv.ANTHROPIC_AUTH_TOKEN,
    "no ANTHROPIC_AUTH_TOKEN must remain after off");
}));
