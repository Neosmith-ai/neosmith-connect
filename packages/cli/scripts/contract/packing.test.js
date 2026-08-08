// scripts/contract/packing.test.js
//
// What actually ships. CONTRIBUTING.md calls a file missing from the `files`
// allowlist "the single most common source of 'worked locally, broken on npm'
// bugs", and nothing tested for it: publish.yml's only real-CLI check is
// `node bin/neosmith.js help` run from the SOURCE TREE, where every file is
// present whether or not it is packed.
//
// `npm pack --dry-run --json` reports the exact tarball contents without
// building anything, so this is fast enough to run in the normal suite.

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const PKG = path.resolve(__dirname, "..", "..");
const pkgJson = require("../../package.json");

// `npm pack --dry-run --json` prints JSON on stdout, but npm also emits
// notices on stderr — parse only the JSON payload.
const packed = (() => {
  const r = spawnSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: PKG, encoding: "utf8", shell: process.platform === "win32",
  });
  if (r.status !== 0) throw new Error(`npm pack --dry-run failed:\n${r.stderr}`);
  const start = r.stdout.indexOf("[");
  const parsed = JSON.parse(r.stdout.slice(start));
  return parsed[0].files.map((f) => f.path.replace(/\\/g, "/"));
})();

const inTarball = (p) => packed.includes(p.replace(/\\/g, "/"));

test("every lib/**/*.js on disk is in the tarball", () => {
  // The failure this prevents: a new lib/ module that works from the checkout
  // and throws MODULE_NOT_FOUND for everyone who installed from npm.
  const onDisk = [];
  const walk = (dir, prefix) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) { walk(full, `${prefix}${name}/`); continue; }
      if (name.endsWith(".js")) onDisk.push(`${prefix}${name}`);
    }
  };
  walk(path.join(PKG, "lib"), "lib/");

  const missing = onDisk.filter((f) => !inTarball(f));
  assert.deepEqual(missing, [], `lib files missing from the npm tarball: ${missing.join(", ")}`);
});

test("the runtime data files ship", () => {
  // Each of these is require()d or read at runtime. Any one of them missing
  // is a crash on first run for an npm-installed user.
  for (const f of [
    "bin/neosmith.js",
    "harnesses.json",
    "contract/router-contract.v1.json",
    "package.json",
    "README.md",
  ]) {
    assert.ok(inTarball(f), `${f} is not in the npm tarball (check package.json "files")`);
  }
});

test("the installers ship", () => {
  // The router serves these at /install.sh and /install.ps1, but they are also
  // shipped in the package so a fork or an air-gapped install works.
  assert.ok(inTarball("install.sh"));
  assert.ok(inTarball("install.ps1"));
});

test("tests, fixtures and smoke artifacts never ship", () => {
  const leaked = packed.filter((f) =>
    f.startsWith("scripts/") ||
    f.startsWith(".smoke/") ||
    f.startsWith(".sandbox/") ||
    f.endsWith(".test.js"),
  );
  assert.deepEqual(leaked, [], `these should not be published: ${leaked.join(", ")}`);
});

test("no key material or local state is in the tarball", () => {
  const suspicious = packed.filter((f) =>
    /(^|\/)\.env($|\.)/.test(f) || f.includes(".neosmith/") || f.endsWith(".bak"),
  );
  assert.deepEqual(suspicious, [], `these must never be published: ${suspicious.join(", ")}`);
});

test("every entry in the files allowlist actually exists", () => {
  // A stale allowlist entry is harmless to npm but hides a rename: the file it
  // named is gone, and whatever replaced it may not be covered by any pattern.
  for (const entry of pkgJson.files) {
    const p = path.join(PKG, entry.replace(/\/$/, ""));
    assert.ok(fs.existsSync(p), `package.json "files" lists ${entry}, which does not exist`);
  }
});

test("the packed CLI runs and reports its version", () => {
  // Cheap end-to-end: the binary in the tarball is the one that must work.
  // (A full tarball install is the e2e workflow's `pack` job; this catches a
  // syntax error or a bad require without paying for that.)
  const r = spawnSync(process.execPath, [path.join(PKG, "bin", "neosmith.js"), "--version"], {
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), pkgJson.version);
});
