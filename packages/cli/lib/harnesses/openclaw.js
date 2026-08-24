// OpenClaw — file-writable, with a hard guard.
//
// OpenClaw is a self-hosted gateway that fronts AI coding agents. Its own model
// providers are configured in ONE file, on every platform:
//
//   ~/.openclaw/openclaw.json
//
// Two properties of that file drive every decision in this module, both taken
// from https://docs.openclaw.ai/gateway/configuration:
//
//   1. It is JSON5, not JSON. Comments, trailing commas and unquoted keys are
//      all legal, and io.readJSON returns {} on a parse failure — so writing
//      through it would silently replace a commented config with our block
//      alone. There is no JSON5 parser in this package's dependency budget
//      (the core is deliberately zero-dep; smol-toml and yaml are lazy-loaded
//      by codex/continue only). So: if JSON.parse cannot read it, we do not
//      write it. `on` snapshots, prints the block, and points at OpenClaw's own
//      `openclaw config set` — the tool that already speaks JSON5.
//
//   2. "OpenClaw only accepts configurations that fully match the schema.
//      Unknown keys, malformed types, or invalid values cause the Gateway to
//      refuse to start." A stray field here does not degrade the config, it
//      bricks the user's gateway. So the written block carries EXACTLY the
//      documented keys and nothing else — no version stamp, no updatedAt, no
//      NeoSmith bookkeeping. Ownership is established by the baseUrl host
//      alone, the same test every other harness uses.
//
// Provider shape (https://docs.openclaw.ai/concepts/model-providers):
//   models.providers.<id>.baseUrl     OpenAI-compatible base
//   models.providers.<id>.apiKey      literal, or "${VAR}"
//   models.providers.<id>.api         "openai-completions"
//   models.providers.<id>.models[]    { id, name, contextWindow, maxTokens, cost }
//   agents.defaults.model.primary     "<provider-id>/<model-id>"
//
// Issue #15 / #22 contract is the shared one: snapshot + restore ledger +
// post-write fingerprint on `on`; byte-for-byte restore when nothing moved,
// ledger replay over the user's live file when it did.

"use strict";

const path = require("path");

const harness = require("../harness");
const io = require("../io");
const preserve = require("../preserve");
const ui = require("../ui");

const PROVIDER_ID = "neosmith";

function openclawDir() {
  return path.join(io.HOME, ".openclaw");
}

const CONFIG = path.join(openclawDir(), "openclaw.json");

// The two blocks `on` owns. `agents.defaults.model.primary` is addressed at the
// leaf, not at `agents`, so a user's other agent defaults are never in scope.
const POINTERS = [
  ["models", "providers", PROVIDER_ID],
  ["agents", "defaults", "model", "primary"],
];

// Read as strict JSON. A file that exists and does not parse is JSON5 we must
// not touch — see the header.
function readConfig() {
  const raw = io.readText(CONFIG);
  if (raw === null) return { cfg: {}, raw: null, parseFailed: false };
  if (!raw.trim()) return { cfg: {}, raw, parseFailed: false };
  try {
    const cfg = JSON.parse(raw);
    if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) {
      return { cfg: {}, raw, parseFailed: true };
    }
    return { cfg, raw, parseFailed: false };
  } catch {
    return { cfg: {}, raw, parseFailed: true };
  }
}

function providerBlock(cfg) {
  const providers = cfg && cfg.models && cfg.models.providers;
  if (!providers || typeof providers !== "object") return null;
  const block = providers[PROVIDER_ID];
  return block && typeof block === "object" ? block : null;
}

function providerUrl(cfg) {
  const block = providerBlock(cfg);
  return (block && block.baseUrl) || "";
}

function hasNeoSmith(cfg) {
  // Ownership: matches ANY known environment so `off` finds staging wiring too.
  return harness.isNeosmithUrl(providerUrl(cfg));
}

function displayName(sku) {
  const tiers = harness.manifest().claudeTierMap || {};
  for (const t of Object.values(tiers)) {
    if (t && t.model === sku && t.name) return t.name;
  }
  return `NeoSmith ${sku}`;
}

// Every SKU, with its real context window — OpenClaw cannot discover these
// (GET /v1/models returns ids only), and switching model inside OpenClaw does
// not re-run `on`. Cost is declared zero: NeoSmith bills per its own contract,
// and a made-up per-token price would show the user fictional numbers.
function modelEntries(wired) {
  const specs = harness.manifest().modelSpecs || {};
  const entries = [];
  const seen = new Set();
  for (const [sku, spec] of Object.entries(specs)) {
    entries.push(modelEntry(sku, spec));
    seen.add(sku);
  }
  if (!seen.has(wired)) {
    entries.push(modelEntry(wired, specs[harness.MODELS.pro] || { contextWindow: 1000000, maxTokens: 128000 }));
  }
  return entries;
}

function modelEntry(sku, spec) {
  return {
    id: sku,
    name: displayName(sku),
    contextWindow: spec.contextWindow,
    maxTokens: spec.maxTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}

// Exactly the documented keys — see hazard 2 in the header. One function so the
// written block and the printed paste-in block can never drift.
function neosmithConfig(model, key) {
  return {
    models: {
      providers: {
        [PROVIDER_ID]: {
          baseUrl: harness.OPENAI_BASE_URL,
          apiKey: key,
          api: "openai-completions",
          models: modelEntries(model),
        },
      },
    },
    agents: { defaults: { model: { primary: `${PROVIDER_ID}/${model}` } } },
  };
}

function on(ctx) {
  const model = ctx.model;
  const key = ctx.key;
  const { cfg: existing, raw, parseFailed } = readConfig();

  if (hasNeoSmith(existing)) {
    ui.warn(`${CONFIG} already points at NeoSmith.`);
    return { alreadyOn: true };
  }

  const block = neosmithConfig(model, key);

  if (parseFailed) {
    io.snapshot("openclaw", CONFIG);
    ui.warn(`${CONFIG} is JSON5 that this CLI cannot parse (comments, trailing commas or unquoted keys).`);
    ui.log(ui.c("dim", `Leaving it exactly as it is — a copy is kept at ${io.snapshotPath("openclaw")}.`));
    ui.log(ui.c("dim", `Apply it with OpenClaw's own tooling, which does speak JSON5:`));
    ui.box([
      `openclaw config set models.providers.${PROVIDER_ID}.baseUrl ${harness.OPENAI_BASE_URL}`,
      `openclaw config set models.providers.${PROVIDER_ID}.apiKey ${key}`,
      `openclaw config set models.providers.${PROVIDER_ID}.api openai-completions`,
      `openclaw models set ${PROVIDER_ID}/${model}`,
      ``,
      `…or merge this into ${CONFIG} by hand:`,
      ``,
      ...JSON.stringify(block, null, 2).split("\n"),
    ]);
    io.setHarnessFlag("openclaw", true, {
      model, manual: true,
      env: (ctx && ctx.env && ctx.env.name) || harness.envName(),
    });
    return { wrote: false, manual: true, file: CONFIG };
  }

  if (raw !== null && raw.trim() && !Object.keys(existing).length) {
    ui.warn(`Existing ${CONFIG} was not a JSON object — backing it up as-is and starting clean.`);
  }

  io.ensureDir(path.dirname(CONFIG));
  io.snapshot("openclaw", CONFIG);
  io.recordRestore("openclaw", CONFIG, io.planRestore(existing, POINTERS));

  const next = { ...existing };
  next.models = { ...(existing.models || {}) };
  next.models.providers = { ...(next.models.providers || {}) };
  next.models.providers[PROVIDER_ID] = block.models.providers[PROVIDER_ID];
  next.agents = { ...(existing.agents || {}) };
  next.agents.defaults = { ...(next.agents.defaults || {}) };
  next.agents.defaults.model = { ...(next.agents.defaults.model || {}) };
  next.agents.defaults.model.primary = block.agents.defaults.model.primary;

  io.writeJSON(CONFIG, next, 0o600);
  io.recordFingerprint("openclaw", CONFIG);
  io.setHarnessFlag("openclaw", true, {
    model, env: (ctx && ctx.env && ctx.env.name) || harness.envName(),
  });
  ui.ok(`Wrote ${CONFIG}`);
  ui.log(ui.c("dim", `Default agent model set to ${PROVIDER_ID}/${model}; ${block.models.providers[PROVIDER_ID].models.length} SKUs registered.`));
  // The restart line is printed by lib/commands/on.js for every writable
  // harness — saying it again here just doubles it.
  return { wrote: true };
}

function off(ctx) {
  io.setHarnessFlag("openclaw", false);

  if (!io.fileExists(CONFIG)) {
    preserve.finish("openclaw", CONFIG);
    ui.log(`${CONFIG} not present — nothing to disconnect.`);
    return { ok: true };
  }

  if (preserve.disposition("openclaw", CONFIG) === "snapshot") {
    io.restoreSnapshot("openclaw", CONFIG);
    preserve.finish("openclaw", CONFIG);
    // A tombstone snapshot means the file did not exist pre-connect, so the
    // restore was a delete. Reporting that as "restored" is not what happened.
    ui.ok(io.fileExists(CONFIG)
      ? `Restored pre-NeoSmith ${CONFIG} from snapshot.`
      : `Removed ${CONFIG} — it did not exist before you connected.`);
    return { ok: true, mode: "snapshot" };
  }

  const { cfg, parseFailed } = readConfig();
  if (parseFailed) {
    // The manual path. We never wrote it, and a blind rewrite here is exactly
    // the "gateway refuses to start" failure this module exists to avoid.
    ui.warn(`${CONFIG} is JSON5 this CLI cannot parse — leaving it alone.`);
    ui.log(ui.c("dim", `Finish disconnecting with OpenClaw's own tooling:`));
    ui.box([
      `openclaw config unset models.providers.${PROVIDER_ID}`,
      `openclaw config unset agents.defaults.model.primary`,
    ]);
    preserve.finish("openclaw", CONFIG);
    return { ok: true, partial: true, manual: true };
  }

  const ledger = preserve.ledgerFor("openclaw", CONFIG, POINTERS, (r) => JSON.parse(r || "{}"));
  if (ledger) {
    io.applyRestore(cfg, ledger);
  } else {
    // No ledger (state.json lost). Drop only what we know we write, and prune
    // the containers we would have created — but only if they end up empty.
    if (cfg.models && cfg.models.providers) {
      delete cfg.models.providers[PROVIDER_ID];
      if (!Object.keys(cfg.models.providers).length) delete cfg.models.providers;
    }
    if (cfg.models && !Object.keys(cfg.models).length) delete cfg.models;
    const primary = cfg.agents && cfg.agents.defaults && cfg.agents.defaults.model;
    if (primary && typeof primary.primary === "string" && primary.primary.startsWith(`${PROVIDER_ID}/`)) {
      delete primary.primary;
    }
    if (primary && !Object.keys(primary).length) delete cfg.agents.defaults.model;
    if (cfg.agents && cfg.agents.defaults && !Object.keys(cfg.agents.defaults).length) delete cfg.agents.defaults;
    if (cfg.agents && !Object.keys(cfg.agents).length) delete cfg.agents;
  }

  io.writeJSON(CONFIG, cfg, 0o600);
  preserve.finish("openclaw", CONFIG);
  ui.ok(ledger
    ? `Removed the NeoSmith provider from ${CONFIG} — the settings you changed while connected are still there.`
    : `Removed NeoSmith keys from ${CONFIG} (no pre-connect snapshot or ledger was available).`);
  return { ok: true, mode: "merge", partial: !ledger };
}

function status(ctx) {
  if (!io.fileExists(CONFIG)) return { on: false, detail: `${CONFIG} does not exist` };

  const { cfg, parseFailed } = readConfig();
  if (parseFailed) {
    const flagged = io.getHarnessFlag("openclaw");
    return {
      on: flagged ? "manual" : false,
      detail: flagged
        ? `${CONFIG} is JSON5 this CLI cannot parse — the provider block was printed for you to apply with \`openclaw config set\``
        : `${CONFIG} is JSON5 this CLI cannot parse and could not be inspected`,
    };
  }

  const url = providerUrl(cfg);
  const wiredEnv = harness.envForUrl(url);
  if (!wiredEnv) return { on: false, detail: `no NeoSmith provider in models.providers` };

  const block = providerBlock(cfg) || {};
  const primary = (cfg.agents && cfg.agents.defaults && cfg.agents.defaults.model && cfg.agents.defaults.model.primary) || "(unset)";
  const count = Array.isArray(block.models) ? block.models.length : 0;
  const selected = typeof primary === "string" && primary.startsWith(`${PROVIDER_ID}/`);
  return {
    on: true,
    env: wiredEnv,
    detail: `primary=${primary}${selected ? "" : " — configured but NOT the default agent model"} · ${count} SKU(s) · base=${url}`,
  };
}

function keyRef() {
  if (!io.fileExists(CONFIG)) return null;
  const { cfg, parseFailed } = readConfig();
  if (parseFailed) return null;
  const block = providerBlock(cfg);
  const value = block && block.apiKey;
  if (typeof value !== "string" || !value) return null;
  const envRef = /^\$\{([^}]+)\}$/.exec(value);
  if (envRef) return { kind: "env-ref", name: envRef[1], file: CONFIG };
  return { kind: "literal", value, file: CONFIG };
}

function help() {
  return [
    `OpenClaw — OpenAI-compatible model provider for the self-hosted gateway.`,
    `Wires: ~/.openclaw/openclaw.json — models.providers.${PROVIDER_ID} plus`,
    `       agents.defaults.model.primary.`,
    `Key storage: apiKey literal in the config (mode 0600).`,
    ``,
    `OpenClaw refuses to start on a config that does not match its schema, so`,
    `\`on\` writes exactly the documented keys and nothing else. The file is JSON5:`,
    `if yours has comments or trailing commas it is never rewritten — \`on\` prints`,
    `the equivalent \`openclaw config set\` commands instead.`,
    ``,
    `Examples:`,
    `  neosmith openclaw on`,
    `  neosmith openclaw on --model neosmith.intelligent-maestro`,
    `  neosmith openclaw off           # restores the pre-connect config`,
    `  neosmith openclaw status`,
  ].join("\n");
}

module.exports = {
  id: "openclaw",
  name: "OpenClaw",
  writable: true,
  configFile: CONFIG,
  on, off, status, help, keyRef,
};
