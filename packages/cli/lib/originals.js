// Where NeoSmith keeps copies of your pre-connect settings.
//
// `on` copies the whole pre-connect file to ~/.neosmith/snapshots/<id>.bak
// before writing anything (see io.js). Until now nothing surfaced that: a user
// who wanted to know "what did this do to my config, and can I get it back"
// had to know to look in the snapshots dir, and then cross-reference
// audit.log to work out which file each .bak came from.
//
// This module is the single place that answers those questions. It is used by
// `neosmith originals`, by `neosmith status`, and by the reset/uninstall
// confirm prompts (both of which can destroy these copies).
//
// A .bak is either a byte-for-byte copy of the pre-connect file, or a
// tombstone — {"__tombstone":true,"path":"…"} — meaning the file did not exist
// before connecting, so `off` will delete it rather than restore anything.

"use strict";

const fs = require("fs");
const path = require("path");

const harness = require("./harness");
const io = require("./io");

// Display paths home-relative: ~/.codex/config.toml reads better than the
// absolute path, and keeps usernames out of pasted terminal output.
function tilde(p) {
  if (!p) return p;
  if (p.startsWith(io.HOME)) return "~" + p.slice(io.HOME.length).replace(/\\/g, "/");
  return p;
}

// Editor-extension snapshots use a compound id (claude-ext-vscode). Split it
// back into the harness it belongs to plus the editor.
function splitId(harnessId) {
  const at = harnessId.indexOf("-ext-");
  if (at === -1) return { baseId: harnessId, editor: null };
  return { baseId: harnessId.slice(0, at), editor: harnessId.slice(at + "-ext-".length) };
}

const EDITOR_NAMES = { vscode: "VS Code", cursor: "Cursor" };

function labelFor(harnessId) {
  const { baseId, editor } = splitId(harnessId);
  let base = baseId;
  try { base = (harness.get(baseId) || {}).name || baseId; } catch { /* registry unavailable */ }
  if (!editor) return base;
  return `${base} · ${EDITOR_NAMES[editor] || editor} extension`;
}

// Most recent snapshot entry for this id in the audit log. This is the
// fallback source-path lookup for connects made before the restore ledger
// existed — the audit log has recorded {op, harness, path} all along.
function sourceFromAuditLog(harnessId) {
  if (!io.fileExists(io.AUDIT_FILE)) return null;
  let lines;
  try { lines = fs.readFileSync(io.AUDIT_FILE, "utf8").split("\n"); }
  catch { return null; }
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i]) continue;
    let e;
    try { e = JSON.parse(lines[i]); } catch { continue; }
    if (e && e.op === "snapshot" && e.harness === harnessId && e.path) return e.path;
  }
  return null;
}

// Which file did this .bak come from? In priority order:
//   1. the tombstone's own recorded path (exact, self-describing)
//   2. the restore ledger, keyed by absolute file path and written in the same
//      breath as the snapshot
//   3. the audit log's most recent snapshot entry for this id
//   4. the registry's configFile, for a plain harness id
function sourceFor(harnessId, tombstonePath) {
  if (tombstonePath) return tombstonePath;

  const ledger = io.readRestore(harnessId);
  const keys = Object.keys(ledger || {});
  if (keys.length) return keys[0];

  const audited = sourceFromAuditLog(harnessId);
  if (audited) return audited;

  const { baseId, editor } = splitId(harnessId);
  if (!editor) {
    try {
      const mod = harness.get(baseId);
      if (mod && mod.configFile) return mod.configFile;
    } catch { /* registry unavailable */ }
  }
  return null;
}

function describe(harnessId) {
  const bak = io.snapshotPath(harnessId);
  let stat = null;
  try { stat = fs.statSync(bak); } catch { return null; }

  let tombstone = false;
  let tombstonePath = null;
  try {
    const parsed = JSON.parse(fs.readFileSync(bak, "utf8"));
    if (parsed && parsed.__tombstone) { tombstone = true; tombstonePath = parsed.path || null; }
  } catch { /* a real config file, not a tombstone */ }

  return {
    harnessId,
    label: labelFor(harnessId),
    bak,
    source: sourceFor(harnessId, tombstonePath),
    bytes: tombstone ? 0 : stat.size,
    mtime: stat.mtime,
    tombstone,
  };
}

// Every stored original, oldest-connect first. Driven off the snapshots dir
// rather than a hardcoded id list, so it can't go stale when a harness is
// added or starts snapshotting a second file.
function list() {
  if (!io.fileExists(io.SNAPSHOTS_DIR)) return [];
  let names;
  try { names = fs.readdirSync(io.SNAPSHOTS_DIR); } catch { return []; }
  return names
    .filter((n) => n.endsWith(".bak"))
    .map((n) => describe(n.slice(0, -".bak".length)))
    .filter(Boolean)
    .sort((a, b) => a.mtime - b.mtime);
}

// Originals belonging to one harness, including its editor-extension configs
// (claude → claude, claude-ext-vscode, claude-ext-cursor).
function forHarness(id) {
  return list().filter((e) => splitId(e.harnessId).baseId === id);
}

function get(harnessId) {
  return list().find((e) => e.harnessId === harnessId) || null;
}

// Raw stored bytes. Returns null for a tombstone (there is nothing to show)
// and for an unknown id.
function read(harnessId) {
  const entry = get(harnessId);
  if (!entry || entry.tombstone) return null;
  try { return fs.readFileSync(entry.bak, "utf8"); } catch { return null; }
}

// Copy every stored original out to `dir`, alongside a MANIFEST.json recording
// where each one came from. This is the only way to keep a copy: `off`
// consumes the .bak, and `uninstall` deletes the whole ~/.neosmith tree.
function exportAll(dir) {
  const entries = list();
  io.ensureDir(dir);
  const written = [];
  for (const e of entries) {
    if (e.tombstone) continue;
    const base = e.source ? path.basename(e.source) : `${e.harnessId}.bak`;
    const out = path.join(dir, `${e.harnessId}.${base}`);
    fs.copyFileSync(e.bak, out);
    written.push({ harness: e.harnessId, from: e.source, file: path.basename(out), bytes: e.bytes });
  }
  const manifest = {
    exported: new Date().toISOString(),
    note: "Copies of the settings files NeoSmith replaced. Restore by copying each `file` back to its `from` path, or run `neosmith <harness> off`.",
    originals: written,
    tombstones: entries.filter((e) => e.tombstone).map((e) => ({ harness: e.harnessId, path: e.source })),
  };
  fs.writeFileSync(path.join(dir, "MANIFEST.json"), JSON.stringify(manifest, null, 2) + "\n");
  return { dir, written, manifest };
}

module.exports = { list, forHarness, get, read, exportAll, tilde, labelFor, splitId };
