// How `off` decides to put a config file back — issue #22.
//
// Issue #15 made `on` merge instead of clobber. This is the other half: what
// happens to the settings a user writes AFTER the harness is already on.
//
// `off` used to restore the pre-connect snapshot unconditionally. That is the
// right answer for a file nobody touched — it brings back formatting, comments
// and key order, byte for byte — and the wrong answer the moment the user has
// added a hook, a permission, a proxy variable or a second provider while
// connected. Those edits are not NeoSmith's to discard.
//
// So `off` now asks two questions in order:
//
//   1. Has the file changed since `on` wrote it?  (io.fileDrifted — the
//      post-write fingerprint in ~/.neosmith/state.json)
//   2. If it has, what did the keys NeoSmith owns look like before?
//      (the restore ledger, or the snapshot read as a source of prior values)
//
// Unchanged → snapshot restore, exactly as before. Changed → keep the user's
// file and replay the ledger over it, which touches only NeoSmith's own keys.

"use strict";

// Resolved per call rather than captured at module load. io.js reads HOME once,
// at load, and the contract sandbox swaps HOME and re-requires it between
// cases — a reference captured here would go on addressing the previous
// sandbox's ~/.neosmith. (io.js resolves lib/env.js the same way, for the same
// kind of reason.) require() hits the module cache, so this is a lookup, not a
// re-parse.
function io() { return require("./io"); }

// What `off` should do with one config file:
//
//   "absent"   — the file is gone; there is nothing to restore
//   "snapshot" — untouched since `on` wrote it, and a .bak exists → byte-for-byte
//   "merge"    — edited while connected (or no fingerprint, or no .bak) → keep
//                the live file and take back only the NeoSmith keys
function disposition(harnessId, filePath) {
  const $io = io();
  if (!$io.fileExists(filePath)) return "absent";
  if (!$io.fileDrifted(harnessId, filePath) && $io.hasSnapshot(harnessId)) return "snapshot";
  return "merge";
}

// The ledger the merge path replays.
//
// Normally this is what `on` recorded. When it is missing — a connect made by
// a CLI older than the ledger, or state.json lost — the pre-connect snapshot
// carries the same information in another form: parse the .bak and read the
// prior value of every pointer `on` writes. That is precisely what
// planRestore() would have recorded at connect time, so the merge path keeps
// working for connections that predate this code.
//
// `parse` turns the snapshot's raw text into the same object shape the harness
// hands to applyRestore (JSON.parse for claude/zed, toml.parse for codex).
// Returns null when neither source is available; the caller then falls back to
// stripping the keys it knows it writes.
function ledgerFor(harnessId, filePath, pointers, parse) {
  const $io = io();
  const recorded = $io.readRestore(harnessId, filePath);
  if (recorded && recorded.length) return recorded;

  const bak = $io.snapshotPath(harnessId);
  if (!$io.fileExists(bak)) return null;
  const raw = $io.readText(bak);
  if (raw === null) return null;

  let parsed;
  try { parsed = parse(raw); } catch { return null; }
  // A tombstone .bak means the file did not exist pre-connect, so every
  // pointer was ABSENT — which is what planRestore returns for an empty object.
  if (parsed && parsed.__tombstone) parsed = {};
  if (!parsed || typeof parsed !== "object") return null;

  return $io.planRestore(parsed, pointers);
}

// Everything `off` must forget once a file has been put back. The snapshot goes
// too on the merge path: it is the PRE-CONNECT baseline, and leaving it behind
// would make the next `on` skip snapshotting (snapshots are write-once) and
// hold a baseline that no longer matches what is on disk.
function finish(harnessId, filePath) {
  const $io = io();
  $io.clearSnapshot(harnessId);
  $io.clearRestore(harnessId);
  $io.clearFingerprint(harnessId, filePath);
}

module.exports = { disposition, ledgerFor, finish };
