// `neosmith reset [--all] [--keep-audit]` — disconnect every connected harness
// without removing ~/.neosmith (the inverse of `uninstall`).
//
// --all         also clear ~/.neosmith/cli and the launcher shim (bin/neosmith
//               + bin/neosmith.cmd on Windows) but leave ~/.neosmith itself
//               intact so audit.log + state.json survive.
// --keep-audit  do not truncate ~/.neosmith/audit.log (forensics-friendly).
//               Without this flag, audit.log is also cleared.

"use strict";

const fs = require("fs");
const path = require("path");

const harness = require("../harness");
const io = require("../io");
const ui = require("../ui");

function parseFlags(args) {
  return {
    all:        args.includes("--all") || args.includes("-a"),
    keepAudit:  args.includes("--keep-audit"),
    yes:        args.includes("--yes") || args.includes("-y"),
  };
}

function removeLauncher() {
  const targets = [
    path.join(io.HOME, ".local", "bin", "neosmith"),
    path.join(io.HOME, ".local", "bin", "neosmith.cmd"),
    path.join(io.HOME, ".neosmith", "bin", "neosmith.cmd"),
  ];
  for (const t of targets) {
    if (io.fileExists(t)) {
      try { fs.unlinkSync(t); ui.ok(`Removed launcher ${t}`); }
      catch (e) { ui.warn(`Could not remove ${t}: ${e.message}`); }
    }
  }
}

function removeInstallClone() {
  const cliDir = path.join(io.HOME, ".neosmith", "cli");
  if (io.fileExists(cliDir)) {
    try {
      fs.rmSync(cliDir, { recursive: true, force: true });
      ui.ok(`Removed install clone ${cliDir}`);
    } catch (e) {
      ui.warn(`Could not remove ${cliDir}: ${e.message}`);
    }
  }
}

async function run(args) {
  const flags = parseFlags(args);
  ui.banner("NeoSmith · reset");

  if (!flags.yes && ui.isTTY) {
    const what = flags.all ? "Disconnect every harness, clear key + install + launcher?" : "Disconnect every harness and clear the stored key?";
    if (!(await ui.confirm(what))) ui.die("Aborted.");
  }

  let offCount = 0;
  let alreadyOff = 0;
  for (const mod of harness.list()) {
    const before = mod.status({});
    if (before.on) {
      try {
        mod.off({});
        offCount++;
        ui.log(`  ${ui.c("green", "✓")}  ${mod.name} → off`);
      } catch (e) {
        ui.warn(`  ${mod.name}: ${e.message}`);
      }
    } else {
      alreadyOff++;
    }
  }

  // Clear stored key.
  if (io.readKeyRef()) {
    io.clearKeyRef();
    ui.ok("Cleared stored key reference (~/.neosmith/config.json).");
  }

  // Audit log retention.
  if (!flags.keepAudit && io.fileExists(io.AUDIT_FILE)) {
    try {
      fs.unlinkSync(io.AUDIT_FILE);
      ui.ok("Cleared audit log (~/.neosmith/audit.log). Pass --keep-audit to preserve it.");
    } catch (e) {
      ui.warn(`Could not clear audit log: ${e.message}`);
    }
  } else if (flags.keepAudit && io.fileExists(io.AUDIT_FILE)) {
    ui.log(ui.c("dim", "Audit log preserved (--keep-audit)."));
  }

  if (flags.all) {
    removeInstallClone();
    removeLauncher();
  }

  ui.log("");
  ui.log(`${offCount} harness(es) disconnected, ${alreadyOff} already off.`);
}

module.exports = { run };
