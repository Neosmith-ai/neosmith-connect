// `neosmith uninstall` — `off` every harness, then remove ~/.neosmith and the
// launcher shim (if installed via curl-pipe). Idempotent.
//
// Launcher handling, and why it is unconditional:
//
// install.sh writes TWO things — the CLI into ~/.neosmith/cli, and a launcher
// at ~/.local/bin/neosmith that hardcodes an absolute `exec` path to
// ~/.neosmith/cli/bin/neosmith.js. Removing ~/.neosmith (below) therefore
// ORPHANS that launcher: it survives as a pointer to a file that no longer
// exists. It is not "still in place", it is dead.
//
// Leaving it is actively harmful, because install.sh also PREPENDS
// ~/.local/bin to PATH in the user's shell rc. The corpse outranks the npm
// global bin, so a later `npm i -g @neosmithai/cli` installs correctly and
// still fails at the prompt with a MODULE_NOT_FOUND naming the deleted
// directory — an error that points nowhere near the file you must delete.
//
// So: a launcher whose target is gone is removed every time, with no flag.
// `--all` now means "also remove a launcher that still works" — the only
// remaining judgement call. The PATH line install.sh added is reported rather
// than deleted; see reportPathEntry() for why.
//
// A launcher pointing at a live target is NOT touched: install.sh supports
// running from a local checkout (`CLI=/path/to/checkout`), in which case the
// shim outlives ~/.neosmith legitimately. That is a working launcher, and
// removing it would be the mirror-image bug.

"use strict";

const fs = require("fs");
const path = require("path");
const harness = require("../harness");
const io = require("../io");
const originals = require("../originals");
const ui = require("../ui");

async function run(args) {
  const removeAll = args.includes("--all") || args.includes("-a");
  const skipConfirm = args.includes("--yes") || args.includes("-y");

  ui.banner("NeoSmith · uninstall");

  // uninstall deletes ~/.neosmith outright. Every harness is disconnected
  // first, so live configs are restored — but anything still stored after that
  // (an orphaned snapshot from a harness that reports off) goes with the tree.
  // Say so before asking, and point at the export.
  const stored = originals.list();
  if (stored.length) {
    ui.log(`  ${stored.length} original settings file(s) are stored in ${originals.tilde(io.SNAPSHOTS_DIR)}/:`);
    for (const o of stored) {
      ui.log(ui.c("dim", `    ${o.label} → ${originals.tilde(o.source) || "(unknown source)"}`));
    }
    ui.log(ui.c("dim", "  Each is restored to its location first; then ~/.neosmith is removed entirely,"));
    ui.log(ui.c("dim", "  so nothing is left to restore from afterwards."));
    ui.log(ui.c("dim", "  Run `neosmith originals --export <dir>` first to keep a copy."));
    ui.log("");
  }

  if (!skipConfirm && ui.isTTY) {
    const what = removeAll
      ? "Disconnect every harness, remove ~/.neosmith, and remove the launcher?"
      : "Disconnect every harness, remove ~/.neosmith, and remove the launcher it orphans?";
    if (!(await ui.confirm(what))) {
      ui.die("Aborted.");
    }
  }

  // off every harness (best effort)
  for (const mod of harness.list()) {
    try {
      mod.off({});
      ui.log(`  ${ui.c("green", "✓")}  ${mod.name}`);
    } catch (e) {
      ui.warn(`  ${mod.name}: ${e.message}`);
    }
  }

  // Remove ~/.neosmith
  if (io.fileExists(io.NEOSMITH_DIR)) {
    fs.rmSync(io.NEOSMITH_DIR, { recursive: true, force: true });
    ui.ok(`Removed ${io.NEOSMITH_DIR}`);
  }

  // Launcher shims. Dead ones always go (see the header comment); live ones
  // stay unless --all. Runs AFTER the ~/.neosmith removal above, so the
  // liveness check reflects the post-uninstall world.
  const { removed, alive } = removeLaunchers({ force: removeAll });
  for (const t of removed) ui.ok(`Removed launcher ${tilde(t)}`);
  if (alive.length) {
    for (const t of alive) {
      ui.log(ui.c("dim", `Launcher left in place: ${tilde(t)} — it points at a copy`));
      ui.log(ui.c("dim", `outside ~/.neosmith and still works. Re-run with --all to remove it.`));
    }
  }

  reportPathEntry();

  // The npm-installed copy is a separate install with its own lifecycle; this
  // command cannot uninstall it, and staying silent leaves the user thinking
  // `neosmith` should be gone when it isn't.
  ui.log("");
  ui.log(ui.c("dim", `If you also installed via npm, remove that copy with:`));
  ui.log(ui.c("dim", `    npm uninstall -g @neosmithai/cli`));

  ui.log("");
  ui.log(ui.c("bold", "Done.") + " Claude Code will talk to its previous backend on its next launch.");
}

const LAUNCHER_PATHS = () => [
  path.join(io.HOME, ".local", "bin", "neosmith"),
  path.join(io.HOME, ".local", "bin", "neosmith.cmd"), // Windows sibling — was never checked
];

// Pull the `exec`d script path out of a launcher shim. Both shapes install.sh
// writes quote the .js path:
//   bash: exec "$NODE_BIN" "/c/Users/me/.neosmith/cli/bin/neosmith.js" "$@"
//   cmd:  "C:\...\node.exe" "C:\...\bin\neosmith.js" %*
function launcherTarget(text) {
  const m = String(text || "").match(/["']([^"']*neosmith\.js)["']/i);
  return m ? m[1] : null;
}

// Git Bash writes MSYS paths (/c/Users/…) into the bash shim; fs can't stat
// those on Windows — it would resolve them against the current drive root and
// report "missing" for a file that exists.
function normalizeTarget(t) {
  if (process.platform !== "win32") return t;
  const m = String(t).match(/^\/([a-zA-Z])\/(.*)$/);
  return m ? `${m[1].toUpperCase()}:\\${m[2].replace(/\//g, "\\")}` : t;
}

// A shim is dead if it points into the tree we just deleted, or if its target
// simply isn't there. An unrecognized shape returns false: we don't delete
// files we can't read, since something else may own that name.
function isDeadLauncher(text) {
  const target = launcherTarget(text);
  if (!target) return false;
  const norm = normalizeTarget(target);
  if (norm.replace(/\\/g, "/").includes("/.neosmith/")) return true;
  return !io.fileExists(norm);
}

function removeLaunchers(opts = {}) {
  const removed = [];
  const alive = [];
  for (const t of LAUNCHER_PATHS()) {
    if (!io.fileExists(t)) continue;
    if (!opts.force && !isDeadLauncher(io.readText(t))) { alive.push(t); continue; }
    try { fs.unlinkSync(t); removed.push(t); }
    catch (e) { ui.warn(`Could not remove ${t}: ${e.message}`); }
  }
  return { removed, alive };
}

// install.sh appends `export PATH="$HOME/.local/bin:$PATH"` to the shell rc.
// We REPORT that line, we do not delete it — ~/.local/bin is a shared
// convention (pipx, uv, cargo, user scripts all live there), install.sh skips
// the append when the line already exists, and an rc file is the user's. So
// "we put it there" isn't knowable after the fact, and a wrong guess silently
// unhooks unrelated tools. Printing the file and line is the honest fix.
function reportPathEntry() {
  const binDir = path.join(io.HOME, ".local", "bin");
  const rcFiles = [".bashrc", ".bash_profile", ".zshrc"].map((f) => path.join(io.HOME, f));
  const hits = [];
  for (const rc of rcFiles) {
    if (!io.fileExists(rc)) continue;
    const text = io.readText(rc);
    if (text == null) continue;
    text.split(/\r?\n/).forEach((line, i) => {
      if (isNeosmithPathLine(line, binDir)) hits.push({ rc, line: i + 1, text: line.trim() });
    });
  }
  if (!hits.length) return hits;
  ui.log("");
  ui.log(ui.c("dim", `The installer added ~/.local/bin to your PATH. Left alone — other`));
  ui.log(ui.c("dim", `tools commonly use that directory. Remove by hand if it is now empty:`));
  for (const h of hits) ui.log(ui.c("dim", `    ${tilde(h.rc)}:${h.line}  ${h.text}`));
  return hits;
}

function isNeosmithPathLine(line, binDir) {
  const l = line.trim();
  if (!l.startsWith("export PATH=")) return false;
  const norm = (s) => s.replace(/\\/g, "/");
  return norm(l).includes(norm(binDir)) || norm(l).includes("/.local/bin");
}

function tilde(p) {
  return p.startsWith(io.HOME) ? "~" + p.slice(io.HOME.length).replace(/\\/g, "/") : p;
}

module.exports = {
  run,
  // Exported for scripts/contract/uninstall.test.js — the launcher logic is
  // the part with the sharp edges and is tested directly.
  launcherTarget, normalizeTarget, isDeadLauncher, removeLaunchers,
  isNeosmithPathLine, reportPathEntry, LAUNCHER_PATHS,
};
