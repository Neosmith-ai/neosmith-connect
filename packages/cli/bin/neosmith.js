#!/usr/bin/env node
// NeoSmith CLI — routes AI coding agents through https://router.neosmith.ai.
// Same experience, ~60% lower inference cost.
//
// Usage:
//   neosmith login [key]
//   neosmith <harness> on [--model X] [--autocomplete]
//   neosmith <harness> off
//   neosmith <harness> status
//   neosmith status
//   neosmith verify
//   neosmith uninstall
//   neosmith help [harness]
//
// Harnesses: claude · codex · continue · cline · jetbrains
//
// Back-compat: `neosmith init <key>` is preserved — it logs in then connects
// Claude Code, matching the original one-liner documented in the developer guide.
//
// Dispatch is a thin shim; all logic lives in lib/. Zero runtime deps for the
// core (Claude/Cline/JetBrains paths); lib/ lazily requires `smol-toml` and
// `yaml` only when codex/continue `on` runs, with string-merge fallbacks.

"use strict";

const harness = require("../lib/harness");
const ui = require("../lib/ui");
const commands = {
  login: require("../lib/commands/login"),
  on: require("../lib/commands/on"),
  off: require("../lib/commands/off"),
  status: require("../lib/commands/status"),
  verify: require("../lib/commands/verify"),
  uninstall: require("../lib/commands/uninstall"),
  help: require("../lib/commands/help"),
};

async function main() {
  const args = process.argv.slice(2);
  const first = (args.shift() || "").toLowerCase();

  // Global flags / help
  if (!first || first === "-h" || first === "--help") {
    return commands.help.run(args);
  }

  // `<harness> on|off|status` — harness is the first word.
  if (harness.idsSorted().includes(first)) {
    const sub = (args.shift() || "").toLowerCase();
    if (sub === "on") return commands.on.run([first, ...args]);
    if (sub === "off") return commands.off.run([first, ...args]);
    if (sub === "status") return commands.status.run([first, ...args]);
    if (!sub || sub === "-h" || sub === "--help" || sub === "help") {
      return commands.help.run([first]);
    }
    ui.warn(`Unknown subcommand: neosmith ${first} ${sub}`);
    return commands.help.run([first]);
  }

  // Top-level commands.
  switch (first) {
    case "login":   return commands.login.run(args);
    case "verify":  return commands.verify.run(args);
    case "status":  return commands.status.run(args);
    case "uninstall": return commands.uninstall.run(args);
    case "help":    return commands.help.run(args);
    case "init":    // back-compat: init <key> → login <key> + claude on
      return compatInit(args);
    case "-v":
    case "--version":
      try { console.log(require("../package.json").version); }
      catch { console.log("0.2.0"); }
      return;
    default:
      ui.warn(`Unknown command: ${first}`);
      return commands.help.run(args);
  }
}

// `neosmith init <key>` — the original one-liner. Preserved so existing docs
// and muscle memory keep working. Equivalent to: login <key> && claude on.
async function compatInit(args) {
  const keyMod = require("../lib/key");
  const io = require("../lib/io");
  ui.banner("NeoSmith · init (login + Claude Code on)");
  let keyArg = args[0];
  if (!keyArg) keyArg = undefined; // let login prompt
  await keyMod.login(keyArg);
  const stored = io.readKeyRef();
  ui.log("");
  return commands.on.run(["claude", "--key", stored].concat(args.filter((a, i) => i !== 0 && a.startsWith("--"))));
}

main().catch((e) => ui.die(e && e.message ? e.message : String(e)));
