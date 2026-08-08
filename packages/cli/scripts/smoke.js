#!/usr/bin/env node
// scripts/smoke.js — one-command, human-inspectable smoke gate for the CLI.
//
//   npm run smoke            → full report + open the artifacts folder
//   npm run smoke -- --quiet → exit-code only (for CI / pre-push hooks)
//
// What it does, in order:
//   1. Runs every scripts/contract/*.test.js under node --test, verbose, and
//      captures the named pass/fail list to a report file.
//   2. Rehearses a real claude on → status → off cycle against a FAKE HOME
//      (never your real ~/.claude or editor settings), with a fake VS Code +
//      Claude Code extension present, and saves every file it writes plus
//      before/after editor diffs.
//   3. Bundles it all into .smoke/<timestamp>/ and prints the absolute path.
//
// The artifacts folder is the point: open it and read exactly what the CLI
// would write, what it preserved, and what it restored — without touching your
// machine.

"use strict";

const { spawnSync } = require("child_process");
const { run: runTests } = require("node:test");
const { spec: specReporter } = require("node:test/reporters");
const { Transform } = require("stream");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PKG = path.resolve(__dirname, "..");
const CONTRACT_DIR = path.join(__dirname, "contract");
const OUT_ROOT = path.join(PKG, ".smoke");
const BIN = path.join(PKG, "bin", "neosmith.js");

const QUIET = process.argv.includes("--quiet") || process.argv.includes("-q");
const NO_OPEN = QUIET || process.argv.includes("--no-open");

function log(s) { if (!QUIET) console.log(s); }
function out(s) { console.log(s); } // always printed (the folder path / result)

function mkdir(p) { fs.mkdirSync(p, { recursive: true }); return p; }
function write(p, s) { mkdir(path.dirname(p)); fs.writeFileSync(p, s); }

// ── 1. contract suite ───────────────────────────────────────────────────────
// Uses the node:test run() API with an explicit glob, so ONLY *.test.js files
// run (helpers like _sandbox.js / _mock_server.js are excluded) on every
// supported Node (18/20/22/24) and OS. run() returns a TapStream; we render it
// with the spec reporter into both the console and the report file, and count
// pass/fail from the stream events.
function runContractSuite(reportPath) {
  const files = fs.readdirSync(CONTRACT_DIR)
    .filter((f) => f.endsWith(".test.js"))
    .map((f) => path.join(CONTRACT_DIR, f));
  log(`\n▶ Running contract suite (${files.length} files via node:test run API)…`);

  return new Promise((resolve) => {
    const stream = runTests({ files, concurrency: true });
    let buf = "";
    // Parse the rendered spec/TAP text: top-level "✔ name"/"✖ name" (and the
    // "not ok" TAP form) mark leaf test results. Counting the rendered lines
    // is version-robust (the run-stream's event timing is not).
    let pass = 0, fail = 0;
    const counter = new Transform({
      transform(chunk, _enc, cb) {
        const s = chunk.toString();
        buf += s;
        if (!QUIET) process.stdout.write(s);
        for (const line of s.split("\n")) {
          if (/^\s*✔/.test(line)) pass++;
          else if (/^\s*✖/.test(line)) fail++;
        }
        cb(null, chunk);
      },
    });
    counter.on("finish", () => {
      write(reportPath, buf);
      resolve({ pass, fail, ok: fail === 0, text: buf });
    });
    stream.on("error", (err) => { buf += "\nSTREAM ERROR: " + (err && err.message) + "\n"; });
    stream.compose(specReporter()).pipe(counter);
  });
}

// ── 2. isolated claude on/off rehearsal ─────────────────────────────────────
// Runs in a CHILD process with HOME/USERPROFILE/APPDATA pointed at a fake dir
// so the real profile is never read or written. Saves every artifact.
function runRehearsal(dir) {
  const home = mkdir(path.join(dir, "home"));
  mkdir(path.join(home, ".vscode", "extensions", "anthropic.claude-code-2.1.224-win32-x64"));
  mkdir(path.join(home, ".cursor", "extensions", "anthropic.claude-code-2.1.221-win32-x64"));
  mkdir(path.join(home, "Code", "User"));
  mkdir(path.join(home, "Cursor", "User"));

  // Pre-existing editor settings to prove merge-not-clobber + byte-for-byte restore.
  const codeSettings = path.join(home, "Code", "User", "settings.json");
  const cursorSettings = path.join(home, "Cursor", "User", "settings.json");
  const codeBefore = JSON.stringify({ "editor.fontSize": 15, "workbench.colorTheme": "Default Dark+" }, null, 2) + "\n";
  const cursorBefore = JSON.stringify({ "editor.minimap.enabled": false }, null, 2) + "\n";
  fs.writeFileSync(codeSettings, codeBefore);
  fs.writeFileSync(cursorSettings, cursorBefore);
  write(path.join(dir, "editor-before.code.settings.json"), codeBefore);
  write(path.join(dir, "editor-before.cursor.settings.json"), cursorBefore);

  // Child-process runner: sets HOME then drives the real harness on→off.
  // It snapshots the WIRED state (during on) into the artifacts dir so a dev
  // can see exactly what the CLI injects, before off() restores it.
  const runner = path.join(dir, "_rehearse.js");
  write(runner, [
    'const home = process.argv[2];',
    'const outdir = process.argv[3];',
    'process.env.HOME = home; process.env.USERPROFILE = home; process.env.APPDATA = home;',
    `const cli = ${JSON.stringify(PKG.replace(/\\/g, "/"))};`,
    'const h = require(cli + "/lib/harness");',
    'const claude = require(cli + "/lib/harnesses/claude");',
    'const fs = require("fs"), path = require("path");',
    'const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "(absent)");',
    'const save = (name, p) => fs.writeFileSync(path.join(outdir, name), read(p));',
    'const codeS = path.join(home, "Code", "User", "settings.json");',
    'const cursorS = path.join(home, "Cursor", "User", "settings.json");',
    'const cliS = path.join(home, ".claude", "settings.json");',
    'console.log("### ON ###");',
    'claude.on({ key: "sk-plus-smoke-XXXXXXXXXXXX", model: h.resolveModel("pro") });',
    'save("cli.settings.wired.json", cliS);',
    'save("editor-wired.code.settings.json", codeS);',
    'save("editor-wired.cursor.settings.json", cursorS);',
    'console.log("\\n### STATUS ###");',
    'console.log(JSON.stringify(claude.status({})));',
    'console.log("\\n### OFF ###");',
    'claude.off({});',
    'console.log("\\n### STATUS AFTER OFF ###");',
    'console.log(JSON.stringify(claude.status({})));',
  ].join("\n"));

  const res = spawnSync(process.execPath, [runner, home, dir], { cwd: PKG, encoding: "utf8" });
  const log_ = (res.stdout || "") + "\n" + (res.stderr || "");
  write(path.join(dir, "rehearsal.log"), log_);

  // Save the post-off state for the byte-restore invariant. (The wired state
  // was already saved by the child during `on`.)
  const cliSettings = path.join(home, ".claude", "settings.json");
  const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "(absent after off)");
  write(path.join(dir, "cli.settings.after-off.json"), read(cliSettings));
  write(path.join(dir, "editor-after.code.settings.json"), read(codeSettings));
  write(path.join(dir, "editor-after.cursor.settings.json"), read(cursorSettings));

  // Invariant check: editor settings restored byte-for-byte, cli settings removed.
  const codeRestored = fs.existsSync(codeSettings) && fs.readFileSync(codeSettings, "utf8") === codeBefore;
  const cursorRestored = fs.existsSync(cursorSettings) && fs.readFileSync(cursorSettings, "utf8") === cursorBefore;
  const cliRemoved = !fs.existsSync(cliSettings);
  const statusOn = /"on":true/.test(log_);

  const checks = [
    ["claude on → status reports on:true", statusOn],
    ["off → VS Code settings restored byte-for-byte", codeRestored],
    ["off → Cursor settings restored byte-for-byte", cursorRestored],
    ["off → ~/.claude/settings.json removed (was absent pre-connect)", cliRemoved],
  ];
  const ok = checks.every((c) => c[1]) && res.status === 0;
  return { ok, checks, log: log_ };
}

// ── 3. assemble + report ────────────────────────────────────────────────────
async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  const dir = mkdir(path.join(OUT_ROOT, stamp));
  mkdir(path.join(dir, "home"));

  log("NeoSmith CLI · smoke");
  log(`artifacts → ${dir}`);

  const contract = await runContractSuite(path.join(dir, "contract-tests.txt"));
  const rehearsal = runRehearsal(dir);

  // Human-readable summary.
  const lines = [];
  lines.push(`NeoSmith CLI smoke · ${new Date().toISOString()}`);
  lines.push("");
  lines.push(`Contract tests : ${contract.pass} passed, ${contract.fail} failed  (contract-tests.txt)`);
  lines.push("");
  lines.push("Rehearsal (claude on → status → off, isolated HOME):");
  for (const [label, ok] of rehearsal.checks) {
    lines.push(`  ${ok ? "✓" : "✗"}  ${label}`);
  }
  lines.push("");
  lines.push("Files in this folder:");
  lines.push("  contract-tests.txt            full named pass/fail list");
  lines.push("  rehearsal.log                 the on/status/off console output");
  lines.push("  cli.settings.wired.json       ~/.claude/settings.json as written by `on`");
  lines.push("  editor-wired.*.settings.json  editor settings as written by `on` (the claudeCode.* block)");
  lines.push("  editor-before.*.settings.json editor settings before connect");
  lines.push("  editor-after.*.settings.json  editor settings after disconnect (must equal before)");
  lines.push("  cli.settings.after-off.json   ~/.claude/settings.json after off (absent)");
  lines.push("  home/                         the sandbox HOME the rehearsal ran in");
  write(path.join(dir, "SUMMARY.txt"), lines.join("\n") + "\n");

  const allOk = contract.ok && rehearsal.ok;

  // Always print the result + folder, even in quiet mode.
  out("");
  out(`smoke ${allOk ? "PASSED" : "FAILED"} · ${contract.pass} tests · rehearsal ${rehearsal.ok ? "ok" : "FAILED"}`);
  out(`inspect: ${dir}`);
  if (!allOk) {
    out("");
    out(contract.text.split("\n").filter((l) => l.includes("✖")).slice(0, 20).join("\n"));
    rehearsal.checks.filter((c) => !c[1]).forEach((c) => out(`  ✗ ${c[0]}`));
  }

  if (!NO_OPEN) tryOpen(dir);
  process.exitCode = allOk ? 0 : 1;
}

function tryOpen(dir) {
  const plat = process.platform;
  const cmd = plat === "win32" ? "explorer" : plat === "darwin" ? "open" : "xdg-open";
  const args = plat === "win32" ? [dir] : [dir];
  const r = spawnSync(cmd, args, { stdio: "ignore", shell: plat === "win32" });
  if (r.error) log(`(couldn't auto-open folder: ${r.error.message})`);
}

main();
