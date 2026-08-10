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
// The npm-global install is a THIRD way `neosmith` gets onto a machine, and
// this command cannot remove it: `npm uninstall -g` is npm's job, and its files
// live under npm's prefix, not ours. Uninstall used to end with a conditional
// footnote — "If you also installed via npm…" — and call itself Done. On a
// machine where npm IS the install, that reads as success while the binary the
// user just invoked keeps working. It is not a guess: the running module's own
// path says which copy is executing, so we detect it and say so as fact.
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

  // A harness that still reports `on` after its own `off` ran is the one state
  // where deleting ~/.neosmith does real damage: the snapshots go, and the live
  // config keeps routing through NeoSmith — with the API key still in it for
  // the harnesses that store one literally. Observed in the field after an
  // older CLI's `off` wrote to a path its `status` no longer reads.
  //
  // Deleting the tree anyway would be the destructive default, so this stops.
  const stillOn = survivingHarnesses();
  if (stillOn.length) {
    ui.log("");
    ui.warn(`These harnesses are STILL WIRED to NeoSmith after \`off\` ran:`);
    for (const s of stillOn) {
      ui.log(ui.c("yellow", `    ${s.name}`) + ui.c("dim", ` — ${s.detail}`));
    }
    ui.log(ui.c("dim", `  Removing ${originals.tilde(io.NEOSMITH_DIR)} now would delete the snapshots that undo`));
    ui.log(ui.c("dim", `  them, leaving those configs pointing at NeoSmith with nothing to restore from.`));
    ui.log("");
    if (!removeAll) {
      ui.log(`  Stopped before deleting anything else. Either:`);
      ui.log(`    - disconnect them by hand, then re-run \`neosmith uninstall\`, or`);
      ui.log(`    - re-run with ${ui.c("bold", "--all")} to delete regardless.`);
      ui.die("Aborted — nothing removed.");
    }
    ui.warn(`--all given: deleting anyway. Those configs will need fixing by hand.`);
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
  reportWindowsPathEntry();

  // The npm-installed copy is a separate install with its own lifecycle; this
  // command cannot uninstall it, and staying silent leaves the user thinking
  // `neosmith` should be gone when it isn't.
  const npmRoot = reportNpmInstall();

  ui.log("");
  // "Done" is only true when nothing that provides the command is left. Saying
  // it while the binary the user just ran still works is the whole bug.
  if (npmRoot) {
    ui.log(ui.c("bold", "Partly done.") + " Your settings and the installer's files are gone;");
    ui.log(`the ${isGlobalNpmRoot(npmRoot) ? "npm-global" : "node_modules"} copy of the command is not — see above.`);
  } else {
    ui.log(ui.c("bold", "Done.") + " Claude Code will talk to its previous backend on its next launch.");
  }
}

// Harnesses whose own status still reports wired after off() ran. A status
// that throws is treated as "can't confirm it's clean" and reported too —
// silence there is what let the field case through.
function survivingHarnesses() {
  const out = [];
  for (const mod of harness.list()) {
    let res;
    try { res = mod.status({}); }
    catch (e) { out.push({ name: mod.name, detail: `status failed: ${e.message}` }); continue; }
    if (res && res.on) out.push({ name: mod.name, detail: res.detail || String(res.on) });
  }
  return out;
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

// ── npm-global detection ────────────────────────────────────────────────────
//
// Which copy of the CLI is executing right now? `node_modules/@neosmithai/cli`
// anywhere in this module's own path means npm installed it — either globally
// or as a dependency. `~/.neosmith/cli` is the installer's copy, which the tree
// removal above handles. A checkout is neither.
//
// __dirname, not argv[1]: a launcher shim invokes the .js by absolute path, and
// on Windows argv[1] can be the .cmd wrapper rather than the script.
function npmInstallRoot(fromDir) {
  const dir = (fromDir || __dirname).replace(/\\/g, "/");
  const at = dir.toLowerCase().indexOf("/node_modules/@neosmithai/cli");
  if (at === -1) return null;
  // Installed under ~/.neosmith? Then it is the installer's copy, already gone.
  const root = dir.slice(0, at + "/node_modules/@neosmithai/cli".length);
  if (root.includes(io.HOME.replace(/\\/g, "/") + "/.neosmith/")) return null;
  return root;
}

// The command that removes it. Global installs live under npm's prefix; a
// local/dependency copy is the project's to manage, and we must not tell
// someone to run a global uninstall for it.
function isGlobalNpmRoot(root) {
  const r = String(root || "").toLowerCase();
  // Windows: <prefix>/node_modules/... ; POSIX: <prefix>/lib/node_modules/...
  return r.includes("/lib/node_modules/@neosmithai/cli") || /\/npm\/node_modules\/@neosmithai\/cli$/.test(r);
}

function reportNpmInstall() {
  const root = npmInstallRoot();
  ui.log("");
  if (!root) {
    // Can't see one from here, but a global copy may still exist independently
    // of the one running — so the conditional phrasing is honest in this branch.
    ui.log(ui.c("dim", `If you also installed via npm, remove that copy with:`));
    ui.log(ui.c("dim", `    npm uninstall -g @neosmithai/cli`));
    return null;
  }
  if (isGlobalNpmRoot(root)) {
    ui.warn(`\`neosmith\` is STILL INSTALLED — the copy you just ran is npm's, and this command cannot remove it.`);
    ui.log(ui.c("dim", `    ${root}`));
    ui.log(`  Finish removing it with:`);
    ui.log(ui.c("bold", `    npm uninstall -g @neosmithai/cli`));
  } else {
    ui.warn(`\`neosmith\` is STILL INSTALLED — you ran a copy from node_modules, which this command does not manage.`);
    ui.log(ui.c("dim", `    ${root}`));
    ui.log(ui.c("dim", `  Remove it from the project that depends on it.`));
  }
  return root;
}

// ── Windows PATH ────────────────────────────────────────────────────────────
//
// reportPathEntry() reads shell rc files, which do not exist on a PowerShell
// install — Windows keeps the user PATH in the registry. Same policy as the rc
// files: report, never edit. A user PATH is shared by every tool they have
// installed, and a wrong edit there is far more damaging than a stale entry.
function windowsPathEntries() {
  if (process.platform !== "win32") return [];
  let raw = "";
  try {
    const { execFileSync } = require("child_process");
    raw = execFileSync(
      "reg",
      ["query", "HKCU\\Environment", "/v", "Path"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
  } catch { return []; } // no user Path value set, or reg unavailable
  const m = raw.match(/Path\s+REG(?:_EXPAND)?_SZ\s+(.*)/i);
  if (!m) return [];
  const home = io.HOME.replace(/\\/g, "/").toLowerCase();
  return m[1].split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((entry) => {
      const e = entry.replace(/\\/g, "/").toLowerCase();
      return e === `${home}/.neosmith/bin` || e.endsWith("/.neosmith/bin") || e.endsWith("/.local/bin");
    });
}

function reportWindowsPathEntry() {
  const hits = windowsPathEntries();
  if (!hits.length) return hits;
  ui.log("");
  ui.log(ui.c("dim", `Your Windows user PATH still lists the installer's directory. Left alone —`));
  ui.log(ui.c("dim", `editing a shared PATH by script risks unhooking unrelated tools. Remove via`));
  ui.log(ui.c("dim", `Settings → Edit environment variables for your account, or:`));
  for (const h of hits) ui.log(ui.c("dim", `    ${h}`));
  return hits;
}

module.exports = {
  run,
  // Exported for scripts/contract/uninstall.test.js — the launcher logic is
  // the part with the sharp edges and is tested directly.
  launcherTarget, normalizeTarget, isDeadLauncher, removeLaunchers,
  isNeosmithPathLine, reportPathEntry, LAUNCHER_PATHS,
  npmInstallRoot, isGlobalNpmRoot, reportNpmInstall,
  windowsPathEntries, reportWindowsPathEntry,
  survivingHarnesses,
};
