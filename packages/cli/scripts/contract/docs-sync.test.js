// scripts/contract/docs-sync.test.js
//
// Pin the install-instructions drift budget across the repo:
//
//   - The root README.md (README.md) owns the canonical install paths (bash
//     + PowerShell). It must reference BOTH `install.sh` and `install.ps1`.
//   - Every other README that has a "Quick start" or "Install" section
//     must NOT duplicate a `bash -c "$(curl … install.sh)"` or any other
//     install command — they point at the root README instead.
//
// Background: bug #6 reported user-guide.md vs packages/cli/README.md drifting
// on the Windows install option (the user-guide only listed bash). The fix
// collapses the duplicated install narrative to the root README. This test
// is the guardrail: if anyone refactors a Quick-start back into these files,
// the contract breaks loudly.

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..", "..", "..");

const ROOT_README = path.join(ROOT, "README.md");
const USER_GUIDE = path.join(ROOT, "docs", "user-guide.md");
const CLI_README = path.join(ROOT, "packages", "cli", "README.md");

// Root README owns the canonical paths — must include both installers.
test("docs: root README references both install.sh and install.ps1", () => {
  const text = fs.readFileSync(ROOT_README, "utf8");
  assert.ok(/install\.sh/.test(text),
    "root README must reference the bash installer");
  // .ps1 literal is enough — we don't require the full ir…|iex line.
  assert.ok(/install\.ps1/.test(text),
    "root README must reference the PowerShell installer (Windows)");
});

// User-guide and CLI README: NO duplicated install command. They MAY mention
// the installer by name (e.g. as a reference) but must not paste a runnable
// `bash -c "$(curl -fsSL …/install.sh)"` command — that's what drifted and
// contradicted the root in bug #6.
test("docs: docs/user-guide.md has no runnable `bash -c \"$(curl ... install.sh)\"`", () => {
  const text = fs.readFileSync(USER_GUIDE, "utf8");
  assert.ok(!/bash\s+-c\s+"\$\(curl[^"]*install\.sh/.test(text),
    "user-guide.md must not duplicate the runnable bash install command — point at the root README instead");
  assert.ok(text.toLowerCase().includes("readme"),
    "user-guide.md must point readers at the root README for install paths");
});

test("docs: packages/cli/README.md has no runnable `bash -c \"$(curl ... install.sh)\"`", () => {
  const text = fs.readFileSync(CLI_README, "utf8");
  assert.ok(!/bash\s+-c\s+"\$\(curl[^"]*install\.sh/.test(text),
    "packages/cli/README.md must not duplicate the runnable bash install command — point at the root README instead");
  assert.ok(text.toLowerCase().includes("readme"),
    "packages/cli/README.md must point readers at the root README for install paths");
});
