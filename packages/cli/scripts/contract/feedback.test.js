// scripts/contract/feedback.test.js
//
//   1. buildUrl() routes to the right GitHub template URL (bug.md vs
//      enhancement.md) at the New Issue deep-link.
//   2. bodyFor() uses the template's exact field headings ("What happened?",
//      "Steps to reproduce", etc.) so reviewers don't have to reparse.
//   3. envContext() exposes only the router host (never the key, never a
//      query string) and renders the audit-safe environment block.
//   4. parseFlags() correctly routes positional "bug"/"idea", -t/--type,
//      -m/--message, --no-open; bare-word extras fold into the message slot.
//   5. resolveType() rejects unknown types with a clear error.
//   6. run() with --no-open prints the URL + body and returns opened=false
//      without spawning a browser.

"use strict";

const test = require("node:test");
const assert = require("node:assert");

const cmd = require("../../lib/commands/feedback");

// 1. URL routing + encoding.
test("feedback buildUrl routes bug → bug.md deep-link", () => {
  const url = cmd.buildUrl({ type: "bug", message: "" });
  assert.ok(url.startsWith("https://github.com/Neosmith-ai/neosmith-connect/issues/new"), "repo + endpoint");
  assert.ok(url.includes("template=bug.md"), "bug.md template selected");
  assert.ok(url.includes("title="), "title parameter present");
  assert.ok(url.includes("body="), "body parameter present");
});

test("feedback buildUrl routes idea → enhancement.md deep-link", () => {
  const url = cmd.buildUrl({ type: "idea", message: "" });
  assert.ok(url.includes("template=enhancement.md"), "enhancement.md template selected");
});

test("feedback buildUrl encodes the user message into the body parameter", () => {
  const url = cmd.buildUrl({ type: "bug", message: "Tab autocomplete broken in Cursor" });
  // URLSearchParams renders spaces as "+" — both + and %20 are accepted by GitHub.
  const encoded =
    /Tab[^&]+autocomplete[^&]+broken[^&]+in[^&]+Cursor/.test(url);
  assert.ok(encoded, "message words appear in the URL-encoded body");
});

// 2. body field headings match the .github/ISSUE_TEMPLATE/*.md files.
test("feedback bodyFor('bug') uses the Bug template's exact headings", () => {
  const body = cmd.bodyFor({ type: "bug", message: "It hurts when I click Tab." });
  assert.match(body, /^## What happened\?$/m);
  assert.match(body, /^## Steps to reproduce$/m);
  assert.match(body, /^## Expected$/m);
  assert.match(body, /^## Environment$/m);
  assert.ok(body.includes("It hurts when I click Tab."), "user message included exactly");
});

test("feedback bodyFor('idea') uses the Enhancement template's exact headings", () => {
  const body = cmd.bodyFor({ type: "idea", message: "Add a /doctor ping interval setting." });
  assert.match(body, /^## What should change and why\?$/m);
  assert.match(body, /^## Motivation$/m);
  assert.match(body, /^## Acceptance criteria$/m);
  assert.match(body, /^## Environment$/m);
});

// 3. envContext exposes router host only (no keys, no querystrings).
test("feedback envContext strips query strings and never leaks the key", () => {
  const ctx = cmd.envContext();
  assert.equal(typeof ctx["Router"], "string");
  assert.ok(!ctx["Router"].includes("?"), "no query string in router host");
  assert.ok(!ctx["Router"].includes("="), "no equal sign in router host");
  assert.ok(!/sk-|eyJ/i.test(ctx["Router"]), "no key prefix leak");
  assert.match(ctx["CLI version"], /@neosmithai\/cli v\d/);
  assert.match(ctx["Node"], /^v\d+\.\d+\.\d+/);
  // OS shape only — actual value varies by host.
  assert.ok(/^(win32|linux|darwin)/.test(ctx["OS"]), `unexpected OS: ${ctx["OS"]}`);
});

// 4. parseFlags
test("feedback parseFlags handles positional + flags + bare extras", () => {
  const f1 = cmd.parseFlags(["bug"]);
  assert.equal(f1.type, "bug");
  assert.equal(f1.message, null);
  assert.equal(f1.noOpen, false);

  const f2 = cmd.parseFlags(["idea", "tab", "autocomplete", "stuck"]);
  assert.equal(f2.type, "idea");
  assert.equal(f2.message, "tab autocomplete stuck", "bare words join into the message");

  const f3 = cmd.parseFlags(["--type=bug", "--message=hello world", "--no-open"]);
  assert.equal(f3.type, "bug");
  assert.equal(f3.message, "hello world");
  assert.equal(f3.noOpen, true);

  const f4 = cmd.parseFlags(["-t", "idea"]);
  assert.equal(f4.type, "idea");
});

// 5. resolveType
test("feedback resolveType accepts bug|idea and rejects unknown", () => {
  assert.equal(cmd.resolveType("bug"), "bug");
  assert.equal(cmd.resolveType("idea"), "idea");
  assert.equal(cmd.resolveType("BUG"), "bug", "case-insensitive");
  assert.throws(() => cmd.resolveType("feature"), /unknown/);
  assert.equal(cmd.resolveType(), "bug", "default is bug when nothing supplied");
});

// 6. run() with --no-open prints URL + body and returns opened=false.
test("feedback run --no-open prints URL + body without launching a browser", async () => {
  // cmd.run prints to stdout. Capture it via the same harness — --no-open
  // prevents any spawn, so we only assert the return contract.
  const out = await cmd.run(["bug", "test probe", "--no-open"]);
  assert.equal(out.opened, false);
  assert.equal(out.type, "bug");
  assert.ok(out.url.includes("template=bug.md"));
});
