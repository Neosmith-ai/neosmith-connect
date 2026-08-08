// `neosmith uninstall` — `off` every harness, then remove ~/.neosmith and the
// launcher shim (if installed via curl-pipe). Idempotent.

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
    if (!(await ui.confirm("Disconnect every harness and remove ~/.neosmith + the launcher?"))) {
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

  // Remove launcher if present.
  if (removeAll) {
    removeLauncher();
  } else {
    const launcher = path.join(io.HOME, ".local", "bin", "neosmith");
    if (io.fileExists(launcher)) {
      ui.log(ui.c("dim", `Launcher still in place: ~/.local/bin/neosmith. Re-run with --all to also remove it.`));
    }
  }

  ui.log("");
  ui.log(ui.c("bold", "Done.") + " Claude Code will talk to its previous backend on its next launch.");
}

function removeLauncher() {
  const targets = [
    path.join(io.HOME, ".local", "bin", "neosmith"),
    path.join(io.HOME, ".local", "bin", "neosmith.cmd"),
  ];
  for (const t of targets) {
    if (io.fileExists(t)) {
      try { fs.unlinkSync(t); ui.ok(`Removed ${t}`); }
      catch (e) { ui.warn(`Could not remove ${t}: ${e.message}`); }
    }
  }
}

module.exports = { run };
