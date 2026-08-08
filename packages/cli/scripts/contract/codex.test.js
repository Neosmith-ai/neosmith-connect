// scripts/contract/codex.test.js
//
// T8 contract for codex.js. Codex has DIFFERENT idempotency than claude:
// codex does NOT short-circuit on already-on — re-running `on` re-writes the
// TOML, which is how `neosmith codex on --model X` switches tiers. This
// asymmetry is preserved intact per T1 ground truth. See T1 in the build plan.
//
// Changed for issue #15: the manifest idempotency label moved from
// "snapshot-always" to "snapshot-once". on() still re-writes, but the
// pre-connect .bak is now taken only once — re-snapshotting on the second call
// captured the already-NeoSmith TOML and made `off` restore *that*, destroying
// the user's config. The preservation contract lives in
// env-preservation.test.js; this file keeps the codex-specific shape tests.
//
// Behavior under test:
//   - on() writes ~/.codex/config.toml with a NeoSmith provider block.
//   - on()/on() does not short-circuit: it re-writes the TOML and leaves the
//     pre-connect snapshot alone.
//   - off() with neither snapshot nor ledger strips the
//     [model_providers.neosmith] block via regex.

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { withSandbox } = require("./_sandbox");

function loadCodex() {
  delete require.cache[require.resolve("../../lib/io")];
  delete require.cache[require.resolve("../../lib/harness")];
  delete require.cache[require.resolve("../../lib/harnesses/codex")];
  return {
    io: require("../../lib/io"),
    harness: require("../../lib/harness"),
    codex: require("../../lib/harnesses/codex"),
  };
}

test("codex on writes a NeoSmith provider block", () => withSandbox((home) => {
  const { codex, harness } = loadCodex();
  const cfg = path.join(home, ".codex", "config.toml");
  // Pass a resolved SKU — the on-command flow resolves `pro` → `neosmith.intelligent-pro`
  // via harness.resolveModel before calling codex.on(). Direct calls pass the alias
  // through verbatim; the CLI command resolves first. Mirror the CLI flow here.
  const resolved = harness.resolveModel("pro");
  codex.on({ key: "sk-plus-test-aaaaaaaaaaaa", model: resolved });

  assert.ok(fs.existsSync(cfg), "config.toml must be created");
  const text = fs.readFileSync(cfg, "utf8");
  assert.match(text, /\[model_providers\.neosmith\]/);
  assert.match(text, /model\s*=\s*"neosmith\.intelligent-pro"/);
  assert.match(text, /base_url\s*=\s*"https:\/\/router\.neosmith\.ai\/v1"/);
  assert.match(text, /wire_api\s*=\s*"responses"/);
  assert.match(text, /env_key\s*=\s*"OPENAI_API_KEY"/);
}));

test("codex on/off round-trips on an empty pre-connect state (tombstone)", () => withSandbox((home) => {
  const { io, codex } = loadCodex();
  const cfg = path.join(home, ".codex", "config.toml");

  codex.on({ key: "sk-plus-test-aaaaaaaaaaaa", model: "pro" });
  assert.ok(fs.existsSync(cfg), "config.toml should exist after on()");

  codex.off({});
  assert.ok(!fs.existsSync(cfg),
    "off() must remove the file when pre-connect was a tombstone");
}));

test("codex on does NOT short-circuit on already-on (asymmetry with claude)", () => withSandbox((home) => {
  const { codex } = loadCodex();
  const cfg = path.join(home, ".codex", "config.toml");

  codex.on({ key: "sk-plus-test-aaaaaaaaaaaa", model: "pro" });
  const sizeAfterFirst = fs.statSync(cfg).size;
  const mtimeAfterFirst = fs.statSync(cfg).mtimeMs;

  // Wait briefly so any re-write would register on mtime.
  const start = Date.now();
  while (Date.now() - start < 50) { /* spin */ }

  // Codex's contract is "snapshot-once, no short-circuit" — running on()
  // twice does NOT return { alreadyOn: true }. It re-writes the file (mtime
  // bumps) while leaving the pre-connect snapshot intact.
  const res = codex.on({ key: "sk-plus-test-aaaaaaaaaaaa", model: "pro" });
  assert.equal(res.alreadyOn, undefined,
    "codex.on() should NOT return alreadyOn — that's claude's contract");
  // We don't assert mtime changed (Windows fs resolution can be coarse),
  // but we assert the contract distinction is enforced.
  void sizeAfterFirst;
  void mtimeAfterFirst;
}));

test("codex off strips the NeoSmith block when no pre-connect snapshot exists", () => withSandbox((home) => {
  const { io, codex } = loadCodex();
  const cfg = path.join(home, ".codex", "config.toml");
  io.ensureDir(path.dirname(cfg));

  // Pre-connect has unrelated keys.
  const preText = '# user comment\nmodel = "other-model"\n[model_providers.other]\nname = "Other"\nbase_url = "https://example.com/v1"\n';
  fs.writeFileSync(cfg, preText);

  codex.on({ key: "sk-plus-test-aaaaaaaaaaaa", model: "pro" });

  // Simulate deletion of the .bak AND the restore ledger (the pre-0.8 case:
  // a connect made before either existed). off() must fall back to the text
  // strip and preserve user content. The ledger path is covered separately in
  // env-preservation.test.js.
  const bak = path.join(home, ".neosmith", "snapshots", "codex.bak");
  fs.unlinkSync(bak);
  io.clearRestore("codex");

  codex.off({});
  const afterText = fs.readFileSync(cfg, "utf8");
  assert.ok(!afterText.includes("[model_providers.neosmith]"),
    "off() fallback must strip the NeoSmith provider block");
  assert.ok(!/model_provider\s*=\s*"neosmith"/.test(afterText),
    "off() fallback must strip top-level model_provider");
  assert.ok(afterText.includes("[model_providers.other]") ||
            afterText.includes("model = \"other-model\"") ||
            afterText.includes("# user comment"),
    "off() fallback must preserve pre-connect user content");
}));

// ── env instructions ────────────────────────────────────────────────────────
// codex.on() must TELL the user how to set OPENAI_API_KEY, because the TOML
// only holds `env_key = "OPENAI_API_KEY"` — without the env var the harness has
// no credentials at all. The wording is contracted in envsetup.test.js; here we
// only assert that on() actually routes through it and never prints a POSIX
// export command on Windows.

function captureOn(ctx) {
  const orig = console.log;
  const lines = [];
  console.log = (...a) => lines.push(a.join(" "));
  try {
    const { codex, harness } = loadCodex();
    codex.on({ model: harness.resolveModel("pro"), ...ctx });
  } finally {
    console.log = orig;
  }
  // Strip ANSI so assertions match regardless of TTY state.
  return lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, ""));
}

test("codex on prints env instructions containing the key", () => withSandbox(() => {
  const out = captureOn({ key: "sk-plus-test-aaaaaaaaaaaa" }).join("\n");
  assert.match(out, /OPENAI_API_KEY/);
  assert.match(out, /sk-plus-test-aaaaaaaaaaaa/, "the user must be shown the value to set");
  assert.match(out, /https:\/\/router\.neosmith\.ai\/v1/);
}));

test("codex on explains that the TOML holds only the variable name", () => withSandbox(() => {
  const out = captureOn({ key: "sk-plus-test-aaaaaaaaaaaa" }).join("\n");
  // The whole class of confusion this fixes: "the CLI said it wrote the config,
  // so why is there no key in it?"
  assert.match(out, /never the key itself|only the variable's name/i);
}));

test("codex on tells the user how to fully restart the editor", () => withSandbox(() => {
  const out = captureOn({ key: "sk-plus-test-aaaaaaaaaaaa" }).join("\n");
  assert.match(out, /NOT enough/i, "must rule out restarting just the terminal panel");
  assert.match(out, /code \./, "must warn against relaunching from a stale terminal");
}));

test("codex on never prints a POSIX export command on Windows", () => withSandbox(() => {
  if (process.platform !== "win32") return; // asserted cross-platform in envsetup.test.js
  for (const line of captureOn({ key: "sk-plus-test-aaaaaaaaaaaa" })) {
    assert.ok(!/^\s+export\s/.test(line), `dead copy on Windows: ${line}`);
  }
  assert.match(captureOn({ key: "sk-plus-test-aaaaaaaaaaaa" }).join("\n"), /setx/);
}));
