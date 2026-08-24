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
    "uninstall", "models", "keys", "update", "originals", "feedback", "help", "init"];
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

// 5. Customer-facing docs must name every harness in the manifest.
//
// Adding a harness used to mean remembering an unbounded list of prose files.
// It did not get remembered: site/docs/agents/index.md still listed five agents
// long after copilot, zed and cursor shipped in 0.3.0, and the docs-site landing
// page was stuck at eight. The manifest-driven blocks (scripts/generate-docs.js)
// are the fix; this is the gate that says the fix is still wired up.
test("docs: every manifest harness is named in the customer-facing docs", () => {
  const harness = require("../../lib/harness");
  const SURFACES = [
    ["site/README.md", "the docs-site landing table"],
    ["site/COMPATIBILITY.md", "the compatibility matrix"],
    ["site/docs/agents/index.md", "the Agents section index"],
    ["packages/cli/README.md", "the npm page"],
  ];
  for (const [rel, what] of SURFACES) {
    const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
    for (const h of harness.manifest().harnesses) {
      const label = h.shortLabel || h.name;
      assert.ok(text.includes(label),
        `${rel} (${what}) does not mention "${label}". A harness a reader cannot ` +
        `find is one they will never wire — regenerate with \`node scripts/generate-docs.js\` ` +
        `if the table is manifest-driven, or add the prose if it is not.`);
    }
  }
});

// 6. Every harness's docPage must actually exist.
test("docs: every manifest docPage resolves to a real file", () => {
  const harness = require("../../lib/harness");
  for (const h of harness.manifest().harnesses) {
    const rel = (h.docPage || `agents/${h.id}.md`).replace(/^\.\//, "");
    const full = path.join(ROOT, "site", rel);
    assert.ok(fs.existsSync(full),
      `manifest declares docPage "${rel}" for '${h.id}', but site/${rel} does not exist — ` +
      `the generated tables link to it, so this ships a 404`);
  }
});

// 7. The de-listed SKU must not be advertised as a supported option.
//
// harnesses.json records neosmith.intelligent-lite as DE-LISTED: the router
// still routes it, but GET /v1/models no longer lists it and the real budget
// tier is neosmith.neolite. The reference page advertised it in its SKU table
// for months — a wrong answer a reader has no way to detect. The table is
// generated from claudeTierMap now; this pins that it stays that way, on the
// published mirror as well as the source.
test("docs: the de-listed intelligent-lite SKU is not offered in the SKU tables", () => {
  for (const rel of ["site/reference/endpoints.md", "site/docs/reference/endpoints.md"]) {
    const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
    const block = text.split("<!-- BEGIN manifest:skus -->")[1];
    assert.ok(block, `${rel} lost its manifest:skus marker block`);
    const table = block.split("<!-- END manifest:skus -->")[0];
    assert.ok(!table.includes("intelligent-lite"),
      `${rel} still lists neosmith.intelligent-lite as a SKU; the budget tier is neosmith.neolite`);
    assert.ok(table.includes("neosmith.neolite"), `${rel} must list the real budget tier`);
  }
});

// 8. Every harness page must exist in the MIRROR, not just in site/.
//
// site/docs/ is the Jekyll source root — it is what gets built and what GitHub
// Pages serves. site/ is the authoring copy. A page that exists in one and not
// the other is written, reviewed, merged, and then absent from the live site,
// with every generated table linking to a 404.
//
// That is not hypothetical: agents/copilot.md and agents/zed.md were declared in
// the manifest from 0.3.0 and served 404 on the published guide until the check
// below was written. Test 6 (docPage resolves) would not have caught it — the
// source pages were the ones missing there, and once they existed the mirror
// still was not.
test("docs: every manifest docPage is mirrored into site/docs/ so it publishes", () => {
  const harness = require("../../lib/harness");
  for (const h of harness.manifest().harnesses) {
    const rel = (h.docPage || `agents/${h.id}.md`).replace(/^\.\//, "");
    const mirror = path.join(ROOT, "site", "docs", rel);
    assert.ok(fs.existsSync(mirror),
      `site/docs/${rel} does not exist, so '${h.id}' will not appear on the published site ` +
      `even though every generated table links to it. site/docs/ is what Jekyll builds.`);
  }
});

// 9. A mirrored page must carry the Jekyll front matter, or it renders raw.
test("docs: every mirrored harness page has usable Jekyll front matter", () => {
  const harness = require("../../lib/harness");
  for (const h of harness.manifest().harnesses) {
    const rel = (h.docPage || `agents/${h.id}.md`).replace(/^\.\//, "");
    const mirror = path.join(ROOT, "site", "docs", rel);
    if (!fs.existsSync(mirror)) continue; // test 8 owns that failure
    const head = fs.readFileSync(mirror, "utf8").split("---")[1] || "";
    for (const key of ["title:", "layout:", "parent:", "nav_order:"]) {
      assert.ok(head.includes(key),
        `site/docs/${rel} front matter has no ${key} — Just-the-Docs needs it to place the ` +
        `page in the nav; without it the page builds but nobody can find it`);
    }
  }
});
