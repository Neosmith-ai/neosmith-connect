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
