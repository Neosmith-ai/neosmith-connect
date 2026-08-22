// OpenCode — file-writable.
//
// Config target (per https://opencode.ai/docs/troubleshooting/ — the docs list
// the same `~/.config` layout on every platform, including Windows):
//   Linux/macOS:  ~/.config/opencode/opencode.json  (or .jsonc)
//   Windows:      %USERPROFILE%\.config\opencode\opencode.jsonc
//
// So unlike zed.js there is no per-OS branch — one path, three platforms. What
// there IS is a per-FILE branch: OpenCode reads `opencode.jsonc` if it exists
// and `opencode.json` otherwise, and .jsonc legitimately contains comments and
// trailing commas. io.readJSON returns {} on a parse failure, so writing
// through it would silently replace a commented config with our block alone.
// `configPath()` picks the file OpenCode would read, and `on` refuses to
// rewrite anything JSON.parse cannot handle — it snapshots, prints the block to
// paste, and stops. Same conservative stance copilot.js takes when it cannot
// prove ownership of what it found.
//
// Provider shape (https://opencode.ai/docs/providers/ — "custom provider"):
//   provider.<id>.npm                 "@ai-sdk/openai-compatible" for
//                                     /v1/chat/completions backends
//   provider.<id>.options.baseURL     the OpenAI-compatible base
//   provider.<id>.options.apiKey      literal, or "{env:VAR}"
//   provider.<id>.models.<sku>        { name, limit: { context, output } }
//   model / small_model               "<provider-id>/<sku>"
//
// EVERY SKU is registered, not just the wired one — same reasoning as
// cline.js's models.json catalog. GET /v1/models returns ids only, so OpenCode
// cannot discover a context window; switching tiers inside OpenCode rewrites
// nothing on our side, and an uncatalogued SKU falls back to a conservative
// default. neolite is the sealed 512K tier, not 1M.
//
// Issue #15 / #22 contract, identical to zed.js: `on` snapshots the pre-connect
// file, records the prior value of every pointer it touches, and stamps a
// post-write fingerprint. `off` restores byte-for-byte when nothing moved, and
// otherwise keeps the user's live file and replays the ledger over it.

"use strict";

const path = require("path");

const harness = require("../harness");
const io = require("../io");
const preserve = require("../preserve");
const ui = require("../ui");

// Our provider id inside OpenCode's config, and the left half of the
// "<provider>/<sku>" model references.
const PROVIDER_ID = "neosmith";
const NPM_PACKAGE = "@ai-sdk/openai-compatible";

function opencodeDir() {
  return path.join(io.HOME, ".config", "opencode");
}

const CONFIG_JSON = path.join(opencodeDir(), "opencode.json");
const CONFIG_JSONC = path.join(opencodeDir(), "opencode.jsonc");

// The file OpenCode would actually read. Resolved per call, not at module load:
// a .jsonc can appear between `on` and `off`, and the contract sandbox swaps
// HOME between cases.
function configPath() {
  if (io.fileExists(CONFIG_JSONC)) return CONFIG_JSONC;
  return CONFIG_JSON;
}

const POINTERS = [["provider", PROVIDER_ID], ["model"], ["small_model"]];

// Read the config as strict JSON. Returns { cfg, raw, parseFailed }. A file
// that exists but does not parse is the case that must never be rewritten.
function readConfig(file) {
  const raw = io.readText(file);
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
  if (!cfg || typeof cfg !== "object") return null;
  const p = cfg.provider;
  if (!p || typeof p !== "object") return null;
  const block = p[PROVIDER_ID];
  return block && typeof block === "object" ? block : null;
}

function providerUrl(cfg) {
  const block = providerBlock(cfg);
  return (block && block.options && block.options.baseURL) || "";
}

function hasNeoSmith(cfg) {
  // Ownership: matches ANY known environment so `off` finds staging wiring too.
  return harness.isNeosmithUrl(providerUrl(cfg));
}

// "NeoSmith Pro" / "NeoSmith Maestro" / … from the manifest's tier map, so the
// picker shows the same label the rest of the CLI uses. Falls back to the raw
// SKU for a --model the manifest does not know about.
function displayName(sku) {
  const tiers = harness.manifest().claudeTierMap || {};
  for (const t of Object.values(tiers)) {
    if (t && t.model === sku && t.name) return t.name;
  }
  return `NeoSmith ${sku}`;
}

function modelCatalog(wired) {
  const specs = harness.manifest().modelSpecs || {};
  const models = {};
  for (const [sku, spec] of Object.entries(specs)) {
    models[sku] = {
      name: displayName(sku),
      limit: { context: spec.contextWindow, output: spec.maxTokens },
    };
  }
  if (!models[wired]) {
    const fallback = specs[harness.MODELS.pro] || { contextWindow: 1000000, maxTokens: 128000 };
    models[wired] = {
      name: displayName(wired),
      limit: { context: fallback.contextWindow, output: fallback.maxTokens },
    };
  }
  return models;
}

// The block `on` writes, and the block the paste-in fallback prints. One
// function so the two can never drift.
function neosmithConfig(model, key) {
  const small = harness.MODELS.lite || model;
  return {
    provider: {
      [PROVIDER_ID]: {
        npm: NPM_PACKAGE,
        name: "NeoSmith",
        options: {
          baseURL: harness.OPENAI_BASE_URL,
          apiKey: key,
        },
        models: modelCatalog(model),
      },
    },
    model: `${PROVIDER_ID}/${model}`,
    small_model: `${PROVIDER_ID}/${small}`,
  };
}

function on(ctx) {
  const model = ctx.model;
  const key = ctx.key;
  const CONFIG = configPath();
  const { cfg: existing, raw, parseFailed } = readConfig(CONFIG);

  if (hasNeoSmith(existing)) {
    ui.warn(`${CONFIG} already points at NeoSmith.`);
    return { alreadyOn: true };
  }

  const block = neosmithConfig(model, key);

  // A config we cannot parse is a config we must not rewrite. .jsonc files are
  // allowed comments and trailing commas, and there is no JSON5 parser in this
  // package's dependency budget — clobbering the user's real config to add a
  // provider is a far worse outcome than asking them to paste a block.
  if (parseFailed) {
    io.snapshot("opencode", CONFIG);
    ui.warn(`${CONFIG} is not strict JSON (comments and trailing commas are legal in .jsonc).`);
    ui.log(ui.c("dim", `Leaving it exactly as it is — a copy is kept at ${io.snapshotPath("opencode")}.`));
    ui.log(ui.c("dim", `Merge this into it by hand (or delete the file and re-run \`neosmith opencode on\`):`));
    ui.box(JSON.stringify(block, null, 2).split("\n"));
    io.setHarnessFlag("opencode", true, {
      model, manual: true, file: CONFIG,
      env: (ctx && ctx.env && ctx.env.name) || harness.envName(),
    });
    return { wrote: false, manual: true, file: CONFIG };
  }

  if (raw !== null && raw.trim() && !Object.keys(existing).length) {
    ui.warn(`Existing ${CONFIG} was not a JSON object — backing it up as-is and starting clean.`);
  }

  io.ensureDir(path.dirname(CONFIG));
  // Snapshot + ledger before mutating `existing`. Both are write-once, so a
  // second `on` refreshes the wiring without losing the pre-connect baseline.
  io.snapshot("opencode", CONFIG);
  io.recordRestore("opencode", CONFIG, io.planRestore(existing, POINTERS));

  const next = { ...existing };
  next.provider = { ...(existing.provider || {}) };
  next.provider[PROVIDER_ID] = block.provider[PROVIDER_ID];
  next.model = block.model;
  next.small_model = block.small_model;

  io.writeJSON(CONFIG, next, 0o600);
  // Re-stamped on every `on`, not write-once like the snapshot: a second `on`
  // to switch tiers would otherwise read as user drift.
  io.recordFingerprint("opencode", CONFIG);
  io.setHarnessFlag("opencode", true, {
    model, env: (ctx && ctx.env && ctx.env.name) || harness.envName(),
  });
  ui.ok(`Wrote ${CONFIG}`);
  ui.log(ui.c("dim", `Registered ${Object.keys(block.provider[PROVIDER_ID].models).length} NeoSmith SKUs; default model=${block.model}.`));
  // The restart line is printed by lib/commands/on.js for every writable
  // harness — saying it again here just doubles it.
  return { wrote: true };
}

function off(ctx) {
  io.setHarnessFlag("opencode", false);
  const CONFIG = configPath();

  if (!io.fileExists(CONFIG)) {
    preserve.finish("opencode", CONFIG);
    ui.log(`${CONFIG} not present — nothing to disconnect.`);
    return { ok: true };
  }

  // Nobody touched the config since `on` wrote it, and we still hold the
  // pre-connect bytes — restore them verbatim.
  if (preserve.disposition("opencode", CONFIG) === "snapshot") {
    io.restoreSnapshot("opencode", CONFIG);
    preserve.finish("opencode", CONFIG);
    // A tombstone snapshot means the file did not exist pre-connect, so the
    // restore was a delete. Reporting that as "restored" is not what happened.
    ui.ok(io.fileExists(CONFIG)
      ? `Restored pre-NeoSmith ${CONFIG} from snapshot.`
      : `Removed ${CONFIG} — it did not exist before you connected.`);
    return { ok: true, mode: "snapshot" };
  }

  const { cfg, parseFailed } = readConfig(CONFIG);
  if (parseFailed) {
    // The manual path (or a file the user converted to .jsonc while connected).
    // We never wrote it, and without a JSON5 parser there is no way to take our
    // block back out without risking the rest of the file.
    ui.warn(`${CONFIG} is not strict JSON — leaving it alone.`);
    ui.log(ui.c("dim", `Remove the "${PROVIDER_ID}" provider block by hand to finish disconnecting.`));
    preserve.finish("opencode", CONFIG);
    return { ok: true, partial: true, manual: true };
  }

  const ledger = preserve.ledgerFor("opencode", CONFIG, POINTERS, (r) => JSON.parse(r || "{}"));
  if (ledger) {
    io.applyRestore(cfg, ledger);
  } else {
    // No ledger (state.json lost). Drop only the keys we know we write.
    if (cfg.provider && cfg.provider[PROVIDER_ID]) delete cfg.provider[PROVIDER_ID];
    if (cfg.provider && !Object.keys(cfg.provider).length) delete cfg.provider;
    if (typeof cfg.model === "string" && cfg.model.startsWith(`${PROVIDER_ID}/`)) delete cfg.model;
    if (typeof cfg.small_model === "string" && cfg.small_model.startsWith(`${PROVIDER_ID}/`)) delete cfg.small_model;
  }

  io.writeJSON(CONFIG, cfg, 0o600);
  preserve.finish("opencode", CONFIG);
  ui.ok(ledger
    ? `Removed the NeoSmith provider from ${CONFIG} — the settings you changed while connected are still there.`
    : `Removed NeoSmith keys from ${CONFIG} (no pre-connect snapshot or ledger was available).`);
  return { ok: true, mode: "merge", partial: !ledger };
}

function status(ctx) {
  const CONFIG = configPath();
  if (!io.fileExists(CONFIG)) return { on: false, detail: `${CONFIG} does not exist` };

  const { cfg, parseFailed } = readConfig(CONFIG);
  if (parseFailed) {
    const flagged = io.getHarnessFlag("opencode");
    return {
      on: flagged ? "manual" : false,
      detail: flagged
        ? `${CONFIG} is not strict JSON — the provider block was printed for you to paste in by hand`
        : `${CONFIG} is not strict JSON and could not be inspected`,
    };
  }

  const url = providerUrl(cfg);
  const wiredEnv = harness.envForUrl(url);
  if (!wiredEnv) return { on: false, detail: `no NeoSmith provider in ${CONFIG}` };

  const block = providerBlock(cfg) || {};
  const skus = Object.keys(block.models || {});
  return {
    on: true,
    env: wiredEnv,
    detail: `model=${cfg.model || "(unset)"} small_model=${cfg.small_model || "(unset)"} · ${skus.length} SKU(s) · base=${url}`,
  };
}

// Which key OpenCode is holding, for `neosmith keys`. A literal, unless the
// user swapped it for an "{env:VAR}" reference by hand — which OpenCode also
// accepts, and which is not a key we can print.
function keyRef() {
  const CONFIG = configPath();
  if (!io.fileExists(CONFIG)) return null;
  const { cfg, parseFailed } = readConfig(CONFIG);
  if (parseFailed) return null;
  const block = providerBlock(cfg);
  const value = block && block.options && block.options.apiKey;
  if (typeof value !== "string" || !value) return null;
  const envRef = /^\{env:([^}]+)\}$/.exec(value);
  if (envRef) return { kind: "env-ref", name: envRef[1], file: CONFIG };
  return { kind: "literal", value, file: CONFIG };
}

function help() {
  return [
    `OpenCode — OpenAI-compatible custom provider.`,
    `Wires: ~/.config/opencode/opencode.json (or .jsonc if that is what you have)`,
    `       — provider.${PROVIDER_ID} via ${NPM_PACKAGE}, plus model/small_model.`,
    `Key storage: apiKey literal in the config (mode 0600).`,
    `Every NeoSmith SKU is registered with its real context window, so switching`,
    `tiers inside OpenCode does not silently fall back to a small context.`,
    ``,
    `A .jsonc with comments or trailing commas is never rewritten — \`on\` prints`,
    `the block for you to merge by hand instead of clobbering it.`,
    ``,
    `Examples:`,
    `  neosmith opencode on`,
    `  neosmith opencode on --model neosmith.intelligent-basic`,
    `  neosmith opencode off           # restores the pre-connect config`,
    `  neosmith opencode status`,
  ].join("\n");
}

module.exports = {
  id: "opencode",
  name: "OpenCode",
  writable: true,
  configFile: CONFIG_JSON,
  jsoncConfigFile: CONFIG_JSONC,
  configPath,
  on, off, status, help, keyRef,
};
