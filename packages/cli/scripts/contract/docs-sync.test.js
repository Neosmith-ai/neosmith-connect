// scripts/contract/docs-sync.test.js
//
// Pin the "one canonical CLI guide" invariant.
//
// History: the repo used to carry two overlapping developer-facing guides —
// `docs/user-guide.md` (a narrated walkthrough) and `packages/cli/README.md`
// (the npm package README). They drifted in opposite directions: the
// user-guide covered 8 harnesses but missed the maestro tier and the
// `feedback`/`models`/`setup`/`reset` commands; the CLI README had the right
// env-var names and the smoke gate but claimed "five harnesses" and omitted
// cursor/copilot/zed entirely. Bug #6 was the install-command flavor of this
// drift; the deeper fix (this test's reason for existing) was to collapse to
// a single canonical guide.
//
// The single canonical guide is `packages/cli/README.md` — it is what
// `npm view @neosmithai/cli` renders and what ships inside the published
// package. `docs/user-guide.md` was deleted; this test prevents a second
// guide from being re-introduced and pins the must-cover claims so the
// canonical guide can't silently regress.

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const ROOT_README = path.join(ROOT, "README.md");
const CLI_README = path.join(ROOT, "packages", "cli", "README.md");
const OLD_USER_GUIDE = path.join(ROOT, "docs", "user-guide.md");

// 1. The duplicate guide must not come back.
test("docs: no second developer guide at docs/user-guide.md (single canonical source)", () => {
  assert.ok(!fs.existsSync(OLD_USER_GUIDE),
    "docs/user-guide.md was removed to end the drift with packages/cli/README.md; " +
    "do not re-add it — extend packages/cli/README.md instead.");
});

// 2. Root README owns the canonical install paths (bash + PowerShell).
test("docs: root README references both install.sh and install.ps1", () => {
  const text = fs.readFileSync(ROOT_README, "utf8");
  assert.ok(/install\.sh/.test(text), "root README must reference the bash installer");
  assert.ok(/install\.ps1/.test(text), "root README must reference the PowerShell installer (Windows)");
});

// 3. The canonical CLI README must cover the full harness set and command set
//    — these are the claims that drifted before. If a harness/command is
//    added to the manifest/dispatcher, the README must mention it.
test("docs: packages/cli/README.md covers every shipped harness", () => {
  const harness = require("../../lib/harness");
  const text = fs.readFileSync(CLI_README, "utf8");
  for (const id of harness.idsSorted()) {
    assert.ok(text.includes(id),
      `packages/cli/README.md must mention harness "${id}" (declared in the manifest)`);
  }
});

test("docs: packages/cli/README.md covers every top-level command the dispatcher routes", () => {
  const text = fs.readFileSync(CLI_README, "utf8");
  // Mirror the dispatcher's top-level switch (bin/neosmith.js). Each must
  // appear in the canonical README so users discover it.
  const commands = ["login", "verify", "doctor", "setup", "reset", "status",
    "uninstall", "models", "feedback", "help", "init"];
  for (const c of commands) {
    assert.ok(text.includes(c),
      `packages/cli/README.md must mention command "neosmith ${c}" (routed by the dispatcher)`);
  }
});

// 4. The CLI README must not duplicate the runnable bash install command —
//    install paths live in the root README (the bug #6 regression guard).
test("docs: packages/cli/README.md has no runnable `bash -c \"$(curl ... install.sh)\"`", () => {
  const text = fs.readFileSync(CLI_README, "utf8");
  assert.ok(!/bash\s+-c\s+"\$\(curl[^"]*install\.sh/.test(text),
    "packages/cli/README.md must not duplicate the runnable bash install command — " +
    "point at the root README instead (bug #6 regression guard).");
});
