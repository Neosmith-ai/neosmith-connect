// `neosmith update [--check] [--yes]` — move to the latest published version
// without losing anything you have configured.
//
// Why this exists: updating used to mean remembering which of three ways you
// installed and then remembering that way's command. Get it wrong and you end
// up with two copies on PATH — the exact state `uninstall` had to grow a
// detector for.
//
// YOUR SETTINGS ARE NEVER AT RISK, and that is worth saying plainly because it
// is the reason people put updates off. The CLI's code and the CLI's state live
// in different places:
//
//   ~/.neosmith/cli/        the installer's copy of the code  ← replaced
//   ~/.neosmith/config.json your key, per environment          ← untouched
//   ~/.neosmith/state.json  which harnesses are on, the restore ledger
//   ~/.neosmith/snapshots/  YOUR pre-connect config files
//   ~/.neosmith/audit.log   the write history
//
// install.sh removes only `${HOME}/.neosmith/cli` (install.sh:142) and
// install.ps1 only `$CliDir` (install.ps1:110); an npm-global update never
// touches ~/.neosmith at all. Harness configs — ~/.claude/settings.json,
// ~/.codex/config.toml and the rest — are not touched either: they are written
// by `on` and read by `off`, and neither runs here. So a harness stays wired
// across an update, with the same key.
//
// Rather than assert that, this verifies it: the state files present before the
// update are re-checked after, and anything that vanished is reported loudly.

"use strict";

const path = require("path");
const { spawnSync } = require("child_process");

const io = require("../io");
const http = require("../http");
const ui = require("../ui");
const uninstall = require("./uninstall");

const PKG = "@neosmithai/cli";
const REGISTRY = "https://registry.npmjs.org";

// Installer one-liners, per platform. Kept in step with the root README.
const INSTALL_SH = "https://raw.githubusercontent.com/Neosmith-ai/neosmith-connect/main/packages/cli/install.sh";
const INSTALL_PS1 = "https://raw.githubusercontent.com/Neosmith-ai/neosmith-connect/main/packages/cli/install.ps1";

function parseFlags(args) {
  const out = { check: false, yes: false };
  for (const a of args) {
    if (a === "--check" || a === "-c") out.check = true;
    else if (a === "--yes" || a === "-y") out.yes = true;
  }
  return out;
}

// The version of the copy this command would REPLACE — which is not always the
// copy executing. Run `node bin/neosmith.js update` from a checkout on a machine
// with a global install and the copy on PATH is the npm one; reporting the
// checkout's version there would compare the wrong number against the registry
// and could report "already latest" while the installed copy is two behind.
function currentVersion(method) {
  const root = method && method.viaCheckout && method.root;
  if (root) {
    try { return require(path.join(root, "package.json")).version; } catch { /* fall through */ }
  }
  try { return require("../../package.json").version; }
  catch { return null; }
}

// Numeric-segment compare, prerelease-aware enough for our tags: 0.10.0 sorts
// above 0.9.0 (a plain string compare gets that backwards), and 1.0.0-rc.1
// sorts below 1.0.0.
function compareVersions(a, b) {
  const split = (v) => {
    const [core, pre] = String(v).split("-");
    return { nums: core.split(".").map((n) => parseInt(n, 10) || 0), pre: pre || null };
  };
  const A = split(a), B = split(b);
  for (let i = 0; i < Math.max(A.nums.length, B.nums.length); i++) {
    const d = (A.nums[i] || 0) - (B.nums[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  if (A.pre === B.pre) return 0;
  if (A.pre && !B.pre) return -1;   // 1.0.0-rc.1 < 1.0.0
  if (!A.pre && B.pre) return 1;
  return A.pre < B.pre ? -1 : 1;
}

// The registry's own endpoint, not `npm view`: npm costs about half a second
// and is not guaranteed to be on the PATH of a process the installer launches
// by absolute path.
async function latestVersion() {
  const res = await http.get(`${REGISTRY}/${PKG}/latest`, { accept: "application/json" }, 8000);
  if (res.status !== 200) throw new Error(`registry returned HTTP ${res.status}`);
  const v = JSON.parse(res.body).version;
  if (!v) throw new Error("registry response carried no version");
  return v;
}

// How this copy got here, and therefore how to replace it.
//
//   npm-global   → npm can replace it in place
//   installer    → ~/.neosmith/cli, re-run the installer
//   project      → a dependency of someone's project; not ours to touch
//   checkout     → a git working tree; `git pull` is the update
function installMethod() {
  const running = uninstall.npmInstallRoot();
  if (running) {
    return uninstall.isGlobalNpmRoot(running)
      ? { kind: "npm-global", root: running }
      : { kind: "project", root: running };
  }
  const here = __dirname.replace(/\\/g, "/").toLowerCase();
  const installerRoot = path.join(io.HOME, ".neosmith", "cli").replace(/\\/g, "/").toLowerCase();
  if (here.startsWith(installerRoot)) return { kind: "installer", root: installerRoot };

  // Not running from an npm copy — but one may still exist, and it is the copy
  // on PATH. Same blind spot `uninstall` had.
  const globals = uninstall.globalNpmInstalls();
  if (globals.length) return { kind: "npm-global", root: globals[0], viaCheckout: true };
  return { kind: "checkout", root: path.resolve(__dirname, "..", "..") };
}

// Everything under ~/.neosmith that is state rather than code. Sampled before
// the update and re-checked after.
function stateInventory() {
  const items = [
    ["your stored key", io.CONFIG_FILE],
    ["harness on/off + restore ledger", io.STATE_FILE],
    ["your pre-connect config backups", io.SNAPSHOTS_DIR],
    ["the audit log", io.AUDIT_FILE],
  ];
  return items.filter(([, p]) => io.fileExists(p));
}

function run(cmd, args) {
  ui.log(ui.c("dim", `  $ ${cmd} ${args.join(" ")}`));
  const r = spawnSync(cmd, args, { encoding: "utf8", shell: true, stdio: "inherit" });
  return r.status === 0;
}

function performUpdate(method) {
  if (method.kind === "npm-global") {
    return run("npm", ["install", "-g", `${PKG}@latest`]);
  }
  if (method.kind === "installer") {
    if (process.platform === "win32") {
      return run("powershell", ["-NoProfile", "-Command", `"irm ${INSTALL_PS1} | iex"`]);
    }
    return run("bash", ["-c", `"$(curl -fsSL ${INSTALL_SH})"`]);
  }
  return false;
}

async function runCmd(args) {
  const flags = parseFlags(args);
  const method = installMethod();
  const current = currentVersion(method);

  ui.banner("NeoSmith · update");

  let latest;
  try {
    latest = await latestVersion();
  } catch (e) {
    ui.warn(`Could not reach the npm registry (${e.message}).`);
    ui.log(ui.c("dim", `  Installed: ${current || "unknown"}. Try again when you're online.`));
    return;
  }

  const cmp = current ? compareVersions(current, latest) : -1;
  ui.log(`  installed  ${ui.c("bold", current || "unknown")}`);
  ui.log(`  latest     ${ui.c(cmp < 0 ? "green" : "bold", latest)}`);
  ui.log(ui.c("dim", `  installed via ${method.kind}${method.root ? ` · ${method.root}` : ""}`));
  ui.log("");

  if (cmp === 0) { ui.ok(`Already on the latest version.`); return; }
  if (cmp > 0) {
    ui.log(`You are ahead of the registry — ${current} is newer than the published ${latest}.`);
    ui.log(ui.c("dim", `  That is normal on a checkout, or between a release tag and its publish.`));
    return;
  }

  ui.log(`  ${ui.c("green", `${latest} is available.`)}`);

  // The reason people put updates off. Say it before asking.
  const state = stateInventory();
  if (state.length) {
    ui.log("");
    ui.log(`  Your settings are NOT touched — only the CLI's own code is replaced:`);
    for (const [what, p] of state) {
      ui.log(ui.c("dim", `    kept   ${what.padEnd(34)} ${p.replace(io.HOME, "~")}`));
    }
    ui.log(ui.c("dim", `    Connected harnesses stay connected, with the same key.`));
  }

  if (method.kind === "project") {
    ui.log("");
    ui.warn(`This copy is a dependency of a project, which this command does not manage.`);
    ui.log(ui.c("dim", `  Update it there:  npm install ${PKG}@latest`));
    return;
  }
  if (method.kind === "checkout") {
    ui.log("");
    ui.warn(`You are running a git checkout — its version is whatever you have committed.`);
    ui.log(ui.c("dim", `  Update it with:  git pull`));
    return;
  }
  if (method.viaCheckout) {
    ui.log("");
    ui.log(ui.c("dim", `  (You ran this from a checkout, but the copy on your PATH is the npm one above.)`));
  }

  if (flags.check) {
    ui.log("");
    ui.log(`  Run ${ui.c("bold", "neosmith update")} to install it.`);
    return;
  }

  if (!flags.yes && ui.isTTY) {
    ui.log("");
    if (!(await ui.confirm(`  Update ${current} → ${latest}?`))) { ui.die("Aborted — nothing changed."); }
  } else if (!flags.yes) {
    ui.log("");
    ui.warn(`Not a terminal — re-run with --yes to update without prompting.`);
    return;
  }

  ui.log("");
  const ok = performUpdate(method);
  ui.log("");

  // Verify rather than assert. If an installer ever grows a wider rm -rf, this
  // is what catches it — and the user still has the export path.
  const after = stateInventory().map(([, p]) => p);
  const lost = state.filter(([, p]) => !after.includes(p));
  if (lost.length) {
    ui.warn(`Some of your state is missing after the update:`);
    for (const [what, p] of lost) ui.log(ui.c("yellow", `    ${what} — ${p.replace(io.HOME, "~")}`));
    ui.log(ui.c("dim", `  This should not happen. Please report it: neosmith feedback bug`));
  }

  if (!ok) {
    ui.warn(`The update command did not complete successfully.`);
    ui.log(ui.c("dim", method.kind === "npm-global"
      ? `  Run it yourself:  npm install -g ${PKG}@latest`
      : `  Re-run the installer from the README.`));
    return;
  }

  ui.ok(`Updated to ${latest}.`);
  if (!lost.length && state.length) ui.log(ui.c("dim", `  Your key and connected harnesses came through untouched.`));
  ui.log(ui.c("dim", `  Open a new terminal, then: neosmith status`));
}

module.exports = {
  run: runCmd,
  // Exported for the contract suite.
  parseFlags, compareVersions, currentVersion, latestVersion,
  installMethod, stateInventory, PKG, REGISTRY,
};
