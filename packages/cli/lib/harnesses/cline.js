// Cline — file-writable.
//
// This harness used to be paste-only. That was correct for Cline 3.x, which
// kept provider config in the VS Code extension's globalState (state.vscdb) —
// nothing a CLI could safely write. It is no longer correct.
//
// Cline 4.x (VS Code / JetBrains) and the standalone Cline CLI both read ONE
// global config, shared across IDE, CLI and SDK:
//
//   <dataDir>/settings/providers.json   — provider + key + model + baseUrl
//   <dataDir>/settings/models.json      — model metadata for custom providers
//
//   dataDir = ($CLINE_DIR || ~/.cline) + "/data"
//
// Verified 2026-08-10 against saoudrizwan.claude-dev 4.1.7 (both the `next/`
// and `legacy/` bundles resolve exactly these paths) and against Cline CLI
// 3.0.52, whose `cline auth -p openai-compatible -k … -b …` writes the same
// providers.json shape this module writes.
//
// CLINE_PROVIDER_SETTINGS_PATH relocates providers.json outright; Cline honors
// it, so we do too, and models.json is taken as its sibling.
//
// `on` still prints the paste-in values, because a user on Cline 3.x has a
// config file we cannot reach. For them the box is the instruction; for
// everyone else it is a no-op they can ignore.

"use strict";

const path = require("path");

const harness = require("../harness");
const io = require("../io");
const ui = require("../ui");

// Cline's own provider id for "OpenAI Compatible". Not "openai" — that is the
// first-party OpenAI provider, and pointing it at a third-party base URL is the
// legacy 3.x wiring, not what 4.x reads.
const PROVIDER_ID = "openai-compatible";

// Snapshot id for the second file this harness owns. `-file-` is the same
// compound-id convention as claude's `-ext-` (see lib/originals.js).
const MODELS_SNAPSHOT_ID = "cline-file-models";

function clineDataDir() {
  const root = (process.env.CLINE_DIR || "").trim() || path.join(io.HOME, ".cline");
  return path.join(root, "data");
}

function providersPath() {
  const override = (process.env.CLINE_PROVIDER_SETTINGS_PATH || "").trim();
  return override || path.join(clineDataDir(), "settings", "providers.json");
}

const CONFIG = providersPath();
const MODELS_CONFIG = path.join(path.dirname(CONFIG), "models.json");

function providerBlock(cfg) {
  if (!cfg || typeof cfg !== "object") return null;
  const providers = cfg.providers;
  if (!providers || typeof providers !== "object") return null;
  return providers[PROVIDER_ID] || null;
}

function hasNeoSmith(cfg) {
  const block = providerBlock(cfg);
  if (!block || !block.settings) return false;
  // Ownership: matches ANY known environment so `off` finds staging wiring too.
  return harness.isNeosmithUrl(block.settings.baseUrl);
}

function on(ctx) {
  const model = ctx.model;
  const key = ctx.key;

  const existing = io.readJSON(CONFIG) || {};
  if (hasNeoSmith(existing)) {
    ui.warn(`${CONFIG} already points at NeoSmith.`);
    return { alreadyOn: true };
  }

  io.ensureDir(path.dirname(CONFIG));
  io.snapshot("cline", CONFIG);
  // Ledger the whole provider block plus lastUsedProvider: `on` overwrites the
  // user's own openai-compatible settings and switches the active provider, so
  // both can only be put back wholesale (issue #15).
  io.recordRestore("cline", CONFIG, io.planRestore(existing, [
    ["providers", PROVIDER_ID],
    ["lastUsedProvider"],
  ]));

  const prevBlock = providerBlock(existing) || {};
  const next = { ...existing };
  next.version = existing.version || 1;
  next.providers = { ...(existing.providers || {}) };
  next.providers[PROVIDER_ID] = {
    ...prevBlock,
    settings: {
      ...(prevBlock.settings || {}),
      provider: PROVIDER_ID,
      apiKey: key,
      model,
      baseUrl: harness.OPENAI_BASE_URL,
    },
    updatedAt: new Date().toISOString(),
    tokenSource: "manual",
  };
  // Cline reads lastUsedProvider to decide which provider is live. Writing the
  // block without this leaves the user configured but still on their old
  // provider — connected on disk, unchanged in practice.
  next.lastUsedProvider = PROVIDER_ID;
  io.writeJSON(CONFIG, next, 0o600);

  writeModelCatalog(model);

  ui.ok(`Wrote ${CONFIG}`);
  ui.log(ui.c("dim", `Also registered ${model} in ${MODELS_CONFIG}`));
  ui.log(ui.c("dim", `Reload the Cline panel (or restart the IDE) if it was open.`));
  ui.log("");
  ui.log(ui.c("dim", `On Cline 3.x? Provider config lived in VS Code's extension state back then,`));
  ui.log(ui.c("dim", `so the file above is not read. Paste these into Cline's settings instead:`));
  ui.box([
    `  API Provider:  OpenAI Compatible`,
    `  Base URL:      ${harness.OPENAI_BASE_URL}`,
    `  API Key:       ${key}`,
    `  Model ID:      ${model}`,
    ``,
    `Enable streaming + tool/function calling (required for Cline's agentic actions).`,
  ]);

  io.setHarnessFlag("cline", true, { model, env: (ctx && ctx.env && ctx.env.name) || harness.envName() });
  return { wrote: true };
}

// models.json carries the context window and capabilities for a custom
// provider's models. Cline never discovers these — GET /v1/models returns ids
// only — so without this file it falls back to conservative defaults and a
// 1M-context SKU silently behaves like a small one.
//
// EVERY SKU gets an entry, not just the one being wired. Nothing else will
// ever fill them in: Cline's VS Code migration is one-shot, its auto-seed
// refuses to touch a provider whose catalog already exists, and switching
// model (in the panel or the CLI) writes providers.json alone. Registering
// only the wired SKU is what leaves the catalog stale the moment a user
// switches tiers.
function catalogEntry(id, spec) {
  return {
    id,
    name: id,
    maxTokens: spec.maxTokens,
    contextWindow: spec.contextWindow,
    maxInputTokens: spec.contextWindow,
    capabilities: ["streaming", "tools", "images"],
  };
}

function writeModelCatalog(model) {
  const existing = io.readJSON(MODELS_CONFIG) || {};
  io.snapshot(MODELS_SNAPSHOT_ID, MODELS_CONFIG);
  io.recordRestore(MODELS_SNAPSHOT_ID, MODELS_CONFIG, io.planRestore(existing, [
    ["providers", PROVIDER_ID],
  ]));

  const specs = harness.manifest().modelSpecs || {};
  const models = {};
  for (const [id, spec] of Object.entries(specs)) models[id] = catalogEntry(id, spec);
  // A --model the manifest doesn't know about still has to be usable, so it
  // inherits the default tier's shape rather than being left uncatalogued.
  if (!models[model]) {
    models[model] = catalogEntry(model, specs[harness.MODELS.pro] || { maxTokens: 128000, contextWindow: 1000000 });
  }

  const prev = (existing.providers && existing.providers[PROVIDER_ID]) || {};
  const next = { ...existing };
  next.version = existing.version || 1;
  next.providers = { ...(existing.providers || {}) };
  next.providers[PROVIDER_ID] = {
    ...prev,
    provider: {
      ...(prev.provider || {}),
      name: "OpenAI Compatible",
      baseUrl: harness.OPENAI_BASE_URL,
      defaultModelId: model,
    },
    // User-defined entries win: someone who hand-tuned a context window in
    // Cline's UI meant it, and `off` restores the block wholesale anyway.
    models: { ...models, ...(prev.models || {}) },
  };
  io.writeJSON(MODELS_CONFIG, next, 0o600);
}

// Restore one of this harness's files: snapshot first (byte-for-byte), ledger
// as the fallback, and a targeted strip if neither is available.
function restoreFile(snapshotId, file) {
  if (!io.fileExists(file)) {
    io.clearSnapshot(snapshotId);
    io.clearRestore(snapshotId);
    return false;
  }
  if (io.restoreSnapshot(snapshotId, file)) {
    io.clearRestore(snapshotId);
    return true;
  }
  const cfg = io.readJSON(file) || {};
  const ledger = io.readRestore(snapshotId, file);
  if (ledger) {
    io.applyRestore(cfg, ledger);
  } else if (cfg.providers && cfg.providers[PROVIDER_ID]) {
    // No ledger (pre-0.9 connect) — drop only the block we would have written.
    delete cfg.providers[PROVIDER_ID];
    if (cfg.lastUsedProvider === PROVIDER_ID) delete cfg.lastUsedProvider;
  }
  if (cfg.providers && !Object.keys(cfg.providers).length) delete cfg.providers;
  io.writeJSON(file, cfg, 0o600);
  io.clearRestore(snapshotId);
  return false;
}

function off(ctx) {
  io.setHarnessFlag("cline", false);

  if (!io.fileExists(CONFIG) && !io.fileExists(MODELS_CONFIG)) {
    io.clearSnapshot("cline");
    io.clearRestore("cline");
    io.clearSnapshot(MODELS_SNAPSHOT_ID);
    io.clearRestore(MODELS_SNAPSHOT_ID);
    ui.log(`${CONFIG} not present — nothing to disconnect.`);
    return { ok: true };
  }

  const restored = restoreFile("cline", CONFIG);
  restoreFile(MODELS_SNAPSHOT_ID, MODELS_CONFIG);

  if (restored) ui.ok(`Restored pre-NeoSmith ${CONFIG} from snapshot.`);
  else ui.ok(`Removed the NeoSmith provider from ${CONFIG} (no pre-connect snapshot was available).`);

  ui.log(ui.c("dim", `If you configured Cline 3.x by hand, switch the API Provider back in its settings UI.`));
  return { ok: true, partial: !restored };
}

function status(ctx) {
  if (!io.fileExists(CONFIG)) return { on: false, detail: `${CONFIG} does not exist` };
  const cfg = io.readJSON(CONFIG) || {};
  const block = providerBlock(cfg);
  const settings = (block && block.settings) || {};
  const wiredEnv = harness.envForUrl(settings.baseUrl || "");
  if (!wiredEnv) return { on: false, detail: `no NeoSmith provider in providers.${PROVIDER_ID}` };
  // Configured but not selected is the one failure mode a "connected" line
  // would otherwise hide, so it gets said out loud.
  const active = cfg.lastUsedProvider === PROVIDER_ID;
  return {
    on: true,
    env: wiredEnv,
    detail: `model=${settings.model || "(unset)"} base=${settings.baseUrl}` +
      (active ? "" : ` · NOT the active provider (lastUsedProvider=${cfg.lastUsedProvider || "unset"})`),
  };
}

function help() {
  return [
    `Cline — OpenAI-compatible provider, written to Cline's shared global config.`,
    `Wires: ${CONFIG} (+ models.json alongside it).`,
    `Read by Cline 4.x in VS Code / JetBrains AND by the standalone Cline CLI.`,
    `Key storage: apiKey literal in providers.json (mode 0600).`,
    `Honors CLINE_DIR and CLINE_PROVIDER_SETTINGS_PATH.`,
    ``,
    `On Cline 3.x the provider lived in VS Code's extension state — "on" also`,
    `prints the paste-in values for that case.`,
    ``,
    `Examples:`,
    `  neosmith cline on`,
    `  neosmith cline on --model neosmith.intelligent-basic`,
    `  neosmith cline off           # restores the pre-connect providers.json`,
    `  neosmith cline status`,
  ].join("\n");
}

module.exports = {
  id: "cline",
  name: "Cline",
  writable: true,
  configFile: CONFIG,
  modelsFile: MODELS_CONFIG,
  on, off, status, help,
};
