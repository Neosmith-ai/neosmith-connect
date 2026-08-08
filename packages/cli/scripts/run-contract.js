#!/usr/bin/env node
// scripts/run-contract.js — run every scripts/contract/*.test.js and exit
// non-zero if any test fails. Shared by CI and `npm test`.
//
// Why not `node --test <glob>` or `node --test <dir>`:
//   - Glob CLI args need Node 22+; this repo supports Node 18/20.
//   - Directory recursion (default since 18.13) also matches helper files like
//     _sandbox.js / _mock_server.js, which then run as (failing) "tests".
//   - The run-stream's own event timing is unreliable for exit codes on some
//     versions, so we count rendered ✔/✖ lines from the spec reporter instead.
"use strict";

const { run } = require("node:test");
const { spec } = require("node:test/reporters");
const { Writable } = require("stream");
const fs = require("fs");
const path = require("path");

// Explicit absolute file list — auto-discovers every *.test.js, excludes
// helpers (_sandbox.js, _mock_server.js), and is fully portable (glob args to
// run() are unreliable on Windows and unsupported pre-22).
// `--only a,b` restricts the run to the named suites (the filename without
// its .test.js suffix). Used by `npm run test:router-facing`, which the
// router's pre-deploy gate runs, and handy for local iteration.
const onlyArg = (() => {
  const i = process.argv.indexOf("--only");
  if (i !== -1) return process.argv[i + 1];
  const inline = process.argv.find((a) => a.startsWith("--only="));
  return inline ? inline.slice("--only=".length) : null;
})();
const only = onlyArg ? onlyArg.split(",").map((s) => s.trim()).filter(Boolean) : null;

const allFiles = fs.readdirSync(path.join(__dirname, "contract"))
  .filter((f) => f.endsWith(".test.js"));

const files = allFiles
  .filter((f) => !only || only.includes(f.replace(/\.test\.js$/, "")))
  .map((f) => path.join(__dirname, "contract", f));

if (only) {
  const known = allFiles.map((f) => f.replace(/\.test\.js$/, ""));
  const unknown = only.filter((n) => !known.includes(n));
  if (unknown.length) {
    console.error(`unknown suite(s): ${unknown.join(", ")}\nknown: ${known.join(", ")}`);
    process.exit(2);
  }
  console.log(`running ${files.length} of ${allFiles.length} suites: ${only.join(", ")}\n`);
}

// A Writable, not a Transform: nothing reads a Transform's readable side here,
// so its buffer fills, writes stall, "finish" never fires and the process
// exits 0 having reported nothing. See the same note in smoke.js.
let pass = 0, fail = 0;
const counter = new Writable({
  write(chunk, _enc, cb) {
    const s = chunk.toString();
    process.stdout.write(s);
    for (const line of s.split("\n")) {
      if (/^\s*✔/.test(line)) pass++;
      else if (/^\s*✖/.test(line)) fail++;
    }
    cb();
  },
});
counter.on("finish", () => {
  console.log(`\ncontract suite: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
});
run({ files, concurrency: true }).compose(spec()).pipe(counter);
