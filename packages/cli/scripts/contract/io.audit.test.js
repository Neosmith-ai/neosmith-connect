// scripts/contract/io.audit.test.js
//
// T4 contract: the audit log never leaks key material. We exercise every
// state-changing io path with a key-shaped payload and assert that the four
// prefixes (sk-plus- / sk-std- / sk-slm- / eyJ) don't appear in the log.

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { withSandbox } = require("./_sandbox");

test("audit log never leaks sk-plus- tokens", () => withSandbox((home) => {
  delete require.cache[require.resolve("../../lib/io")];
  const io = require("../../lib/io");

  io.appendAuditLog({ op: "write", path: "/x/y.json", key: true });
  io.appendAuditLog({
    op: "write",
    path: "/x/y.json",
    bytes: 12,
  });
  // Also pass the raw token through path (defensive — should never land).
  io.appendAuditLog({ op: "write", path: "sk-plus-this-must-be-redacted" });

  const log = fs.readFileSync(path.join(home, ".neosmith", "audit.log"), "utf8");
  assert.ok(!log.includes("sk-plus-this-must-be-redacted"),
    "raw sk-plus-… token must never appear in audit log");
  assert.ok(!/sk-plus-[A-Za-z0-9]{6,}/.test(log),
    "no sk-plus-* literal should slip through");
}));

test("audit log never leaks sk-std- / sk-slm- / eyJ tokens", () => withSandbox((home) => {
  delete require.cache[require.resolve("../../lib/io")];
  const io = require("../../lib/io");

  for (const tok of ["sk-std-test-aaaaaaaaaaaa", "sk-slm-test-aaaaaaaaaaaa", "eyJabc.def.ghi"]) {
    io.appendAuditLog({ op: "write", path: "/x/y.json", key: tok });
  }
  const log = fs.readFileSync(path.join(home, ".neosmith", "audit.log"), "utf8");
  assert.ok(!log.includes("sk-std-test-"), "no sk-std-… in audit log");
  assert.ok(!log.includes("sk-slm-test-"), "no sk-slm-… in audit log");
  assert.ok(!log.includes("eyJabc.def.ghi"), "no raw JWT in audit log");
}));

test("writeJSON → write → snapshot → restore cycle all log audit entries in order", () => withSandbox((home) => {
  delete require.cache[require.resolve("../../lib/io")];
  const io = require("../../lib/io");

  const cfg = path.join(home, "sandbox.json");
  fs.writeFileSync(cfg, JSON.stringify({ pre: "connect" }));
  io.snapshot("claude", cfg);
  io.writeJSON(cfg, { post: "connect" });
  io.restoreSnapshot("claude", cfg);

  const log = fs.readFileSync(path.join(home, ".neosmith", "audit.log"), "utf8");
  const lines = log.split("\n").filter(Boolean).map((l) => JSON.parse(l).op);
  assert.deepEqual(lines.slice(0, 3), ["snapshot", "write", "restore"],
    "audit entries must follow the io operation sequence");
}));

// ── issue #15: write-once snapshot + restore ledger ─────────────────────────

test("snapshot() is write-once — a second call keeps the pre-connect bytes", () => withSandbox((home) => {
  delete require.cache[require.resolve("../../lib/io")];
  const io = require("../../lib/io");

  const cfg = path.join(home, "sandbox.json");
  fs.writeFileSync(cfg, '{"pre":"connect"}');
  io.snapshot("claude", cfg);
  io.writeJSON(cfg, { wired: "neosmith" });
  io.snapshot("claude", cfg); // second `on` — must NOT capture the wired state

  assert.equal(fs.readFileSync(io.snapshotPath("claude"), "utf8"), '{"pre":"connect"}',
    "the .bak must still hold the pre-connect bytes");

  io.restoreSnapshot("claude", cfg);
  assert.equal(fs.readFileSync(cfg, "utf8"), '{"pre":"connect"}');
  assert.equal(io.hasSnapshot("claude"), false, "restore consumes the snapshot");
}));

test("snapshot-skip is audited so the write-once decision is traceable", () => withSandbox((home) => {
  delete require.cache[require.resolve("../../lib/io")];
  const io = require("../../lib/io");

  const cfg = path.join(home, "sandbox.json");
  fs.writeFileSync(cfg, "{}");
  io.snapshot("zed", cfg);
  io.snapshot("zed", cfg);

  const ops = fs.readFileSync(path.join(home, ".neosmith", "audit.log"), "utf8")
    .split("\n").filter(Boolean).map((l) => JSON.parse(l).op);
  assert.deepEqual(ops, ["snapshot", "snapshot-skip"]);
}));

test("restore ledger round-trips prior values and deletes only what was ABSENT", () => withSandbox(() => {
  delete require.cache[require.resolve("../../lib/io")];
  const io = require("../../lib/io");

  const before = { env: { USER_VAR: "keep", ANTHROPIC_MODEL: "user-model" }, other: 1 };
  const entries = io.planRestore(before, [
    ["env", "ANTHROPIC_MODEL"],   // exists → record the leaf's prior value
    ["env", "ANTHROPIC_BASE_URL"], // absent leaf under an existing parent
    ["model"],                    // absent top-level
  ]);

  const wired = JSON.parse(JSON.stringify(before));
  wired.env.ANTHROPIC_MODEL = "neosmith.intelligent-pro";
  wired.env.ANTHROPIC_BASE_URL = "https://router.neosmith.ai";
  wired.model = "opus";

  io.applyRestore(wired, entries);
  assert.deepEqual(wired, before, "applyRestore must reproduce the pre-connect object exactly");
}));

test("planRestore collapses to the shallowest absent prefix so created blocks are pruned", () => withSandbox(() => {
  delete require.cache[require.resolve("../../lib/io")];
  const io = require("../../lib/io");

  const before = { theme: "dark" }; // no `env` block at all
  const entries = io.planRestore(before, [["env", "A"], ["env", "B"]]);
  assert.deepEqual(entries, [{ pointer: ["env"], prior: io.ABSENT }],
    "both leaves collapse to a single `env → ABSENT` entry");

  const wired = { theme: "dark", env: { A: "1", B: "2" } };
  io.applyRestore(wired, entries);
  assert.deepEqual(wired, before, "the whole block NeoSmith created is removed");
}));

test("recordRestore is write-once — a second on() cannot overwrite the prior values", () => withSandbox(() => {
  delete require.cache[require.resolve("../../lib/io")];
  const io = require("../../lib/io");

  const p = "/x/settings.json";
  assert.equal(io.recordRestore("codex", p, [{ pointer: ["model"], prior: "gpt-5-user" }]), true);
  assert.equal(io.recordRestore("codex", p, [{ pointer: ["model"], prior: "neosmith.intelligent-pro" }]), false);
  assert.deepEqual(io.readRestore("codex", p), [{ pointer: ["model"], prior: "gpt-5-user" }]);

  io.clearRestore("codex");
  assert.equal(io.readRestore("codex", p), null);
}));

test("ledger values never reach the audit log, even when they are keys", () => withSandbox((home) => {
  delete require.cache[require.resolve("../../lib/io")];
  const io = require("../../lib/io");

  io.recordRestore("zed", "/x/settings.json", [
    { pointer: ["language_models", "openai", "api_key"], prior: "sk-plus-users-own-key-aaaa" },
  ]);

  const log = fs.readFileSync(path.join(home, ".neosmith", "audit.log"), "utf8");
  assert.ok(!log.includes("sk-plus-users-own-key"),
    "a prior value captured in the ledger must never be echoed into the audit log");
}));

test("dry-run writes go to ~/.neosmith/dryrun/ and never to the real path", () => withSandbox((home) => {
  delete require.cache[require.resolve("../../lib/io")];
  const io = require("../../lib/io");

  const real = path.join(home, "real-settings.json");
  process.env.NEOSMITH_DRY_RUN = "1";
  try {
    io.writeJSON(real, { dry: true });
  } finally {
    delete process.env.NEOSMITH_DRY_RUN;
  }

  assert.ok(!fs.existsSync(real), "dry-run must not touch the real file");
  const dryDir = path.join(home, ".neosmith", "dryrun");
  assert.ok(fs.existsSync(dryDir), "dry-run must materialize a shadow under .neosmith/dryrun/");
  const shadows = fs.readdirSync(dryDir);
  assert.ok(shadows.length >= 1, "shadow should be present");
}));
