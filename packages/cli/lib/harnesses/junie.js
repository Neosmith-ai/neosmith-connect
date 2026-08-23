// Junie CLI (JetBrains) — file-writable.
//
// Junie discovers "custom model profiles" as one JSON file per profile:
//
//   user scope     $JUNIE_HOME/models/<profile>.json   (JUNIE_HOME || ~/.junie)
//   project scope  .junie/models/<profile>.json
//
// The filename without .json IS the profile id, selected as `custom:<id>`.
// Source: https://junie.jetbrains.com/docs/custom-llm-models.html and
// https://junie.jetbrains.com/docs/environment-variables.html (JUNIE_HOME —
// "Home directory for Junie CLI. Overrides the default ~/.junie").
//
// ONE PROFILE HOLDS ONE MODEL. There is no catalogue field: `id` names the
// model, and primaryModel/fasterModel are per-role overrides of that same
// profile. So unlike opencode.js and openclaw.js — which register every SKU
// inside a single provider block — offering all four NeoSmith tiers here means
// writing four files. `on` writes five:
//
//   neosmith.json           the tier you wired      → custom:neosmith
//   neosmith-pro.json       intelligent-pro         → custom:neosmith-pro
//   neosmith-basic.json     intelligent-basic       → custom:neosmith-basic
//   neosmith-lite.json      neolite                 → custom:neosmith-lite
//   neosmith-maestro.json   intelligent-maestro     → custom:neosmith-maestro
//
// The alias exists so `--model custom:neosmith` always means "the tier I
// connected with" and does not have to change when you switch; the four tier
// profiles exist so you can switch inside Junie without re-running `on`. The
// tier list comes from the manifest, so a fifth SKU appears here for free.
//
// TWO THINGS ARE DIFFERENT HERE from every other harness in this package:
//
//   1. `baseUrl` is the FULL endpoint, not the /v1 root. JetBrains' own Ollama
//      example is "http://localhost:11434/v1/chat/completions", and Junie sends
//      to exactly the URL you give it. Ownership and env detection still work
//      unchanged: harness.envForUrl matches on HOST, not on path.
//
//   2. There is no documented way to make a custom profile the persistent
//      default. Selection is `junie --model custom:<id>`, or the JUNIE_MODEL
//      environment variable. `on` prints both, using the shared lib/envsetup.js
//      helper so the env-var instructions are platform-correct (setx on
//      Windows, export + rc file on POSIX) — the same treatment codex.js gets.
//
// NeoSmith owns these files: they are named after us and Junie reads every
// *.json in the directory as a separate profile, so there is no shared document
// to merge into. `on` still MERGES rather than replaces, because a user can
// legitimately hand-tune fields on one of our profiles (temperature,
// extraHeaders, extraBody) and those are not ours to discard. Only the fields
// in OWNED are written, and only those are taken back by `off`. A profile that
// did not exist pre-connect is snapshotted as a tombstone and `off` deletes it.

"use strict";

const fs = require("fs");
const path = require("path");

const harness = require("../harness");
const io = require("../io");
const preserve = require("../preserve");
const envsetup = require("../envsetup");
const ui = require("../ui");

// The default profile's id, which is also its filename stem and the stem every
// tier profile is prefixed with.
const PROFILE = "neosmith";

// Junie's OpenAI-compatible wire format. The other legal values are
// "OpenAIResponses", "Google" and "Anthropic".
const API_TYPE = "OpenAICompletion";

// Junie reads a full endpoint URL, not a base. See note 1 in the header.
const ENDPOINT_PATH = "/chat/completions";

function junieHome() {
  const override = (process.env.JUNIE_HOME || "").trim();
  return override || path.join(io.HOME, ".junie");
}

function profilePath(id) {
  return path.join(junieHome(), "models", `${id}.json`);
}

// Resolved per call: JUNIE_HOME can change between invocations, and the
// contract sandbox swaps HOME between cases.
function configPath() {
  return profilePath(PROFILE);
}

const CONFIG = configPath();

// One entry per tier in the manifest's model ladder, in manifest order. The
// snapshot id follows lib/originals.js's `-profile-` convention, so
// `neosmith originals` labels these "Junie CLI · profile pro" rather than
// showing four indistinguishable rows.
function tierProfiles() {
  return Object.entries(harness.manifest().models || {}).map(([tier, sku]) => ({
    tier,
    sku,
    id: `${PROFILE}-${tier}`,
    snapshotId: `junie-profile-${tier}`,
    file: profilePath(`${PROFILE}-${tier}`),
  }));
}

// Every file this harness owns: the default alias first, then the tier
// profiles. `on`, `off` and `status` all walk this one list.
function targets(wiredModel) {
  return [
    { id: PROFILE, sku: wiredModel, snapshotId: "junie", file: configPath(), isDefault: true },
    ...tierProfiles(),
  ];
}

// The fields this module writes, and therefore the only fields `off` removes.
// Anything else on a profile is the user's.
const OWNED = ["id", "displayName", "providerName", "baseUrl", "apiType", "apiKey", "maxContextLength", "fasterModel"];
const POINTERS = OWNED.map((k) => [k]);

function endpointUrl() {
  return harness.OPENAI_BASE_URL.replace(/\/+$/, "") + ENDPOINT_PATH;
}

function hasNeoSmith(cfg) {
  // Ownership: matches ANY known environment so `off` finds staging wiring too.
  return !!(cfg && harness.isNeosmithUrl(cfg.baseUrl));
}

function displayName(sku) {
  const tiers = harness.manifest().claudeTierMap || {};
  for (const t of Object.values(tiers)) {
    if (t && t.model === sku && t.name) return t.name;
  }
  return `NeoSmith ${sku}`;
}

// Junie takes one model per profile, plus an optional `fasterModel` for helper
// tasks — the same pro/lite split OpenCode calls model/small_model.
function profileFor(model, key) {
  const specs = harness.manifest().modelSpecs || {};
  const spec = specs[model] || specs[harness.MODELS.pro] || { contextWindow: 1000000 };
  const faster = harness.MODELS.lite;
  const profile = {
    id: model,
    displayName: displayName(model),
    providerName: "NeoSmith",
    baseUrl: endpointUrl(),
    apiType: API_TYPE,
    apiKey: key,
    maxContextLength: spec.contextWindow,
  };
  // Only when it is a different SKU — a fasterModel pointing at the primary is
  // noise, and Junie treats an absent fasterModel as "use the primary".
  if (faster && faster !== model) profile.fasterModel = { id: faster };
  return profile;
}

// Snapshot + ledger + write + fingerprint for one profile file. Every target
// goes through here, so the default alias and the tier profiles get identical
// preservation guarantees.
function writeProfile(target, model, key) {
  const existing = io.fileExists(target.file) ? (io.readJSON(target.file) || {}) : {};
  io.ensureDir(path.dirname(target.file));
  // Both write-once, so a re-run refreshes the wiring without losing the
  // pre-connect baseline.
  io.snapshot(target.snapshotId, target.file);
  io.recordRestore(target.snapshotId, target.file, io.planRestore(existing, POINTERS));

  // Merge, do not replace: a temperature or extraHeaders the user put on this
  // profile is theirs and must survive.
  //
  // Note what is NOT done here: `fasterModel` is not cleared first. The reflex
  // is to clear it so a lite-tier profile (which writes no fasterModel — see
  // profileFor) cannot inherit a stale one. But `on` short-circuits on an
  // already-NeoSmith default profile, so the only files this ever merges into
  // are ones NeoSmith did not write — and the only fasterModel it could clear
  // is therefore the user's.
  io.writeJSON(target.file, { ...existing, ...profileFor(model, key) }, 0o600);
  // Re-stamped on every write, not write-once like the snapshot.
  io.recordFingerprint(target.snapshotId, target.file);
}

function on(ctx) {
  const model = ctx.model;
  const key = ctx.key;
  const all = targets(model);
  const primary = all[0];

  if (hasNeoSmith(io.fileExists(primary.file) ? (io.readJSON(primary.file) || {}) : {})) {
    ui.warn(`${primary.file} already points at NeoSmith.`);
    return { alreadyOn: true };
  }

  for (const t of all) writeProfile(t, t.isDefault ? model : t.sku, key);

  io.setHarnessFlag("junie", true, {
    model, env: (ctx && ctx.env && ctx.env.name) || harness.envName(),
  });

  ui.ok(`Wrote ${all.length} model profiles to ${path.dirname(primary.file)}`);
  ui.log(ui.c("dim", `Endpoint ${endpointUrl()}`));
  ui.log("");
  ui.log(ui.c("dim", `Junie has no persistent default for a custom profile — select one per run:`));
  ui.box([
    `junie --model custom:${PROFILE}${" ".repeat(9)}# ${model}  (the tier you just wired)`,
    ...tierProfiles().map((t) =>
      `junie --model custom:${t.id.padEnd(17)}# ${t.sku}`),
  ]);
  ui.log("");
  ui.log(ui.c("dim", `To make one the default for every run, set JUNIE_MODEL.`));
  ui.box(envsetup.envSetupLines([["JUNIE_MODEL", `custom:${PROFILE}`]]));
  // Deliberately NOT `needsEnv`. That flag makes lib/commands/on.js print
  // "until that variable is set, <harness> has no credentials" — true for
  // codex, whose config holds only an env_key reference, and false here: the
  // key is written into every profile. JUNIE_MODEL selects a model, it does not
  // supply a credential, and saying otherwise would send people hunting for a
  // problem they do not have.
  return { wrote: true, profiles: all.length };
}

// Put one profile file back. Returns what happened, so `off` can report
// accurately instead of claiming a restore that was really a delete.
function restoreProfile(target) {
  if (!io.fileExists(target.file)) {
    preserve.finish(target.snapshotId, target.file);
    return "absent";
  }

  // Untouched since we wrote it, and we hold the pre-connect bytes. For the
  // common case that snapshot is a tombstone, so this deletes the file.
  if (preserve.disposition(target.snapshotId, target.file) === "snapshot") {
    io.restoreSnapshot(target.snapshotId, target.file);
    preserve.finish(target.snapshotId, target.file);
    return io.fileExists(target.file) ? "restored" : "removed";
  }

  const cfg = io.readJSON(target.file) || {};
  const ledger = preserve.ledgerFor(target.snapshotId, target.file, POINTERS, (r) => JSON.parse(r || "{}"));
  if (ledger) {
    io.applyRestore(cfg, ledger);
  } else {
    // No ledger (state.json lost). Drop only the fields we know we write.
    for (const k of OWNED) delete cfg[k];
  }

  // Everything we own is gone and nothing of the user's is left — the profile
  // is an empty husk Junie would still try to load, so remove it.
  if (!Object.keys(cfg).length) {
    if (process.env.NEOSMITH_DRY_RUN !== "1") fs.unlinkSync(target.file);
    preserve.finish(target.snapshotId, target.file);
    return "removed";
  }

  io.writeJSON(target.file, cfg, 0o600);
  preserve.finish(target.snapshotId, target.file);
  return "merged";
}

function off(ctx) {
  io.setHarnessFlag("junie", false);
  const all = targets(harness.MODELS.pro);

  const tally = { restored: 0, removed: 0, merged: 0, absent: 0 };
  for (const t of all) tally[restoreProfile(t)]++;

  const touched = tally.restored + tally.removed + tally.merged;
  if (!touched) {
    ui.log(`No NeoSmith profiles found in ${path.dirname(all[0].file)} — nothing to disconnect.`);
    return { ok: true };
  }

  if (tally.removed) ui.ok(`Removed ${tally.removed} NeoSmith profile(s) from ${path.dirname(all[0].file)}.`);
  if (tally.restored) ui.ok(`Restored ${tally.restored} pre-NeoSmith profile(s) from snapshot.`);
  if (tally.merged) {
    ui.ok(`Removed the NeoSmith fields from ${tally.merged} profile(s) — the settings you changed while connected are still there.`);
  }
  ui.log(ui.c("dim", `If you set JUNIE_MODEL to one of these profiles, unset it too.`));
  return { ok: true, ...tally };
}

function status(ctx) {
  const all = targets(harness.MODELS.pro);
  const primary = all[0];
  if (!io.fileExists(primary.file)) {
    return { on: false, detail: `${primary.file} does not exist` };
  }

  const cfg = io.readJSON(primary.file) || {};
  const wiredEnv = harness.envForUrl(cfg.baseUrl || "");
  if (!wiredEnv) return { on: false, detail: `${primary.file} does not point at NeoSmith` };

  const tiers = tierProfiles().filter((t) => {
    const c = io.fileExists(t.file) ? (io.readJSON(t.file) || {}) : null;
    return c && hasNeoSmith(c);
  });
  const selected = (process.env.JUNIE_MODEL || "").trim();
  const known = new Set([PROFILE, ...tierProfiles().map((t) => t.id)].map((id) => `custom:${id}`));

  return {
    on: true,
    env: wiredEnv,
    detail: `profile=custom:${PROFILE} model=${cfg.id || "(unset)"} · ${tiers.length} tier profile(s) · base=${cfg.baseUrl}` +
      (known.has(selected) ? ` · JUNIE_MODEL=${selected}` : ` · select with \`junie --model custom:${PROFILE}\``),
  };
}

function keyRef() {
  const cfg = configPath();
  if (!io.fileExists(cfg)) return null;
  const parsed = io.readJSON(cfg) || {};
  const value = parsed.apiKey;
  if (typeof value !== "string" || !value) return null;
  // Junie resolves "${VAR}" references; a literal is used as-is.
  const envRef = /^\$\{([^}]+)\}$/.exec(value);
  if (envRef) return { kind: "env-ref", name: envRef[1], file: cfg };
  return { kind: "literal", value, file: cfg };
}

function help() {
  const tiers = tierProfiles();
  return [
    `Junie CLI (JetBrains) — custom model profiles.`,
    `Wires: $JUNIE_HOME/models/*.json (JUNIE_HOME defaults to ~/.junie),`,
    `       apiType ${API_TYPE}.`,
    `Key storage: apiKey literal in each profile (mode 0600).`,
    ``,
    `One Junie profile holds ONE model, so \`on\` writes ${1 + tiers.length}: an alias for the`,
    `tier you wired, plus one per NeoSmith SKU so you can switch without re-running it.`,
    ``,
    `  custom:${PROFILE}${" ".repeat(18 - PROFILE.length)}the tier you connected with`,
    ...tiers.map((t) => `  custom:${t.id.padEnd(18)}${t.sku}`),
    ``,
    `Junie wants the FULL endpoint, not the /v1 root, so the profiles point at`,
    `<router>/v1${ENDPOINT_PATH} — that is per JetBrains' own examples.`,
    ``,
    `There is no persistent default for a custom profile. Select one per run with`,
    `\`junie --model custom:<id>\`, or set JUNIE_MODEL=custom:<id>.`,
    ``,
    `Examples:`,
    `  neosmith junie on`,
    `  neosmith junie on --model neosmith.intelligent-basic   # which one the alias points at`,
    `  neosmith junie off           # restores (or removes) every profile it wrote`,
    `  neosmith junie status`,
  ].join("\n");
}

module.exports = {
  id: "junie",
  name: "Junie CLI",
  writable: true,
  // The default alias. The tier profiles are discovered at call time via
  // tierProfiles() — a single path cannot represent them (same reason
  // copilot.js exposes profileTargets alongside its configFile).
  configFile: CONFIG,
  configPath,
  profilePath,
  tierProfiles,
  targets,
  profile: PROFILE,
  on, off, status, help, keyRef,
};
