// scripts/contract/keys.test.js
//
// Contract for `neosmith keys` — the command that reprints the keys this
// machine is configured with, and says which harness is holding which.
//
// Three things it must never get wrong, because each of them is either a
// security regression or the exact failure the command exists to surface:
//
//   1. Masked by default. A key printed in full without --reveal ends up in
//      scrollback, screen-shares and CI logs that nobody meant to expose.
//
//   2. Per-environment isolation. io.readKeyRef keeps prod and staging in
//      separate slots precisely so a staging key never reaches a prod
//      invocation (see the note at lib/io.js:186). If `keys` cross-wires them
//      in its own reporting it undoes the value of that separation.
//
//   3. A harness holding a key that matches NO stored key must be FLAGGED.
//      That is the rotated-credential case: `status` still says `on` because
//      the base URL is right, and the 401 only shows up inside the editor.
//
// And one operational property: `keys` writes nothing, so it must add no
// record to the audit log (pairs with io.audit.test.js, which pins that the
// log never carries key material).

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { withSandbox } = require("./_sandbox");

const PROD_KEY = "sk-plus-keystest-prod-aaaaaaaa";
const STAGING_KEY = "sk-std-keystest-staging-bbbb";
const OTHER_KEY = "sk-plus-rotated-away-cccccccc";

function loadKeys() {
  for (const m of ["../../lib/io", "../../lib/harness", "../../lib/key",
    "../../lib/originals", "../../lib/commands/keys",
    "../../lib/harnesses/zed", "../../lib/harnesses/codex",
    "../../lib/harnesses/copilot", "../../lib/harnesses/cursor",
    "../../lib/harnesses/jetbrains", "../../lib/harnesses/claude",
    "../../lib/harnesses/continue", "../../lib/harnesses/cline",
    "../../lib/harnesses/opencode", "../../lib/harnesses/openclaw",
    "../../lib/harnesses/junie"]) {
    delete require.cache[require.resolve(m)];
  }
  return {
    io: require("../../lib/io"),
    harness: require("../../lib/harness"),
    keys: require("../../lib/commands/keys"),
  };
}

// `keys` prints through ui.log/console.log. Capture both so the masking
// assertions look at exactly what a user would see.
async function capture(fn) {
  const out = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a) => out.push(a.join(" "));
  console.error = (...a) => out.push(a.join(" "));
  try { await fn(); } finally { console.log = origLog; console.error = origErr; }
  return out.join("\n");
}

// ── masking ─────────────────────────────────────────────────────────────────

test("keys: mask keeps the shape prefix and enough tail to tell two keys apart", () => {
  const { keys } = loadKeys();
  const masked = keys.mask(PROD_KEY);
  assert.ok(masked.startsWith("sk-plus-"), "the shape must still be readable");
  assert.ok(masked.endsWith("aaaa"), "the tail is what distinguishes two keys of the same shape");
  assert.ok(!masked.includes("keystest"), "the middle must not survive masking");
  assert.ok(masked.length < PROD_KEY.length);
});

test("keys: a short key is still masked rather than printed whole", () => {
  const { keys } = loadKeys();
  assert.equal(keys.mask("sk-plus-a"), "sk-p…");
  assert.equal(keys.mask(""), "");
  assert.equal(keys.mask(undefined), "");
});

test("keys: the stored key is masked by default", () => withSandbox(async () => {
  const { io, keys } = loadKeys();
  io.writeKeyRef(PROD_KEY, "prod");

  const text = await capture(() => keys.run([]));
  assert.ok(!text.includes(PROD_KEY), "the full key must NOT appear without --reveal");
  assert.match(text, /sk-plus-…aaaa/, "the masked form must appear");
  assert.match(text, /--reveal/, "and the command to see it in full must be offered");
}));

test("keys: --reveal prints the full value, and says so", () => withSandbox(async () => {
  const { io, keys } = loadKeys();
  io.writeKeyRef(PROD_KEY, "prod");

  const text = await capture(() => keys.run(["--reveal"]));
  assert.ok(text.includes(PROD_KEY), "--reveal must print the key in full");
  assert.match(text, /live credentials/i, "and warn that the output is a credential");
}));

// ── per-environment isolation ───────────────────────────────────────────────

test("keys: prod and staging are listed separately, each with its own value", () => withSandbox(async () => {
  const { io, keys } = loadKeys();
  io.writeKeyRef(PROD_KEY, "prod");
  io.writeKeyRef(STAGING_KEY, "staging");

  const stored = keys.storedKeys();
  assert.deepEqual(stored.map((s) => s.env), ["prod", "staging"],
    "the default environment sorts first — it is the one most invocations use");
  assert.equal(stored[0].value, PROD_KEY);
  assert.equal(stored[1].value, STAGING_KEY);
  assert.match(stored[0].shape, /Pro \/ Opus-tier/);
  assert.match(stored[1].shape, /Basic \/ Sonnet-tier/);

  const text = await capture(() => keys.run(["--reveal"]));
  assert.ok(text.includes(PROD_KEY) && text.includes(STAGING_KEY), "both must be printed");
}));

test("keys: a legacy bare {api_key} config is reported under the default environment", () => withSandbox(() => {
  const { io, keys } = loadKeys();
  // What a pre-named-environments CLI wrote. io.readKeyRef treats it as the
  // default environment's key; `keys` must agree rather than showing nothing.
  io.ensureDir(io.NEOSMITH_DIR);
  fs.writeFileSync(io.CONFIG_FILE, JSON.stringify({ api_key: PROD_KEY }) + "\n");

  const stored = keys.storedKeys();
  assert.deepEqual(stored.map((s) => s.env), ["prod"]);
  assert.equal(stored[0].value, PROD_KEY);
}));

test("keys: with nothing stored it says so instead of printing an empty table", () => withSandbox(async () => {
  const { keys } = loadKeys();
  const text = await capture(() => keys.run([]));
  assert.match(text, /No key stored/);
  assert.match(text, /neosmith login/);
  assert.ok(!/sk-(plus|std|slm)-/.test(text), "nothing key-shaped may be printed when there is no key");
}));

// ── keyRef() per harness ────────────────────────────────────────────────────

test("keys: keyRef reports a literal for the file-writable harnesses", () => withSandbox(() => {
  const { harness, keys } = loadKeys();
  const model = harness.resolveModel("pro");

  for (const id of ["zed", "opencode", "openclaw", "junie", "claude", "continue", "cline"]) {
    harness.get(id).on({ key: PROD_KEY, model });
    const ref = harness.get(id).keyRef();
    assert.ok(ref, `${id}: keyRef must find the key it just wrote`);
    assert.equal(ref.kind, "literal", `${id}: the key is a literal in its config`);
    assert.equal(ref.value, PROD_KEY, `${id}: and it must be the key we handed it`);
    assert.ok(ref.file, `${id}: keyRef must name the file it read`);
  }

  const held = keys.harnessKeys().map((h) => h.id);
  for (const id of ["zed", "opencode", "openclaw", "junie", "claude", "continue", "cline"]) {
    assert.ok(held.includes(id), `${id} must appear in the harness list`);
  }
}));

test("keys: codex reports an env reference, never a key it does not hold", () => withSandbox(() => {
  const { harness } = loadKeys();
  harness.get("codex").on({ key: PROD_KEY, model: harness.resolveModel("pro") });

  const ref = harness.get("codex").keyRef();
  assert.ok(ref, "codex is wired, so it must report something");
  assert.equal(ref.kind, "env-ref", "config.toml holds env_key, not the secret");
  assert.equal(ref.name, "OPENAI_API_KEY");
  assert.ok(!JSON.stringify(ref).includes(PROD_KEY),
    "reporting a literal here would claim the config contains a credential it does not");
}));

test("keys: copilot reports the keychain, which is not the same as 'no key'", () => withSandbox(() => {
  const { harness } = loadKeys();
  harness.get("copilot").on({ key: PROD_KEY, model: harness.resolveModel("pro") });

  const ref = harness.get("copilot").keyRef();
  assert.ok(ref, "the provider entry exists, so there is something to report");
  assert.equal(ref.kind, "keychain");
  assert.match(ref.detail, /SecretStorage/);
  assert.ok(!JSON.stringify(ref).includes(PROD_KEY), "we never write, and cannot read, that key");
}));

test("keys: the UI-driven harnesses report nothing", () => withSandbox(() => {
  const { harness } = loadKeys();
  for (const id of ["cursor", "jetbrains"]) {
    harness.get(id).on({ key: PROD_KEY, model: harness.resolveModel("pro") });
    assert.equal(harness.get(id).keyRef(), null,
      `${id} writes no config file, so it has no key to report`);
  }
}));

test("keys: a harness that is off reports nothing", () => withSandbox(() => {
  const { harness } = loadKeys();
  for (const id of harness.idsSorted()) {
    assert.equal(harness.get(id).keyRef(), null, `${id}: nothing is wired yet`);
  }
}));

test("keys: zed's keyRef ignores a user's own OpenAI key", () => withSandbox((home) => {
  const { harness, keys } = loadKeys();
  // A settings.json wired to somebody else's endpoint. The api_key in it is
  // the user's own credential and is none of this command's business.
  const cfg = harness.get("zed").configFile;
  fs.mkdirSync(path.dirname(cfg), { recursive: true });
  fs.writeFileSync(cfg, JSON.stringify({
    language_models: { openai: { api_url: "https://example.com/v1", api_key: "user-owned-key" } },
  }, null, 2));

  assert.equal(harness.get("zed").keyRef(), null,
    "an api_key under a non-NeoSmith endpoint must never be surfaced");
  assert.ok(!keys.harnessKeys().some((h) => h.id === "zed"));
  void home;
}));

// ── the rotated-credential case ─────────────────────────────────────────────

test("keys: a harness holding a key that matches no stored key is flagged", () => withSandbox(async () => {
  const { io, harness, keys } = loadKeys();
  io.writeKeyRef(PROD_KEY, "prod");
  // Wired with a key that has since been rotated out of ~/.neosmith/config.json.
  harness.get("zed").on({ key: OTHER_KEY, model: harness.resolveModel("pro") });

  const held = keys.harnessKeys();
  const zed = held.find((h) => h.id === "zed");
  assert.equal(zed.value, OTHER_KEY);
  assert.equal(keys.matchEnv(zed.value, keys.storedKeys()), null,
    "it belongs to no stored environment");

  const text = await capture(() => keys.run([]));
  assert.match(text, /does not match any stored key/,
    "this is the whole point of the command — it must be said out loud");
}));

test("keys: a harness holding the stored key is reported as matching, by environment name", () => withSandbox(async () => {
  const { io, harness, keys } = loadKeys();
  io.writeKeyRef(PROD_KEY, "prod");
  io.writeKeyRef(STAGING_KEY, "staging");
  harness.get("zed").on({ key: STAGING_KEY, model: harness.resolveModel("pro") });

  assert.equal(keys.matchEnv(STAGING_KEY, keys.storedKeys()), "staging");
  const text = await capture(() => keys.run([]));
  assert.match(text, /matches the staging key/);
  assert.ok(!/does not match/.test(text));
}));

test("keys: a harness whose config is unreadable is reported, not silently skipped", () => withSandbox(() => {
  const { harness, keys } = loadKeys();
  const mod = harness.get("zed");
  const orig = mod.keyRef;
  mod.keyRef = () => { throw new Error("config unreadable"); };
  try {
    const held = keys.harnessKeys();
    const zed = held.find((h) => h.id === "zed");
    assert.ok(zed, "unverifiable is not the same as absent");
    assert.equal(zed.kind, "error");
    assert.match(zed.detail, /config unreadable/);
  } finally {
    mod.keyRef = orig;
  }
}));

// ── --json ──────────────────────────────────────────────────────────────────

test("keys: --json is masked by default and complete under --reveal", () => withSandbox(async () => {
  const { io, harness, keys } = loadKeys();
  io.writeKeyRef(PROD_KEY, "prod");
  harness.get("zed").on({ key: PROD_KEY, model: harness.resolveModel("pro") });
  harness.get("codex").on({ key: PROD_KEY, model: harness.resolveModel("pro") });

  const masked = JSON.parse(await capture(() => keys.run(["--json"])));
  assert.equal(masked.revealed, false);
  assert.equal(masked.stored[0].env, "prod");
  assert.ok(!JSON.stringify(masked).includes(PROD_KEY), "--json must mask unless --reveal is passed");

  const zed = masked.harnesses.find((h) => h.harness === "zed");
  assert.equal(zed.kind, "literal");
  assert.equal(zed.matchesEnv, "prod");
  const codex = masked.harnesses.find((h) => h.harness === "codex");
  assert.equal(codex.kind, "env-ref");
  assert.equal(codex.envVar, "OPENAI_API_KEY");

  const revealed = JSON.parse(await capture(() => keys.run(["--json", "--reveal"])));
  assert.equal(revealed.revealed, true);
  assert.equal(revealed.stored[0].key, PROD_KEY);
  assert.equal(revealed.harnesses.find((h) => h.harness === "zed").key, PROD_KEY);
}));

// ── operational ─────────────────────────────────────────────────────────────

test("keys: running it writes nothing and adds no audit record", () => withSandbox(async () => {
  const { io, harness, keys } = loadKeys();
  io.writeKeyRef(PROD_KEY, "prod");
  harness.get("zed").on({ key: PROD_KEY, model: harness.resolveModel("pro") });

  const before = fs.readFileSync(io.AUDIT_FILE, "utf8");
  await capture(() => keys.run([]));
  await capture(() => keys.run(["--reveal"]));
  await capture(() => keys.run(["--json", "--reveal"]));
  const after = fs.readFileSync(io.AUDIT_FILE, "utf8");

  assert.equal(after, before, "`keys` is read-only — it must not append to the audit log");
  assert.ok(!after.includes(PROD_KEY), "and the log must still carry no key material");
}));

test("keys: --reveal is accepted in any position and -r is an alias", () => {
  const { keys } = loadKeys();
  assert.deepEqual(keys.parseFlags(["--reveal"]), { reveal: true, json: false });
  assert.deepEqual(keys.parseFlags(["-r"]), { reveal: true, json: false });
  assert.deepEqual(keys.parseFlags(["--json", "--reveal"]), { reveal: true, json: true });
  assert.deepEqual(keys.parseFlags([]), { reveal: false, json: false });
});
