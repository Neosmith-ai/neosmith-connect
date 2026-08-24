// scripts/contract/uninstall.completeness.test.js
//
// Contract for the three ways `neosmith uninstall` used to claim success while
// leaving something behind. All three were observed on one Windows machine.
//
//   1. npm-global install. uninstall removes ~/.neosmith and the ~/.local/bin
//      shims — it has no idea npm's global bin exists. It ended with a dim,
//      CONDITIONAL footnote ("If you also installed via npm…") and printed
//      "Done." while the binary the user had just invoked still worked. The
//      running module's own path settles it, so it must be stated as fact.
//
//   2. Windows PATH. reportPathEntry() reads .bashrc/.bash_profile/.zshrc.
//      A PowerShell install puts the directory in HKCU\Environment instead, so
//      the entry was never reported on the platform that uses it.
//
//   3. Snapshots dying under a live config. ~/.neosmith holds the ONLY copies
//      of the user's pre-connect settings. Deleting it while a harness still
//      reports `on` strands that config pointing at NeoSmith — with the API key
//      still in it, for harnesses that store one literally — and nothing left
//      to restore from. That is the one case where uninstall must stop.

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { withSandbox } = require("./_sandbox");

function loadUninstall() {
  delete require.cache[require.resolve("../../lib/io")];
  delete require.cache[require.resolve("../../lib/commands/uninstall")];
  return {
    io: require("../../lib/io"),
    uninstall: require("../../lib/commands/uninstall"),
  };
}

// ── 1. which copy is running ────────────────────────────────────────────────

test("uninstall: an npm-global copy is identified as global, on both path layouts", () => withSandbox(() => {
  const { uninstall } = loadUninstall();

  const win = uninstall.npmInstallRoot(
    "C:/Users/me/AppData/Roaming/npm/node_modules/@neosmithai/cli/lib/commands");
  assert.ok(win, "a Windows npm prefix must be recognized");
  assert.ok(uninstall.isGlobalNpmRoot(win), "…and classified global, so we can name `npm uninstall -g`");

  const posix = uninstall.npmInstallRoot(
    "/usr/local/lib/node_modules/@neosmithai/cli/lib/commands");
  assert.ok(posix, "a POSIX npm prefix must be recognized");
  assert.ok(uninstall.isGlobalNpmRoot(posix));
}));

test("uninstall: a project dependency is not reported as a global install", () => withSandbox(() => {
  const { uninstall } = loadUninstall();
  const root = uninstall.npmInstallRoot("/home/me/proj/node_modules/@neosmithai/cli/lib/commands");
  assert.ok(root, "it is still an npm copy this command cannot remove");
  assert.equal(uninstall.isGlobalNpmRoot(root), false,
    "telling someone to `npm uninstall -g` for a project dependency would be wrong");
}));

test("uninstall: the installer's own copy under ~/.neosmith is not an npm install", () => withSandbox((home) => {
  const { uninstall } = loadUninstall();
  const dir = home.replace(/\\/g, "/") + "/.neosmith/cli/node_modules/@neosmithai/cli/lib/commands";
  assert.equal(uninstall.npmInstallRoot(dir), null,
    "the tree removal already handles it — naming npm here would send the user to the wrong place");
}));

test("uninstall: a checkout is not an npm install", () => withSandbox(() => {
  const { uninstall } = loadUninstall();
  assert.equal(uninstall.npmInstallRoot("/home/me/checkout/packages/cli/lib/commands"), null);
}));

// ── 2. Windows PATH ─────────────────────────────────────────────────────────

test("uninstall: the Windows PATH reporter is inert off Windows", () => withSandbox(() => {
  const { uninstall } = loadUninstall();
  if (process.platform === "win32") return; // covered by the next test
  assert.deepEqual(uninstall.windowsPathEntries(), [],
    "no registry to read — it must not throw or invent entries");
}));

test("uninstall: on Windows, PATH is read from the registry and only our dirs are reported", () => withSandbox(() => {
  const { uninstall } = loadUninstall();
  if (process.platform !== "win32") return;

  const hits = uninstall.windowsPathEntries();
  assert.ok(Array.isArray(hits), "must return a list, never throw, even with no user Path set");
  for (const h of hits) {
    const e = h.replace(/\\/g, "/").toLowerCase();
    assert.ok(e.endsWith("/.neosmith/bin") || e.endsWith("/.local/bin"),
      `only installer-owned directories may be reported — got ${h}. A shared user PATH ` +
      `must never be edited or blamed on us wholesale.`);
  }
}));

// ── 3. stop before stranding a live config ──────────────────────────────────

// A stub registry: uninstall's survivingHarnesses() asks each module for its
// status, so the states that matter can be exercised without wiring real tools.
function withStubHarnesses(mods, fn) {
  const harness = require("../../lib/harness");
  const origList = harness.list;
  harness.list = () => mods;
  try { return fn(); } finally { harness.list = origList; }
}

test("uninstall: a harness still reporting `on` after off() is surfaced", () => withSandbox(() => {
  const { uninstall } = loadUninstall();
  withStubHarnesses([
    { id: "clean", name: "Clean", status: () => ({ on: false, detail: "not connected" }) },
    { id: "stuck", name: "Stuck", status: () => ({ on: true, detail: "base=https://router.neosmith.ai/v1" }) },
  ], () => {
    const surviving = uninstall.survivingHarnesses();
    assert.deepEqual(surviving.map((s) => s.name), ["Stuck"],
      "only the harness whose own status still says wired");
    assert.match(surviving[0].detail, /router\.neosmith\.ai/, "carry the detail so the user can act on it");
  });
}));

test("uninstall: an intermediate truthy state counts as still wired", () => withSandbox(() => {
  const { uninstall } = loadUninstall();
  withStubHarnesses([
    { id: "partial", name: "Partial", status: () => ({ on: "models-written", detail: "models registered" }) },
  ], () => {
    assert.equal(uninstall.survivingHarnesses().length, 1,
      "`models-written` is not disconnected — treating only `true` as wired would miss it");
  });
}));

test("uninstall: a harness whose status throws is reported, not silently skipped", () => withSandbox(() => {
  const { uninstall } = loadUninstall();
  withStubHarnesses([
    { id: "broken", name: "Broken", status: () => { throw new Error("config unreadable"); } },
  ], () => {
    const surviving = uninstall.survivingHarnesses();
    assert.equal(surviving.length, 1, "unverifiable is not the same as clean");
    assert.match(surviving[0].detail, /config unreadable/);
  });
}));

test("uninstall: nothing wired means nothing to warn about", () => withSandbox(() => {
  const { uninstall } = loadUninstall();
  withStubHarnesses([
    { id: "a", name: "A", status: () => ({ on: false, detail: "off" }) },
    { id: "b", name: "B", status: () => ({ on: false, detail: "off" }) },
  ], () => {
    assert.deepEqual(uninstall.survivingHarnesses(), [],
      "the normal path must stay quiet — a warning that always fires is one nobody reads");
  });
}));

// ── 4. a global install the running copy cannot see ─────────────────────────
//
// The npm-detection above keys on __dirname: it settles which copy is
// EXECUTING. That is only half the question. Run `node bin/neosmith.js
// uninstall` from a checkout — or the installer's copy under ~/.neosmith/cli —
// on a machine that also has `npm i -g @neosmithai/cli`, and __dirname says
// nothing about npm. uninstall fell through to a dim conditional footnote and
// printed "Done." while `neosmith` was still on PATH. Reported from the field.
//
// The machine can just be looked at, so these pin that it is.

function fakeGlobalInstall(home, rel) {
  const dir = path.join(home, ...rel, "node_modules", "@neosmithai", "cli");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@neosmithai/cli" }));
  return dir.split(path.sep).join("/");
}

function withPrefix(prefix, fn) {
  const saved = process.env.npm_config_prefix;
  process.env.npm_config_prefix = prefix;
  try { return fn(); } finally {
    if (saved === undefined) delete process.env.npm_config_prefix;
    else process.env.npm_config_prefix = saved;
  }
}

test("uninstall: a global install is found via npm's prefix, whichever copy is running", () => withSandbox((home) => {
  const { uninstall } = loadUninstall();
  const dir = fakeGlobalInstall(home, ["npm-prefix"]);
  withPrefix(path.join(home, "npm-prefix"), () => {
    assert.deepEqual(uninstall.globalNpmInstalls(), [dir],
      "npm_config_prefix is the authoritative answer when npm or the user has set it");
  });
}));

test("uninstall: the POSIX <prefix>/lib/node_modules layout is found too", () => withSandbox((home) => {
  const { uninstall } = loadUninstall();
  const dir = fakeGlobalInstall(home, ["npm-prefix", "lib"]);
  withPrefix(path.join(home, "npm-prefix"), () => {
    assert.deepEqual(uninstall.globalNpmInstalls(), [dir]);
  });
}));

test("uninstall: a prefix with nothing installed yields nothing", () => withSandbox((home) => {
  const { uninstall } = loadUninstall();
  fs.mkdirSync(path.join(home, "npm-prefix"), { recursive: true });
  withPrefix(path.join(home, "npm-prefix"), () => {
    assert.deepEqual(uninstall.globalNpmInstalls().filter((g) => g.includes("npm-prefix")), [],
      "a directory without a package.json is not an install");
  });
}));

// ── reportNpmInstall's three branches ───────────────────────────────────────
// `running` is injected: __dirname cannot be faked, and the branch that must
// NOT offer to self-remove is exactly the one worth pinning.

test("uninstall: run from a checkout with a global present, npm removal is offered", () => withSandbox(async () => {
  const { uninstall } = loadUninstall();
  let asked = 0;
  const left = await uninstall.reportNpmInstall({
    running: null,                                   // a checkout: not an npm copy
    globals: ["/somewhere/npm/node_modules/@neosmithai/cli"],
    confirm: async () => { asked++; return false; },
  });
  assert.equal(asked, 1, "there is no self-deletion hazard here, so it must offer");
  assert.ok(left, "declining leaves it installed — the caller must not print 'Done.'");
}));

test("uninstall: the copy you are RUNNING is never handed to npm to delete", () => withSandbox(async () => {
  const { uninstall } = loadUninstall();
  const self = "/users/me/appdata/roaming/npm/node_modules/@neosmithai/cli";
  let asked = 0;
  const left = await uninstall.reportNpmInstall({
    running: self,
    globals: [self],
    confirm: async () => { asked++; return true; },
  });
  assert.equal(asked, 0,
    "deleting the tree a live process was loaded from fails outright on Windows — it can only be reported");
  assert.equal(left, self, "and it is still installed, so 'Done.' would be a lie");
}));

test("uninstall: a second global copy IS offered even while running one of them", () => withSandbox(async () => {
  const { uninstall } = loadUninstall();
  const self = "/users/me/appdata/roaming/npm/node_modules/@neosmithai/cli";
  const other = "/usr/local/lib/node_modules/@neosmithai/cli";
  let asked = 0;
  await uninstall.reportNpmInstall({
    running: self,
    globals: [self, other],
    confirm: async () => { asked++; return false; },
  });
  assert.equal(asked, 1, "the copy that is not executing has no self-deletion hazard");
}));

test("uninstall: nothing npm-installed prints no conditional footnote at all", () => withSandbox(async () => {
  const { uninstall } = loadUninstall();
  const lines = [];
  const origLog = console.log, origErr = console.error;
  console.log = (...a) => lines.push(a.join(" "));
  console.error = (...a) => lines.push(a.join(" "));
  let left;
  try {
    left = await uninstall.reportNpmInstall({ running: null, globals: [], confirm: async () => true });
  } finally { console.log = origLog; console.error = origErr; }

  assert.equal(left, null, "nothing left → the caller may say 'Done.'");
  assert.ok(!lines.join("\n").includes("npm uninstall -g"),
    "the old 'If you also installed via npm…' footnote fired on every run; a warning that " +
    "always fires is one nobody reads, and it was wrong precisely when it mattered");
}));

test("uninstall: --yes / --all do not spawn npm under --dry-run", () => withSandbox(async () => {
  const { uninstall } = loadUninstall();
  const saved = process.env.NEOSMITH_DRY_RUN;
  process.env.NEOSMITH_DRY_RUN = "1";
  try {
    const left = await uninstall.reportNpmInstall({
      running: null,
      globals: ["/somewhere/npm/node_modules/@neosmithai/cli"],
      confirm: async () => true,
    });
    assert.ok(left, "a dry run reports what it would do and removes nothing");
  } finally {
    if (saved === undefined) delete process.env.NEOSMITH_DRY_RUN;
    else process.env.NEOSMITH_DRY_RUN = saved;
  }
}));
