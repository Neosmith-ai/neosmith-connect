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
//   Snapshots are WRITE-ONCE (issue #15): once a .bak exists it is the
//   pre-connect baseline and a second `on` must not overwrite it with the
//   already-NeoSmith config. `restoreSnapshot` unlinks the .bak, so the next
//   `on` after an `off` correctly takes a fresh baseline.
//
// Restore ledger (issue #15): `on` also records, per harness and per file,
// every key it is about to touch together with that key's PRIOR value (or the
// ABSENT sentinel). `off` replays the ledger when the .bak is unavailable, so
// user-defined values are put back and only NeoSmith-introduced keys are
// deleted. Lives under ~/.neosmith/state.json (mode 0600) — prior values can
// contain the user's own API keys, so it never reaches the audit log.
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

function snapshotPath(harnessId) {
  return path.join(SNAPSHOTS_DIR, `${harnessId}.bak`);
}

function hasSnapshot(harnessId) {
  return fileExists(snapshotPath(harnessId));
}

// Byte-for-byte snapshot of a file's current contents (or a tombstone marker
// if the file does not yet exist, so `off` knows to delete rather than restore).
//
// WRITE-ONCE: an existing .bak is the pre-connect baseline. Overwriting it on a
// second `on` is how issue #15 lost user configs — codex/continue snapshot on
// every call, so the second run captured the already-NeoSmith file and `off`
// then "restored" that.
function snapshot(harnessId, filePath) {
  ensureDir(SNAPSHOTS_DIR);
  const bak = snapshotPath(harnessId);
  if (fileExists(bak)) {
    appendAuditLog({ op: "snapshot-skip", harness: harnessId, path: filePath });
    return bak;
  }
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
  const bak = snapshotPath(harnessId);
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
  const bak = snapshotPath(harnessId);
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

// ── Restore ledger (issue #15) ──────────────────────────────────────────────
// A pointer is an ARRAY of key segments, not a dotted string — editor settings
// use literal dotted keys ("claudeCode.environmentVariables"), so splitting on
// "." would address the wrong node. ABSENT marks "this key did not exist
// pre-connect", which is what tells `off` to delete rather than restore.
const ABSENT = "__neosmith_absent__";

function getAt(obj, pointer) {
  let cur = obj;
  for (const seg of pointer) {
    if (!cur || typeof cur !== "object" || !Object.prototype.hasOwnProperty.call(cur, seg)) return ABSENT;
    cur = cur[seg];
  }
  return cur;
}

function setAt(obj, pointer, value) {
  let cur = obj;
  for (let i = 0; i < pointer.length - 1; i++) {
    const seg = pointer[i];
    if (!cur[seg] || typeof cur[seg] !== "object") cur[seg] = {};
    cur = cur[seg];
  }
  cur[pointer[pointer.length - 1]] = value;
}

function unsetAt(obj, pointer) {
  let cur = obj;
  for (let i = 0; i < pointer.length - 1; i++) {
    const seg = pointer[i];
    if (!cur || typeof cur !== "object" || !Object.prototype.hasOwnProperty.call(cur, seg)) return;
    cur = cur[seg];
  }
  if (cur && typeof cur === "object") delete cur[pointer[pointer.length - 1]];
}

function clonePrior(v) {
  if (v === ABSENT || v === null || typeof v !== "object") return v;
  return JSON.parse(JSON.stringify(v));
}

// Build ledger entries for the pointers `on` is about to write. Each pointer is
// collapsed to the SHALLOWEST prefix that does not exist yet: if `env` is
// absent pre-connect, recording `["env"] → ABSENT` removes the whole block on
// `off`, which also prunes the container NeoSmith created. Otherwise the leaf
// itself is recorded so sibling user keys are never touched.
function planRestore(obj, pointers) {
  const seen = new Set();
  const entries = [];
  for (const pointer of pointers) {
    let recorded = pointer;
    for (let i = 1; i <= pointer.length; i++) {
      const prefix = pointer.slice(0, i);
      if (getAt(obj, prefix) === ABSENT) { recorded = prefix; break; }
    }
    const k = JSON.stringify(recorded);
    if (seen.has(k)) continue;
    seen.add(k);
    entries.push({ pointer: recorded, prior: clonePrior(getAt(obj, recorded)) });
  }
  return entries;
}

// Replay a ledger onto a parsed config. Shallow-first so a parent unset can't
// wipe a deeper restore that follows it.
function applyRestore(obj, entries) {
  const sorted = (entries || []).slice().sort((a, b) => a.pointer.length - b.pointer.length);
  for (const e of sorted) {
    if (e.prior === ABSENT) unsetAt(obj, e.pointer);
    else setAt(obj, e.pointer, clonePrior(e.prior));
  }
  return obj;
}

// WRITE-ONCE, for the same reason snapshots are: a second `on` would otherwise
// record the already-NeoSmith values as the "prior" state.
function recordRestore(harnessId, filePath, entries) {
  const state = readState();
  state.restore = state.restore || {};
  state.restore[harnessId] = state.restore[harnessId] || {};
  if (state.restore[harnessId][filePath]) return false;
  state.restore[harnessId][filePath] = entries;
  writeState(state);
  return true;
}

function readRestore(harnessId, filePath) {
  const state = readState();
  const led = (state.restore && state.restore[harnessId]) || {};
  return filePath ? (led[filePath] || null) : led;
}

function clearRestore(harnessId) {
  const state = readState();
  if (!state.restore || !state.restore[harnessId]) return;
  delete state.restore[harnessId];
  if (!Object.keys(state.restore).length) delete state.restore;
  writeState(state);
}

// T4: appendAuditLog is exported so commands (`neosmith log`) and tests can
// emit events that go through the same funnel. The redaction + write-after
// contract lives here, so emitting-from-elsewhere is just a call.
module.exports = {
  HOME, NEOSMITH_DIR, SNAPSHOTS_DIR, CONFIG_FILE, STATE_FILE,
  AUDIT_FILE, DRYRUN_DIR, AUDIT_KEY_PREFIX,
  ensureDir, fileExists, readText, readJSON, writeText, writeJSON,
  snapshot, restoreSnapshot, clearSnapshot, snapshotPath, hasSnapshot,
  appendAuditLog,
  readKeyRef, writeKeyRef, clearKeyRef,
  readState, writeState, setHarnessFlag, getHarnessFlag,
  // Restore ledger (issue #15)
  ABSENT, getAt, setAt, unsetAt, planRestore, applyRestore,
  recordRestore, readRestore, clearRestore,
};
