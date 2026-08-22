// Junie CLI (JetBrains) — file-writable.
//
// Junie discovers "custom model profiles" as one JSON file per profile:
//
//   user scope     $JUNIE_HOME/models/<profile>.json   (JUNIE_HOME || ~/.junie)
//   project scope  .junie/models/<profile>.json
//
// The filename without .json IS the profile id, so ours is `neosmith.json` and
// the profile is selected as `custom:neosmith`. Source:
// https://junie.jetbrains.com/docs/custom-llm-models.html and
// https://junie.jetbrains.com/docs/environment-variables.html (JUNIE_HOME —
// "Home directory for Junie CLI. Overrides the default ~/.junie").
//
// TWO THINGS ARE DIFFERENT HERE from every other harness in this package:
//
//   1. `baseUrl` is the FULL endpoint, not the base. JetBrains' own Ollama
//      example is "http://localhost:11434/v1/chat/completions", not the /v1
//      root every other client wants. So this is the one module that appends a
//      path to harness.OPENAI_BASE_URL. Ownership and env detection still work
//      unchanged: harness.envForUrl matches on HOST, not on path.
//
//   2. There is no documented way to make a custom profile the persistent
//      default. Selection is `junie --model custom:neosmith`, or the
//      JUNIE_MODEL environment variable. `on` writes the profile and then
//      prints both, using the shared lib/envsetup.js helper so the env-var
//      instructions are platform-correct (setx on Windows, export + rc file on
//      POSIX) — the same treatment codex.js gets.
//
// NeoSmith owns this file: it is named after us and Junie reads every *.json in
// the directory as a separate profile, so there is no shared document to merge
// into. `on` still MERGES rather than replaces, because a user can legitimately
// hand-tune fields on our profile (temperature, extraHeaders, extraBody) and a
// second `on` to switch tiers must not throw those away. Only the fields listed
// in OWNED are written, and only those are taken back by `off`. When the file
// did not exist pre-connect the snapshot is a tombstone and `off` deletes it.

"use strict";

const path = require("path");

const harness = require("../harness");
const io = require("../io");
const preserve = require("../preserve");
const envsetup = require("../envsetup");
const ui = require("../ui");

// The profile id, which is also the filename stem and the `custom:` suffix.
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

// Resolved per call: JUNIE_HOME can change between invocations, and the
// contract sandbox swaps HOME between cases.
function configPath() {
  return path.join(junieHome(), "models", `${PROFILE}.json`);
}

const CONFIG = configPath();

// The fields this module writes, and therefore the only fields `off` removes.
// Anything else on the profile is the user's.
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

function on(ctx) {
  const model = ctx.model;
  const key = ctx.key;
  const CFG = configPath();
  const existing = io.fileExists(CFG) ? (io.readJSON(CFG) || {}) : {};

  if (hasNeoSmith(existing)) {
    ui.warn(`${CFG} already points at NeoSmith.`);
    return { alreadyOn: true };
  }

  io.ensureDir(path.dirname(CFG));
  // Snapshot + ledger before mutating. Both write-once, so a second `on` to
  // switch tiers refreshes the wiring without losing the pre-connect baseline.
  io.snapshot("junie", CFG);
  io.recordRestore("junie", CFG, io.planRestore(existing, POINTERS));

  const profile = profileFor(model, key);
  // Merge, do not replace: a temperature or extraHeaders the user put on this
  // profile is theirs and must survive.
  //
  // Note what is NOT done here: `fasterModel` is not cleared first. The reflex
  // is to clear it so wiring the lite tier (which writes no fasterModel — see
  // profileFor) cannot leave a stale one behind. But `on` short-circuits on an
  // already-NeoSmith profile, so the only file this branch ever merges into is
  // one NeoSmith did not write — and the only fasterModel it could clear is
  // therefore the user's. Switching tiers goes through `off` then `on`, which
  // starts from a clean profile anyway.
  const next = { ...existing, ...profile };

  io.writeJSON(CFG, next, 0o600);
  io.recordFingerprint("junie", CFG);
  io.setHarnessFlag("junie", true, {
    model, env: (ctx && ctx.env && ctx.env.name) || harness.envName(),
  });

  ui.ok(`Wrote ${CFG}`);
  ui.log(ui.c("dim", `Profile id: ${PROFILE} · model ${model} · endpoint ${profile.baseUrl}`));
  ui.log("");
  ui.log(ui.c("dim", `Junie has no persistent default for a custom profile — select it per run:`));
  ui.box([`junie --model custom:${PROFILE}`]);
  ui.log("");
  ui.log(ui.c("dim", `To make it the default for every run, set JUNIE_MODEL.`));
  ui.box(envsetup.envSetupLines([["JUNIE_MODEL", `custom:${PROFILE}`]]));
  // Deliberately NOT `needsEnv`. That flag makes lib/commands/on.js print
  // "until that variable is set, <harness> has no credentials" — true for
  // codex, whose config holds only an env_key reference, and false here: the
  // key is written into the profile. JUNIE_MODEL selects a model, it does not
  // supply a credential, and saying otherwise would send people hunting for a
  // problem they do not have.
  return { wrote: true };
}

function off(ctx) {
  io.setHarnessFlag("junie", false);
  const CFG = configPath();

  if (!io.fileExists(CFG)) {
    preserve.finish("junie", CFG);
    ui.log(`${CFG} not present — nothing to disconnect.`);
    return { ok: true };
  }

  // Untouched since `on` wrote it, and we hold the pre-connect bytes. For the
  // common case that snapshot is a tombstone, so this deletes the file.
  if (preserve.disposition("junie", CFG) === "snapshot") {
    io.restoreSnapshot("junie", CFG);
    preserve.finish("junie", CFG);
    ui.ok(io.fileExists(CFG)
      ? `Restored pre-NeoSmith ${CFG} from snapshot.`
      : `Removed ${CFG} — it did not exist before you connected.`);
    return { ok: true, mode: "snapshot" };
  }

  const cfg = io.readJSON(CFG) || {};
  const ledger = preserve.ledgerFor("junie", CFG, POINTERS, (r) => JSON.parse(r || "{}"));
  if (ledger) {
    io.applyRestore(cfg, ledger);
  } else {
    // No ledger (state.json lost). Drop only the fields we know we write.
    for (const k of OWNED) delete cfg[k];
  }

  // Everything we own is gone and nothing of the user's is left — the profile
  // is an empty husk Junie would still try to load, so remove it.
  if (!Object.keys(cfg).length) {
    if (process.env.NEOSMITH_DRY_RUN !== "1") require("fs").unlinkSync(CFG);
    preserve.finish("junie", CFG);
    ui.ok(`Removed ${CFG} — nothing was left on the profile once the NeoSmith fields came out.`);
    return { ok: true, mode: "merge", partial: !ledger };
  }

  io.writeJSON(CFG, cfg, 0o600);
  preserve.finish("junie", CFG);
  ui.ok(ledger
    ? `Removed the NeoSmith fields from ${CFG} — the settings you changed while connected are still there.`
    : `Removed NeoSmith fields from ${CFG} (no pre-connect snapshot or ledger was available).`);
  ui.log(ui.c("dim", `If you set JUNIE_MODEL=custom:${PROFILE}, unset it too.`));
  return { ok: true, mode: "merge", partial: !ledger };
}

function status(ctx) {
  const CFG = configPath();
  if (!io.fileExists(CFG)) return { on: false, detail: `${CFG} does not exist` };

  const cfg = io.readJSON(CFG) || {};
  const wiredEnv = harness.envForUrl(cfg.baseUrl || "");
  if (!wiredEnv) return { on: false, detail: `${CFG} does not point at NeoSmith` };

  const selected = (process.env.JUNIE_MODEL || "").trim() === `custom:${PROFILE}`;
  return {
    on: true,
    env: wiredEnv,
    detail: `profile=custom:${PROFILE} model=${cfg.id || "(unset)"} base=${cfg.baseUrl}` +
      (selected ? " · JUNIE_MODEL selects it" : ` · select with \`junie --model custom:${PROFILE}\``),
  };
}

function keyRef() {
  const CFG = configPath();
  if (!io.fileExists(CFG)) return null;
  const cfg = io.readJSON(CFG) || {};
  const value = cfg.apiKey;
  if (typeof value !== "string" || !value) return null;
  // Junie resolves "${VAR}" references; a literal is used as-is.
  const envRef = /^\$\{([^}]+)\}$/.exec(value);
  if (envRef) return { kind: "env-ref", name: envRef[1], file: CFG };
  return { kind: "literal", value, file: CFG };
}

function help() {
  return [
    `Junie CLI (JetBrains) — custom model profile.`,
    `Wires: $JUNIE_HOME/models/${PROFILE}.json (JUNIE_HOME defaults to ~/.junie),`,
    `       apiType ${API_TYPE}.`,
    `Key storage: apiKey literal in the profile (mode 0600).`,
    ``,
    `Junie wants the FULL endpoint, not the /v1 root, so the profile points at`,
    `<router>/v1${ENDPOINT_PATH} — that is per JetBrains' own examples.`,
    ``,
    `There is no persistent default for a custom profile. Select it per run with`,
    `\`junie --model custom:${PROFILE}\`, or set JUNIE_MODEL=custom:${PROFILE}.`,
    ``,
    `Examples:`,
    `  neosmith junie on`,
    `  neosmith junie on --model neosmith.intelligent-basic`,
    `  neosmith junie off           # restores (or removes) the profile`,
    `  neosmith junie status`,
  ].join("\n");
}

module.exports = {
  id: "junie",
  name: "Junie CLI",
  writable: true,
  configFile: CONFIG,
  configPath,
  profile: PROFILE,
  on, off, status, help, keyRef,
};
