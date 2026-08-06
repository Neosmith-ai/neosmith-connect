// scripts/contract/_sandbox.js
//
// Test helper: reset HOME / USERPROFILE / XDG / APPDATA to a temp directory
// before each test, so io.js writes go to a fresh ~/.neosmith per test.
//
// Usage:
//   const withSandbox = require("./_sandbox");
//   test("...", () => withSandbox((home) => {
//     // HOME is now the temp dir; io.js points at <home>/.neosmith
//   }));
//
// All settings are restored after the test body resolves.

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "neosh-sandbox-"));
}

const ENV_KEYS = ["HOME", "USERPROFILE", "APPDATA", "XDG_CONFIG_HOME"];

function withSandbox(fn) {
  const sandboxHome = freshHome();
  const saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    process.env[k] = sandboxHome;
  }
  try {
    const result = fn(sandboxHome);
    if (result && typeof result.then === "function") {
      return result.finally(() => restore(saved));
    }
    restore(saved);
    return result;
  } catch (e) {
    restore(saved);
    throw e;
  }
}

function restore(saved) {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}

// strip HOME override for direct subprocess inspection (used by tests
// that call `node -e` against a fixture).
function sandboxForFixture({ apiKey, harness, model, extraEnv } = {}) {
  const home = freshHome();
  const env = { ...process.env, HOME: home, USERPROFILE: home, NEOSMITH_KEY: apiKey || "" };
  if (extraEnv) Object.assign(env, extraEnv);
  return { home, env };
}

module.exports = { withSandbox, freshHome, sandboxForFixture };
