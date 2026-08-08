#!/usr/bin/env node
// scripts/install-hook.js — opt-in pre-push gate.
//
//   npm run install-hook      (from the repo root or packages/cli)
//
// Points core.hooksPath at the repo-tracked hooks/ dir, which contains a
// pre-push hook that runs `npm run smoke:ci` and BLOCKS the push on failure.
// Override a single push with `git push --no-verify`.
//
// To remove the gate:  git config --unset core.hooksPath

"use strict";

const { execSync } = require("child_process");
const path = require("path");

function run(cmd) { return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }

let root;
try {
  root = run("git rev-parse --show-toplevel");
} catch {
  console.error("✗ not inside a git repository — run this from the neosmith-connect checkout.");
  process.exit(1);
}

const hooksDir = path.join(root, "hooks");
execSync("git config core.hooksPath hooks", { stdio: "inherit" });
console.log(`✓ core.hooksPath → hooks  (${hooksDir})`);
console.log("  pre-push now runs `npm run smoke:ci` and blocks on failure.");
console.log("  Bypass once with: git push --no-verify");
console.log("  Remove with:      git config --unset core.hooksPath");
