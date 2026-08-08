// Manifest reader — the single point that resolves and parses harnesses.json.
//
// Extracted from lib/harness.js so lib/env.js can read the manifest without
// requiring the registry. That would be a cycle: every lib/harnesses/*.js
// requires ../harness, so harness.js cannot be on env.js's require path.
//
// NEOSMITH_MANIFEST overrides the path (testing). The default resolves to
// harnesses.json in the package root (packages/cli/harnesses.json) — one level
// up from lib/ — which keeps the npm-published package self-contained:
// `npm install -g @neosmithai/cli` ships the manifest inside the package.

"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_MANIFEST_PATH = path.resolve(__dirname, "..", "harnesses.json");

let CACHE = null;

function resolvePath() {
  return process.env.NEOSMITH_MANIFEST || DEFAULT_MANIFEST_PATH;
}

// Memoized. Returns { manifestPath, manifest }.
function read() {
  if (CACHE) return CACHE;
  const manifestPath = resolvePath();
  const raw = fs.readFileSync(manifestPath, "utf8");
  CACHE = { manifestPath, manifest: JSON.parse(raw) };
  return CACHE;
}

// Test hook — drop the cache so a test can swap NEOSMITH_MANIFEST mid-process.
function reset() {
  CACHE = null;
}

module.exports = { read, reset, resolvePath, DEFAULT_MANIFEST_PATH };
