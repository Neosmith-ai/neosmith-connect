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
