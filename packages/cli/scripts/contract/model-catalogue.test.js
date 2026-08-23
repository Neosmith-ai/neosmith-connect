// scripts/contract/model-catalogue.test.js
//
// Every harness that can register a model catalogue must register EVERY
// NeoSmith SKU, with each SKU's real context window.
//
// Two separate failures this is here to prevent, both of which had shipped:
//
//   1. ONE MODEL. zed, continue and copilot each registered only the tier
//      passed to `on`. Switching tiers inside those tools does not re-run
//      `on`, so the other three SKUs were simply not selectable — you had to
//      disconnect and reconnect to change tier, or hand-edit the config.
//
//   2. A WRONG CONTEXT WINDOW, which is worse, because nothing looks broken.
//      zed wrote a flat `max_tokens: 8192`, and `max_tokens` is Zed's name for
//      the model's CONTEXT WINDOW ("you must provide the model's context
//      window in max_tokens" — zed.dev/docs/ai/use-api-access). So a 1M SKU
//      behaved like an 8K one and compacted almost immediately. copilot
//      hardcoded 1000000/128000 for every model, which is false for neolite's
//      sealed 512K.
//
// GET /v1/models returns ids only — no window, no capabilities — so none of
// these clients can discover this. If the CLI does not write it, it is wrong.
// That is the same reasoning recorded in harnesses.json's `$modelSpecs` note.
//
// The exempt list below is the escape hatch, and it requires a reason.

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { withSandbox } = require("./_sandbox");

const KEY = "sk-plus-catalogue-test-aaaa";

const HARNESS_MODULES = ["claude", "cline", "codex", "continue", "copilot", "cursor",
  "jetbrains", "zed", "opencode", "openclaw", "junie"];

function loadAll() {
  delete require.cache[require.resolve("../../lib/io")];
  delete require.cache[require.resolve("../../lib/harness")];
  for (const id of HARNESS_MODULES) {
    delete require.cache[require.resolve(`../../lib/harnesses/${id}`)];
  }
  return { io: require("../../lib/io"), harness: require("../../lib/harness") };
}

const readJSON = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

// For each harness: read back what `on` wrote as a Map of sku → declared
// context window (or null where the harness has no field for one).
//
//   windows: false  — this harness registers models but declares no context
//                     window, because its client does not read one.
const CATALOGUED = {
  // Claude Code picks a model per TIER SLOT, not from a catalogue, and the
  // Anthropic client derives the window from the model itself — there is no
  // field to declare. What must hold is that all four slots are filled.
  claude: {
    windows: false,
    read(mod) {
      const cfg = readJSON(mod.configFile);
      const out = new Map();
      for (const [k, v] of Object.entries(cfg.env || {})) {
        if (/^ANTHROPIC_DEFAULT_[A-Z]+_MODEL$/.test(k)) out.set(v, null);
      }
      return out;
    },
  },

  cline: {
    read(mod) {
      const catalog = readJSON(mod.modelsFile).providers["openai-compatible"].models;
      return new Map(Object.entries(catalog).map(([sku, m]) => [sku, m.contextWindow]));
    },
  },

  // `max_tokens` IS the context window here. See the header.
  zed: {
    read(mod) {
      const list = readJSON(mod.configFile).language_models.openai.available_models || [];
      return new Map(list.map((m) => [m.name, m.max_tokens]));
    },
  },

  continue: {
    read(mod) {
      const parsed = require("yaml").parse(fs.readFileSync(mod.configFile, "utf8"));
      const out = new Map();
      for (const m of parsed.models || []) {
        if (!m || typeof m.model !== "string" || !m.model.startsWith("neosmith.")) continue;
        out.set(m.model, (m.defaultCompletionOptions || {}).contextLength);
      }
      return out;
    },
  },

  copilot: {
    read(mod) {
      const list = readJSON(mod.configFile).find((p) => p.name === "NeoSmith").models;
      return new Map(list.map((m) => [m.id, m.maxInputTokens]));
    },
  },

  opencode: {
    read(mod) {
      const models = readJSON(mod.configPath()).provider.neosmith.models;
      return new Map(Object.entries(models).map(([sku, m]) => [sku, m.limit.context]));
    },
  },

  openclaw: {
    read(mod) {
      const list = readJSON(mod.configFile).models.providers.neosmith.models;
      return new Map(list.map((m) => [m.id, m.contextWindow]));
    },
  },

  // One profile file per SKU — Junie has no catalogue field at all.
  junie: {
    read(mod) {
      const out = new Map();
      for (const t of mod.tierProfiles()) {
        const p = readJSON(t.file);
        out.set(p.id, p.maxContextLength);
      }
      return out;
    },
  },
};

// A harness is exempt only with a reason a reviewer can check.
const EXEMPT = {
  codex: "config.toml has no model catalogue — it carries one `model = \"…\"` plus a " +
    "generic provider block, and Codex accepts any model name typed at `/model`. " +
    "There is nothing to enumerate into.",
  cursor: "UI-driven: native BYOK lives in Cursor's encrypted, server-synced store. " +
    "`on` writes no file, so there is no catalogue to populate.",
  jetbrains: "UI-driven: models are chosen in the JetBrains Settings UI. `on` writes no file.",
};

// ── coverage gate ───────────────────────────────────────────────────────────

test("catalogue: every registered harness is either catalogued or exempt with a reason", () => withSandbox(() => {
  const { harness } = loadAll();
  for (const id of harness.idsSorted()) {
    const covered = Object.prototype.hasOwnProperty.call(CATALOGUED, id);
    const exempt = Object.prototype.hasOwnProperty.call(EXEMPT, id);
    assert.ok(covered || exempt,
      `harness '${id}' is not in this file — add it to CATALOGUED with a read() that returns ` +
      `sku → context window, or to EXEMPT with a reason its client has no catalogue.`);
    assert.ok(!(covered && exempt), `'${id}' cannot be both catalogued and exempt`);
    if (exempt) {
      assert.ok(EXEMPT[id] && EXEMPT[id].length > 40,
        `'${id}' is exempt with no real reason — the field is required, not decorative`);
    }
  }
}));

// ── per-harness ─────────────────────────────────────────────────────────────

for (const [id, spec] of Object.entries(CATALOGUED)) {
  test(`catalogue: ${id} registers every NeoSmith SKU`, () => withSandbox(() => {
    const { harness } = loadAll();
    const mod = harness.get(id);
    // Wire the DEFAULT tier. Registering only what `on` was handed is exactly
    // the bug — the other three have to be there anyway.
    mod.on({ key: KEY, model: harness.resolveModel("pro") });

    const got = spec.read(mod);
    for (const sku of Object.values(harness.manifest().models)) {
      assert.ok(got.has(sku),
        `${id}: ${sku} is not registered. Switching tiers inside ${mod.name} does not re-run ` +
        `\`on\`, so an unregistered SKU is not selectable at all.`);
    }
  }));

  if (spec.windows === false) continue;

  test(`catalogue: ${id} declares each SKU's real context window`, () => withSandbox(() => {
    const { harness } = loadAll();
    const mod = harness.get(id);
    mod.on({ key: KEY, model: harness.resolveModel("pro") });

    const got = spec.read(mod);
    const specs = harness.manifest().modelSpecs;
    for (const [sku, want] of Object.entries(specs)) {
      assert.equal(got.get(sku), want.contextWindow,
        `${id}: ${sku} must declare ${want.contextWindow}, got ${got.get(sku)}. ` +
        `GET /v1/models returns ids only, so a wrong or missing window is never corrected ` +
        `at runtime — the client just compacts at the number written here.`);
    }
  }));

  test(`catalogue: ${id} does not flatten neolite to the 1M default`, () => withSandbox(() => {
    const { harness } = loadAll();
    const mod = harness.get(id);
    mod.on({ key: KEY, model: harness.resolveModel("pro") });

    const lite = harness.MODELS.lite;
    assert.equal(spec.read(mod).get(lite), 512000,
      `${id}: neolite is the sealed 512K budget tier. Copying the 1M figure across every SKU ` +
      `is the shape of the copilot bug; a flat small constant is the shape of the zed one.`);
  }));
}

// ── the specific regressions ────────────────────────────────────────────────

test("catalogue: zed never writes the old flat 8192 window", () => withSandbox(() => {
  const { harness } = loadAll();
  const mod = harness.get("zed");
  mod.on({ key: KEY, model: harness.resolveModel("pro") });

  const list = readJSON(mod.configFile).language_models.openai.available_models;
  for (const m of list) {
    assert.notEqual(m.max_tokens, 8192,
      "8192 was the hardcoded value that made every 1M NeoSmith SKU behave as an 8K model in Zed");
    assert.ok(m.max_tokens >= 512000, `${m.name}: max_tokens is Zed's CONTEXT WINDOW, not an output cap`);
  }
}));

test("catalogue: a user's own model entries are not counted or clobbered", () => withSandbox(() => {
  const { harness } = loadAll();
  const mod = harness.get("zed");
  const cfg = mod.configFile;
  fs.mkdirSync(path.dirname(cfg), { recursive: true });
  fs.writeFileSync(cfg, JSON.stringify({
    language_models: { openai: { available_models: [{ name: "gpt-5-user", max_tokens: 4096 }] } },
  }, null, 2));

  mod.on({ key: KEY, model: harness.resolveModel("pro") });
  const list = readJSON(cfg).language_models.openai.available_models;
  const mine = list.find((m) => m.name === "gpt-5-user");
  assert.ok(mine, "the user's entry must survive");
  assert.equal(mine.max_tokens, 4096, "and keep its own window — 4096 is theirs to choose");
  assert.equal(list.filter((m) => m.name.startsWith("neosmith.")).length, 4);
}));

test("catalogue: continue registers the tiers in the yaml-less fallback too", () => withSandbox(() => {
  const { harness } = loadAll();
  // stringMerge() is what runs when the optional `yaml` dep is missing. It used
  // to emit one hardcoded block, so a machine without the dep silently got a
  // single model — and nothing tested that path's contents.
  const cont = require("../../lib/harnesses/continue");
  const text = cont.stringMerge("", harness.resolveModel("pro"), KEY, false);
  for (const sku of Object.values(harness.manifest().models)) {
    assert.ok(text.includes(`model: ${sku}`), `${sku} missing from the string-merge fallback`);
  }
  assert.match(text, /contextLength: 512000/, "neolite's real window must survive the fallback path");
}));

test("catalogue: cline's capability strings are members of the enum Cline validates against", () => withSandbox(() => {
  const { harness } = loadAll();
  const mod = harness.get("cline");
  mod.on({ key: KEY, model: harness.resolveModel("pro") });

  // Cline parses models.json with a zod schema and DISCARDS THE WHOLE REGISTRY
  // on a validation failure — its own message is "models.json content is not a
  // valid models file envelope; starting from an empty registry". So a
  // capability string that is not an enum member does not degrade one entry,
  // it silently unregisters all four and every SKU falls back to Cline's
  // conservative defaults. Nothing surfaces; the models just behave small.
  //
  // Read out of the installed bundle on 2026-08-23 (saoudrizwan.claude-dev
  // 4.1.13, next/dist/extension.js). Note the near-misses: "vision" and
  // "popular" belong to OTHER enums in the same bundle and would fail here.
  const VALID = new Set(["images", "video", "tools", "streaming", "prompt-cache",
    "reasoning", "reasoning-effort", "computer-use", "global-endpoint",
    "structured_output", "temperature", "files"]);

  const catalog = readJSON(mod.modelsFile).providers["openai-compatible"].models;
  for (const [sku, m] of Object.entries(catalog)) {
    for (const cap of m.capabilities || []) {
      assert.ok(VALID.has(cap),
        `${sku}: "${cap}" is not a member of Cline's capability enum — the whole registry ` +
        `would be rejected, not just this entry`);
    }
  }
  assert.ok(catalog["neosmith.intelligent-pro"].capabilities.includes("tools"),
    "Cline's agentic loop needs tool calling");
}));

test("catalogue: cline's models.json is the registry; providers.json holds the SELECTION", () => withSandbox(() => {
  const { harness } = loadAll();
  const mod = harness.get("cline");
  mod.on({ key: KEY, model: harness.resolveModel("basic") });

  // These two files answer different questions, and reading only providers.json
  // makes it look like one model is registered.
  const selected = readJSON(mod.configFile).providers["openai-compatible"].settings;
  assert.equal(selected.model, "neosmith.intelligent-basic",
    "providers.json carries ONE model — the one currently in use");

  const registry = readJSON(mod.modelsFile).providers["openai-compatible"];
  assert.equal(Object.keys(registry.models).length, 4,
    "models.json carries the whole catalogue, which is what makes the other tiers selectable");
  assert.equal(registry.provider.defaultModelId, "neosmith.intelligent-basic",
    "and its default agrees with the selection");
}));
