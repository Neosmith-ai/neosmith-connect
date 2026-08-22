// scripts/contract/setup.detect.test.js
//
// `neosmith setup` only offers to wire a harness it believes is installed, and
// its generic probe is:
//
//   path.join(HOME, path.basename(path.dirname(manifestEntry.configFile)))
//
// That works for a harness whose config sits one level under HOME (~/.codex,
// ~/.continue, ~/.openclaw) and silently produces a nonsense path for anything
// else — ~/.config/opencode/opencode.json becomes ~/opencode, and
// ~/.junie/models/neosmith.json becomes ~/models. Neither directory can ever
// exist, so the harness is never detected, `setup` never offers it, and there
// is no error to notice: the tool just quietly is not in the list.
//
// Each harness that needs one therefore carries an explicit probe. This file
// asserts that every manifest entry resolves to at least one path that could
// plausibly exist, and pins the specific ones.

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { withSandbox } = require("./_sandbox");

function loadSetup() {
  for (const m of ["../../lib/io", "../../lib/harness", "../../lib/commands/setup"]) {
    delete require.cache[require.resolve(m)];
  }
  return {
    io: require("../../lib/io"),
    harness: require("../../lib/harness"),
    setup: require("../../lib/commands/setup"),
  };
}

// The probe list is computed before the filesystem filter, so create the
// directory the harness would really use and check the probe finds it.
test("setup detects every file-writable harness from its real config directory", () => withSandbox(() => {
  const { io, harness, setup } = loadSetup();
  const manifest = harness.manifest();

  // Where each harness's config actually lives, relative to the sandbox HOME.
  // Deliberately written out rather than derived from the manifest — deriving
  // it would reproduce the very bug this file exists to catch.
  const zedDir = process.platform === "win32"
    ? ["Zed"]                                            // sandbox sets APPDATA to HOME
    : process.platform === "darwin"
      ? ["Library", "Application Support", "Zed"]
      : [".config", "zed"];

  const REAL_DIRS = {
    claude:   [".claude"],
    codex:    [".codex"],
    continue: [".continue"],
    cline:    [".cline"],
    zed:      zedDir,
    copilot:  null,        // VS Code User dir; has its own explicit probe
    opencode: [".config", "opencode"],
    openclaw: [".openclaw"],
    junie:    [".junie"],
  };

  for (const entry of manifest.harnesses) {
    const rel = REAL_DIRS[entry.id];
    if (!rel) continue;
    const dir = path.join(io.HOME, ...rel);
    fs.mkdirSync(dir, { recursive: true });

    assert.ok(setup.isInstalled(entry),
      `setup must detect '${entry.id}' from ${rel.join("/")} — an undetected harness is one ` +
      `\`neosmith setup\` silently never offers`);
  }
}));

test("setup does not claim a harness is installed when nothing of it is on disk", () => withSandbox(() => {
  const { harness, setup } = loadSetup();
  for (const entry of harness.manifest().harnesses) {
    assert.equal(setup.isInstalled(entry), false,
      `${entry.id}: a fresh HOME has nothing installed — a probe matching here is matching the wrong thing`);
  }
}));

test("setup's opencode probe targets ~/.config/opencode, not ~/opencode", () => withSandbox(() => {
  const { io, harness, setup } = loadSetup();
  const entry = harness.manifest().harnesses.find((h) => h.id === "opencode");

  // The path the generic probe would produce. Creating it must NOT be enough.
  fs.mkdirSync(path.join(io.HOME, "opencode"), { recursive: true });
  assert.equal(setup.isInstalled(entry), false,
    "~/opencode is an artefact of basename(dirname(configFile)) — it is not where OpenCode lives");

  fs.mkdirSync(path.join(io.HOME, ".config", "opencode"), { recursive: true });
  assert.ok(setup.isInstalled(entry));
}));

test("setup's opencode probe also accepts the data dir, for a /connect-only user", () => withSandbox(() => {
  const { io, harness, setup } = loadSetup();
  const entry = harness.manifest().harnesses.find((h) => h.id === "opencode");
  // auth.json and the project store live here; someone who authenticated with
  // `/connect` and never hand-wrote a config has this and nothing else.
  fs.mkdirSync(path.join(io.HOME, ".local", "share", "opencode"), { recursive: true });
  assert.ok(setup.isInstalled(entry));
}));

test("setup's junie probe targets ~/.junie, not ~/models, and honours JUNIE_HOME", () => withSandbox((home) => {
  const { io, harness, setup } = loadSetup();
  const entry = harness.manifest().harnesses.find((h) => h.id === "junie");

  const saved = process.env.JUNIE_HOME;
  try {
    delete process.env.JUNIE_HOME;
    fs.mkdirSync(path.join(io.HOME, "models"), { recursive: true });
    assert.equal(setup.isInstalled(entry), false,
      "~/models is an artefact of basename(dirname(configFile)) — Junie's profiles are under ~/.junie/models");

    fs.mkdirSync(path.join(io.HOME, ".junie"), { recursive: true });
    assert.ok(setup.isInstalled(entry));

    // JUNIE_HOME moves the whole tree, so the probe has to follow it.
    const custom = path.join(home, "elsewhere-junie");
    process.env.JUNIE_HOME = custom;
    fs.rmSync(path.join(io.HOME, ".junie"), { recursive: true, force: true });
    assert.equal(setup.isInstalled(entry), false, "the default location is gone");
    fs.mkdirSync(custom, { recursive: true });
    assert.ok(setup.isInstalled(entry), "and JUNIE_HOME is where it moved to");
  } finally {
    if (saved === undefined) delete process.env.JUNIE_HOME;
    else process.env.JUNIE_HOME = saved;
  }
}));

test("setup's cline and zed probes are not the generic HOME-level artefacts either", () => withSandbox(() => {
  const { io, harness, setup } = loadSetup();
  const byId = (id) => harness.manifest().harnesses.find((h) => h.id === id);

  // ~/.cline/data/settings/providers.json used to probe ~/settings.
  fs.mkdirSync(path.join(io.HOME, "settings"), { recursive: true });
  assert.equal(setup.isInstalled(byId("cline")), false, "~/settings is not Cline");

  // The manifest path for zed is ~/.config/zed/settings.json, which probed
  // ~/zed. Not assertable on Windows: the sandbox points APPDATA at HOME and
  // NTFS is case-insensitive, so ~/zed and the real ~/Zed probe are the same
  // directory. The POSIX runners cover it.
  if (process.platform !== "win32") {
    fs.mkdirSync(path.join(io.HOME, "zed"), { recursive: true });
    assert.equal(setup.isInstalled(byId("zed")), false, "~/zed is not where Zed keeps its settings");
  }
}));

test("every manifest harness resolves probes without throwing", () => withSandbox(() => {
  const { harness, setup } = loadSetup();
  for (const entry of harness.manifest().harnesses) {
    // A UI-driven harness (cursor) legitimately yields none — it is wired by
    // hand, not by `setup`. What must never happen is a throw on a manifest
    // shape nobody anticipated.
    const probes = setup.harnessInstallPaths(entry);
    assert.ok(Array.isArray(probes), `${entry.id}: harnessInstallPaths must return a list`);
  }
}));
