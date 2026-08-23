// Zed — file-writable.
//
// Writes Zed's settings.json (per-OS path) with an OpenAI-compatible
// language_models entry pointing at https://router.neosmith.ai/v1.
//
// Config target (per the build brief T10):
//   Linux:   ~/.config/zed/settings.json
//   macOS:   ~/Library/Application Support/Zed/settings.json
//   Windows: %APPDATA%\Zed\settings.json
//
// Zed's settings schema places OpenAI-compatible providers under
// `language_models.openai`. We set base_url + api_key + default_model.
//
// Issue #22 contract: `on` snapshots the pre-connect file, stamps a
// post-write fingerprint, and records the prior values of every pointer it
// touches (issue #15 — `off` used to delete everything NeoSmith wrote, even
// settings the user had). `off` branches on whether the file drifted:
//
//   • unchanged → byte-for-byte snapshot restore (formatting, comments,
//     key order all come back).
//   • changed → keep the user's live file and replay the restore ledger
//     onto it, taking back only our own keys.
//   • no ledger at all (a connect made by a CLI older than the ledger or
//     state.json lost) → fall back to stripping NeoSmith's openai block.
//
// `available_models` is an array of named entries (mirrors Continue's
// `models`), not an opaque value the shared ledger replays. The merge
// path has to handle it element-wise: a user-added model is preserved, a
// model NeoSmith overwrote gets the user's own value back, an entry
// NeoSmith introduced drops out.
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const harness = require("../harness");
const io = require("../io");
const preserve = require("../preserve");
const ui = require("../ui");

function zedSettingsPath() {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Zed", "settings.json");
  }
  if (process.platform === "darwin") {
    return path.join(io.HOME, "Library", "Application Support", "Zed", "settings.json");
  }
  return path.join(io.HOME, ".config", "zed", "settings.json");
}

const CONFIG = zedSettingsPath();

function hasNeoSmith(s) {
  if (!s || typeof s !== "object") return false;
  const lm = s.language_models;
  if (!lm || typeof lm !== "object") return false;
  const openai = lm.openai;
  if (!openai || typeof openai !== "object") return false;
  // Ownership: matches ANY known environment so `off` finds staging wiring too.
  return harness.isNeosmithUrl(openai.api_url) || harness.isNeosmithUrl(openai.base_url);
}

function displayNameFor(sku) {
  const tiers = harness.manifest().claudeTierMap || {};
  for (const t of Object.values(tiers)) {
    if (t && t.model === sku && t.name) return t.name;
  }
  return `NeoSmith ${sku}`;
}

// One available_models entry per SKU.
//
// `max_tokens` is Zed's name for the model's CONTEXT WINDOW, not its output
// cap — the docs are explicit: "you must provide the model's context window in
// max_tokens". Before 0.10.0 this module wrote a flat `max_tokens: 8192` for
// the single SKU it registered, so a 1M-context NeoSmith model behaved in Zed
// like an 8K one and compacted almost immediately. The real windows come from
// the manifest's modelSpecs, the same source cline.js's catalog uses.
//
// And every SKU is registered, not just the wired one: switching model in Zed's
// picker does not re-run `on`, so an unregistered SKU is simply not selectable.
function availableModels(wired) {
  const specs = harness.manifest().modelSpecs || {};
  const entries = Object.entries(specs).map(([sku, spec]) => ({
    name: sku,
    display_name: displayNameFor(sku),
    max_tokens: spec.contextWindow,
    tool_calling: true,
  }));
  if (!entries.some((e) => e.name === wired)) {
    const fallback = specs[harness.MODELS.pro] || { contextWindow: 1000000 };
    entries.push({
      name: wired,
      display_name: displayNameFor(wired),
      max_tokens: fallback.contextWindow,
      tool_calling: true,
    });
  }
  return entries;
}

function on(ctx) {
  const model = ctx.model;
  const key = ctx.key;
  io.ensureDir(path.dirname(CONFIG));
  const existing = io.readJSON(CONFIG) || {};
  if (!existing || typeof existing !== "object") {
    ui.warn(`Existing ${CONFIG} was not valid JSON — backing up as-is and starting clean.`);
  }

  if (hasNeoSmith(existing)) {
    ui.warn(`${CONFIG} already points at NeoSmith.`);
    return { alreadyOn: true };
  }

  // Snapshot + ledger before mutating `existing`. Both are write-once, so a
  // second `on` refreshes without losing the pre-connect baseline (issue #15:
  // this used to re-snapshot the already-NeoSmith config and `off` then
  // "restored" that).
  io.snapshot("zed", CONFIG);
  io.recordRestore("zed", CONFIG, io.planRestore(existing, [["language_models", "openai"]]));

  const next = { ...existing };
  next.language_models = { ...(existing.language_models || {}) };
  next.language_models.openai = {
    ...(next.language_models.openai || {}),
    api_url: harness.OPENAI_BASE_URL,
    api_key: key,
    available_models: [
      ...(next.language_models.openai && Array.isArray(next.language_models.openai.available_models)
        ? next.language_models.openai.available_models
        : []),
      ...availableModels(model),
    ],
  };

  io.writeJSON(CONFIG, next, 0o600);
  // Post-write fingerprint (issue #22): stamp the file as we left it so `off`
  // can tell a settings.json the user edited from one nobody touched.
  // Re-stamped on every `on`, not write-once like the snapshot (otherwise a
  // second `on` to switch tiers would read as drift).
  io.recordFingerprint("zed", CONFIG);
  ui.ok(`Wrote ${CONFIG}`);
  ui.log(ui.c("dim", `Restart Zed for the change to take effect.`));
  return { wrote: true };
}

function off(ctx) {
  if (!io.fileExists(CONFIG)) {
    preserve.finish("zed", CONFIG);
    ui.log(`${CONFIG} not present — nothing to disconnect.`);
    return { ok: true };
  }

  // Nobody touched settings.json since `on` wrote it, and we still hold the
  // pre-connect bytes — restore them verbatim.
  if (preserve.disposition("zed", CONFIG) === "snapshot") {
    io.restoreSnapshot("zed", CONFIG);
    preserve.finish("zed", CONFIG);
    ui.ok(`Restored pre-NeoSmith ${CONFIG} from snapshot.`);
    return { ok: true, mode: "snapshot" };
  }

  // The file changed after `on` wrote it. Restoring the snapshot here would
  // delete every indented key, comment or new available_models the user
  // added (issue #22). Keep their file and take back only what NeoSmith owns.
  const cfg = io.readJSON(CONFIG) || {};
  const ledger = preserve.ledgerFor(
    "zed", CONFIG, [["language_models", "openai"]], (raw) => JSON.parse(raw || "{}"),
  );

  if (ledger) {
    // Replay the ledger, treating the `available_models` array element-wise
    // (mirrors how continue.js handles `models`). Setting the whole pre-connect
    // block back in one go would clobber every model the user added while
    // connected.
    unmergeAvailableModels(cfg, ledger);
  } else {
    // No ledger (pre-0.8 connect, or state.json lost). Today's partial
    // restore: strip the NeoSmith openai keys. A user api_url/api_key that
    // NeoSmith overwrote cannot be recovered, but a model they added alongside
    // ours can — we filter `available_models` by name.
    if (cfg.language_models && cfg.language_models.openai) {
      const o = cfg.language_models.openai;
      delete o.api_url;
      delete o.api_key;
      if (Array.isArray(o.available_models)) {
        o.available_models = o.available_models.filter((m) =>
          !(m && typeof m.name === "string" && (m.name.startsWith("neosmith.") || (m.display_name || "").startsWith("NeoSmith "))));
        if (!o.available_models.length) delete o.available_models;
      }
      if (Object.keys(o).length === 0) delete cfg.language_models.openai;
      if (cfg.language_models && Object.keys(cfg.language_models).length === 0) delete cfg.language_models;
    }
  }
  io.writeJSON(CONFIG, cfg, 0o600);
  preserve.finish("zed", CONFIG);
  ui.ok(ledger
    ? `Removed the NeoSmith provider from ${CONFIG} — the settings you changed while connected are still there.`
    : `Removed NeoSmith keys from ${CONFIG} (no pre-connect snapshot or ledger was available).`);
  return { ok: true, mode: "merge", partial: !ledger };
}

// Replay a Zed-specific restore ledger onto the parsed settings, treating the
// openai block's `available_models` array element-wise rather than as one
// opaque value. Same shape as continue.js's `unmergeByName`, named to match
// the field on the Zed side.
//
//   • available_models entry NeoSmith introduced (no prior with the same
//     name) → dropped.
//   • available_models entry the user already had pre-connect → their own
//     values come back.
//   • every other key on the openai block, plus the language_models container
//     itself → handled by the shared applyRestore.
function unmergeAvailableModels(cfg, ledger) {
  let modelsEntry = null;
  const scalars = [];
  for (const e of ledger) {
    const p = e.pointer;
    if (Array.isArray(p) && p.length === 3 && p[0] === "language_models" && p[1] === "openai" && p[2] === "available_models") {
      modelsEntry = e;
    } else {
      scalars.push(e);
    }
  }

  io.applyRestore(cfg, scalars);

  if (modelsEntry && cfg.language_models && cfg.language_models.openai) {
    const priorArr = modelsEntry.prior === io.ABSENT ? [] : modelsEntry.prior;
    const prior = new Map(
      (Array.isArray(priorArr) ? priorArr : [])
        .filter((m) => m && typeof m === "object" && typeof m.name === "string")
        .map((m) => [m.name, m]),
    );
    const live = cfg.language_models.openai.available_models;
    if (Array.isArray(live)) {
      const out = [];
      for (const m of live) {
        if (!m || typeof m !== "object") { out.push(m); continue; }
        if (prior.has(m.name)) {
          // A model the user had pre-connect (same name): restore their values.
          out.push(JSON.parse(JSON.stringify(prior.get(m.name))));
          continue;
        }
        // A model NeoSmith introduced that has no prior equivalent — including
        // the entry NeoSmith wrote and any user-added entry — survives only
        // if it does not look like one of ours. This is the conservative
        // fallback; the ledger-based path above preserves entries by name,
        // but without a recorded prior we have nothing to compare against and
        // so cannot distinguish user-added from NeoSmith-introduced.
        const isOurs = typeof m.name === "string" && (m.name.startsWith("neosmith.") || ((m.display_name || "").startsWith("NeoSmith ")));
        if (!isOurs) out.push(m);
      }
      if (out.length) cfg.language_models.openai.available_models = out;
      else delete cfg.language_models.openai.available_models;
    }
    // Empty-container prune: a `language_models` block NeoSmith created that
    // now holds nothing (no other provider keys, no openai, no
    // available_models) is dropped.
    if (cfg.language_models.openai && Object.keys(cfg.language_models.openai).length === 0) {
      delete cfg.language_models.openai;
    }
    if (cfg.language_models && Object.keys(cfg.language_models).length === 0) {
      delete cfg.language_models;
    }
  }
}

function status(ctx) {
  if (!io.fileExists(CONFIG)) return { on: false, detail: `${CONFIG} does not exist` };
  const cfg = io.readJSON(CONFIG) || {};
  const lm = cfg.language_models || {};
  const openai = lm.openai || {};
  const wiredEnv = harness.envForUrl(openai.api_url || openai.base_url || "");
  if (!wiredEnv) return { on: false, detail: "no NeoSmith provider in language_models.openai" };
  // Four SKUs plus whatever the user had makes a full list unreadable on one
  // status line. Report the count, and the smallest declared window — a SKU
  // registered without its real max_tokens is the failure worth surfacing.
  const ours = (Array.isArray(openai.available_models) ? openai.available_models : [])
    .filter((m) => m && typeof m.name === "string" && m.name.startsWith("neosmith."));
  const windows = ours.map((m) => m.max_tokens).filter((n) => typeof n === "number");
  // Compact, NOT toLocaleString: that renders 512000 as "5,12,000" under an
  // en-IN locale and "512,000" under en-US, so the same config reads
  // differently on two machines.
  const compact = (n) => (n >= 1e6 ? `${n / 1e6}M` : n >= 1e3 ? `${n / 1e3}K` : String(n));
  return {
    on: true,
    env: wiredEnv,
    detail: `${ours.length} SKU(s)` +
      (windows.length ? ` · context ${compact(Math.min(...windows))}–${compact(Math.max(...windows))}` : " · context unset") +
      ` · base=${openai.api_url || openai.base_url}`,
  };
}

function help() {
  return [
    `Zed — OpenAI-compatible language model provider.`,
    `Wires: Zed's settings.json (per-OS path) under language_models.openai.`,
    `Key storage: api_key literal in settings.json (mode 0600).`,
    ``,
    `Examples:`,
    `  neosmith zed on`,
    `  neosmith zed on --model neosmith.intelligent-basic`,
    `  neosmith zed off           # restores pre-connect settings.json from snapshot`,
    `  neosmith zed status`,
  ].join("\n");
}

// Which key Zed is holding, for `neosmith keys`. Only report it when the block
// actually points at NeoSmith — an api_key sitting under a user's own OpenAI
// wiring is theirs, not ours to surface.
function keyRef() {
  if (!io.fileExists(CONFIG)) return null;
  const cfg = io.readJSON(CONFIG) || {};
  if (!hasNeoSmith(cfg)) return null;
  const value = cfg.language_models.openai.api_key;
  if (typeof value !== "string" || !value) return null;
  return { kind: "literal", value, file: CONFIG };
}

module.exports = {
  id: "zed",
  name: "Zed",
  writable: true,
  configFile: CONFIG,
  on, off, status, help, keyRef,
};
