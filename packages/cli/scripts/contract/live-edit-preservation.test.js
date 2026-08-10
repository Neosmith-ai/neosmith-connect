// scripts/contract/live-edit-preservation.test.js
//
// Issue #22 contract, for the two file-writable harnesses it is implemented on
// (claude, codex):
//
//   "After a harness is turned ON a user could write or edit more env variables
//    or settings in config/settings files. When user gives command to turn off
//    a harness; user would expect his new env variables should also be kept
//    along with previous settings backup."
//
// Issue #15 stopped `on` from clobbering what was already in the file. This is
// the other side of the round trip: `off` used to restore the pre-connect
// snapshot unconditionally, which silently deleted everything the user wrote
// while the harness was connected.
//
// The three behaviours pinned here:
//
//   A. Untouched file → still a byte-for-byte snapshot restore. Nothing about
//      the old guarantee is given up for files nobody edited.
//   B. Edited file → the live file is kept and only NeoSmith's own keys are
//      taken back, down to individual entries in claude's editor env ARRAY and
//      individual lines (comments included) in codex's TOML.
//   C. A block NeoSmith created is pruned only if it is empty. A user variable
//      added inside `env` / `model_providers` while connected keeps the block.

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { withSandbox } = require("./_sandbox");

const HARNESS_MODULES = ["claude", "cline", "codex", "continue", "copilot", "cursor", "jetbrains", "zed"];

function loadAll() {
  delete require.cache[require.resolve("../../lib/io")];
  delete require.cache[require.resolve("../../lib/preserve")];
  delete require.cache[require.resolve("../../lib/harness")];
  for (const id of HARNESS_MODULES) {
    delete require.cache[require.resolve(`../../lib/harnesses/${id}`)];
  }
  return { io: require("../../lib/io"), harness: require("../../lib/harness") };
}

const KEY = "sk-plus-test-aaaaaaaaaaaa";

function seed(io, mod, text) {
  io.ensureDir(path.dirname(mod.configFile));
  fs.writeFileSync(mod.configFile, text);
  return mod.configFile;
}

function read(p) { return fs.readFileSync(p, "utf8"); }

// ── claude: ~/.claude/settings.json ─────────────────────────────────────────

const CLAUDE_SEED = JSON.stringify({
  env: { MY_OWN_VAR: "keep-me" },
  permissions: { allow: ["Read"] },
  model: "sonnet",
}, null, 2) + "\n";

test("claude: settings added while connected survive off()", () => withSandbox(() => {
  const { io, harness } = loadAll();
  const claude = harness.get("claude");
  const cfg = seed(io, claude, CLAUDE_SEED);

  claude.on({ key: KEY, model: harness.resolveModel("pro") });

  // The user edits settings.json while NeoSmith is on — a new env var, a new
  // permission, a hook, an MCP server. All of it is theirs.
  const live = io.readJSON(cfg);
  live.env.CORP_PROXY = "http://corp-proxy:8080";
  live.permissions.allow.push("Bash");
  live.hooks = { PreToolUse: [{ matcher: "Bash", hooks: [] }] };
  io.writeJSON(cfg, live, 0o600);

  claude.off({});

  const after = JSON.parse(read(cfg));
  assert.equal(after.env.CORP_PROXY, "http://corp-proxy:8080",
    "an env var added while connected must survive off() — this is issue #22 verbatim");
  assert.deepEqual(after.permissions.allow, ["Read", "Bash"], "a permission added while connected survives");
  assert.ok(after.hooks, "a hook block added while connected survives");

  assert.equal(after.env.MY_OWN_VAR, "keep-me", "the pre-connect env var is still there");
  assert.equal(after.model, "sonnet", "the pre-connect model is restored, not deleted");
  assert.ok(!after.env.ANTHROPIC_BASE_URL, "the NeoSmith wiring is gone");
  assert.ok(!after.env.ANTHROPIC_AUTH_TOKEN, "the NeoSmith key is gone");
  assert.ok(!after.env.ANTHROPIC_DEFAULT_OPUS_MODEL, "the NeoSmith tier ladder is gone");
}));

test("claude: an untouched settings.json is still restored byte-for-byte", () => withSandbox(() => {
  const { io, harness } = loadAll();
  const claude = harness.get("claude");
  const cfg = seed(io, claude, CLAUDE_SEED);

  claude.on({ key: KEY, model: harness.resolveModel("pro") });
  claude.off({});

  assert.equal(read(cfg), CLAUDE_SEED,
    "with no edits between on and off, the snapshot path must still apply verbatim");
}));

test("claude: an env block NeoSmith created is kept if the user put a variable in it", () => withSandbox(() => {
  const { io, harness } = loadAll();
  const claude = harness.get("claude");
  // No `env` block at all pre-connect: `on` creates it, so `off` normally
  // removes it again.
  const cfg = seed(io, claude, JSON.stringify({ permissions: { allow: ["Read"] } }, null, 2) + "\n");

  claude.on({ key: KEY, model: harness.resolveModel("pro") });

  const live = io.readJSON(cfg);
  live.env.CORP_PROXY = "http://corp-proxy:8080";
  io.writeJSON(cfg, live, 0o600);

  claude.off({});

  const after = JSON.parse(read(cfg));
  assert.deepEqual(after.env, { CORP_PROXY: "http://corp-proxy:8080" },
    "the block NeoSmith created stays, holding exactly the user's own variable");
  assert.ok(!("model" in after), "a top-level default NeoSmith introduced is still removed");
}));

test("claude: with no env edits, the block NeoSmith created is still removed", () => withSandbox(() => {
  const { io, harness } = loadAll();
  const claude = harness.get("claude");
  const cfg = seed(io, claude, JSON.stringify({ permissions: { allow: ["Read"] } }, null, 2) + "\n");

  claude.on({ key: KEY, model: harness.resolveModel("pro") });

  // Touch the file somewhere else so off() takes the merge path, not the
  // snapshot path — the env block must still go.
  const live = io.readJSON(cfg);
  live.permissions.allow.push("Bash");
  io.writeJSON(cfg, live, 0o600);

  claude.off({});

  const after = JSON.parse(read(cfg));
  assert.ok(!("env" in after), "an empty block NeoSmith created is pruned");
  assert.deepEqual(after.permissions.allow, ["Read", "Bash"], "the unrelated edit survives");
}));

// ── claude: the IDE extension's env ARRAY ───────────────────────────────────

function editorSettingsPath(home) {
  if (process.platform === "win32") return path.join(home, "Code", "User", "settings.json"); // APPDATA=sandbox
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "Code", "User", "settings.json");
  return path.join(home, ".config", "Code", "User", "settings.json");
}

function seedEditor(io, home, contents) {
  fs.mkdirSync(path.join(home, ".vscode", "extensions", "anthropic.claude-code-2.1.0-win32-x64"), { recursive: true });
  const p = editorSettingsPath(home);
  io.ensureDir(path.dirname(p));
  fs.writeFileSync(p, contents);
  return p;
}

test("claude: a variable added to claudeCode.environmentVariables while connected survives off()", () => withSandbox((home) => {
  const { io, harness } = loadAll();
  const claude = harness.get("claude");

  const settings = seedEditor(io, home, JSON.stringify({
    "editor.fontSize": 14,
    "claudeCode.environmentVariables": [
      { name: "ANTHROPIC_BASE_URL", value: "https://my-own-gateway.example.com" },
    ],
  }, null, 2) + "\n");

  claude.on({ key: KEY, model: harness.resolveModel("pro") });

  // The user adds their corporate proxy to the same array while connected.
  const live = io.readJSON(settings);
  live["claudeCode.environmentVariables"].push({ name: "HTTPS_PROXY", value: "http://corp-proxy:8080" });
  live["editor.tabSize"] = 4;
  io.writeJSON(settings, live, 0o600);

  claude.off({});

  const after = JSON.parse(read(settings));
  const byName = Object.fromEntries((after["claudeCode.environmentVariables"] || []).map((e) => [e.name, e.value]));
  assert.equal(byName.HTTPS_PROXY, "http://corp-proxy:8080",
    "an entry the user added to the array while connected must not be dropped by the ledger replay");
  assert.equal(byName.ANTHROPIC_BASE_URL, "https://my-own-gateway.example.com",
    "a NeoSmith-owned name that WAS the user's before connecting gets their value back");
  assert.ok(!("CLAUDE_CODE_USE_BEDROCK" in byName), "names NeoSmith introduced are gone");
  assert.equal(after["editor.tabSize"], 4, "an unrelated editor setting added while connected survives");
  assert.equal(after["editor.fontSize"], 14, "pre-connect editor settings survive");
  assert.ok(!("claudeCode.disableLoginPrompt" in after), "the other claudeCode.* keys NeoSmith wrote are gone");
}));

test("claude: an env array NeoSmith created is dropped when the user never added to it", () => withSandbox((home) => {
  const { io, harness } = loadAll();
  const claude = harness.get("claude");
  const settings = seedEditor(io, home, JSON.stringify({ "editor.fontSize": 14 }, null, 2) + "\n");

  claude.on({ key: KEY, model: harness.resolveModel("pro") });

  const live = io.readJSON(settings);
  live["editor.tabSize"] = 4;   // edit elsewhere, to force the merge path
  io.writeJSON(settings, live, 0o600);

  claude.off({});

  const after = JSON.parse(read(settings));
  assert.ok(!("claudeCode.environmentVariables" in after),
    "an array that holds nothing but NeoSmith's own entries goes away entirely");
  assert.equal(after["editor.tabSize"], 4);
}));

// ── codex: ~/.codex/config.toml ─────────────────────────────────────────────

const CODEX_SEED = 'model = "gpt-5-user"\nmodel_provider = "openai"\n\n[model_providers.other]\nname = "Other"\nbase_url = "https://example.com/v1"\n';

test("codex: `on` fences its lines behind a managed-block banner", () => withSandbox(() => {
  const { io, harness } = loadAll();
  const codex = harness.get("codex");
  const cfg = seed(io, codex, CODEX_SEED);

  codex.on({ key: KEY, model: harness.resolveModel("pro") });

  const text = read(cfg);
  assert.match(text, /NeoSmith managed block/, "the banner tells the user which lines are ours");
  const bannerAt = text.indexOf("NeoSmith managed block");
  const blockAt = text.indexOf("[model_providers.neosmith]");
  assert.ok(bannerAt !== -1 && blockAt !== -1 && bannerAt < blockAt, "the banner sits above the block it describes");
  assert.match(text, /^model = "neosmith[^"]*"\s+# NeoSmith managed/m, "the top-level keys carry a marker too");

  // A second `on` must not stack a second banner.
  codex.on({ key: KEY, model: harness.resolveModel("basic") });
  const again = read(cfg);
  assert.equal(again.split("NeoSmith managed block").length - 1, 1, "re-running `on` does not duplicate the banner");
}));

test("codex: providers and comments added while connected survive off()", () => withSandbox(() => {
  const { io, harness } = loadAll();
  const codex = harness.get("codex");
  const cfg = seed(io, codex, CODEX_SEED);

  codex.on({ key: KEY, model: harness.resolveModel("pro") });

  // The user edits config.toml while NeoSmith is on: a new provider of their
  // own, a top-level setting, and a comment above each.
  fs.writeFileSync(cfg, read(cfg) +
    '\n# my own notes about this provider\n[model_providers.mine]\nname = "Mine"\nbase_url = "https://mine.example.com/v1"\n');

  codex.off({});

  const after = read(cfg);
  assert.match(after, /\[model_providers\.mine\]/, "a provider added while connected must survive — issue #22 verbatim");
  assert.match(after, /base_url = "https:\/\/mine\.example\.com\/v1"/, "its settings survive");
  assert.match(after, /# my own notes about this provider/, "and so does the comment the user wrote above it");

  assert.ok(!after.includes("[model_providers.neosmith]"), "the NeoSmith provider block is gone");
  assert.ok(!after.includes("NeoSmith managed block"), "the banner goes with it");
  assert.ok(!after.includes("# NeoSmith managed"), "so do the top-level markers");
  assert.match(after, /model = "gpt-5-user"/, "the pre-connect model is restored");
  assert.match(after, /model_provider = "openai"/, "the pre-connect model_provider is restored");
  assert.match(after, /\[model_providers\.other\]/, "the pre-connect provider is still there");

  const parsed = require("smol-toml").parse(after);
  assert.equal(parsed.model, "gpt-5-user");
  assert.equal(parsed.model_provider, "openai");
  assert.ok(!parsed.model_providers.neosmith);
  assert.equal(parsed.model_providers.mine.name, "Mine");
}));

test("codex: an untouched config.toml is still restored byte-for-byte", () => withSandbox(() => {
  const { io, harness } = loadAll();
  const codex = harness.get("codex");
  const cfg = seed(io, codex, CODEX_SEED);

  codex.on({ key: KEY, model: harness.resolveModel("pro") });
  codex.off({});

  assert.equal(read(cfg), CODEX_SEED,
    "with no edits between on and off, the snapshot path must still apply verbatim");
}));

test("codex: top-level keys NeoSmith introduced are removed, not left pointing at NeoSmith", () => withSandbox(() => {
  const { io, harness } = loadAll();
  const codex = harness.get("codex");
  // Nothing pre-connect: `on` introduces model / model_provider / the provider table.
  const cfg = seed(io, codex, 'approval_policy = "on-request"\n');

  codex.on({ key: KEY, model: harness.resolveModel("pro") });

  fs.writeFileSync(cfg, read(cfg) + '\n[model_providers.mine]\nname = "Mine"\n');

  codex.off({});

  const parsed = require("smol-toml").parse(read(cfg));
  assert.ok(!("model" in parsed), "a top-level key NeoSmith introduced is removed");
  assert.ok(!("model_provider" in parsed), "and so is the other one");
  assert.equal(parsed.approval_policy, "on-request", "the user's own top-level setting is untouched");
  assert.equal(parsed.model_providers.mine.name, "Mine", "the provider they added while connected survives");
  assert.ok(!parsed.model_providers.neosmith, "ours is gone");
}));

// ── the fallback that makes this work for connections made by an older CLI ──

test("both: off() still merges when state.json is lost, deriving priors from the snapshot", () => withSandbox(() => {
  const { io, harness } = loadAll();

  for (const [id, seedText, edit, check] of [
    ["claude", CLAUDE_SEED,
      (cfg) => {
        const live = io.readJSON(cfg);
        live.env.CORP_PROXY = "http://corp-proxy:8080";
        io.writeJSON(cfg, live, 0o600);
      },
      (cfg) => {
        const after = JSON.parse(read(cfg));
        assert.equal(after.env.CORP_PROXY, "http://corp-proxy:8080", "claude: the edit survives");
        assert.equal(after.env.MY_OWN_VAR, "keep-me", "claude: the pre-connect var is back");
        assert.equal(after.model, "sonnet", "claude: the pre-connect model is back");
        assert.ok(!after.env.ANTHROPIC_AUTH_TOKEN, "claude: the NeoSmith wiring is gone");
      }],
    ["codex", CODEX_SEED,
      (cfg) => fs.writeFileSync(cfg, read(cfg) + '\n[model_providers.mine]\nname = "Mine"\n'),
      (cfg) => {
        const after = read(cfg);
        assert.match(after, /\[model_providers\.mine\]/, "codex: the edit survives");
        assert.match(after, /model = "gpt-5-user"/, "codex: the pre-connect model is back");
        assert.ok(!after.includes("[model_providers.neosmith]"), "codex: the NeoSmith block is gone");
      }],
  ]) {
    const mod = harness.get(id);
    const cfg = seed(io, mod, seedText);
    mod.on({ key: KEY, model: harness.resolveModel("pro") });
    edit(cfg);

    // Simulate a connect made before the ledger and the fingerprint existed:
    // the .bak is all that is left. The merge path must derive the prior
    // values from it rather than restoring it over the user's edits.
    io.clearRestore(id);
    io.clearFingerprint(id, cfg);

    mod.off({});
    check(cfg);
  }
}));

// ── the fingerprint itself ──────────────────────────────────────────────────

test("fingerprint: a second on() re-stamps, so an unedited file still takes the snapshot path", () => withSandbox(() => {
  const { io, harness } = loadAll();
  const claude = harness.get("claude");
  const cfg = seed(io, claude, CLAUDE_SEED);

  claude.on({ key: KEY, model: harness.resolveModel("pro") });
  assert.equal(io.fileDrifted("claude", cfg), false, "the file matches what on() wrote");

  // A second `on` rewrites the file with a different tier — if the fingerprint
  // were write-once like the snapshot, this would read as a user edit.
  claude.on({ key: KEY, model: harness.resolveModel("basic"), force: true });
  assert.equal(io.fileDrifted("claude", cfg), false, "on() re-stamps the fingerprint");

  const live = io.readJSON(cfg);
  live.env.CORP_PROXY = "http://corp-proxy:8080";
  io.writeJSON(cfg, live, 0o600);
  assert.equal(io.fileDrifted("claude", cfg), true, "a user edit is detected");

  claude.off({});
  assert.equal(io.readFingerprint("claude", cfg), null, "off() clears the fingerprint");
}));
