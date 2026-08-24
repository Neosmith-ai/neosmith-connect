// Continue — file-writable.
//
// Writes ~/.continue/config.yaml (0600). OpenAI-compatible provider on
// https://router.neosmith.ai/v1. Per site/agents/continue.md:
//
//   models:
//     - name: NeoSmith
//       provider: openai
//       apiBase: https://router.neosmith.ai/v1
//       model: neosmith.intelligent-pro
//       apiKey: <key>
//
// Optional tabAutocompleteModel with intelligent-lite for inline completions.
// The key is baked as a plaintext literal (0600) — Continue has no env-key
// indirection for the openai provider.
//
// YAML merge via the `yaml` package. Falls back to a string block merge if
// the dependency is missing.

"use strict";

const path = require("path");
const harness = require("../harness");
const io = require("../io");
const preserve = require("../preserve");
const ui = require("../ui");

const CONFIG_DIR = path.join(io.HOME, ".continue");
const CONFIG = path.join(CONFIG_DIR, "config.yaml");

let yaml;
try { yaml = require("yaml"); } catch { yaml = null; }

// Every NeoSmith entry's `name` starts with this, which is what `off` keys on
// to tell our models apart from the user's. The bare "NeoSmith" name is the
// wired-tier entry and predates the per-SKU list; it is still written (and
// still recognised) so an existing connect keeps the name it had.
const NEO_NAME = "NeoSmith";

function isNeosmithEntry(m) {
  return !!(m && typeof m.name === "string" && (m.name === NEO_NAME || m.name.startsWith(NEO_NAME + " ")));
}

function displayNameFor(sku) {
  const tiers = harness.manifest().claudeTierMap || {};
  for (const t of Object.values(tiers)) {
    if (t && t.model === sku && t.name) return t.name;
  }
  return `${NEO_NAME} ${sku}`;
}

function modelEntry(name, sku, key) {
  const spec = (harness.manifest().modelSpecs || {})[sku];
  const entry = {
    name,
    provider: "openai",
    apiBase: harness.OPENAI_BASE_URL,
    model: sku,
    apiKey: key,
  };
  // Continue cannot discover a context window — GET /v1/models returns ids
  // only — so without contextLength it falls back to a conservative default
  // and compacts a 1M-context SKU far too early. neolite is the sealed 512K
  // tier; the rest are 1M.
  if (spec) entry.defaultCompletionOptions = { contextLength: spec.contextWindow, maxTokens: spec.maxTokens };
  return entry;
}

// The wired tier, under the bare "NeoSmith" name.
function neosmithModelBlock(model, key) {
  return modelEntry(NEO_NAME, model, key);
}

// One entry per SKU, so every tier is selectable from Continue's model
// dropdown without re-running `on`. Sourced from the manifest, so a new SKU
// lands here for free.
function neosmithTierBlocks(key) {
  return Object.values(harness.manifest().models || {})
    .map((sku) => modelEntry(displayNameFor(sku), sku, key));
}

function neosmithAutocompleteBlock(key) {
  return {
    title: "NeoSmith Autocomplete",
    provider: "openai",
    apiBase: harness.OPENAI_BASE_URL,
    model: harness.MODELS.lite,
    apiKey: key,
  };
}

// Every pointer on() writes into the parsed YAML, for the restore ledger.
const WRITTEN_POINTERS = [["models"], ["tabAutocompleteModel"]];

// String fallback, used only when the `yaml` dependency is missing so we can't
// merge structurally. It used to accept `existingText` and never read it —
// silently destroying the whole config (issue #15). We can't safely merge two
// YAML documents by hand, so the user's original is preserved verbatim as a
// commented block: the file stays valid, nothing is lost, and `off` still
// restores the real thing from the snapshot.
function stringMerge(existingText, model, key, withAutocomplete) {
  const lines = [];
  lines.push(`name: Local Config`);
  lines.push(`version: 1.0.0`);
  lines.push(`schema: v1`);
  lines.push(``);
  lines.push(`models:`);
  // The wired tier, then one entry per SKU — the same set the structural merge
  // writes. A machine without the `yaml` dep must not silently get one model.
  for (const m of [neosmithModelBlock(model, key), ...neosmithTierBlocks(key)]) {
    lines.push(`  - name: ${m.name}`);
    lines.push(`    provider: ${m.provider}`);
    lines.push(`    apiBase: ${m.apiBase}`);
    lines.push(`    model: ${m.model}`);
    lines.push(`    apiKey: ${m.apiKey}`);
    if (m.defaultCompletionOptions) {
      lines.push(`    defaultCompletionOptions:`);
      lines.push(`      contextLength: ${m.defaultCompletionOptions.contextLength}`);
      lines.push(`      maxTokens: ${m.defaultCompletionOptions.maxTokens}`);
    }
  }
  if (withAutocomplete) {
    lines.push(``);
    lines.push(`tabAutocompleteModel:`);
    lines.push(`  title: NeoSmith Autocomplete`);
    lines.push(`  provider: openai`);
    lines.push(`  apiBase: ${harness.OPENAI_BASE_URL}`);
    lines.push(`  model: ${harness.MODELS.lite}`);
    lines.push(`  apiKey: ${key}`);
  }
  const prior = (existingText || "").trim();
  if (prior) {
    lines.push(``);
    lines.push(`# ── pre-NeoSmith config (preserved verbatim) ─────────────────────────`);
    lines.push(`# The \`yaml\` package was unavailable, so this could not be merged`);
    lines.push(`# structurally. Run \`neosmith continue off\` to restore it, or`);
    lines.push(`# uncomment the entries you still want.`);
    for (const l of prior.split("\n")) lines.push(`# ${l}`);
  }
  return lines.join("\n") + "\n";
}

function on(ctx) {
  const model = ctx.model;
  const key = ctx.key;
  const withAutocomplete = !!ctx.autocomplete;
  io.ensureDir(CONFIG_DIR);

  const existingText = io.readText(CONFIG);
  let out;
  if (yaml) {
    let parsed = {};
    try { parsed = yaml.parse(existingText || "") || {}; }
    catch (e) {
      ui.warn(`Existing ${CONFIG} had a YAML parse error (${e.message}); starting fresh with a snapshot of the old file.`);
      parsed = {};
    }
    if (!parsed || typeof parsed !== "object") parsed = {};

    // Snapshot + ledger before mutating `parsed`. Both are write-once, so a
    // second `on` refreshes the entry without losing the pre-connect baseline
    // (issue #15 — this used to re-snapshot the already-NeoSmith config).
    io.snapshot("continue", CONFIG);
    io.recordRestore("continue", CONFIG, io.planRestore(parsed, WRITTEN_POINTERS));

    const models = Array.isArray(parsed.models) ? parsed.models.slice() : [];
    // Replace any prior NeoSmith entries; keep others.
    const filtered = models.filter((m) => !isNeosmithEntry(m));
    filtered.push(neosmithModelBlock(model, key), ...neosmithTierBlocks(key));
    parsed.models = filtered;

    if (withAutocomplete) parsed.tabAutocompleteModel = neosmithAutocompleteBlock(key);
    else if (parsed.tabAutocompleteModel && parsed.tabAutocompleteModel.title === "NeoSmith Autocomplete") {
      delete parsed.tabAutocompleteModel;
    }

    out = yaml.stringify(parsed);
  } else {
    ui.warn("`yaml` package not installed — writing a fresh NeoSmith block and preserving your existing config as a comment (and in the snapshot). Run `npm install` in the CLI dir for a true merge.");
    io.snapshot("continue", CONFIG);
    out = stringMerge(existingText, model, key, withAutocomplete);
    // No parser → no ledger. `off` falls back to the same string surgery.
    // Do NOT stamp a fingerprint: a user edit would then look like drift on a
    // file the CLI cannot structurally merge, and `off` would still take the
    // snapshot path because the ledger is empty. Worst of both.
  }

  io.writeText(CONFIG, out, 0o600);
  if (yaml) {
    // Stamp the file as we left it, so `off` can tell a config.yaml the user
    // has since edited from one nobody touched (issue #22). Re-stamped on
    // every `on` — the fingerprint is deliberately not write-once.
    io.recordFingerprint("continue", CONFIG);
  }
  ui.ok(`Wrote ${CONFIG}`);
  if (!withAutocomplete) {
    ui.log(ui.c("dim", `Tip: add --autocomplete to also route inline completions through NeoSmith (intelligent-lite).`));
  }
  return { wrote: true };
}

function off(ctx) {
  if (!io.fileExists(CONFIG)) {
    preserve.finish("continue", CONFIG);
    ui.log(`${CONFIG} not present — nothing to disconnect.`);
    return { ok: true };
  }

  // Nobody touched config.yaml since `on` wrote it, and we still hold the
  // pre-connect bytes — put them back exactly, comments and all. The YAML
  // library round-trips YAML through `parse → stringify` on every write, so a
  // snapshot restore is the only way to bring back the user's formatting,
  // their block ordering, and the order of entries inside `models:`.
  if (preserve.disposition("continue", CONFIG) === "snapshot") {
    io.restoreSnapshot("continue", CONFIG);
    preserve.finish("continue", CONFIG);
    ui.ok(`Restored pre-NeoSmith ${CONFIG} from snapshot.`);
    return { ok: true, mode: "snapshot" };
  }

  // The file changed after `on` wrote it. Restoring the snapshot here would
  // delete everything the user added to it while connected (issue #22), so
  // keep their file and take back only the entries NeoSmith owns.
  if (yaml) {
    let parsed = {};
    try { parsed = yaml.parse(io.readText(CONFIG) || "") || {}; } catch { parsed = {}; }
    const ledger = preserve.ledgerFor("continue", CONFIG, WRITTEN_POINTERS, (raw) => yaml.parse(raw));
    if (ledger) {
      // Replay per-element (not via applyRestore wholesale on `models`): the
      // ledger records the WHOLE pre-connect array, and setting it back would
      // wipe the models the user added while connected.
      unmergeByName(parsed, ledger);
    } else {
      // No ledger (a connect made by an older CLI, or state.json lost outside
      // the .bak). Today's partial-restore: filter NeoSmith entries by name.
      // A user model NeoSmith overwrote can't be recovered.
      if (Array.isArray(parsed.models)) {
        const kept = parsed.models.filter((m) => !isNeosmithEntry(m));
        if (kept.length) parsed.models = kept;
        else delete parsed.models;
      }
      if (parsed.tabAutocompleteModel && parsed.tabAutocompleteModel.title === "NeoSmith Autocomplete") {
        delete parsed.tabAutocompleteModel;
      }
    }
    io.writeText(CONFIG, yaml.stringify(parsed), 0o600);
    preserve.finish("continue", CONFIG);
    ui.ok(ledger
      ? `Removed the NeoSmith entries from ${CONFIG} — the models and settings you changed while connected are still there.`
      : `Removed NeoSmith entries from ${CONFIG} (no pre-connect snapshot or ledger was available).`);
    return { ok: true, mode: "merge", partial: !ledger };
  }

  // No YAML library → string fallback. Today this just strips lines by regex.
  let text = io.readText(CONFIG) || "";
  text = text.replace(/\n?\s*-\s+name:\s*NeoSmith[\s\S]*?(?=\n\s*-\s+name:|\ntabAutocompleteModel:|\n[a-z]|$)/g, "");
  text = text.replace(/\n?tabAutocompleteModel:[\s\S]*?(?=\n[a-z]|$)/g, "");
  io.writeText(CONFIG, text + "\n", 0o600);
  // No fingerprint on this branch (see on()'s comment), so disambiguate: no
  // recorded fingerprint + a real .bak (or none) → merge path. No ledger →
  // nothing structural to replay; the regex strip above is the entire job.
  preserve.finish("continue", CONFIG);
  ui.ok(`Removed the NeoSmith entries from ${CONFIG} (no parser — the user's edits cannot be structurally preserved; restore from ${io.snapshotPath("continue") || "the snapshot"} or rebuild the YAML).`);
  return { ok: true, mode: "merge", partial: true };
}

// Replay a YAML-specific restore ledger onto a parsed config, treating
// `models` as a list of named entries rather than one opaque value.
//
// The shared ledger would otherwise set the whole pre-connect `models` array
// back in one go, overwriting every model the user added while connected. So
// split that entry out and apply it element-wise:
//
//   • name "NeoSmith", present pre-connect        → user's own model comes back
//   • name "NeoSmith", not present pre-connect    → NeoSmith introduced it; drop
//   • any other name                              → left exactly where it was
//
// The autocomplete model is a single object, so applyRestore handles it.
function unmergeByName(parsed, ledger) {
  let modelsEntry = null;
  const scalars = [];
  for (const e of ledger) {
    if (Array.isArray(e.pointer) && e.pointer.length === 1 && e.pointer[0] === "models") {
      modelsEntry = e;
    } else {
      scalars.push(e);
    }
  }

  // `tabAutocompleteModel` and any container (models[]) are scalar-only after
  // the split — applyRestore handles them: ABSENT → unset, anything else →
  // set back. It does NOT touch individual entries inside the models array;
  // that is what the loop below is for.
  io.applyRestore(parsed, scalars);

  if (modelsEntry && Array.isArray(parsed.models)) {
    const priorModels = modelsEntry.prior === io.ABSENT ? [] : modelsEntry.prior;
    const prior = new Map(
      (Array.isArray(priorModels) ? priorModels : [])
        .filter((m) => m && typeof m === "object" && typeof m.name === "string")
        .map((m) => [m.name, m]),
    );
    const live = parsed.models;
    const out = [];
    for (const m of live) {
      if (!isNeosmithEntry(m)) { out.push(m); continue; }
      if (prior.has(m.name)) out.push(JSON.parse(JSON.stringify(prior.get(m.name))));
      // An entry NeoSmith introduced that no prior exists for falls away.
    }
    if (out.length) parsed.models = out;
    else delete parsed.models;
  }
}

function status(ctx) {
  if (!io.fileExists(CONFIG)) return { on: false, detail: `${CONFIG} does not exist` };
  const text = io.readText(CONFIG) || "";
  const hasNeo = /name:\s*NeoSmith/.test(text);
  const modelMatch = text.match(/model:\s*(neosmith\.\S+)/);
  const hasAutocomplete = /title:\s*NeoSmith Autocomplete/.test(text);
  // The YAML is merged as text, so read the apiBase back out to name the env.
  const baseMatch = text.match(/apiBase:\s*(\S+)/);
  const wiredEnv = baseMatch ? harness.envForUrl(baseMatch[1]) : null;
  // Distinct SKUs, not entry count: the wired-tier entry duplicates one of the
  // per-SKU ones, and reporting "5 models" for four tiers reads as a bug.
  const skus = new Set((text.match(/model:\s*(neosmith\.\S+)/g) || [])
    .map((m) => m.replace(/^model:\s*/, "")));
  return {
    on: hasNeo,
    env: wiredEnv,
    detail: hasNeo
      ? `model=${modelMatch ? modelMatch[1] : "(unset)"} · ${skus.size} SKU(s)${hasAutocomplete ? " +autocomplete" : ""} base=${baseMatch ? baseMatch[1] : "(unset)"}`
      : "no NeoSmith model entry",
  };
}

function help() {
  return [
    `Continue — OpenAI-compatible provider (config.yaml).`,
    `Wires: ~/.continue/config.yaml (merges your existing models).`,
    `Key storage: apiKey baked into config.yaml (mode 0600).`,
    ``,
    `Examples:`,
    `  neosmith continue on`,
    `  neosmith continue on --autocomplete   # also route inline completions via intelligent-lite`,
    `  neosmith continue off`,
    `  neosmith continue status`,
  ].join("\n");
}

// Which key Continue is holding, for `neosmith keys`. Read from the NeoSmith
// model entry specifically — a user's own models each carry their own apiKey,
// and reporting the first one in the file would name someone else's credential.
// Structural read when `yaml` is available, scoped text match when it is not
// (the same fallback pair `on`/`off` already use).
function keyRef() {
  if (!io.fileExists(CONFIG)) return null;
  const text = io.readText(CONFIG);
  if (text === null) return null;

  if (yaml) {
    try {
      const parsed = yaml.parse(text) || {};
      const ours = (Array.isArray(parsed.models) ? parsed.models : []).filter(isNeosmithEntry);
      // The bare "NeoSmith" entry is the wired tier; the per-SKU ones all carry
      // the same key, so either answers "which key is Continue holding".
      const entry = ours.find((m) => m.name === NEO_NAME) || ours[0];
      if (entry && typeof entry.apiKey === "string" && entry.apiKey) {
        return { kind: "literal", value: entry.apiKey, file: CONFIG };
      }
      return null;
    } catch { /* fall through to the text match */ }
  }

  // `- name: NeoSmith` is followed by provider/apiBase/model/apiKey — bound the
  // window so this cannot reach into the NEXT model entry's key.
  const m = text.match(/name:\s*NeoSmith\s*\n[\s\S]{0,400}?apiKey:\s*(\S+)/);
  return m ? { kind: "literal", value: m[1], file: CONFIG } : null;
}

module.exports = {
  id: "continue",
  name: "Continue",
  writable: true,
  configFile: CONFIG,
  on, off, status, help, keyRef,
  // Exported for the contract suite. stringMerge is the path taken when the
  // optional `yaml` dep is missing, so it never runs in a normal install and
  // nothing would otherwise notice it drifting from the structural merge — it
  // used to emit one hardcoded model block while `on` wrote the full set.
  stringMerge,
};
