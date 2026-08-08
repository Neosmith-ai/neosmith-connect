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
const { Writable } = require("stream");
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
    //
    // The sink MUST be a Writable, not a Transform. A Transform's readable
    // side has nobody reading it here, so once its buffer fills, writes stop
    // being acknowledged, "finish" never fires and this promise never settles
    // — main() then falls off the end of the event loop and the process exits
    // 0 with no output. That is a smoke gate that always "passes".
    let pass = 0, fail = 0;
    const counter = new Writable({
      write(chunk, _enc, cb) {
        const s = chunk.toString();
        buf += s;
        if (!QUIET) process.stdout.write(s);
        for (const line of s.split("\n")) {
          if (/^\s*✔/.test(line)) pass++;
          else if (/^\s*✖/.test(line)) fail++;
        }
        cb();
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

  // Pre-existing editor settings to prove merge-not-clobber + byte-for-byte
  // restore. VS Code's block carries a USER-DEFINED env var (issue #15): it
  // must survive `on` and be back after `off`.
  //
  // The editor settings paths are per-OS and are resolved INSIDE the child,
  // via claude.js's own editorSettingsPath(), because only the child has the
  // sandbox HOME. Seeding them here from a hardcoded Windows layout meant that
  // on Linux/macOS the CLI wrote somewhere else entirely — and the "restored
  // byte-for-byte" checks passed against a file nothing had touched.
  const codeBefore = JSON.stringify({
    "editor.fontSize": 15,
    "workbench.colorTheme": "Default Dark+",
    "claudeCode.environmentVariables": [
      { name: "HTTPS_PROXY", value: "http://corp-proxy:8080" },
    ],
  }, null, 2) + "\n";
  const cursorBefore = JSON.stringify({ "editor.minimap.enabled": false }, null, 2) + "\n";
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
    // Same resolver the harness uses — no second copy of the per-OS switch.
    'const codeS = claude.editorSettingsPath("vscode");',
    'const cursorS = claude.editorSettingsPath("cursor");',
    'const cliS = path.join(home, ".claude", "settings.json");',
    // Seed the pre-connect editor settings at those real paths.
    `const codeBefore = ${JSON.stringify(codeBefore)};`,
    `const cursorBefore = ${JSON.stringify(cursorBefore)};`,
    'fs.mkdirSync(path.dirname(codeS), { recursive: true });',
    'fs.mkdirSync(path.dirname(cursorS), { recursive: true });',
    'fs.writeFileSync(codeS, codeBefore);',
    'fs.writeFileSync(cursorS, cursorBefore);',
    // Report the resolved paths so the parent checks the same files.
    'console.log("SMOKE_PATHS=" + JSON.stringify({ codeS, cursorS, cliS }));',
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
    // Issue #15: a second `on` must never overwrite the pre-connect snapshot.
    // codex is the harness that used to lose the user config here.
    'console.log("\\n### CODEX on/on/off (issue #15 double-connect) ###");',
    'const codex = require(cli + "/lib/harnesses/codex");',
    'const codexCfg = path.join(home, ".codex", "config.toml");',
    'fs.mkdirSync(path.dirname(codexCfg), { recursive: true });',
    'const codexBefore = \'model = "gpt-5-user"\\nmodel_provider = "openai"\\n\';',
    'fs.writeFileSync(codexCfg, codexBefore);',
    'fs.writeFileSync(path.join(outdir, "codex.config.before.toml"), codexBefore);',
    'codex.on({ key: "sk-plus-smoke-XXXXXXXXXXXX", model: h.resolveModel("pro") });',
    'save("codex.config.wired.toml", codexCfg);',
    'codex.on({ key: "sk-plus-smoke-XXXXXXXXXXXX", model: h.resolveModel("basic") });',
    'codex.off({});',
    'save("codex.config.after-off.toml", codexCfg);',
    'console.log("CODEX_RESTORED=" + (read(codexCfg) === codexBefore));',
  ].join("\n"));

  const res = spawnSync(process.execPath, [runner, home, dir], { cwd: PKG, encoding: "utf8" });
  const log_ = (res.stdout || "") + "\n" + (res.stderr || "");
  write(path.join(dir, "rehearsal.log"), log_);

  // The child reports where it actually wrote. If that line is missing the run
  // died early — fail loudly rather than silently checking files that were
  // never touched.
  const pathsLine = (log_.match(/^SMOKE_PATHS=(.*)$/m) || [])[1];
  let paths = null;
  try { paths = pathsLine ? JSON.parse(pathsLine) : null; } catch { /* left null */ }
  if (!paths) {
    return {
      ok: false,
      checks: [["rehearsal child reported the paths it wrote to", false]],
      log: log_,
    };
  }
  const { codeS: codeSettings, cursorS: cursorSettings, cliS: cliSettings } = paths;

  // Save the post-off state for the byte-restore invariant. (The wired state
  // was already saved by the child during `on`.)
  const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "(absent after off)");
  write(path.join(dir, "cli.settings.after-off.json"), read(cliSettings));
  write(path.join(dir, "editor-after.code.settings.json"), read(codeSettings));
  write(path.join(dir, "editor-after.cursor.settings.json"), read(cursorSettings));

  // Invariant check: editor settings restored byte-for-byte, cli settings removed.
  const codeRestored = fs.existsSync(codeSettings) && fs.readFileSync(codeSettings, "utf8") === codeBefore;
  const cursorRestored = fs.existsSync(cursorSettings) && fs.readFileSync(cursorSettings, "utf8") === cursorBefore;
  const cliRemoved = !fs.existsSync(cliSettings);
  const statusOn = /"on":true/.test(log_);
  // The wired artifact must differ from the seed — otherwise `on` never touched
  // the file and every "restored byte-for-byte" check below is vacuous.
  const editorActuallyWired =
    read(path.join(dir, "editor-wired.code.settings.json")) !== codeBefore;

  // Issue #15 invariants.
  const wiredCode = read(path.join(dir, "editor-wired.code.settings.json"));
  let userVarMerged = false;
  try {
    const vars = JSON.parse(wiredCode)["claudeCode.environmentVariables"] || [];
    const byName = Object.fromEntries(vars.map((e) => [e.name, e.value]));
    userVarMerged = byName.HTTPS_PROXY === "http://corp-proxy:8080" &&
      byName.ANTHROPIC_BASE_URL === "https://router.neosmith.ai";
  } catch { /* left false */ }
  const codexRestored = /CODEX_RESTORED=true/.test(log_);

  const checks = [
    ["claude on → status reports on:true", statusOn],
    ["on → the editor settings.json was actually written (not a vacuous pass)", editorActuallyWired],
    ["on → user's own editor env var merged, not clobbered (issue #15)", userVarMerged],
    ["off → VS Code settings restored byte-for-byte", codeRestored],
    ["off → Cursor settings restored byte-for-byte", cursorRestored],
    ["off → ~/.claude/settings.json removed (was absent pre-connect)", cliRemoved],
    ["codex on → on → off restores the user's config (issue #15)", codexRestored],
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
  lines.push("  codex.config.before.toml      ~/.codex/config.toml before connect");
  lines.push("  codex.config.wired.toml       ~/.codex/config.toml as written by `on`");
  lines.push("  codex.config.after-off.toml   ~/.codex/config.toml after on→on→off (must equal before)");
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
