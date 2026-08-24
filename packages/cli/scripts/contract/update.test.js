// scripts/contract/update.test.js
//
// Contract for `neosmith update`.
//
// The promise this command makes is "your settings survive", and that promise
// is the whole reason it exists — people put updates off because they do not
// know whether their key and their wiring come through. So the tests that
// matter here are the ones that pin the promise, not the happy path:
//
//   - the version comparison, because a string compare says 0.10.0 < 0.9.0 and
//     would silently tell every user they are up to date forever;
//   - the install-method detection, because updating the wrong copy leaves two
//     on PATH — the exact mess `uninstall` grew a detector for;
//   - the state inventory, which is what the command re-checks after the update
//     to verify (not assert) that nothing was lost.
//
// Nothing here spawns npm or an installer. `performUpdate` is the only part
// that does, and it is a three-line dispatch over the detection this file pins.

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { withSandbox } = require("./_sandbox");

function loadUpdate() {
  for (const m of ["../../lib/io", "../../lib/commands/uninstall", "../../lib/commands/update"]) {
    delete require.cache[require.resolve(m)];
  }
  return {
    io: require("../../lib/io"),
    update: require("../../lib/commands/update"),
  };
}

// ── version comparison ──────────────────────────────────────────────────────

test("update: 0.10.0 is newer than 0.9.0", () => {
  const { update } = loadUpdate();
  // The bug a string compare gives you: "0.10.0" < "0.9.0" lexically, so an
  // installed 0.9.0 would be reported as current forever, through every 0.1x.
  assert.equal(update.compareVersions("0.9.0", "0.10.0"), -1);
  assert.equal(update.compareVersions("0.10.0", "0.9.0"), 1);
  assert.ok("0.10.0" < "0.9.0", "…which is what a naive compare would have done");
});

test("update: equal versions compare equal, and patch/minor/major all order", () => {
  const { update } = loadUpdate();
  assert.equal(update.compareVersions("1.2.3", "1.2.3"), 0);
  assert.equal(update.compareVersions("1.2.3", "1.2.4"), -1);
  assert.equal(update.compareVersions("1.2.3", "1.3.0"), -1);
  assert.equal(update.compareVersions("1.2.3", "2.0.0"), -1);
  assert.equal(update.compareVersions("2.0.0", "1.99.99"), 1);
});

test("update: a prerelease sorts below its release", () => {
  const { update } = loadUpdate();
  // publish.yml routes -rc/-beta/-alpha/-next to the `next` dist-tag, so these
  // do reach real users who opt in.
  assert.equal(update.compareVersions("1.0.0-rc.1", "1.0.0"), -1);
  assert.equal(update.compareVersions("1.0.0", "1.0.0-rc.1"), 1);
  assert.equal(update.compareVersions("1.0.0-rc.1", "1.0.0-rc.2"), -1);
});

test("update: a short version compares against a longer one", () => {
  const { update } = loadUpdate();
  assert.equal(update.compareVersions("1.2", "1.2.0"), 0);
  assert.equal(update.compareVersions("1.2", "1.2.1"), -1);
});

// ── install-method detection ────────────────────────────────────────────────

test("update: running from a checkout with no global install is a checkout", () => withSandbox(() => {
  const { update } = loadUpdate();
  // The sandbox HOME has no ~/.neosmith/cli and no npm prefix, and the tests
  // run from the working tree.
  const saved = process.env.npm_config_prefix;
  process.env.npm_config_prefix = path.join(process.env.HOME, "empty-prefix");
  try {
    const m = update.installMethod();
    assert.equal(m.kind, "checkout",
      "a git working tree updates with `git pull`, not with npm");
  } finally {
    if (saved === undefined) delete process.env.npm_config_prefix;
    else process.env.npm_config_prefix = saved;
  }
}));

test("update: a global install is found even when running from a checkout", () => withSandbox((home) => {
  const { update } = loadUpdate();
  // The blind spot `uninstall` had: __dirname says "checkout", but the copy on
  // PATH is npm's, and that is the one an update has to replace.
  const dir = path.join(home, "npm-prefix", "node_modules", "@neosmithai", "cli");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"),
    JSON.stringify({ name: "@neosmithai/cli", version: "0.1.0" }));

  const saved = process.env.npm_config_prefix;
  process.env.npm_config_prefix = path.join(home, "npm-prefix");
  try {
    const m = update.installMethod();
    assert.equal(m.kind, "npm-global");
    assert.equal(m.viaCheckout, true, "flagged, so the output can say which copy it means");

    // And the version reported must be THAT copy's, not the checkout's —
    // otherwise the comparison is against the wrong number entirely.
    assert.equal(update.currentVersion(m), "0.1.0",
      "reporting the checkout's version here could say 'already latest' while the " +
      "installed copy is several releases behind");
  } finally {
    if (saved === undefined) delete process.env.npm_config_prefix;
    else process.env.npm_config_prefix = saved;
  }
}));

test("update: with no method override, currentVersion is this package's own", () => {
  const { update } = loadUpdate();
  assert.equal(update.currentVersion(), require("../../package.json").version);
  assert.equal(update.currentVersion({ kind: "checkout" }), require("../../package.json").version);
});

// ── the promise: settings survive ───────────────────────────────────────────

test("update: the state inventory names exactly what must survive", () => withSandbox(() => {
  const { io, update } = loadUpdate();
  assert.deepEqual(update.stateInventory(), [], "nothing configured yet, nothing to protect");

  io.writeKeyRef("sk-plus-update-test-aaaa", "prod");
  io.setHarnessFlag("zed", true, { model: "neosmith.intelligent-pro" });
  io.snapshot("zed", path.join(process.env.HOME, "some-config.json"));

  const paths = update.stateInventory().map(([, p]) => p);
  assert.ok(paths.includes(io.CONFIG_FILE), "the stored key");
  assert.ok(paths.includes(io.STATE_FILE), "which harnesses are on + the restore ledger");
  assert.ok(paths.includes(io.SNAPSHOTS_DIR), "the user's own pre-connect config files");
  assert.ok(paths.includes(io.AUDIT_FILE), "the write history");
}));

test("update: state lives outside the directory an installer replaces", () => withSandbox(() => {
  const { io, update } = loadUpdate();
  io.writeKeyRef("sk-plus-update-test-aaaa", "prod");
  io.setHarnessFlag("zed", true, {});

  // This is the invariant the whole command rests on. install.sh removes
  // ${HOME}/.neosmith/cli and install.ps1 removes $CliDir — NOT ~/.neosmith.
  // If either ever widened to the parent, every one of these would go with it.
  const replaced = path.join(io.HOME, ".neosmith", "cli");
  for (const [what, p] of update.stateInventory()) {
    assert.ok(!p.startsWith(replaced + path.sep) && p !== replaced,
      `${what} (${p}) sits inside the directory an installer deletes — an update would destroy it`);
    assert.ok(p.startsWith(io.NEOSMITH_DIR),
      `${what} should live under ~/.neosmith so it is found and re-checked`);
  }
}));

test("update: an update does not disturb a wired harness's own config", () => withSandbox(() => {
  const { io, update } = loadUpdate();
  const harness = require("../../lib/harness");
  delete require.cache[require.resolve("../../lib/harnesses/zed")];
  const zed = require("../../lib/harnesses/zed");

  zed.on({ key: "sk-plus-update-test-aaaa", model: harness.resolveModel("pro") });
  const before = fs.readFileSync(zed.configFile, "utf8");

  // `update` calls neither on() nor off(), so a harness config is not in scope
  // at all — it is not even under ~/.neosmith. Pinned because "do my harnesses
  // stay connected?" is the question the command answers in its output.
  for (const [, p] of update.stateInventory()) {
    assert.notEqual(p, zed.configFile);
  }
  assert.equal(fs.readFileSync(zed.configFile, "utf8"), before);
  assert.equal(zed.status({}).on, true, "still wired");
}));

// ── flags ───────────────────────────────────────────────────────────────────

test("update: flags parse, and --check is distinct from --yes", () => {
  const { update } = loadUpdate();
  assert.deepEqual(update.parseFlags([]), { check: false, yes: false });
  assert.deepEqual(update.parseFlags(["--check"]), { check: true, yes: false });
  assert.deepEqual(update.parseFlags(["-c"]), { check: true, yes: false });
  assert.deepEqual(update.parseFlags(["--yes"]), { check: false, yes: true });
  assert.deepEqual(update.parseFlags(["-y"]), { check: false, yes: true });
  // --check must never imply --yes: "tell me what's available" and "install it
  // without asking" are different requests.
  assert.deepEqual(update.parseFlags(["--check", "--yes"]), { check: true, yes: true });
});

test("update: it points at the real package on the real registry", () => {
  const { update } = loadUpdate();
  assert.equal(update.PKG, "@neosmithai/cli");
  assert.equal(update.REGISTRY, "https://registry.npmjs.org");
});
