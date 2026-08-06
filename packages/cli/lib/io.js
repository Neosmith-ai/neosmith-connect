// Filesystem helpers — JSON read/write (0600), text snapshots, backups,
// ~/.neosmith state. JSON only here; TOML/YAML live in the harness modules
// that need them (codex.js, continue.js) so the core stays zero-dep.
//
// Snapshot model (mirrors fireconnect's byte-for-byte restore guarantee):
//   before `on` writes a harness config, the pre-connect file bytes are copied
//   to ~/.neosmith/snapshots/<harness>.bak. `off` copies them back verbatim.
//   A missing snapshot means "nothing to restore" (e.g. the file didn't exist
//   before connect), so `off` removes the NeoSmith keys it wrote instead.

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

// Resolve HOME honoring the HOME env var first (so sandboxed test HOMEs work),
// then USERPROFILE (Windows), then os.homedir() as a final fallback.
const HOME = process.env.HOME || process.env.USERPROFILE || os.homedir();
const NEOSMITH_DIR = path.join(HOME, ".neosmith");
const SNAPSHOTS_DIR = path.join(NEOSMITH_DIR, "snapshots");
const CONFIG_FILE = path.join(NEOSMITH_DIR, "config.json"); // stored key ref
const STATE_FILE = path.join(NEOSMITH_DIR, "state.json");   // per-harness on/off flags

function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }
function fileExists(p) { try { fs.accessSync(p); return true; } catch { return false; } }

function readText(p) {
  try { return fs.readFileSync(p, "utf8"); }
  catch { return null; }
}

function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return {}; }
}

function writeText(p, text, mode) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, text, mode ? { mode } : undefined);
}

function writeJSON(p, obj, mode) {
  writeText(p, JSON.stringify(obj, null, 2) + "\n", mode || 0o600);
}

// Byte-for-byte snapshot of a file's current contents (or a tombstone marker
// if the file does not yet exist, so `off` knows to delete rather than restore).
function snapshot(harnessId, filePath) {
  ensureDir(SNAPSHOTS_DIR);
  const bak = path.join(SNAPSHOTS_DIR, `${harnessId}.bak`);
  if (fileExists(filePath)) {
    fs.copyFileSync(filePath, bak);
  } else {
    // Tombstone: the file did not exist pre-connect. `off` should delete it.
    fs.writeFileSync(bak, JSON.stringify({ __tombstone: true, path: filePath }), { mode: 0o600 });
  }
  return bak;
}

// Restore from a snapshot. Returns true if a snapshot existed and was applied.
function restoreSnapshot(harnessId, filePath) {
  const bak = path.join(SNAPSHOTS_DIR, `${harnessId}.bak`);
  if (!fileExists(bak)) return false;
  let isTombstone = false;
  try {
    const raw = fs.readFileSync(bak, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && parsed.__tombstone) isTombstone = true;
  } catch { /* binary/real-config file → not a tombstone */ }

  if (isTombstone) {
    if (fileExists(filePath)) fs.unlinkSync(filePath);
  } else {
    ensureDir(path.dirname(filePath));
    fs.copyFileSync(bak, filePath);
    try { fs.chmodSync(filePath, 0o600); } catch { /* best effort */ }
  }
  fs.unlinkSync(bak);
  return true;
}

function clearSnapshot(harnessId) {
  const bak = path.join(SNAPSHOTS_DIR, `${harnessId}.bak`);
  if (fileExists(bak)) fs.unlinkSync(bak);
}

// ── ~/.neosmith/config.json — stored key ────────────────────────────────
function readKeyRef() {
  const cfg = readJSON(CONFIG_FILE);
  return cfg && cfg.api_key ? cfg.api_key : null;
}

function writeKeyRef(apiKey) {
  writeJSON(CONFIG_FILE, { api_key: apiKey }, 0o600);
}

function clearKeyRef() {
  if (fileExists(CONFIG_FILE)) fs.unlinkSync(CONFIG_FILE);
}

// ── ~/.neosmith/state.json — per-harness on/off flags (UI-driven harnesses) ──
function readState() {
  return readJSON(STATE_FILE);
}

function writeState(state) {
  writeJSON(STATE_FILE, state, 0o600);
}

function setHarnessFlag(harnessId, on, meta) {
  const state = readState();
  state.harnesses = state.harnesses || {};
  if (on) state.harnesses[harnessId] = { on: true, ...(meta || {}) };
  else delete state.harnesses[harnessId];
  writeState(state);
}

function getHarnessFlag(harnessId) {
  const state = readState();
  return !!(state.harnesses && state.harnesses[harnessId] && state.harnesses[harnessId].on);
}

module.exports = {
  HOME, NEOSMITH_DIR, SNAPSHOTS_DIR, CONFIG_FILE, STATE_FILE,
  ensureDir, fileExists, readText, readJSON, writeText, writeJSON,
  snapshot, restoreSnapshot, clearSnapshot,
  readKeyRef, writeKeyRef, clearKeyRef,
  readState, writeState, setHarnessFlag, getHarnessFlag,
};
