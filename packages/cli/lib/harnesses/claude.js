// Claude Code — file-writable.
//
// Writes ~/.claude/settings.json (0600). Anthropic Messages API:
//   ANTHROPIC_BASE_URL   = https://router.neosmith.ai  (bare host; Claude appends /v1/messages)
//   ANTHROPIC_AUTH_TOKEN = <key>                       (accepted alongside ANTHROPIC_API_KEY)
//   ANTHROPIC_MODEL      = neosmith.intelligent-pro    (mapped via flag --model)
//
// In addition to the core connection vars, `on` writes the full per-tier
// ANTHROPIC_DEFAULT_<SLOT>_MODEL(+_NAME/_DESCRIPTION) ladder so Claude Code's
// /model picker shows NeoSmith-branded tiers, plus the top-level `model` /
// `advisorModel` shortcuts. The tier→SKU map lives in harnesses.json
// (claudeTierMap); the default `model`/`advisorModel` selection derives from
// the --model flag.
//
// MERGE never clobber: pre-existing env, permissions, hooks, MCP config are
// preserved. `off` restores from the byte-for-byte snapshot taken before `on` —
// unless the file changed in the meantime, in which case it keeps what the user
// wrote while connected and removes only NeoSmith's own keys (issue #22; the
// decision lives in lib/preserve.js).

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const harness = require("../harness");
const io = require("../io");
const preserve = require("../preserve");
const ui = require("../ui");

const CONFIG = path.join(io.HOME, ".claude", "settings.json");

// The environment this invocation is acting as. `on` receives it on ctx;
// `off`/`status` are called with a bare {} from several call sites, so fall
// back to the process-wide resolution rather than assuming ctx is populated.
function activeEnvName(ctx) {
  return (ctx && ctx.env && ctx.env.name) || harness.envName();
}

// ── Claude Code IDE extension wiring ────────────────────────────────────────
// In addition to the CLI config (~/.claude/settings.json), we detect the
// Anthropic Claude Code extension in installed VS Code-family editors and wire
// the editor's settings.json `claudeCode.*` block. The extension reads these —
// notably `claudeCode.environmentVariables`, which the extension injects into
// the model process. This mirrors the hand-tuned config users maintain.
//
// Each editor's settings.json is snapshot/restored independently so `off`
// returns it byte-for-byte.
const CLAUDE_EXT_PREFIX = "anthropic.claude-code";

// The env vars NeoSmith owns inside claudeCode.environmentVariables. Anything
// else in that array is the user's and must survive `on` untouched (issue #15).
function neosmithEditorEnvVars(key, tierMap) {
  const envVars = [
    { name: "ANTHROPIC_BASE_URL", value: harness.ROUTER_URL },
    { name: "ANTHROPIC_API_KEY", value: key },
    { name: "CLAUDE_CODE_USE_BEDROCK", value: "0" },
    { name: "CLAUDE_CODE_USE_VERTEX", value: "0" },
  ];
  for (const t of Object.keys(tierMap)) {
    const e = tierMap[t];
    envVars.push({ name: `ANTHROPIC_DEFAULT_${e.slot}_MODEL`, value: e.model });
    envVars.push({ name: `ANTHROPIC_DEFAULT_${e.slot}_MODEL_NAME`, value: e.name });
    envVars.push({ name: `ANTHROPIC_DEFAULT_${e.slot}_MODEL_DESCRIPTION`, value: e.description });
  }
  return envVars;
}

// Merge BY NAME. The previous implementation replaced the whole array, which
// silently dropped every user-defined variable in it (issue #15). User entries
// keep their position; NeoSmith-owned names are overwritten in place, and the
// ones that weren't there yet are appended.
function mergeEditorEnvVars(existingVars, neoVars) {
  const merged = Array.isArray(existingVars)
    ? existingVars.filter((e) => e && typeof e === "object").map((e) => ({ ...e }))
    : [];
  for (const neo of neoVars) {
    const at = merged.findIndex((e) => e.name === neo.name);
    if (at >= 0) merged[at] = { ...merged[at], ...neo };
    else merged.push({ ...neo });
  }
  return merged;
}

// Build the claudeCode.* keys for one editor, from the same tier map + key that
// we write into ~/.claude/settings.json, merged over what's already there.
function claudeCodeEditorSettings(key, tierMap, existing) {
  return {
    "claudeCode.preferredLocation": "panel",
    "claudeCode.disableLoginPrompt": true,
    "claudeCode.environmentVariables": mergeEditorEnvVars(
      (existing || {})["claudeCode.environmentVariables"],
      neosmithEditorEnvVars(key, tierMap),
    ),
  };
}

const ENV_VARS_KEY = "claudeCode.environmentVariables";

function claudeCodeEditorKeys() {
  return [
    "claudeCode.preferredLocation",
    "claudeCode.disableLoginPrompt",
    ENV_VARS_KEY,
  ];
}

// The names — not the values — NeoSmith owns inside the editor env array.
function neosmithEditorEnvNames(tierMap) {
  return new Set(neosmithEditorEnvVars("", tierMap).map((e) => e.name));
}

// The inverse of mergeEditorEnvVars, applied ELEMENT-WISE.
//
// The ledger holds the whole pre-connect array, and setting it back wholesale
// would drop every variable the user added to the array while connected — the
// same clobber issue #15 fixed on the way in, now on the way out (issue #22).
// So each entry is judged by name:
//
//   name NeoSmith owns, present pre-connect → the user's own value comes back
//   name NeoSmith owns, not present before  → NeoSmith introduced it; drop it
//   anything else                           → left exactly where it is
function unmergeEditorEnvVars(liveVars, priorVars, neoNames) {
  const prior = new Map(
    (Array.isArray(priorVars) ? priorVars : [])
      .filter((e) => e && typeof e === "object")
      .map((e) => [e.name, e]),
  );
  const out = [];
  for (const entry of Array.isArray(liveVars) ? liveVars : []) {
    if (!entry || typeof entry !== "object" || !neoNames.has(entry.name)) {
      out.push(entry);
      continue;
    }
    if (prior.has(entry.name)) out.push({ ...prior.get(entry.name) });
  }
  return out;
}

// Replay an editor ledger, handing the env array to unmergeEditorEnvVars
// instead of letting applyRestore overwrite it as one opaque value.
function unmergeEditorSettings(cfg, ledger, tierMap) {
  const scalarEntries = [];
  let envEntry = null;
  for (const e of ledger) {
    if (e.pointer.length === 1 && e.pointer[0] === ENV_VARS_KEY) envEntry = e;
    else scalarEntries.push(e);
  }
  io.applyRestore(cfg, scalarEntries);

  if (!envEntry) return cfg;
  const priorVars = envEntry.prior === io.ABSENT ? [] : envEntry.prior;
  const kept = unmergeEditorEnvVars(cfg[ENV_VARS_KEY], priorVars, neosmithEditorEnvNames(tierMap));
  // An array NeoSmith created and the user never added to goes away entirely;
  // one that still holds their variables stays.
  if (kept.length) cfg[ENV_VARS_KEY] = kept;
  else delete cfg[ENV_VARS_KEY];
  return cfg;
}

const EDITORS = ["vscode", "cursor"];

// Per-OS location of a VS Code-family editor's user settings.json.
//
// Single source of truth: detectEditorsWithClaudeExt, unwireAllEditors and the
// smoke rehearsal all resolve through here. They used to carry three separate
// copies of this switch, and the smoke copy was Windows-only — so on Linux and
// macOS the rehearsal seeded a file the CLI never touched, and its "restored
// byte-for-byte" check passed because nothing had been written.
function editorSettingsPath(editor) {
  const dirName = editor === "vscode" ? "Code" : "Cursor";
  if (process.platform === "darwin") {
    return path.join(io.HOME, "Library", "Application Support", dirName, "User", "settings.json");
  }
  if (process.platform === "win32") {
    const roaming = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(roaming, dirName, "User", "settings.json");
  }
  return path.join(io.HOME, ".config", dirName, "User", "settings.json");
}

// Discover installed VS Code-family editors that have the Claude Code
// extension. Returns [{ editor, settingsPath }]. Detection is by the extension
// dir under ~/.<editor>/extensions/anthropic.claude-code-*.
function detectEditorsWithClaudeExt() {
  const found = [];
  for (const editor of EDITORS) {
    const extRoot = path.join(io.HOME, `.${editor}`, "extensions");
    let present = false;
    try {
      present = fs.readdirSync(extRoot).some((n) => n.toLowerCase().startsWith(CLAUDE_EXT_PREFIX));
    } catch { /* no extensions dir → editor not installed */ }
    if (present) found.push({ editor, settingsPath: editorSettingsPath(editor) });
  }
  return found;
}

// Write the claudeCode.* block into one editor's settings.json (snapshot +
// ledger first). Re-running `on` is safe: the snapshot and the ledger are both
// write-once, so the pre-connect baseline survives while the key/model refresh.
function wireEditor(editor, settingsPath, key, tierMap) {
  const id = `claude-ext-${editor}`;
  io.ensureDir(path.dirname(settingsPath));
  const existing = io.readJSON(settingsPath) || {};
  const already = editorWiredEnv(existing) !== null;
  io.snapshot(id, settingsPath);
  io.recordRestore(id, settingsPath, io.planRestore(existing, claudeCodeEditorKeys().map((k) => [k])));
  const next = { ...existing, ...claudeCodeEditorSettings(key, tierMap, existing) };
  io.writeJSON(settingsPath, next, 0o600);
  // Stamp the file as we left it, so `off` can tell a settings.json the user
  // has since edited from one nobody touched (issue #22). Re-stamped on every
  // `on` — unlike the snapshot and the ledger, this is not write-once.
  io.recordFingerprint(id, settingsPath);
  return { editor, wrote: true, refreshed: !!already, settingsPath };
}

// Undo one editor's claudeCode.* block.
//
// Untouched since `on` → restore the snapshot byte-for-byte. Edited while
// connected → keep the user's file and remove only what NeoSmith put in it,
// down to individual entries in the environmentVariables array (issue #22).
function unwireEditor(editor, settingsPath, tierMap) {
  const id = `claude-ext-${editor}`;
  if (!io.fileExists(settingsPath)) {
    preserve.finish(id, settingsPath);
    return { editor, ok: true, missing: true };
  }

  if (preserve.disposition(id, settingsPath) === "snapshot") {
    io.restoreSnapshot(id, settingsPath);
    preserve.finish(id, settingsPath);
    return { editor, ok: true, mode: "snapshot" };
  }

  const cfg = io.readJSON(settingsPath) || {};
  const pointers = claudeCodeEditorKeys().map((k) => [k]);
  const ledger = preserve.ledgerFor(id, settingsPath, pointers, JSON.parse);
  if (ledger) unmergeEditorSettings(cfg, ledger, tierMap || {});
  else for (const k of claudeCodeEditorKeys()) delete cfg[k];
  io.writeJSON(settingsPath, cfg, 0o600);
  preserve.finish(id, settingsPath);
  return { editor, ok: true, mode: "merge", partial: !ledger };
}

// Which NeoSmith environment is ~/.claude/settings.json wired to, if any?
// Returns an environment name ("prod" / "staging" / …) or null.
//
// Ownership is matched against EVERY known environment, not just the active
// one: `--env staging claude on` followed by a plain `neosmith claude off`
// must still find and remove the staging wiring, or the user is left silently
// pointed at staging believing they disconnected.
function wiredEnvOf(s) {
  const base = s && s.env && s.env.ANTHROPIC_BASE_URL;
  return typeof base === "string" ? harness.envForUrl(base) : null;
}

function hasNeoSmith(s) {
  // Detection keys on the router URL or the canonical NeoSmith auth-token env
  // var. We no longer sniff the prefix of ANTHROPIC_API_KEY: the router is
  // the authority on key validity, and `on` rewrites the entry anyway, so
  // refusing on shape alone was noise.
  return !!(s && s.env && (
    wiredEnvOf(s) !== null ||
    typeof s.env.ANTHROPIC_AUTH_TOKEN === "string"
  ));
}

function on(ctx) {
  const model = ctx.model;
  const key = ctx.key;

  io.ensureDir(path.dirname(CONFIG));
  const existing = io.readJSON(CONFIG) || {};
  if (!existing || typeof existing !== "object") {
    ui.warn(`Existing ${CONFIG} was not valid JSON — backing up as-is and starting clean.`);
    io.writeText(CONFIG + ".corrupt", JSON.stringify(existing), 0o600).catch?.(() => {});
  }

  const wiredEnv = wiredEnvOf(existing);
  const active = activeEnvName(ctx);

  // Re-pointing a harness from one environment to another is not a no-op:
  // io.snapshot and io.recordRestore are both write-once, so a second `on`
  // would overwrite the live wiring while the snapshot still holds the
  // *pre-NeoSmith* baseline — after which `off` restores neither environment
  // deterministically. Refuse unless the user is explicit.
  if (wiredEnv && wiredEnv !== active && !ctx.force) {
    ui.die(
      `Claude Code is already connected to NeoSmith ${wiredEnv} (${existing.env.ANTHROPIC_BASE_URL}).\n` +
      `  Run \`neosmith claude off\` first, then \`neosmith --env ${active} claude on\`.\n` +
      `  Or pass --force to re-point it, abandoning the ${wiredEnv} wiring.`,
    );
  }

  if (hasNeoSmith(existing) && (!wiredEnv || wiredEnv === active)) {
    ui.warn(`${CONFIG} already points at NeoSmith (${wiredEnv || active}).`);
    return { alreadyOn: true, env: wiredEnv || active };
  } else if (existing.env && (existing.env.ANTHROPIC_API_KEY || existing.env.ANTHROPIC_BASE_URL || existing.env.ANTHROPIC_AUTH_TOKEN)) {
    ui.log(ui.c("dim", `Backing up pre-connect config → ~/.claude/settings.json.neosmith-snapshot`));
    io.snapshot("claude", CONFIG);
  } else {
    // No prior Anthropic config — record a tombstone so `off` knows to delete.
    io.snapshot("claude", CONFIG);
  }

  const tierMap = (harness.manifest() || {}).claudeTierMap || {};

  // Ledger the prior value of every key we're about to write, so `off` can put
  // the user's own values back even if the snapshot is gone (issue #15).
  io.recordRestore("claude", CONFIG, io.planRestore(existing, writtenPointers(tierMap)));

  const next = { ...existing };
  next.env = { ...(existing.env || {}) };
  next.env.ANTHROPIC_BASE_URL = harness.ROUTER_URL;
  next.env.ANTHROPIC_AUTH_TOKEN = key;     // canonical NeoSmith var per developer-guide
  next.env.ANTHROPIC_MODEL = model;       // neosmith.intelligent-pro by default

  // Full per-tier model ladder + branded display names/descriptions, so the
  // /model picker and status lines show NeoSmith SKUs instead of Anthropic ids.
  for (const t of Object.keys(tierMap)) {
    const entry = tierMap[t];
    const slot = entry.slot;
    next.env[`ANTHROPIC_DEFAULT_${slot}_MODEL`] = entry.model;
    next.env[`ANTHROPIC_DEFAULT_${slot}_MODEL_NAME`] = entry.name;
    next.env[`ANTHROPIC_DEFAULT_${slot}_MODEL_DESCRIPTION`] = entry.description;
  }

  // Top-level defaults. `model` follows the requested --model tier (mapped to
  // the picker slot name); advisorModel defaults to opus.
  next.model = slotNameForModel(model, tierMap) || "opus";
  if (!next.advisorModel) next.advisorModel = "opus";

  io.writeJSON(CONFIG, next, 0o600);
  io.recordFingerprint("claude", CONFIG);
  ui.ok(`Wrote ${CONFIG}`);
  printManagedKeysNote(tierMap);

  // ── IDE extension wiring ────────────────────────────────────────────────
  // Detect the Claude Code extension in installed editors and write the
  // claudeCode.* block (incl. environmentVariables) into that editor's
  // settings.json so the extension's model process picks up NeoSmith too.
  const editors = detectEditorsWithClaudeExt();
  const wiredEditors = [];
  if (editors.length === 0) {
    ui.log(ui.c("dim", "No Claude Code IDE extension detected in VS Code/Cursor — only the CLI was configured."));
  } else {
    for (const ed of editors) {
      const r = wireEditor(ed.editor, ed.settingsPath, key, tierMap);
      if (r.alreadyOn) {
        ui.log(ui.c("dim", `${ed.editor} settings.json already points at NeoSmith (claudeCode.* present).`));
      } else if (r.wrote) {
        wiredEditors.push(ed.editor);
        ui.ok(`Wired Claude Code extension in ${ed.editor} → ${ed.settingsPath}`);
      }
    }
    if (wiredEditors.length) {
      ui.log(ui.c("dim", `Reload the ${wiredEditors.join("/")} window (or fully restart) for the extension to pick up NeoSmith.`));
    }
  }

  return { wrote: true, editors: wiredEditors };
}

// settings.json is strict JSON, so the "these keys are ours" marker cannot live
// in the file as a comment the way it does in codex's TOML. It is printed here
// instead: the contract is worth stating once, in the place where the user is
// looking at what just changed (issue #22).
function printManagedKeysNote(tierMap) {
  const slots = Object.keys(tierMap).map((t) => tierMap[t].slot);
  ui.log("");
  ui.log(ui.c("dim", `NeoSmith manages these keys in ~/.claude/settings.json — treat them as ours:`));
  ui.log(ui.c("dim", `  env.ANTHROPIC_BASE_URL, env.ANTHROPIC_AUTH_TOKEN, env.ANTHROPIC_MODEL`));
  if (slots.length) {
    ui.log(ui.c("dim", `  env.ANTHROPIC_DEFAULT_{${slots.join(",")}}_MODEL(+_NAME/_DESCRIPTION)`));
  }
  ui.log(ui.c("dim", `  model, advisorModel`));
  ui.log(ui.c("dim", `\`neosmith claude off\` puts those back the way it found them. Anything else`));
  ui.log(ui.c("dim", `you add or change in this file while connected is kept.`));
  ui.log("");
}

// Map a resolved NeoSmith SKU (e.g. neosmith.intelligent-pro) back to the
// picker slot name (opus/sonnet/haiku/fable) using the tier map.
function slotNameForModel(model, tierMap) {
  for (const slotName of Object.keys(tierMap)) {
    if (tierMap[slotName].model === model) return slotName;
  }
  return null;
}

// Env keys that on() writes, used by off()'s fallback strip.
//
// ANTHROPIC_API_KEY is deliberately NOT here: on() never writes it into
// ~/.claude/settings.json (it writes ANTHROPIC_AUTH_TOKEN), so stripping it
// deleted a key that could only ever have been the user's own (issue #15).
function neoEnvKeys(tierMap) {
  const keys = [
    "ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_MODEL",
  ];
  for (const t of Object.keys(tierMap)) {
    const slot = tierMap[t].slot;
    keys.push(
      `ANTHROPIC_DEFAULT_${slot}_MODEL`,
      `ANTHROPIC_DEFAULT_${slot}_MODEL_NAME`,
      `ANTHROPIC_DEFAULT_${slot}_MODEL_DESCRIPTION`,
    );
  }
  return keys;
}

// Every pointer on() writes into settings.json, for the ledger.
function writtenPointers(tierMap) {
  return [
    ...neoEnvKeys(tierMap).map((k) => ["env", k]),
    ["model"],
    ["advisorModel"],
  ];
}

function off(ctx) {
  const tierMap = (harness.manifest() || {}).claudeTierMap || {};

  if (!io.fileExists(CONFIG)) {
    preserve.finish("claude", CONFIG);
    ui.log(`${CONFIG} not present — nothing to disconnect.`);
    return { ok: true, editors: unwireAllEditors(tierMap) };
  }

  // Nobody touched settings.json since `on` wrote it, and we still hold the
  // pre-connect bytes — put them back exactly, comments/order/formatting and all.
  if (preserve.disposition("claude", CONFIG) === "snapshot") {
    io.restoreSnapshot("claude", CONFIG);
    preserve.finish("claude", CONFIG);
    ui.ok(`Restored pre-NeoSmith ${CONFIG} from snapshot.`);
    return { ok: true, mode: "snapshot", editors: unwireAllEditors(tierMap) };
  }

  // The file changed after `on` wrote it — a hook, a permission, an MCP server,
  // an env var of the user's own. Restoring the snapshot here would delete all
  // of it (issue #22), so keep their file and take back only our own keys.
  const cfg = io.readJSON(CONFIG) || {};
  const ledger = preserve.ledgerFor("claude", CONFIG, writtenPointers(tierMap), JSON.parse);
  if (ledger) {
    io.applyRestore(cfg, ledger);
  } else {
    // Neither ledger nor snapshot to derive one from. Strip the keys we know we
    // write; a value of the user's that NeoSmith overwrote can't be recovered.
    const env = cfg.env || {};
    for (const k of neoEnvKeys(tierMap)) delete env[k];
    if (Object.keys(env).length === 0) delete cfg.env;
    else cfg.env = env;
    // Strip the top-level defaults only if they point at a NeoSmith tier slot.
    if (typeof cfg.model === "string" && Object.prototype.hasOwnProperty.call(tierMap, cfg.model)) delete cfg.model;
    if (typeof cfg.advisorModel === "string" && Object.prototype.hasOwnProperty.call(tierMap, cfg.advisorModel)) delete cfg.advisorModel;
  }
  io.writeJSON(CONFIG, cfg, 0o600);
  preserve.finish("claude", CONFIG);
  ui.ok(ledger
    ? `Removed the NeoSmith keys from ${CONFIG} — the settings you changed while connected are still there.`
    : `Removed NeoSmith keys from ${CONFIG} (no pre-connect snapshot or ledger was available).`);
  return { ok: true, mode: "merge", partial: !ledger, editors: unwireAllEditors(tierMap) };
}

// Restore every editor we may have wired (whether or not the extension is still
// installed — a stale snapshot is still restored).
function unwireAllEditors(tierMap) {
  const map = tierMap || (harness.manifest() || {}).claudeTierMap || {};
  const done = [];
  for (const editor of EDITORS) {
    const settingsPath = editorSettingsPath(editor);
    // Only act if we actually wired this editor (a snapshot or a restore
    // ledger exists) — otherwise leave a hand-configured editor untouched.
    const id = `claude-ext-${editor}`;
    if (io.hasSnapshot(id) || io.readRestore(id, settingsPath) ||
        (io.fileExists(settingsPath) && editorWiredToNeo(settingsPath))) {
      const r = unwireEditor(editor, settingsPath, map);
      done.push(editor);
      ui.ok(r.mode === "merge"
        ? `Removed claudeCode.* from ${editor} settings.json — your own edits are still there.`
        : `Restored ${editor} settings.json (claudeCode.* removed).`);
    }
  }
  return done;
}

// Which environment is this editor's claudeCode.environmentVariables block
// wired to? Reads the ANTHROPIC_BASE_URL entry by name rather than
// stringifying the whole array and substring-matching it — the old form also
// matched a user's own unrelated value that happened to contain the host.
function editorWiredEnv(cfg) {
  const ev = (cfg || {})["claudeCode.environmentVariables"];
  if (!Array.isArray(ev)) return null;
  const entry = ev.find((e) => e && e.name === "ANTHROPIC_BASE_URL");
  return entry && typeof entry.value === "string" ? harness.envForUrl(entry.value) : null;
}

function editorWiredToNeo(settingsPath) {
  return editorWiredEnv(io.readJSON(settingsPath) || {}) !== null;
}

function status(ctx) {
  const cfg = io.fileExists(CONFIG) ? io.readJSON(CONFIG) : null;
  const env = (cfg && cfg.env) || {};
  const neosmith = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || env.ANTHROPIC_BASE_URL;
  const wiredEnv = harness.envForUrl(env.ANTHROPIC_BASE_URL || "");
  const cliOn = !!(cfg && neosmith && wiredEnv);

  // Which editors have the extension wired to NeoSmith?
  const editors = detectEditorsWithClaudeExt();
  const wiredEditors = editors.filter((e) => editorWiredToNeo(e.settingsPath)).map((e) => e.editor);
  const extNote = editors.length === 0
    ? "no Claude Code IDE extension detected"
    : (wiredEditors.length ? `ext wired: ${wiredEditors.join(",")}` : `ext detected (${editors.map((e) => e.editor).join(",")}) but not wired`);

  if (!cfg) return { on: false, detail: `${CONFIG} does not exist · ${extNote}` };
  if (!neosmith) return { on: false, detail: `no Anthropic env keys present · ${extNote}` };
  return {
    on: cliOn,
    env: wiredEnv,
    detail: cliOn
      ? `model=${env.ANTHROPIC_MODEL || "(unset)"} base=${env.ANTHROPIC_BASE_URL} · ${extNote}`
      : `pointing at non-NeoSmith backend: ${env.ANTHROPIC_BASE_URL || "(base unset)"} · ${extNote}`,
  };
}

function help() {
  return [
    `Claude Code — Anthropic Messages API.`,
    `Wires: ~/.claude/settings.json (merges, never clobbers your hooks / permissions / MCP).`,
    `  • connection vars (ANTHROPIC_BASE_URL / AUTH_TOKEN / MODEL)`,
    `  • branded per-tier ladder (ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU,FABLE}_*)`,
    `  • top-level model / advisorModel`,
    `Also auto-detects the Claude Code IDE extension (VS Code / Cursor) and wires`,
    `the editor's settings.json claudeCode.* block so the extension uses NeoSmith too.`,
    `Key storage: ANTHROPIC_AUTH_TOKEN in settings.json (mode 0600).`,
    ``,
    `Edits you make while connected are kept: \`off\` restores the pre-connect file`,
    `byte-for-byte only if nothing has changed since \`on\`. If you have edited it,`,
    `\`off\` keeps your file and takes back only the keys NeoSmith owns (the`,
    `ANTHROPIC_* connection vars, the tier ladder, model / advisorModel).`,
    ``,
    `Examples:`,
    `  neosmith claude on`,
    `  neosmith claude on --model neosmith.intelligent-maestro`,
    `  neosmith claude off        # restores CLI + editor configs, keeping edits you made while on`,
    `  neosmith claude status`,
  ].join("\n");
}

// Which key Claude Code is holding, for `neosmith keys`. `on` writes the key
// into env.ANTHROPIC_AUTH_TOKEN (the canonical NeoSmith var per the developer
// guide), so that is the one slot to read — not ANTHROPIC_API_KEY, which may
// hold a first-party Anthropic key the user owns.
function keyRef() {
  if (!io.fileExists(CONFIG)) return null;
  const cfg = io.readJSON(CONFIG) || {};
  const value = cfg.env && cfg.env.ANTHROPIC_AUTH_TOKEN;
  if (typeof value !== "string" || !value) return null;
  return { kind: "literal", value, file: CONFIG };
}

module.exports = {
  id: "claude",
  name: "Claude Code",
  writable: true,
  configFile: CONFIG,
  on, off, status, help, keyRef,
  // Exposed so the smoke rehearsal targets the same per-OS paths the harness
  // writes to, instead of keeping its own (Windows-only) copy of the logic.
  EDITORS, editorSettingsPath,
};
