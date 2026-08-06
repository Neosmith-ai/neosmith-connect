// `neosmith setup [--key X] [--model Y] [--harness H] [--non-interactive]`
//
// Interactive walk that combines login + per-tool wiring + doctor.
// Equivalent macro: `login && <each detected scritable harness> on && doctor`.
//
// Detection: each harness module's `configFile` (from the manifest) tells us
// where on disk a tool's config would live. If the parent directory exists
// (or, for UI-driven harnesses, any of the install paths the harness supports),
// the harness is offered for wiring.
//
// Non-interactive mode picks Claude Code as the default — that's the brief's
// "fastest path" today and matches `neosmith claude on` directly.

"use strict";

const fs = require("fs");
const path = require("path");

const harness = require("../harness");
const io = require("../io");
const ui = require("../ui");
const key = require("../key");

// Heuristic: is this tool likely installed on this machine?
// Two strategies: (1) configFile parent dir exists; (2) fallback paths beyond
// the manifest's configFile (e.g. for UI-driven harnesses that pick from
// multiple IDE roots).
function harnessInstallPaths(manifestEntry) {
  const paths = [];
  if (manifestEntry.configFile) {
    paths.push(path.join(io.HOME, path.basename(path.dirname(manifestEntry.configFile))));
  }
  // OS-specific install probes for code-driven harnesses.
  if (manifestEntry.id === "claude") {
    paths.push(path.join(io.HOME, ".claude"));
  } else if (manifestEntry.id === "codex") {
    paths.push(path.join(io.HOME, ".codex"));
  } else if (manifestEntry.id === "continue") {
    paths.push(path.join(io.HOME, ".continue"));
  } else if (manifestEntry.id === "cline") {
    // Cline: VS Code extension is the install signal. Heuristic: VS Code
    // user/extensions dir present.
    if (process.platform === "win32") paths.push(path.join(process.env.APPDATA || "", "Code", "User", "globalStorage", "saoudrizwan.claude-dev"));
    else if (process.platform === "darwin") paths.push(path.join(io.HOME, "Library", "Application Support", "Code", "User", "globalStorage", "saoudrizwan.claude-dev"));
    else paths.push(path.join(io.HOME, ".config", "Code", "User", "globalStorage", "saoudrizwan.claude-dev"));
  } else if (manifestEntry.id === "jetbrains") {
    // JetBrains: any JetBrains IDE config dir present.
    if (process.platform === "win32") paths.push(path.join(process.env.APPDATA || "", "JetBrains"));
    else if (process.platform === "darwin") paths.push(path.join(io.HOME, "Library", "Application Support", "JetBrains"));
    else paths.push(path.join(io.HOME, ".config", "JetBrains"));
  }
  return paths.filter((p) => { try { return fs.existsSync(p); } catch { return false; } });
}

function isInstalled(manifestEntry) {
  const probes = harnessInstallPaths(manifestEntry);
  if (probes.length === 0) return false;
  return probes.some(fs.existsSync);
}

function parseFlags(args) {
  const out = { key: null, model: null, harness: null, nonInteractive: false, all: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--key" || a === "-k") out.key = args[++i];
    else if (a.startsWith("--key=")) out.key = a.slice("--key=".length);
    else if (a === "--model" || a === "-m") out.model = args[++i];
    else if (a.startsWith("--model=")) out.model = a.slice("--model=".length);
    else if (a === "--harness") out.harness = args[++i];
    else if (a === "--non-interactive") out.nonInteractive = true;
    else if (a === "--all") out.all = true;
  }
  return out;
}

async function pickInstalled(flags) {
  const manifest = harness.manifest();
  const candidates = manifest.harnesses.filter(isInstalled);
  if (candidates.length === 0) return [];
  if (flags.harness) return candidates.filter((c) => c.id === flags.harness);
  if (flags.nonInteractive || flags.all) return candidates;
  if (!ui.isTTY) return candidates; // non-TTY: wire everything detected
  // Interactive checklist.
  const chosen = [];
  for (const c of candidates) {
    const ok = await ui.confirm(`Wire ${c.name} to NeoSmith?`);
    if (ok) chosen.push(c);
  }
  return chosen;
}

async function run(args) {
  const flags = parseFlags(args);
  ui.banner("NeoSmith · setup");

  // Step 1 — key.
  let apiKey = io.readKeyRef();
  if (!apiKey) {
    await key.login(flags.key);
    apiKey = io.readKeyRef();
  }

  // Step 2 — pick harnesses.
  const picks = await pickInstalled(flags);
  if (picks.length === 0) {
    if (flags.harness) ui.warn(`Harness ${flags.harness} doesn't appear to be installed.`);
    else ui.warn("No installed harnesses detected. Run `neosmith claude on` to wire Claude Code directly.");
  } else {
    ui.log(ui.c("dim", `Wiring ${picks.length} harness(es): ${picks.map((p) => p.id).join(", ")}`));
    for (const p of picks) {
      const m = harness.get(p.id);
      const ctx = {
        key: flags.key || apiKey,
        model: harness.resolveModel(flags.model || p.defaultModel),
        autocomplete: false,
        routerUrl: harness.ROUTER_URL,
      };
      try {
        const res = m.on(ctx);
        if (res && res.alreadyOn) ui.warn(`${p.name} was already connected.`);
        else if (res && res.wrote) ui.ok(`${p.name} → on`);
        else if (res && res.ui) ui.ok(`${p.name} → on (paste in values shown above)`);
        else ui.ok(`${p.name} → on`);
      } catch (e) {
        ui.warn(`${p.name} failed: ${e.message}`);
      }
    }
  }

  // Step 3 — doctor.
  ui.log("");
  ui.log(ui.c("dim", "Running doctor to verify…"));
  const doctor = require("./doctor");
  try {
    await doctor.run([]);
    // Doctor exited 0.
  } catch (e) {
    // Doctor UI uses process.exitCode; if it died hard we still want setup
    // to bubble. Print suggestion but don't override doctor's exit code.
    ui.warn(`Doctor errored: ${e.message}`);
  }
}

module.exports = { run };
