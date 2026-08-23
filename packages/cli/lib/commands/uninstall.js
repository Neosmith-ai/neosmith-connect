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
// The npm-global install is a THIRD way `neosmith` gets onto a machine.
// Uninstall used to end with a conditional footnote — "If you also installed
// via npm…" — and call itself Done. On a machine where npm IS the install,
// that reads as success while the binary the user just invoked keeps working.
// It is not a guess: the running module's own path says which copy is
// executing, so we detect it and say so as fact.
//
// That fix covered only HALF the problem, and the other half is the one people
// actually hit. The running module's path settles it when you ran the npm copy
// — but you can equally run `node bin/neosmith.js uninstall` from a checkout,
// or the installer's copy under ~/.neosmith/cli, on a machine that ALSO has a
// global npm install. From there __dirname says nothing about npm, so it fell
// back to the dim conditional footnote and printed "Done." while `neosmith`
// stayed on PATH. Reported from the field, and the reason globalNpmInstalls()
// exists: the machine can simply be looked at, so look at it, whichever copy
// is running.
//
// Removing it is npm's job — its files live under npm's prefix, not ours, and
// its registry bookkeeping is not ours to edit. But we can invoke npm, and
// when the copy being removed is NOT the one executing there is no
// self-deletion hazard, so `uninstall` offers to run it. When you ARE running
// the npm copy it can only tell you: deleting the tree a live process was
// loaded from fails outright on Windows.
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

  // The npm-installed copy is a separate install with its own lifecycle, and
  // staying silent leaves the user thinking `neosmith` should be gone when it
  // isn't. We CAN hand a global copy to npm when it is not the copy running —
  // ask first, unless the invocation already said yes.
  const npmRoot = await reportNpmInstall({
    confirm: async () => {
      if (skipConfirm || removeAll) return true;
      if (!ui.isTTY) return false; // never spawn a package manager unprompted
      return ui.confirm("  Remove it now with `npm uninstall -g @neosmithai/cli`?");
    },
  });

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

// Where npm puts global packages. Derived rather than shelled out to: `npm
// root -g` costs half a second, and npm is not guaranteed to be on PATH of the
// process running us (the installer's copy is invoked by absolute path).
function globalNpmPrefixes() {
  const seen = new Set();
  const out = [];
  const add = (p) => {
    if (!p) return;
    const norm = String(p).replace(/\\/g, "/").replace(/\/+$/, "");
    if (!norm || seen.has(norm.toLowerCase())) return;
    seen.add(norm.toLowerCase());
    out.push(norm);
  };

  // Set by npm itself, and by anyone who has moved their global prefix.
  add(process.env.npm_config_prefix);
  add(process.env.PREFIX);

  if (process.platform === "win32") {
    add(path.join(process.env.APPDATA || "", "npm"));
  } else {
    add("/usr/local");
    add("/usr");
    add("/opt/homebrew");
    add(path.join(io.HOME, ".npm-global"));
    add(path.join(io.HOME, ".npm-packages"));
    add(path.join(io.HOME, ".local"));
  }
  // Whichever node is running us lives at <prefix>/bin/node, and nvm / asdf /
  // homebrew installs keep their global node_modules under that same prefix.
  add(path.dirname(path.dirname(process.execPath)));
  return out;
}

// Every globally installed @neosmithai/cli on this machine — independent of
// which copy is executing. This is the check that was missing.
function globalNpmInstalls() {
  const seen = new Set();
  const found = [];
  for (const prefix of globalNpmPrefixes()) {
    for (const rel of ["node_modules/@neosmithai/cli", "lib/node_modules/@neosmithai/cli"]) {
      const dir = path.join(prefix, rel).replace(/\\/g, "/");
      if (seen.has(dir.toLowerCase())) continue;
      if (!io.fileExists(path.join(dir, "package.json"))) continue;
      seen.add(dir.toLowerCase());
      found.push(dir);
    }
  }
  return found;
}

// Hand the removal to npm. Returns { ok, output } — never throws, because a
// failure here must not abort an uninstall that has already done its real work.
function runNpmUninstall() {
  if (process.env.NEOSMITH_DRY_RUN === "1") {
    return { ok: false, skipped: "dry-run", output: "" };
  }
  const { spawnSync } = require("child_process");
  // shell: true so Windows resolves npm.cmd; npm is not an .exe there.
  const r = spawnSync("npm", ["uninstall", "-g", "@neosmithai/cli"], {
    encoding: "utf8", shell: true,
  });
  const output = ((r.stdout || "") + (r.stderr || "")).trim();
  return { ok: r.status === 0, output };
}

// `opts.confirm` is an async predicate so the caller owns the interaction
// policy; tests pass a stub.
// `opts.running` overrides which copy is considered "the one executing" —
// __dirname cannot be faked, and the self-deletion branch is the one that most
// needs a test.
async function reportNpmInstall(opts = {}) {
  const running = "running" in opts ? opts.running : npmInstallRoot();
  const globals = opts.globals || globalNpmInstalls();
  const runningIsGlobal = !!(running && isGlobalNpmRoot(running));

  // The copy executing right now cannot delete its own tree — on Windows the
  // unlink fails outright while the process holds it.
  const removable = globals.filter((g) => !running || g.toLowerCase() !== running.toLowerCase());

  ui.log("");

  if (!running && !globals.length) {
    // Genuinely nothing npm-installed that we can see. No footnote: a
    // conditional warning that always fires is one nobody reads.
    return null;
  }

  // The copy executing right now, if any. Reported but never removed — see the
  // header. This does NOT return early: a machine can carry a second global
  // copy under a different prefix (an nvm switch, a leftover /usr/local), and
  // that one has no self-deletion hazard and must still be offered.
  if (runningIsGlobal) {
    ui.warn(`\`neosmith\` is STILL INSTALLED — the copy you just ran is npm's, and it cannot remove itself.`);
    ui.log(ui.c("dim", `    ${running}`));
    ui.log(`  Finish removing it with:`);
    ui.log(ui.c("bold", `    npm uninstall -g @neosmithai/cli`));
  } else if (running) {
    ui.warn(`\`neosmith\` is STILL INSTALLED — you ran a copy from node_modules, which this command does not manage.`);
    ui.log(ui.c("dim", `    ${running}`));
    ui.log(ui.c("dim", `  Remove it from the project that depends on it.`));
  }

  if (!removable.length) return running;

  // A global install exists and is NOT the copy executing, so npm can remove
  // it safely from here.
  ui.warn(`\`neosmith\` is STILL INSTALLED globally via npm:`);
  for (const g of removable) ui.log(ui.c("dim", `    ${g}`));

  const confirm = opts.confirm || (async () => false);
  if (await confirm()) {
    ui.log(ui.c("dim", `  Running \`npm uninstall -g @neosmithai/cli\` …`));
    const res = runNpmUninstall();
    if (res.ok) {
      ui.ok(`npm removed the global install.`);
      // Still not "Done." if the copy we are executing is itself npm-managed.
      return running || null;
    }
    if (res.skipped) {
      ui.log(ui.c("dim", `  Skipped (${res.skipped}). Run it yourself:  npm uninstall -g @neosmithai/cli`));
      return running || removable[0];
    }
    ui.warn(`npm could not remove it. Run it yourself:`);
    ui.log(ui.c("bold", `    npm uninstall -g @neosmithai/cli`));
    if (res.output) ui.log(ui.c("dim", `    ${res.output.split("\n")[0]}`));
    return removable[0];
  }

  ui.log(`  Finish removing it with:`);
  ui.log(ui.c("bold", `    npm uninstall -g @neosmithai/cli`));
  return running || removable[0];
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
  // The "is it still installed somewhere else" probe — the half that was
  // missing when uninstall was run from a checkout.
  globalNpmPrefixes, globalNpmInstalls,
  windowsPathEntries, reportWindowsPathEntry,
  survivingHarnesses,
};
