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

test("claude on writes the full per-tier model ladder + display names + top-level defaults", () => withSandbox((home) => {
  const { io, harness, claude } = loadCli();
  const cfg = path.join(home, ".claude", "settings.json");
  claude.on({ key: "sk-plus-test-aaaaaaaaaaaa", model: harness.resolveModel("pro") });

  const parsed = io.readJSON(cfg);
  const env = parsed.env;
  // Per-tier model + branded name + description for all four slots.
  assert.equal(env.ANTHROPIC_DEFAULT_OPUS_MODEL, "neosmith.intelligent-pro");
  assert.equal(env.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME, "NeoSmith Pro");
  assert.equal(env.ANTHROPIC_DEFAULT_SONNET_MODEL, "neosmith.intelligent-basic");
  assert.equal(env.ANTHROPIC_DEFAULT_HAIKU_MODEL, "neosmith.neolite");
  assert.equal(env.ANTHROPIC_DEFAULT_FABLE_MODEL, "neosmith.intelligent-maestro");
  assert.ok(env.ANTHROPIC_DEFAULT_FABLE_MODEL_DESCRIPTION, "fable description present");
  // Top-level defaults derived from the requested model (pro → opus slot).
  assert.equal(parsed.model, "opus");
  assert.equal(parsed.advisorModel, "opus");
}));

test("claude on --model maestro maps model slot to fable and writes maestro SKU", () => withSandbox((home) => {
  const { io, harness, claude } = loadCli();
  const cfg = path.join(home, ".claude", "settings.json");
  claude.on({ key: "sk-plus-test-aaaaaaaaaaaa", model: harness.resolveModel("maestro") });
  const parsed = io.readJSON(cfg);
  assert.equal(parsed.env.ANTHROPIC_MODEL, "neosmith.intelligent-maestro");
  assert.equal(parsed.model, "fable");
}));

test("claude off fallback strips the tier ladder + top-level defaults when no snapshot", () => withSandbox((home) => {
  const { io, harness, claude } = loadCli();
  const cfg = path.join(home, ".claude", "settings.json");
  claude.on({ key: "sk-plus-test-aaaaaaaaaaaa", model: harness.resolveModel("pro") });
  // Remove the snapshot so off() takes the strip-fallback path.
  io.clearSnapshot("claude");
  claude.off({});
  const parsed = io.readJSON(cfg);
  const env = parsed.env || {};
  assert.ok(!env.ANTHROPIC_AUTH_TOKEN, "auth token stripped");
  assert.ok(!env.ANTHROPIC_DEFAULT_OPUS_MODEL, "opus tier stripped");
  assert.ok(!env.ANTHROPIC_DEFAULT_FABLE_MODEL, "fable tier stripped");
  assert.ok(!parsed.model, "top-level model stripped");
  assert.ok(!parsed.advisorModel, "top-level advisorModel stripped");
}));

// Editor settings dir per-OS, mirroring the harness's detectEditorsWithClaudeExt.
// The sandbox sets HOME/USERPROFILE/APPDATA to the temp home.
function editorSettingsPath(home, editor) {
  const dirName = editor === "vscode" ? "Code" : "Cursor";
  if (process.platform === "win32") return path.join(home, dirName, "User", "settings.json"); // APPDATA=sandbox
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", dirName, "User", "settings.json");
  return path.join(home, ".config", dirName, "User", "settings.json");
}

test("claude on wires the IDE extension settings.json when the extension is present", () => withSandbox((home) => {
  const { io, harness, claude } = loadCli();
  // Simulate VS Code with the Claude Code extension installed.
  const extDir = path.join(home, ".vscode", "extensions", "anthropic.claude-code-2.1.0-win32-x64");
  fs.mkdirSync(extDir, { recursive: true });
  const editorSettings = editorSettingsPath(home, "vscode");
  io.ensureDir(path.dirname(editorSettings));
  fs.writeFileSync(editorSettings, JSON.stringify({ "editor.fontSize": 14 }, null, 2) + "\n");

  claude.on({ key: "sk-plus-test-bbbbbbbbbbbb", model: harness.resolveModel("pro") });

  const parsed = io.readJSON(editorSettings);
  assert.equal(parsed["editor.fontSize"], 14, "pre-existing editor settings preserved");
  assert.equal(parsed["claudeCode.preferredLocation"], "panel");
  assert.equal(parsed["claudeCode.disableLoginPrompt"], true);
  const ev = parsed["claudeCode.environmentVariables"];
  assert.ok(Array.isArray(ev), "environmentVariables array written");
  const byName = Object.fromEntries(ev.map((e) => [e.name, e.value]));
  assert.equal(byName.ANTHROPIC_BASE_URL, "https://router.neosmith.ai");
  assert.equal(byName.ANTHROPIC_API_KEY, "sk-plus-test-bbbbbbbbbbbb");
  assert.equal(byName.CLAUDE_CODE_USE_BEDROCK, "0");
  assert.equal(byName.ANTHROPIC_DEFAULT_FABLE_MODEL, "neosmith.intelligent-maestro");

  // off() restores the editor settings byte-for-byte.
  claude.off({});
  assert.equal(fs.readFileSync(editorSettings, "utf8"), JSON.stringify({ "editor.fontSize": 14 }, null, 2) + "\n",
    "editor settings.json restored byte-for-byte after off");
}));

test("claude on without the extension leaves editors untouched and reports none", () => withSandbox((home) => {
  const { io, harness, claude } = loadCli();
  const editorSettings = editorSettingsPath(home, "vscode");
  const res = claude.on({ key: "sk-plus-test-cccccccccccc", model: harness.resolveModel("pro") });
  assert.deepEqual(res.editors, [], "no editors wired when extension absent");
  assert.ok(!io.fileExists(editorSettings), "no editor settings.json created when extension absent");
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
