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
//   neosmith originals
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
  doctor: require("../lib/commands/doctor"),
  setup: require("../lib/commands/setup"),
  reset: require("../lib/commands/reset"),
  uninstall: require("../lib/commands/uninstall"),
  models: require("../lib/commands/models"),
  originals: require("../lib/commands/originals"),
  feedback: require("../lib/commands/feedback"),
  help: require("../lib/commands/help"),
};

async function main() {
  // T15: --dry-run is a global flag. Intercept BEFORE harness dispatch so the
  // env var is set when io.writeText runs, and strip it from argv so the rest
  // of the dispatcher sees clean positional args.
  // Accept --dry-run, --dry-run=true, --dry-run=false. NEOSMITH_DRY_RUN env
  // is also honored (set by the test suite and CI).
  // --env <name> is the same kind of global flag: strip it here and hand it to
  // lib/env.js via NEOSMITH_ENV. Nothing above resolved a router URL at require
  // time (harness.ROUTER_URL and http.DEFAULT_ROUTER are lazy getters), so
  // setting it now is early enough for every command module already loaded.
  const rawArgv = process.argv.slice(2);
  const cleaned = [];
  let dry = process.env.NEOSMITH_DRY_RUN === "1";
  let envName = null;
  for (let i = 0; i < rawArgv.length; i++) {
    const a = rawArgv[i];
    if (a === "--dry-run") { dry = true; continue; }
    if (a === "--dry-run=true" || a === "--dry-run=1") { dry = true; continue; }
    if (a === "--dry-run=false" || a === "--dry-run=0") { dry = false; continue; }
    if (a === "--env") { envName = rawArgv[++i] || ""; continue; }
    if (a.startsWith("--env=")) { envName = a.slice("--env=".length); continue; }
    cleaned.push(a);
  }
  process.env.NEOSMITH_DRY_RUN = dry ? "1" : "";
  if (envName !== null) process.env.NEOSMITH_ENV = envName;

  // Resolve now so an unknown --env dies immediately with the known names,
  // before any command has run, and so the NEOSMITH_BASE_URL override is
  // announced once rather than silently changing where a key gets sent.
  const activeEnv = harness.envInfo();
  if (activeEnv.overridden) {
    ui.warn(
      `NEOSMITH_BASE_URL=${activeEnv.baseUrl} overrides --env ${activeEnv.requestedName}`,
    );
  }

  const args = cleaned;
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
    case "doctor":  return commands.doctor.run(args);
    case "setup":   return commands.setup.run(args);
    case "reset":   return commands.reset.run(args);
    case "status":  return commands.status.run(args);
    case "uninstall": return commands.uninstall.run(args);
    case "models":  return commands.models.run(args);
    case "originals": case "backups":
      return commands.originals.run(args);
    case "feedback": case "issue": case "bug": case "idea":
      return commands.feedback.run(args);
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
  const stored = io.readKeyRef(harness.keyEnv());
  ui.log("");
  return commands.on.run(["claude", "--key", stored].concat(args.filter((a, i) => i !== 0 && a.startsWith("--"))));
}

main().catch((e) => ui.die(e && e.message ? e.message : String(e)));
