// scripts/contract/originals.test.js
//
// Contract for `neosmith originals` and the surfacing of stored pre-connect
// settings generally.
//
// Why this exists: `on` has always copied the user's config to
// ~/.neosmith/snapshots/<id>.bak, but nothing told the user that. `status`
// showed on/off and the stored key; the only record of which real file a given
// .bak came from was audit.log. And `reset`/`uninstall` could destroy those
// copies without ever naming them.
//
// The load-bearing claims here:
//   - every .bak is discoverable, with its SOURCE PATH resolved
//   - source resolution degrades gracefully (ledger → audit log → registry),
//     so connects made before the restore ledger existed still resolve
//   - a tombstone reads as "no file existed", not as an empty backup
//   - --export produces something the user can actually restore by hand
//   - listing is read-only: it must never disturb a snapshot or a ledger

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { withSandbox } = require("./_sandbox");

const HARNESS_MODULES = ["claude", "cline", "codex", "continue", "copilot", "cursor", "jetbrains", "zed"];

function loadAll() {
  delete require.cache[require.resolve("../../lib/io")];
  delete require.cache[require.resolve("../../lib/harness")];
  delete require.cache[require.resolve("../../lib/originals")];
  for (const id of HARNESS_MODULES) {
    delete require.cache[require.resolve(`../../lib/harnesses/${id}`)];
  }
  return {
    io: require("../../lib/io"),
    harness: require("../../lib/harness"),
    originals: require("../../lib/originals"),
  };
}

const KEY = "sk-plus-test-aaaaaaaaaaaa";

function seedCodex(io, harness) {
  const cfg = harness.get("codex").configFile;
  io.ensureDir(path.dirname(cfg));
  fs.writeFileSync(cfg, 'model = "gpt-5-user"\n');
  return cfg;
}

test("originals: nothing stored before any harness is connected", () => withSandbox(() => {
  const { originals } = loadAll();
  assert.deepEqual(originals.list(), []);
}));

test("originals: after `on`, the stored copy is listed with its real source path", () => withSandbox(() => {
  const { io, harness, originals } = loadAll();
  const cfg = seedCodex(io, harness);
  harness.get("codex").on({ key: KEY, model: harness.resolveModel("pro") });

  const entries = originals.list();
  assert.equal(entries.length, 1);
  const e = entries[0];
  assert.equal(e.harnessId, "codex");
  assert.equal(e.label, "Codex");
  assert.equal(e.source, cfg, "the .bak must resolve back to the file it came from");
  assert.equal(e.bak, io.snapshotPath("codex"));
  assert.equal(e.tombstone, false);
  assert.ok(e.bytes > 0);
}));

test("originals: read() returns the user's original bytes verbatim", () => withSandbox(() => {
  const { io, harness, originals } = loadAll();
  const cfg = seedCodex(io, harness);
  const before = fs.readFileSync(cfg, "utf8");
  harness.get("codex").on({ key: KEY, model: harness.resolveModel("pro") });

  assert.equal(originals.read("codex"), before);
  assert.notEqual(fs.readFileSync(cfg, "utf8"), before, "the live file has been rewritten");
}));

test("originals: a tombstone reads as 'no file existed', not as an empty backup", () => withSandbox(() => {
  const { harness, originals } = loadAll();
  // No pre-existing ~/.codex/config.toml — on() records a tombstone.
  harness.get("codex").on({ key: KEY, model: harness.resolveModel("pro") });

  const e = originals.get("codex");
  assert.equal(e.tombstone, true);
  assert.equal(e.bytes, 0);
  assert.equal(e.source, harness.get("codex").configFile,
    "a tombstone records the path it stands in for");
  assert.equal(originals.read("codex"), null, "there is nothing to show for a tombstone");
}));

test("originals: source resolves from the audit log when there is no restore ledger", () => withSandbox(() => {
  const { io, harness, originals } = loadAll();
  const cfg = seedCodex(io, harness);
  harness.get("codex").on({ key: KEY, model: harness.resolveModel("pro") });

  // Simulate a connect made before the restore ledger existed.
  io.clearRestore("codex");
  assert.equal(originals.get("codex").source, cfg,
    "audit.log's snapshot entry is the fallback source-path record");
}));

test("originals: editor-extension snapshots are labelled and attributed to their harness", () => withSandbox((home) => {
  const { io, harness, originals } = loadAll();
  fs.mkdirSync(path.join(home, ".vscode", "extensions", "anthropic.claude-code-2.1.0"), { recursive: true });
  const editorSettings = process.platform === "win32"
    ? path.join(home, "Code", "User", "settings.json")
    : process.platform === "darwin"
      ? path.join(home, "Library", "Application Support", "Code", "User", "settings.json")
      : path.join(home, ".config", "Code", "User", "settings.json");
  io.ensureDir(path.dirname(editorSettings));
  fs.writeFileSync(editorSettings, JSON.stringify({ "editor.fontSize": 14 }, null, 2) + "\n");

  harness.get("claude").on({ key: KEY, model: harness.resolveModel("pro") });

  const ext = originals.get("claude-ext-vscode");
  assert.ok(ext, "the editor's settings.json must be listed as an original too");
  assert.equal(ext.source, editorSettings);
  assert.match(ext.label, /Claude Code · VS Code/);

  // Both the CLI config and the editor config belong to the claude harness.
  const ids = originals.forHarness("claude").map((e) => e.harnessId).sort();
  assert.deepEqual(ids, ["claude", "claude-ext-vscode"]);
}));

test("originals: --export writes restorable copies plus a manifest naming each source", () => withSandbox((home) => {
  const { io, harness, originals } = loadAll();
  const cfg = seedCodex(io, harness);
  const before = fs.readFileSync(cfg, "utf8");
  harness.get("codex").on({ key: KEY, model: harness.resolveModel("pro") });

  const out = path.join(home, "exported");
  const res = originals.exportAll(out);

  assert.equal(res.written.length, 1);
  const copied = path.join(out, res.written[0].file);
  assert.equal(fs.readFileSync(copied, "utf8"), before,
    "the exported copy must be the user's original bytes");

  const manifest = JSON.parse(fs.readFileSync(path.join(out, "MANIFEST.json"), "utf8"));
  assert.equal(manifest.originals[0].from, cfg,
    "the manifest must say where each file belongs, or it isn't restorable by hand");
}));

test("originals: --export records tombstones separately (nothing to copy, but worth knowing)", () => withSandbox((home) => {
  const { harness, originals } = loadAll();
  harness.get("codex").on({ key: KEY, model: harness.resolveModel("pro") });

  const res = originals.exportAll(path.join(home, "exported"));
  assert.equal(res.written.length, 0, "a tombstone has no bytes to export");
  assert.equal(res.manifest.tombstones.length, 1);
  assert.equal(res.manifest.tombstones[0].harness, "codex");
}));

test("originals: listing is read-only — it disturbs neither the snapshot nor the ledger", () => withSandbox(() => {
  const { io, harness, originals } = loadAll();
  const cfg = seedCodex(io, harness);
  harness.get("codex").on({ key: KEY, model: harness.resolveModel("pro") });

  const bakBefore = fs.readFileSync(io.snapshotPath("codex"), "utf8");
  const ledgerBefore = JSON.stringify(io.readRestore("codex"));

  originals.list();
  originals.get("codex");
  originals.read("codex");
  originals.forHarness("codex");

  assert.equal(fs.readFileSync(io.snapshotPath("codex"), "utf8"), bakBefore);
  assert.equal(JSON.stringify(io.readRestore("codex")), ledgerBefore);

  // And `off` still works normally afterwards.
  harness.get("codex").off({});
  assert.equal(fs.readFileSync(cfg, "utf8"), 'model = "gpt-5-user"\n');
}));

test("originals: the entry disappears once `off` has restored and consumed it", () => withSandbox(() => {
  const { io, harness, originals } = loadAll();
  seedCodex(io, harness);
  harness.get("codex").on({ key: KEY, model: harness.resolveModel("pro") });
  assert.equal(originals.list().length, 1);

  harness.get("codex").off({});
  assert.deepEqual(originals.list(), [],
    "after off there is no stored copy left — this is why --export exists");
}));

test("originals: tilde() keeps the home prefix out of displayed paths", () => withSandbox(() => {
  const { io, originals } = loadAll();
  assert.equal(originals.tilde(path.join(io.HOME, ".codex", "config.toml")), "~/.codex/config.toml");
  assert.equal(originals.tilde("/elsewhere/x.json"), "/elsewhere/x.json");
}));

// ── command surface ─────────────────────────────────────────────────────────

test("originals command: flag parsing", () => {
  const cmd = require("../../lib/commands/originals");
  assert.deepEqual(cmd.parseFlags(["--show", "codex"]), { show: "codex", export: null, json: false });
  assert.deepEqual(cmd.parseFlags(["--show=codex"]), { show: "codex", export: null, json: false });
  assert.deepEqual(cmd.parseFlags(["--export", "./out"]), { show: null, export: "./out", json: false });
  assert.deepEqual(cmd.parseFlags(["--json"]), { show: null, export: null, json: true });
});

test("originals command: the dispatcher routes `originals` and the `backups` alias", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "bin", "neosmith.js"), "utf8");
  assert.match(src, /case "originals":/, "bin/neosmith.js must route `neosmith originals`");
  assert.match(src, /case "backups":/, "the `backups` alias must be routed too");
});

test("originals command: help lists it, so it is discoverable", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "lib", "commands", "help.js"), "utf8");
  assert.match(src, /neosmith originals/, "`neosmith help` must mention the command");
});

// ── destructive commands must name what they are about to destroy ───────────

test("reset and uninstall warn about the stored originals before confirming", () => {
  const reset = fs.readFileSync(path.join(__dirname, "..", "..", "lib", "commands", "reset.js"), "utf8");
  const uninstall = fs.readFileSync(path.join(__dirname, "..", "..", "lib", "commands", "uninstall.js"), "utf8");
  for (const [name, src] of [["reset", reset], ["uninstall", uninstall]]) {
    assert.match(src, /require\("\.\.\/originals"\)/,
      `${name}.js must consult lib/originals so it can name what it destroys`);
    assert.match(src, /originals --export/,
      `${name}.js must point the user at the export before destroying their copies`);
  }
});
