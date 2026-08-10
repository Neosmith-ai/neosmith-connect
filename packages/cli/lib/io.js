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
// Post-write fingerprint (issue #22): a snapshot restore is byte-for-byte, so
// it also throws away anything the user wrote into the file AFTER `on` — and
// editing your settings while a harness is connected is a completely normal
// thing to do. So `on` stamps the sha256 of the file as it left it, and `off`
// compares: identical → restore the snapshot (formatting, comments and key
// order all come back); different → keep the user's live file and replay the
// ledger over it, taking back only the keys NeoSmith owns.
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
const crypto = require("crypto");

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

// The active environment's name, for the audit record. Requires lib/env.js,
// which requires only lib/manifest.js — io.js never requires lib/harness.js,
// so there is no cycle. Never throws: an unresolvable environment must not
// break a write that already succeeded.
function currentEnvName() {
  try { return require("./env").current().name; } catch { return null; }
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
    // Which router this invocation was pointed at. A prod/staging mixup is
    // exactly the incident you reconstruct from this log, and the field is a
    // name plus a public hostname — it carries no secret.
    env:     event.env || currentEnvName(),
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

// ── ~/.neosmith/config.json — stored key, per environment ───────────────────
//
// Shape (backward compatible):
//   { "api_key": "<default-env key>", "keys": { "prod": "…", "staging": "…" } }
//
// The invariant that matters: a staging key must NEVER land in the slot a prod
// invocation reads. So `keys[<env>]` is authoritative, the legacy top-level
// `api_key` is only ever read for the default environment, and only a
// default-environment write mirrors into it — which is what keeps install.sh
// and older CLI versions (which know only `api_key`) reading the prod key.

function defaultEnvName() {
  // Read the manifest directly. io.js must not require lib/harness.js — every
  // harness module requires it, so that would be a cycle.
  try {
    const m = require("./manifest").read().manifest;
    return m.defaultEnvironment || "prod";
  } catch { return "prod"; }
}

function readKeyRef(envName) {
  const cfg = readJSON(CONFIG_FILE);
  if (!cfg) return null;
  const env = envName || defaultEnvName();
  if (cfg.keys && cfg.keys[env]) return cfg.keys[env];
  // Legacy fallback: a bare {api_key} file predates named environments, so it
  // can only ever have meant the default environment.
  if (env === defaultEnvName() && cfg.api_key) return cfg.api_key;
  return null;
}

function writeKeyRef(apiKey, envName) {
  const env = envName || defaultEnvName();
  const cfg = readJSON(CONFIG_FILE) || {};
  const keys = { ...(cfg.keys || {}) };
  // Migration: an existing bare api_key was the default environment's key.
  if (cfg.api_key && !keys[defaultEnvName()]) keys[defaultEnvName()] = cfg.api_key;
  keys[env] = apiKey;
  const next = { ...cfg, keys };
  if (env === defaultEnvName()) next.api_key = apiKey;
  writeJSON(CONFIG_FILE, next, 0o600);
}

// Remove one environment's key, or the whole file when no environment is named.
function clearKeyRef(envName) {
  if (!fileExists(CONFIG_FILE)) return;
  if (!envName) { fs.unlinkSync(CONFIG_FILE); return; }
  const cfg = readJSON(CONFIG_FILE) || {};
  if (cfg.keys) delete cfg.keys[envName];
  if (envName === defaultEnvName()) delete cfg.api_key;
  const remaining = Object.keys(cfg.keys || {}).length;
  if (!remaining && !cfg.api_key) fs.unlinkSync(CONFIG_FILE);
  else writeJSON(CONFIG_FILE, cfg, 0o600);
}

// Every environment that currently has a key stored.
function storedKeyEnvs() {
  const cfg = readJSON(CONFIG_FILE);
  if (!cfg) return [];
  const names = new Set(Object.keys(cfg.keys || {}));
  if (cfg.api_key) names.add(defaultEnvName());
  return [...names];
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

function isEmptyContainer(v) {
  if (Array.isArray(v)) return v.length === 0;
  return !!v && typeof v === "object" && Object.keys(v).length === 0;
}

// Build ledger entries for the pointers `on` is about to write. Every entry
// records the LEAF and that leaf's prior value, so `off` puts back exactly what
// was there and leaves every sibling alone.
//
// When a pointer's parent block does not exist pre-connect, the shallowest
// missing prefix is recorded separately as `prune` — the container NeoSmith is
// about to create. It used to be recorded as the entry itself, collapsing
// `["env","A"]` down to `["env"] → ABSENT`, which made `off` delete the whole
// block. That is fine on the day you connect and wrong forever after: any var
// the user adds to that block while connected goes with it (issue #22). A
// prune is now conditional — `applyRestore` removes the container only if
// nothing is left in it once the leaves are restored.
function planRestore(obj, pointers) {
  const seen = new Set();
  const entries = [];
  for (const pointer of pointers) {
    const k = JSON.stringify(pointer);
    if (seen.has(k)) continue;
    seen.add(k);
    let prune = null;
    for (let i = 1; i < pointer.length; i++) {
      const prefix = pointer.slice(0, i);
      if (getAt(obj, prefix) === ABSENT) { prune = prefix; break; }
    }
    const entry = { pointer, prior: clonePrior(getAt(obj, pointer)) };
    if (prune) entry.prune = prune;
    entries.push(entry);
  }
  return entries;
}

// Replay a ledger onto a parsed config. Shallow-first so a parent unset can't
// wipe a deeper restore that follows it.
//
// Ledgers written by an older CLI have no `prune` field and may address a
// container directly (`["env"] → ABSENT`); unsetting that pointer is still the
// right move, so both shapes replay through the same loop.
function applyRestore(obj, entries) {
  const sorted = (entries || []).slice().sort((a, b) => a.pointer.length - b.pointer.length);
  for (const e of sorted) {
    if (e.prior === ABSENT) unsetAt(obj, e.pointer);
    else setAt(obj, e.pointer, clonePrior(e.prior));
  }

  // Prune the blocks NeoSmith created — but only the ones left empty. A user
  // who added their own key inside one while connected keeps both the key and
  // the block. Deepest-first, so an inner block is gone before its parent is
  // judged on whether anything remains in it.
  const prunes = [];
  for (const e of sorted) {
    if (!e.prune) continue;
    const k = JSON.stringify(e.prune);
    if (!prunes.some((p) => p.k === k)) prunes.push({ k, pointer: e.prune });
  }
  prunes.sort((a, b) => b.pointer.length - a.pointer.length);
  for (const p of prunes) {
    const node = getAt(obj, p.pointer);
    if (node !== ABSENT && isEmptyContainer(node)) unsetAt(obj, p.pointer);
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

// ── Post-write fingerprint (issue #22) ──────────────────────────────────────
// The sha256 of a config file exactly as `on` left it. This is the only thing
// that can tell `off` apart the two situations it must handle differently:
// a file nobody touched since connecting (restore the snapshot verbatim) and a
// file the user has since edited (keep their edits, remove only our keys).
//
// Unlike the snapshot and the ledger this is deliberately NOT write-once —
// every `on` rewrites the file, so every `on` must re-stamp the hash, or a
// second `on` would leave `off` believing the user had edited the file.
function hashFile(filePath) {
  try {
    return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  } catch { return null; }
}

function recordFingerprint(harnessId, filePath) {
  const digest = hashFile(filePath);
  if (!digest) return null;
  const state = readState();
  state.fingerprints = state.fingerprints || {};
  state.fingerprints[harnessId] = state.fingerprints[harnessId] || {};
  state.fingerprints[harnessId][filePath] = digest;
  writeState(state);
  return digest;
}

function readFingerprint(harnessId, filePath) {
  const state = readState();
  const f = (state.fingerprints && state.fingerprints[harnessId]) || {};
  return f[filePath] || null;
}

function clearFingerprint(harnessId, filePath) {
  const state = readState();
  if (!state.fingerprints || !state.fingerprints[harnessId]) return;
  if (filePath) delete state.fingerprints[harnessId][filePath];
  else delete state.fingerprints[harnessId];
  if (state.fingerprints[harnessId] && !Object.keys(state.fingerprints[harnessId]).length) {
    delete state.fingerprints[harnessId];
  }
  if (!Object.keys(state.fingerprints).length) delete state.fingerprints;
  writeState(state);
}

// Has this file changed since `on` wrote it?
//
// No recorded fingerprint means we cannot know — a connect made by a CLI older
// than this one, which is exactly the long-lived connection most likely to have
// been edited. So "unknown" counts as DRIFTED: the merge path is correct
// whether or not the file was touched, while guessing "untouched" is the
// guess that destroys work.
function fileDrifted(harnessId, filePath) {
  const recorded = readFingerprint(harnessId, filePath);
  if (!recorded) return true;
  const now = hashFile(filePath);
  return now === null || now !== recorded;
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
  readKeyRef, writeKeyRef, clearKeyRef, storedKeyEnvs,
  readState, writeState, setHarnessFlag, getHarnessFlag,
  // Restore ledger (issue #15)
  ABSENT, getAt, setAt, unsetAt, planRestore, applyRestore,
  recordRestore, readRestore, clearRestore,
  // Post-write fingerprint (issue #22)
  hashFile, recordFingerprint, readFingerprint, clearFingerprint, fileDrifted,
};
