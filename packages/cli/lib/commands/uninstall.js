// `neosmith uninstall` — `off` every harness, then remove ~/.neosmith and the
// launcher shim (if installed via curl-pipe). Idempotent.

"use strict";

const fs = require("fs");
const path = require("path");
const harness = require("../harness");
const io = require("../io");
const ui = require("../ui");

async function run(args) {
  const removeAll = args.includes("--all") || args.includes("-a");
  const skipConfirm = args.includes("--yes") || args.includes("-y");

  ui.banner("NeoSmith · uninstall");

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
