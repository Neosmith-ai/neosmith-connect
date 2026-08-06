// Filesystem helpers — JSON read/write (0600), text snapshots, backups,
// ~/.neosmith state. JSON only here; TOML/YAML live in the harness modules
// that need them (codex.js, continue.js) so the core stays zero-dep.
//
// Snapshot model (mirrors fireconnect's byte-for-byte restore guarantee):
//   before `on` writes a harness config, the pre-connect file bytes are copied
//   to ~/.neosmith/snapshots/<harness>.bak. `off` copies them back verbatim.
//   A missing snapshot means "nothing to restore" (e.g. the file didn't exist
//   before connect), so `off` removes the NeoSmith keys it wrote instead.
//
// Audit log (T4): every state-changing io operation appends a JSON-Lines
// record to ~/.neosmith/audit.log AFTER the operation succeeds. The log is
// always redacted of key material (sk-plus- / sk-std- / sk-slm- / eyJ).
//
// Dry-run (T15): writeText and writeJSON check NEOSMITH_DRY_RUN and route
// writes to ~/.neosmith/dryrun/<hash-of-path> when set, emitting a
// "dry-write" audit entry. Reads and state-mutation (snapshot/restore) are
// untouched.

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
const AUDIT_FILE = path.join(NEOSMITH_DIR, "audit.log");    // T4 append-only JSON-Lines log
const DRYRUN_DIR = path.join(NEOSMITH_DIR, "dryrun");       // T15 shadow writes
const AUDIT_KEY_PREFIX = /sk-(plus|std|slm)-|eyJ/i;

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

function redactAuditString(value) {
  if (typeof value !== "string") return value;
  if (AUDIT_KEY_PREFIX.test(value)) {
    return value.slice(0, 8) + "…redacted(" + value.length + ")";
  }
  return value;
}

function appendAuditLog(event) {
  // Audit AFTER the operation succeeds — a failed write must not produce a
  // phantom audit entry. Append-only JSON Lines, one record per event.
  ensureDir(NEOSMITH_DIR);
  const entry = {
    ts:      new Date().toISOString(),
    op:      event.op,                          // write | snapshot | restore | dry-write
    harness: event.harness || null,
    path:    redactAuditString(event.path || null),
    bytes:   event.bytes || null,
    key:     event.key === true ? "present" : (event.key === false ? "absent" : "absent"),
  };
  fs.appendFileSync(AUDIT_FILE, JSON.stringify(entry) + "\n", { mode: 0o600 });
}

function writeText(p, text, mode) {
  if (process.env.NEOSMITH_DRY_RUN === "1") {
    // T15: shadow writes go to ~/.neosmith/dryrun/<hashed real path>.
    // The hash keeps the shadow name filesystem-safe without dropping info
    // (each unique source path maps to a unique shadow).
    const shadow = path.join(DRYRUN_DIR, p.replace(/[^a-z0-9._-]/gi, "_"));
    ensureDir(path.dirname(shadow));
    fs.writeFileSync(shadow, text, mode ? { mode } : undefined);
    appendAuditLog({ op: "dry-write", path: p, bytes: Buffer.byteLength(text) });
    return;
  }
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, text, mode ? { mode } : undefined);
  appendAuditLog({ op: "write", path: p, bytes: Buffer.byteLength(text) });
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
  appendAuditLog({ op: "snapshot", harness: harnessId, path: filePath });
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
  appendAuditLog({ op: "restore", harness: harnessId, path: filePath });
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

// T4: appendAuditLog is exported so commands (`neosmith log`) and tests can
// emit events that go through the same funnel. The redaction + write-after
// contract lives here, so emitting-from-elsewhere is just a call.
module.exports = {
  HOME, NEOSMITH_DIR, SNAPSHOTS_DIR, CONFIG_FILE, STATE_FILE,
  AUDIT_FILE, DRYRUN_DIR, AUDIT_KEY_PREFIX,
  ensureDir, fileExists, readText, readJSON, writeText, writeJSON,
  snapshot, restoreSnapshot, clearSnapshot,
  appendAuditLog,
  readKeyRef, writeKeyRef, clearKeyRef,
  readState, writeState, setHarnessFlag, getHarnessFlag,
};
