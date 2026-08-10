// scripts/contract/env-preservation.test.js
//
// Issue #15 contract, for EVERY harness:
//
//   "A user may have previous variables set in env block or other block you
//    are touching while setting a harness on. script should preserve user
//    defined env variables and merge the new env variables while setting
//    harness ON. similarly while setting OFF; the older env should be
//    restored fully."
//
// Three failure modes this pins shut:
//
//   A. Snapshot clobber — codex/continue re-snapshotted on every on(), so a
//      second `on` captured the already-NeoSmith config and `off` "restored"
//      that. io.snapshot() is now write-once.
//   B. Replace-not-merge — claude rebuilt claudeCode.environmentVariables from
//      scratch (dropping user entries); zed overwrote the user's own
//      api_url/api_key.
//   C. Destructive fallback — with no .bak, `off` deleted keys it never wrote
//      (claude's ANTHROPIC_API_KEY, zed's api_key). There is now a restore
//      ledger in ~/.neosmith/state.json recording each key's prior value.
//
// The WRITABLE table is driven by harness.idsSorted(), so a new harness cannot
// be added without either landing here or being declared UI-driven.

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { withSandbox } = require("./_sandbox");

const HARNESS_MODULES = ["claude", "cline", "codex", "continue", "copilot", "cursor", "jetbrains", "zed"];

// Re-require everything so io.js picks up the sandbox HOME. The registry caches
// loaded modules, so every harness module must be evicted, not just the one
// under test.
function loadAll() {
  delete require.cache[require.resolve("../../lib/io")];
  delete require.cache[require.resolve("../../lib/harness")];
  for (const id of HARNESS_MODULES) {
    delete require.cache[require.resolve(`../../lib/harnesses/${id}`)];
  }
  return { io: require("../../lib/io"), harness: require("../../lib/harness") };
}

const KEY = "sk-plus-test-aaaaaaaaaaaa";

// ── the writable-harness table ──────────────────────────────────────────────
// seed()          writes a pre-connect config full of user-owned values
// userSurvives()  asserts those values are still there
// neoPresent()    asserts on() actually wired NeoSmith
// neoGone()       asserts off() removed the NeoSmith wiring
const WRITABLE = {
  claude: {
    seed: () => JSON.stringify({
      env: { MY_OWN_VAR: "keep-me", ANTHROPIC_API_KEY: "user-owned-key" },
      model: "sonnet",
      advisorModel: "sonnet",
      permissions: { allow: ["Read"] },
    }, null, 2) + "\n",
    userSurvives(t, text) {
      const c = JSON.parse(text);
      assert.equal(c.env.MY_OWN_VAR, "keep-me", `${t}: user env var must survive`);
      assert.equal(c.env.ANTHROPIC_API_KEY, "user-owned-key", `${t}: user's own ANTHROPIC_API_KEY must survive`);
      assert.deepEqual(c.permissions.allow, ["Read"], `${t}: unrelated blocks must survive`);
    },
    neoPresent(text) {
      const c = JSON.parse(text);
      assert.equal(c.env.ANTHROPIC_BASE_URL, "https://router.neosmith.ai");
      assert.equal(c.env.ANTHROPIC_AUTH_TOKEN, KEY);
    },
    neoGone(text) {
      const c = JSON.parse(text);
      assert.ok(!c.env.ANTHROPIC_BASE_URL, "ANTHROPIC_BASE_URL removed");
      assert.ok(!c.env.ANTHROPIC_AUTH_TOKEN, "ANTHROPIC_AUTH_TOKEN removed");
      assert.ok(!c.env.ANTHROPIC_DEFAULT_OPUS_MODEL, "tier ladder removed");
      assert.equal(c.model, "sonnet", "user's top-level model restored, not deleted");
      assert.equal(c.advisorModel, "sonnet", "user's advisorModel restored, not deleted");
    },
  },

  codex: {
    seed: () => 'model = "gpt-5-user"\nmodel_provider = "openai"\n\n[model_providers.other]\nname = "Other"\nbase_url = "https://example.com/v1"\n',
    userSurvives(t, text) {
      assert.match(text, /\[model_providers\.other\]/, `${t}: user's own provider block must survive`);
      assert.match(text, /base_url\s*=\s*"https:\/\/example\.com\/v1"/, `${t}: user's provider settings must survive`);
    },
    neoPresent(text) {
      assert.match(text, /\[model_providers\.neosmith\]/);
      assert.match(text, /model_provider\s*=\s*"neosmith"/);
    },
    neoGone(text) {
      assert.ok(!text.includes("[model_providers.neosmith]"), "neosmith provider block removed");
      assert.match(text, /model\s*=\s*"gpt-5-user"/, "user's model restored, not deleted");
      assert.match(text, /model_provider\s*=\s*"openai"/, "user's model_provider restored, not deleted");
    },
  },

  continue: {
    seed: () => "models:\n  - name: MyOwnModel\n    provider: openai\n    apiBase: https://example.com/v1\n    apiKey: user-owned-key\n",
    userSurvives(t, text) {
      assert.match(text, /name:\s*MyOwnModel/, `${t}: user's own model entry must survive`);
      assert.match(text, /apiKey:\s*user-owned-key/, `${t}: user's own apiKey must survive`);
    },
    neoPresent(text) {
      assert.match(text, /name:\s*NeoSmith/);
    },
    neoGone(text) {
      assert.ok(!/name:\s*NeoSmith\b/.test(text), "NeoSmith model entry removed");
      assert.match(text, /name:\s*MyOwnModel/, "user's model entry still there");
    },
  },

  zed: {
    seed: () => JSON.stringify({
      theme: "One Dark",
      language_models: {
        openai: {
          api_url: "https://example.com/v1",
          api_key: "user-owned-key",
          available_models: [{ name: "gpt-5-user", max_tokens: 4096 }],
        },
      },
    }, null, 2) + "\n",
    userSurvives(t, text) {
      const c = JSON.parse(text);
      assert.equal(c.theme, "One Dark", `${t}: unrelated settings must survive`);
      const names = (c.language_models.openai.available_models || []).map((m) => m.name);
      assert.ok(names.includes("gpt-5-user"), `${t}: user's own model entry must survive`);
    },
    neoPresent(text) {
      const c = JSON.parse(text);
      assert.equal(c.language_models.openai.api_url, "https://router.neosmith.ai/v1");
      assert.equal(c.language_models.openai.api_key, KEY);
    },
    neoGone(text) {
      const c = JSON.parse(text);
      const o = c.language_models.openai;
      assert.equal(o.api_url, "https://example.com/v1", "user's api_url restored, not deleted");
      assert.equal(o.api_key, "user-owned-key", "user's api_key restored, not deleted");
      const names = (o.available_models || []).map((m) => m.name);
      assert.ok(!names.some((n) => n.startsWith("neosmith.")), "NeoSmith models removed");
    },
  },

  // Cline 4.x (VS Code/JetBrains) and the standalone CLI share ONE global
  // providers.json, so the user's other providers — and which one is selected
  // — are exactly what `on` must not trample.
  cline: {
    seed: () => JSON.stringify({
      version: 1,
      lastUsedProvider: "anthropic",
      providers: {
        anthropic: { settings: { provider: "anthropic", model: "claude-sonnet-4-6" } },
        "openai-compatible": {
          settings: {
            provider: "openai-compatible",
            apiKey: "user-owned-key",
            model: "gpt-5-user",
            baseUrl: "https://example.com/v1",
          },
          tokenSource: "manual",
        },
      },
    }, null, 2) + "\n",
    userSurvives(t, text) {
      const c = JSON.parse(text);
      assert.ok(c.providers.anthropic, `${t}: the user's other providers must survive`);
      assert.equal(c.providers.anthropic.settings.model, "claude-sonnet-4-6",
        `${t}: unrelated provider settings must survive`);
    },
    neoPresent(text) {
      const c = JSON.parse(text);
      const s = c.providers["openai-compatible"].settings;
      assert.equal(s.baseUrl, "https://router.neosmith.ai/v1");
      assert.equal(s.apiKey, KEY);
      assert.equal(c.lastUsedProvider, "openai-compatible",
        "a provider Cline never selects is wired on disk and dead in practice");
    },
    neoGone(text) {
      const c = JSON.parse(text);
      const s = c.providers["openai-compatible"].settings;
      assert.equal(s.baseUrl, "https://example.com/v1", "user's baseUrl restored, not deleted");
      assert.equal(s.apiKey, "user-owned-key", "user's apiKey restored, not deleted");
      assert.equal(c.lastUsedProvider, "anthropic", "user's active provider restored");
    },
  },

  // chatLanguageModels.json is a top-level ARRAY of provider entries, keyed
  // `name`, with the endpoint on each MODEL as `url`. Pinning the real shape
  // here: the pre-0.9 module wrote {"vendors":[…]} with a provider-level
  // baseUrl, which VS Code ignores outright.
  copilot: {
    seed: () => JSON.stringify([
      {
        name: "My Own",
        vendor: "customendpoint",
        apiType: "chat-completions",
        models: [{ id: "gpt-5-user", name: "gpt-5-user", url: "https://example.com/v1" }],
      },
    ], null, 2) + "\n",
    userSurvives(t, text) {
      const c = JSON.parse(text);
      assert.ok(Array.isArray(c), `${t}: the file root must stay an array`);
      assert.ok(c.some((v) => v.name === "My Own"), `${t}: user's own provider must survive`);
    },
    neoPresent(text) {
      const c = JSON.parse(text);
      const neo = c.find((v) => v.name === "NeoSmith");
      assert.ok(neo, "NeoSmith provider registered");
      assert.equal(neo.vendor, "customendpoint");
      assert.ok(!("baseUrl" in neo), "the endpoint belongs on the model, not the provider");
      assert.equal(neo.models[0].url, "https://router.neosmith.ai/v1");
      assert.ok(!("apiKey" in neo), "apiKey is minted by VS Code, never written by us");
    },
    neoGone(text) {
      const c = JSON.parse(text);
      assert.ok(!c.some((v) => v.name === "NeoSmith"), "NeoSmith provider removed");
      assert.equal(c.length, 1, "only the user's provider remains");
    },
  },
};

const UI_DRIVEN = ["cursor", "jetbrains"];

// ── coverage gate ───────────────────────────────────────────────────────────
test("issue #15: every registered harness is covered by this file", () => withSandbox(() => {
  const { harness } = loadAll();
  const covered = new Set([...Object.keys(WRITABLE), ...UI_DRIVEN]);
  for (const id of harness.idsSorted()) {
    assert.ok(covered.has(id),
      `harness '${id}' is not covered by env-preservation.test.js — add it to WRITABLE ` +
      `(with a seed/userSurvives/neoPresent/neoGone spec) or to UI_DRIVEN if it writes no config file.`);
  }
}));

test("issue #15: the WRITABLE/UI_DRIVEN split matches the registry's `writable` flag", () => withSandbox(() => {
  const { harness } = loadAll();
  for (const id of Object.keys(WRITABLE)) {
    assert.equal(harness.get(id).writable, true, `${id} is in WRITABLE but not registry-writable`);
  }
  for (const id of UI_DRIVEN) {
    assert.equal(harness.get(id).writable, false, `${id} is in UI_DRIVEN but registry-writable`);
  }
}));

// ── per-harness contracts ───────────────────────────────────────────────────
for (const id of Object.keys(WRITABLE)) {
  const spec = WRITABLE[id];

  function setup(io, harness) {
    const mod = harness.get(id);
    const cfg = mod.configFile;
    const preConnect = spec.seed();
    io.ensureDir(path.dirname(cfg));
    fs.writeFileSync(cfg, preConnect);
    return { mod, cfg, preConnect };
  }

  test(`${id}: on() merges — user-defined values survive alongside the NeoSmith wiring`, () => withSandbox(() => {
    const { io, harness } = loadAll();
    const { mod, cfg } = setup(io, harness);

    mod.on({ key: KEY, model: harness.resolveModel("pro") });

    const after = fs.readFileSync(cfg, "utf8");
    spec.userSurvives("after on", after);
    spec.neoPresent(after);
  }));

  test(`${id}: a second on() must not overwrite the pre-connect snapshot`, () => withSandbox(() => {
    const { io, harness } = loadAll();
    const { mod, cfg, preConnect } = setup(io, harness);

    mod.on({ key: KEY, model: harness.resolveModel("pro") });
    const bak = io.snapshotPath(id);
    assert.ok(io.fileExists(bak), "on() must take a snapshot");
    assert.equal(fs.readFileSync(bak, "utf8"), preConnect,
      "the .bak must hold the PRE-CONNECT bytes");

    // Re-run on() with a different tier — the exact flow that used to destroy
    // the baseline for codex/continue.
    mod.on({ key: KEY, model: harness.resolveModel("basic") });
    assert.equal(fs.readFileSync(bak, "utf8"), preConnect,
      "a second on() must leave the pre-connect snapshot untouched");

    mod.off({});
    assert.equal(fs.readFileSync(cfg, "utf8"), preConnect,
      "off() after two on()s must still restore the user's original config");
  }));

  test(`${id}: off() restores the pre-connect file byte-for-byte`, () => withSandbox(() => {
    const { io, harness } = loadAll();
    const { mod, cfg, preConnect } = setup(io, harness);

    mod.on({ key: KEY, model: harness.resolveModel("pro") });
    mod.off({});

    assert.equal(fs.readFileSync(cfg, "utf8"), preConnect,
      "off() must restore the pre-connect bytes verbatim from the snapshot");
  }));

  test(`${id}: off() with no snapshot replays the restore ledger`, () => withSandbox(() => {
    const { io, harness } = loadAll();
    const { mod, cfg } = setup(io, harness);

    mod.on({ key: KEY, model: harness.resolveModel("pro") });

    // The ledger is the safety net for exactly this: the .bak is gone.
    const ledger = io.readRestore(id, cfg);
    assert.ok(ledger && ledger.length, `${id} must record a restore ledger during on()`);
    io.clearSnapshot(id);

    mod.off({});

    const after = fs.readFileSync(cfg, "utf8");
    spec.userSurvives("after ledger-restore off", after);
    spec.neoGone(after);
    assert.equal(io.readRestore(id, cfg), null, "off() must clear the ledger");
  }));
}

// ── UI-driven harnesses ─────────────────────────────────────────────────────
for (const id of UI_DRIVEN) {
  test(`${id}: UI-driven — on()/off() touch no config file, so there is no env to preserve`, () => withSandbox((home) => {
    const { io, harness } = loadAll();
    const mod = harness.get(id);
    assert.equal(mod.configFile, null, `${id} must declare no config file`);

    mod.on({ key: KEY, model: harness.resolveModel("pro") });
    mod.off({});

    // The only thing it may write under HOME is ~/.neosmith bookkeeping.
    const touched = fs.readdirSync(home).filter((n) => n !== ".neosmith");
    assert.deepEqual(touched, [], `${id} must not write anything outside ~/.neosmith`);
    assert.equal(io.getHarnessFlag(id), false, "off() clears the on-flag");
  }));
}

// ── claude's IDE-extension env array (the literal issue #15 report) ──────────
function editorSettingsPath(home) {
  if (process.platform === "win32") return path.join(home, "Code", "User", "settings.json"); // APPDATA=sandbox
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "Code", "User", "settings.json");
  return path.join(home, ".config", "Code", "User", "settings.json");
}

test("claude: user entries in claudeCode.environmentVariables survive on() and come back after off()", () => withSandbox((home) => {
  const { io, harness } = loadAll();
  const claude = harness.get("claude");

  fs.mkdirSync(path.join(home, ".vscode", "extensions", "anthropic.claude-code-2.1.0-win32-x64"), { recursive: true });
  const editorSettings = editorSettingsPath(home);
  io.ensureDir(path.dirname(editorSettings));
  const preConnect = JSON.stringify({
    "editor.fontSize": 14,
    "claudeCode.environmentVariables": [
      { name: "HTTPS_PROXY", value: "http://corp-proxy:8080" },
      { name: "ANTHROPIC_BASE_URL", value: "https://my-own-gateway.example.com" },
    ],
  }, null, 2) + "\n";
  fs.writeFileSync(editorSettings, preConnect);

  claude.on({ key: KEY, model: harness.resolveModel("pro") });

  const wired = io.readJSON(editorSettings);
  const vars = wired["claudeCode.environmentVariables"];
  const byName = Object.fromEntries(vars.map((e) => [e.name, e.value]));
  assert.equal(byName.HTTPS_PROXY, "http://corp-proxy:8080",
    "a user-defined env var in the array must survive on() — this is issue #15 verbatim");
  assert.equal(byName.ANTHROPIC_BASE_URL, "https://router.neosmith.ai",
    "a NeoSmith-owned name is overwritten in place");
  assert.equal(vars.filter((e) => e.name === "ANTHROPIC_BASE_URL").length, 1,
    "merge by name must not duplicate an entry");

  claude.off({});
  assert.equal(fs.readFileSync(editorSettings, "utf8"), preConnect,
    "off() restores the editor settings byte-for-byte, including the user's own gateway URL");
}));

test("claude: with no snapshot, the ledger restores the user's editor env array", () => withSandbox((home) => {
  const { io, harness } = loadAll();
  const claude = harness.get("claude");

  fs.mkdirSync(path.join(home, ".vscode", "extensions", "anthropic.claude-code-2.1.0-win32-x64"), { recursive: true });
  const editorSettings = editorSettingsPath(home);
  io.ensureDir(path.dirname(editorSettings));
  fs.writeFileSync(editorSettings, JSON.stringify({
    "editor.fontSize": 14,
    "claudeCode.environmentVariables": [{ name: "HTTPS_PROXY", value: "http://corp-proxy:8080" }],
  }, null, 2) + "\n");

  claude.on({ key: KEY, model: harness.resolveModel("pro") });
  io.clearSnapshot("claude-ext-vscode");
  claude.off({});

  const after = io.readJSON(editorSettings);
  assert.equal(after["editor.fontSize"], 14, "unrelated editor settings kept");
  const vars = after["claudeCode.environmentVariables"];
  assert.deepEqual(vars, [{ name: "HTTPS_PROXY", value: "http://corp-proxy:8080" }],
    "the ledger puts the user's env array back exactly, dropping only NeoSmith's additions");
}));
