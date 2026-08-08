#!/usr/bin/env node
// scripts/e2e/offline.js — run the e2e driver over EVERY harness against the
// offline contract mock.
//
//   node scripts/e2e/offline.js
//
// No secrets, no network, no cost, so it runs in the normal CI matrix on all
// three OSes. Its job is to prove the driver itself works everywhere before
// the expensive staging workflow depends on it — a bug in run.js should cost
// a free job, not a paid one.
//
// What it can and cannot prove:
//   CAN  · config writes land at the right per-OS paths and point at the
//          selected environment; `off` restores byte-for-byte; printed
//          instructions are platform-correct; no key leaks into a harness
//          config or the audit log.
//   CANNOT · that inference actually works. A canned response proves nothing
//          about a model, so run.js reports the prompt step as skipped here
//          and only exercises it against a live router.

"use strict";

const path = require("path");
const { spawn, spawnSync } = require("child_process");

const HERE = __dirname;
const PKG = path.resolve(HERE, "..", "..");
const MOCK = path.join(PKG, "scripts", "contract", "_mock_server.js");
const RUN = path.join(HERE, "run.js");
const CLI = path.join(PKG, "bin", "neosmith.js");

// `local` is declared as 127.0.0.1:4008 in harnesses.json, so the mock must
// bind that exact port to be recognized as that environment. An ephemeral
// port is deliberately NOT `local` — that is the host-matching rule working.
const PORT = 4008;
const HARNESSES = ["claude", "codex", "continue", "zed", "copilot", "cline", "jetbrains", "cursor"];

function startMock() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [MOCK, "--contract", "--port", String(PORT)],
      { stdio: ["ignore", "pipe", "pipe"] });
    let url = null;
    let err = "";
    child.stdout.on("data", (c) => {
      const line = c.toString().trim();
      if (!url && line.startsWith("http://")) { url = line; resolve({ url, child }); }
    });
    child.stderr.on("data", (c) => { err += c.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (!url) {
        reject(new Error(
          `mock router could not bind 127.0.0.1:${PORT} (exit ${code}).\n` +
          `Something else is on that port — a real local router, or a previous run.\n${err}`));
      }
    });
  });
}

(async () => {
  const { url, child } = await startMock();
  console.log(`offline e2e · mock router at ${url}\n`);

  const failed = [];
  try {
    for (const h of HARNESSES) {
      const r = spawnSync(process.execPath, [
        RUN, "--harness", h, "--env", "local", "--cli-script", CLI,
      ], {
        encoding: "utf8",
        env: { ...process.env, NEOSMITH_E2E_KEY: process.env.NEOSMITH_E2E_KEY || "sk-slm-offline-e2e-000" },
      });
      process.stdout.write(r.stdout || "");
      if (r.status !== 0) {
        process.stderr.write(r.stderr || "");
        failed.push(h);
      }
    }
  } finally {
    child.kill();
  }

  if (failed.length) {
    console.error(`\noffline e2e FAILED for: ${failed.join(", ")}`);
    process.exit(1);
  }
  console.log(`\noffline e2e PASSED · ${HARNESSES.length} harnesses · platform=${process.platform}`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
