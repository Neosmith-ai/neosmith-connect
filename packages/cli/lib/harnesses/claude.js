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
// preserved. `off` restores from the byte-for-byte snapshot taken before `on`.

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const harness = require("../harness");
const io = require("../io");
const ui = require("../ui");

const CONFIG = path.join(io.HOME, ".claude", "settings.json");

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

function claudeCodeEditorKeys() {
  return [
    "claudeCode.preferredLocation",
    "claudeCode.disableLoginPrompt",
    "claudeCode.environmentVariables",
  ];
}

// Discover installed VS Code-family editors that have the Claude Code
// extension. Returns [{ editor, settingsPath }]. Detection is by the extension
// dir under ~/.<editor>/extensions/anthropic.claude-code-*.
function detectEditorsWithClaudeExt() {
  const home = io.HOME;
  const roaming = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  const candidates = [
    { editor: "vscode", dir: "Code", settingsDir: path.join(roaming, "Code", "User") },
    { editor: "cursor", dir: "Cursor", settingsDir: path.join(roaming, "Cursor", "User") },
  ];
  if (process.platform === "darwin") {
    candidates[0].settingsDir = path.join(home, "Library", "Application Support", "Code", "User");
    candidates[1].settingsDir = path.join(home, "Library", "Application Support", "Cursor", "User");
  } else if (process.platform !== "win32") {
    candidates[0].settingsDir = path.join(home, ".config", "Code", "User");
    candidates[1].settingsDir = path.join(home, ".config", "Cursor", "User");
  }

  const found = [];
  for (const c of candidates) {
    const extRoot = path.join(home, `.${c.editor === "vscode" ? "vscode" : c.editor}`, "extensions");
    let present = false;
    try {
      present = fs.readdirSync(extRoot).some((n) => n.toLowerCase().startsWith(CLAUDE_EXT_PREFIX));
    } catch { /* no extensions dir → editor not installed */ }
    if (present) found.push({ editor: c.editor, settingsPath: path.join(c.settingsDir, "settings.json") });
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
  const already = existing["claudeCode.environmentVariables"] &&
    JSON.stringify(existing["claudeCode.environmentVariables"]).includes("router.neosmith.ai");
  io.snapshot(id, settingsPath);
  io.recordRestore(id, settingsPath, io.planRestore(existing, claudeCodeEditorKeys().map((k) => [k])));
  const next = { ...existing, ...claudeCodeEditorSettings(key, tierMap, existing) };
  io.writeJSON(settingsPath, next, 0o600);
  return { editor, wrote: true, refreshed: !!already, settingsPath };
}

// Undo one editor's claudeCode.* block (restore snapshot, else replay the
// ledger, else strip the keys we know we write).
function unwireEditor(editor, settingsPath) {
  const id = `claude-ext-${editor}`;
  if (!io.fileExists(settingsPath)) {
    io.clearSnapshot(id);
    io.clearRestore(id);
    return { editor, ok: true, missing: true };
  }
  const restored = io.restoreSnapshot(id, settingsPath);
  if (!restored) {
    const cfg = io.readJSON(settingsPath) || {};
    const ledger = io.readRestore(id, settingsPath);
    if (ledger) io.applyRestore(cfg, ledger);
    else for (const k of claudeCodeEditorKeys()) delete cfg[k];
    io.writeJSON(settingsPath, cfg, 0o600);
    io.clearRestore(id);
    return { editor, ok: true, partial: true };
  }
  io.clearRestore(id);
  return { editor, ok: true };
}

function hasNeoSmith(s) {
  // Detection keys on the router URL or the canonical NeoSmith auth-token env
  // var. We no longer sniff the prefix of ANTHROPIC_API_KEY: the router is
  // the authority on key validity, and `on` rewrites the entry anyway, so
  // refusing on shape alone was noise.
  return s && s.env && (
    (typeof s.env.ANTHROPIC_BASE_URL === "string" && s.env.ANTHROPIC_BASE_URL.includes("router.neosmith.ai")) ||
    (typeof s.env.ANTHROPIC_AUTH_TOKEN === "string")
  );
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

  if (hasNeoSmith(existing)) {
    ui.warn(`${CONFIG} already points at NeoSmith.`);
    return { alreadyOn: true };
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
  ui.ok(`Wrote ${CONFIG}`);

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
  if (!io.fileExists(CONFIG)) {
    io.clearSnapshot("claude");
    io.clearRestore("claude");
    ui.log(`${CONFIG} not present — nothing to disconnect.`);
    const unwired = unwireAllEditors();
    return { ok: true, editors: unwired };
  }
  let unwired = [];
  const restored = io.restoreSnapshot("claude", CONFIG);
  if (!restored) {
    // No snapshot — replay the ledger so the user's own values come back.
    const cfg = io.readJSON(CONFIG) || {};
    const tierMap = (harness.manifest() || {}).claudeTierMap || {};
    const ledger = io.readRestore("claude", CONFIG);
    if (ledger) {
      io.applyRestore(cfg, ledger);
    } else {
      // No ledger either (pre-0.8 connect) — strip the keys we know we write.
      const env = cfg.env || {};
      for (const k of neoEnvKeys(tierMap)) delete env[k];
      if (Object.keys(env).length === 0) delete cfg.env;
      else cfg.env = env;
      // Strip the top-level defaults only if they point at a NeoSmith tier slot.
      if (typeof cfg.model === "string" && Object.prototype.hasOwnProperty.call(tierMap, cfg.model)) delete cfg.model;
      if (typeof cfg.advisorModel === "string" && Object.prototype.hasOwnProperty.call(tierMap, cfg.advisorModel)) delete cfg.advisorModel;
    }
    io.writeJSON(CONFIG, cfg, 0o600);
    io.clearRestore("claude");
    ui.ok(`Removed NeoSmith keys from ${CONFIG} (no pre-connect snapshot was available).`);
    unwired = unwireAllEditors();
    return { ok: true, partial: true, editors: unwired };
  }
  io.clearRestore("claude");
  ui.ok(`Restored pre-NeoSmith ${CONFIG} from snapshot.`);
  unwired = unwireAllEditors();
  return { ok: true, editors: unwired };
}

// Restore every editor we may have wired (whether or not the extension is still
// installed — a stale snapshot is still restored).
function unwireAllEditors() {
  const done = [];
  for (const editor of ["vscode", "cursor"]) {
    const roaming = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    let settingsDir;
    if (process.platform === "darwin") settingsDir = path.join(io.HOME, "Library", "Application Support", editor === "vscode" ? "Code" : "Cursor", "User");
    else if (process.platform === "win32") settingsDir = path.join(roaming, editor === "vscode" ? "Code" : "Cursor", "User");
    else settingsDir = path.join(io.HOME, ".config", editor === "vscode" ? "Code" : "Cursor", "User");
    const settingsPath = path.join(settingsDir, "settings.json");
    // Only act if we actually wired this editor (a snapshot or a restore
    // ledger exists) — otherwise leave a hand-configured editor untouched.
    const id = `claude-ext-${editor}`;
    if (io.hasSnapshot(id) || io.readRestore(id, settingsPath) ||
        (io.fileExists(settingsPath) && editorWiredToNeo(settingsPath))) {
      unwireEditor(editor, settingsPath);
      done.push(editor);
      ui.ok(`Restored ${editor} settings.json (claudeCode.* removed).`);
    }
  }
  return done;
}

function editorWiredToNeo(settingsPath) {
  const cfg = io.readJSON(settingsPath) || {};
  const ev = cfg["claudeCode.environmentVariables"];
  return !!ev && JSON.stringify(ev).includes("router.neosmith.ai");
}

function status(ctx) {
  const cfg = io.fileExists(CONFIG) ? io.readJSON(CONFIG) : null;
  const env = (cfg && cfg.env) || {};
  const neosmith = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || env.ANTHROPIC_BASE_URL;
  const pointingAtNeo = (env.ANTHROPIC_BASE_URL || "").includes("router.neosmith.ai");
  const cliOn = !!(cfg && neosmith && pointingAtNeo);

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
    `Examples:`,
    `  neosmith claude on`,
    `  neosmith claude on --model neosmith.intelligent-maestro`,
    `  neosmith claude off        # restores CLI + editor configs byte-for-byte from snapshots`,
    `  neosmith claude status`,
  ].join("\n");
}

module.exports = {
  id: "claude",
  name: "Claude Code",
  writable: true,
  configFile: CONFIG,
  on, off, status, help,
};
