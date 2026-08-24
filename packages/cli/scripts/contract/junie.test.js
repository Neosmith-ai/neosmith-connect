// scripts/contract/junie.test.js
//
// Contract for junie.js. The merge/restore contract it shares with every other
// writable harness lives in env-preservation.test.js; this file pins what is
// specific to Junie, and two of those are unlike anything else in the package:
//
//   - baseUrl is the FULL endpoint, not the /v1 root. JetBrains' own example
//     for a local model is http://localhost:11434/v1/chat/completions, and
//     Junie sends to exactly the URL it is given. Writing the base alone —
//     which is the correct answer for every other harness here — 404s every
//     request. Ownership detection still has to work over that longer URL.
//
//   - the profile is discovered by FILENAME. $JUNIE_HOME/models/<id>.json,
//     where the stem is the profile id and JUNIE_HOME relocates the whole
//     directory. Getting either wrong means Junie never sees the profile.
//
// Plus: NeoSmith owns this file, so `off` normally deletes it — but a user can
// still hand-tune fields ON our profile, and those are not ours to discard.

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { withSandbox } = require("./_sandbox");

const KEY = "sk-plus-junie-test-aaaaaaaa";

function loadJunie() {
  for (const m of ["../../lib/io", "../../lib/harness", "../../lib/envsetup",
    "../../lib/harnesses/junie"]) {
    delete require.cache[require.resolve(m)];
  }
  return {
    io: require("../../lib/io"),
    harness: require("../../lib/harness"),
    envsetup: require("../../lib/envsetup"),
    junie: require("../../lib/harnesses/junie"),
  };
}

const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

// JUNIE_HOME is read per call, so it has to be cleared around the tests that
// do not set it — a developer with it exported would otherwise see different
// paths than CI does.
function withoutJunieHome(fn) {
  const saved = process.env.JUNIE_HOME;
  delete process.env.JUNIE_HOME;
  try { return fn(); } finally {
    if (saved === undefined) delete process.env.JUNIE_HOME;
    else process.env.JUNIE_HOME = saved;
  }
}

test("junie on writes a custom model profile with Junie's own field names", () => withSandbox(() => withoutJunieHome(() => {
  const { harness, junie } = loadJunie();
  const res = junie.on({ key: KEY, model: harness.resolveModel("pro") });
  assert.equal(res.wrote, true);

  const p = read(junie.configPath());
  assert.equal(p.id, "neosmith.intelligent-pro");
  assert.equal(p.apiType, "OpenAICompletion",
    "the other legal values are OpenAIResponses / Google / Anthropic — this router is chat-completions");
  assert.equal(p.apiKey, KEY);
  assert.equal(p.providerName, "NeoSmith");
  assert.equal(p.displayName, "NeoSmith Pro");
  assert.equal(p.maxContextLength, 1000000);
  assert.deepEqual(p.fasterModel, { id: "neosmith.neolite" },
    "the helper-task model is the lite tier, mirroring OpenCode's small_model");
})));

test("junie: baseUrl is the FULL endpoint, not the /v1 root", () => withSandbox(() => withoutJunieHome(() => {
  const { junie } = loadJunie();
  junie.on({ key: KEY, model: "neosmith.intelligent-pro" });

  const p = read(junie.configPath());
  assert.equal(p.baseUrl, "https://router.neosmith.ai/v1/chat/completions",
    "Junie sends to exactly this URL — the /v1 root every other harness writes would 404");
})));

test("junie: ownership detection still works over the longer URL", () => withSandbox(() => withoutJunieHome(() => {
  const { harness, junie } = loadJunie();
  junie.on({ key: KEY, model: "neosmith.intelligent-pro" });

  // harness.envForUrl matches on HOST, not path — which is what makes the
  // full-endpoint URL safe to write without special-casing status/off.
  assert.equal(harness.envForUrl(read(junie.configPath()).baseUrl), "prod");
  const s = junie.status({});
  assert.equal(s.on, true);
  assert.equal(s.env, "prod", "status must name the environment, not fall back to null");
})));

test("junie: the profile lands under JUNIE_HOME when it is set", () => withSandbox((home) => {
  const saved = process.env.JUNIE_HOME;
  const custom = path.join(home, "custom-junie");
  process.env.JUNIE_HOME = custom;
  try {
    const { junie } = loadJunie();
    junie.on({ key: KEY, model: "neosmith.intelligent-pro" });
    const expected = path.join(custom, "models", "neosmith.json");
    assert.equal(junie.configPath(), expected);
    assert.ok(fs.existsSync(expected), "JUNIE_HOME relocates the whole models directory");
    assert.ok(!fs.existsSync(path.join(home, ".junie", "models", "neosmith.json")),
      "and nothing may be left at the default path");
  } finally {
    if (saved === undefined) delete process.env.JUNIE_HOME;
    else process.env.JUNIE_HOME = saved;
  }
}));

test("junie: the filename stem is the profile id `custom:` selects", () => withSandbox(() => withoutJunieHome(() => {
  const { junie } = loadJunie();
  assert.equal(junie.profile, "neosmith");
  assert.equal(path.basename(junie.configPath()), `${junie.profile}.json`,
    "Junie derives the profile id from the filename — these two cannot drift apart");
  assert.match(junie.help(), /custom:neosmith/,
    "and the help text has to name the same id the file does");
})));

test("junie on/off round-trips on empty pre-connect state (tombstone)", () => withSandbox(() => withoutJunieHome(() => {
  const { junie } = loadJunie();
  junie.on({ key: KEY, model: "neosmith.intelligent-pro" });
  assert.ok(fs.existsSync(junie.configPath()));
  junie.off({});
  assert.ok(!fs.existsSync(junie.configPath()),
    "the profile is named after us and did not exist before — off deletes it");
})));

test("junie on short-circuits when it is already wired", () => withSandbox(() => withoutJunieHome(() => {
  const { junie } = loadJunie();
  junie.on({ key: KEY, model: "neosmith.intelligent-pro" });
  assert.equal(junie.on({ key: KEY, model: "neosmith.neolite" }).alreadyOn, true,
    "warn-noop idempotency, same as zed/opencode/openclaw — on.js tells you to run `off` first");
  assert.equal(read(junie.configPath()).id, "neosmith.intelligent-pro",
    "and the wired profile is left exactly as it was");
})));

test("junie: off then on switches tier cleanly, with no stale fasterModel", () => withSandbox(() => withoutJunieHome(() => {
  const { junie } = loadJunie();
  junie.on({ key: KEY, model: "neosmith.intelligent-pro" });
  assert.deepEqual(read(junie.configPath()).fasterModel, { id: "neosmith.neolite" });

  junie.off({});
  junie.on({ key: KEY, model: "neosmith.neolite" });

  const p = read(junie.configPath());
  assert.equal(p.id, "neosmith.neolite");
  assert.equal(p.maxContextLength, 512000, "the sealed budget tier's real window");
  assert.ok(!("fasterModel" in p),
    "a fasterModel pointing at the primary is noise — Junie falls back to the primary without it");
})));

test("junie: on never clears a fasterModel the user put on the profile", () => withSandbox(() => withoutJunieHome(() => {
  const { junie } = loadJunie();
  // A profile file named neosmith.json that is NOT wired to NeoSmith — so `on`
  // merges rather than short-circuiting. Clearing fasterModel here would be
  // deleting the user's own setting.
  const cfg = junie.configPath();
  fs.mkdirSync(path.dirname(cfg), { recursive: true });
  fs.writeFileSync(cfg, JSON.stringify({
    baseUrl: "http://localhost:11434/v1/chat/completions",
    fasterModel: { id: "qwen2.5-coder:1.5b" },
  }, null, 2) + "\n");

  junie.on({ key: KEY, model: "neosmith.neolite" });
  assert.deepEqual(read(cfg).fasterModel, { id: "qwen2.5-coder:1.5b" },
    "the lite tier writes no fasterModel of its own — the user's must be left alone");

  junie.off({});
  assert.deepEqual(read(cfg).fasterModel, { id: "qwen2.5-coder:1.5b" }, "and restored, not dropped");
})));

test("junie: another profile in the same directory is never touched", () => withSandbox(() => withoutJunieHome(() => {
  const { junie } = loadJunie();
  const dir = path.dirname(junie.configPath());
  fs.mkdirSync(dir, { recursive: true });
  const mine = path.join(dir, "ollama.json");
  const contents = JSON.stringify({
    id: "qwen3-coder:latest",
    baseUrl: "http://localhost:11434/v1/chat/completions",
    apiType: "OpenAICompletion",
  }, null, 2) + "\n";
  fs.writeFileSync(mine, contents);

  junie.on({ key: KEY, model: "neosmith.intelligent-pro" });
  assert.equal(fs.readFileSync(mine, "utf8"), contents, "after on");
  junie.off({});
  assert.equal(fs.readFileSync(mine, "utf8"), contents, "after off");
  assert.ok(!fs.existsSync(junie.configPath()), "and ours is gone");
})));

test("junie: fields the user added to our profile survive off; the husk does not", () => withSandbox(() => withoutJunieHome(() => {
  const { junie } = loadJunie();
  junie.on({ key: KEY, model: "neosmith.intelligent-pro" });

  // Hand-tuning our profile while connected is a completely normal thing to do.
  const p = read(junie.configPath());
  p.temperature = 0.2;
  fs.writeFileSync(junie.configPath(), JSON.stringify(p, null, 2) + "\n");

  junie.off({});
  assert.ok(fs.existsSync(junie.configPath()), "their field is still on the profile, so the file stays");
  const after = read(junie.configPath());
  assert.equal(after.temperature, 0.2);
  assert.ok(!after.apiKey && !after.baseUrl && !after.apiType, "everything of ours is gone");
})));

test("junie: with no ledger, off strips only the fields NeoSmith owns", () => withSandbox(() => withoutJunieHome(() => {
  const { io, junie } = loadJunie();
  junie.on({ key: KEY, model: "neosmith.intelligent-pro" });

  const p = read(junie.configPath());
  p.extraHeaders = { "X-Mine": "keep-me" };
  fs.writeFileSync(junie.configPath(), JSON.stringify(p, null, 2) + "\n");

  // Lose the ledger and the snapshot — the "connected by an older CLI" case.
  fs.unlinkSync(io.STATE_FILE);
  io.clearSnapshot("junie");

  junie.off({});
  const after = read(junie.configPath());
  assert.deepEqual(after.extraHeaders, { "X-Mine": "keep-me" });
  assert.ok(!after.apiKey, "the key is gone");
  assert.ok(!after.fasterModel, "and so is every other field we wrote");
})));

test("junie: the selection instructions are platform-correct", () => withSandbox(() => {
  const { envsetup } = loadJunie();
  // Pure functions of (vars, platform), so both platforms are assertable from
  // one OS — see the header of lib/envsetup.js.
  const win = envsetup.envSetupLines([["JUNIE_MODEL", "custom:neosmith"]], { platform: "win32" }).join("\n");
  assert.match(win, /setx JUNIE_MODEL "custom:neosmith"/);
  assert.ok(!/^\s*export JUNIE_MODEL/m.test(win),
    "a POSIX export is invisible to PowerShell, cmd and anything launched from the Start menu");

  const posix = envsetup.envSetupLines([["JUNIE_MODEL", "custom:neosmith"]],
    { platform: "linux", shell: "/bin/zsh" }).join("\n");
  assert.match(posix, /export JUNIE_MODEL=custom:neosmith/);
  assert.match(posix, /~\/\.zshrc/);
}));

test("junie status reports whether JUNIE_MODEL actually selects the profile", () => withSandbox(() => withoutJunieHome(() => {
  const { junie } = loadJunie();
  junie.on({ key: KEY, model: "neosmith.intelligent-pro" });

  const saved = process.env.JUNIE_MODEL;
  try {
    delete process.env.JUNIE_MODEL;
    assert.match(junie.status({}).detail, /select with `junie --model custom:neosmith`/,
      "there is no persistent default for a custom profile — saying nothing would imply there is");

    process.env.JUNIE_MODEL = "custom:neosmith";
    assert.match(junie.status({}).detail, /JUNIE_MODEL=custom:neosmith/,
      "naming the selected profile beats a bare 'yes' — with five of them, which one matters");

    // A tier profile is just as valid a selection as the alias.
    process.env.JUNIE_MODEL = "custom:neosmith-lite";
    assert.match(junie.status({}).detail, /JUNIE_MODEL=custom:neosmith-lite/);

    // Something that is not one of ours must not be reported as our selection.
    process.env.JUNIE_MODEL = "custom:someone-elses-profile";
    assert.match(junie.status({}).detail, /select with `junie --model custom:neosmith`/);
  } finally {
    if (saved === undefined) delete process.env.JUNIE_MODEL;
    else process.env.JUNIE_MODEL = saved;
  }
})));

test("junie on does NOT claim the harness is credential-less", () => withSandbox(() => withoutJunieHome(() => {
  const { junie } = loadJunie();
  const res = junie.on({ key: KEY, model: "neosmith.intelligent-pro" });
  assert.ok(!res.needsEnv,
    "needsEnv makes on.js print 'has no credentials until that variable is set' — true for " +
    "codex's env_key indirection, false here: the key is written into the profile. JUNIE_MODEL " +
    "selects a model, it does not supply a credential.");
})));

// ── all four SKUs, one profile file each ────────────────────────────────────
// One Junie profile holds ONE model — there is no catalogue field the way
// opencode/openclaw have. Offering every tier therefore means writing a file
// per tier, and `off` has to take all of them back.

test("junie on writes one profile per SKU, plus the wired-tier alias", () => withSandbox(() => withoutJunieHome(() => {
  const { harness, junie } = loadJunie();
  const res = junie.on({ key: KEY, model: harness.resolveModel("pro") });

  const models = harness.manifest().models;
  const tiers = Object.keys(models);
  assert.equal(res.profiles, tiers.length + 1,
    `${tiers.length} tier profiles plus the custom:${junie.profile} alias`);

  for (const [tier, sku] of Object.entries(models)) {
    const file = junie.profilePath(`${junie.profile}-${tier}`);
    assert.ok(fs.existsSync(file), `custom:${junie.profile}-${tier} must exist`);
    const p = read(file);
    assert.equal(p.id, sku, `${tier}: the profile's model`);
    assert.equal(p.apiKey, KEY, `${tier}: every profile carries the key`);
    assert.equal(p.apiType, "OpenAICompletion", `${tier}: wire format`);
    assert.equal(p.baseUrl, "https://router.neosmith.ai/v1/chat/completions", `${tier}: full endpoint`);
  }
})));

test("junie: each profile declares its own real context window", () => withSandbox(() => withoutJunieHome(() => {
  const { harness, junie } = loadJunie();
  junie.on({ key: KEY, model: harness.resolveModel("pro") });

  const specs = harness.manifest().modelSpecs;
  for (const [tier, sku] of Object.entries(harness.manifest().models)) {
    const p = read(junie.profilePath(`${junie.profile}-${tier}`));
    assert.equal(p.maxContextLength, specs[sku].contextWindow,
      `${tier}: Junie cannot discover a context window — an unset one compacts far too early`);
  }
  assert.equal(read(junie.profilePath(`${junie.profile}-lite`)).maxContextLength, 512000,
    "neolite is the sealed 512K budget tier, not 1M");
})));

test("junie: the lite profile has no fasterModel pointing at itself", () => withSandbox(() => withoutJunieHome(() => {
  const { harness, junie } = loadJunie();
  junie.on({ key: KEY, model: harness.resolveModel("pro") });

  assert.deepEqual(read(junie.profilePath(`${junie.profile}-pro`)).fasterModel, { id: "neosmith.neolite" });
  assert.ok(!("fasterModel" in read(junie.profilePath(`${junie.profile}-lite`))),
    "Junie falls back to the primary when fasterModel is absent — self-reference is noise");
})));

test("junie: the alias tracks --model, the tier profiles do not", () => withSandbox(() => withoutJunieHome(() => {
  const { junie } = loadJunie();
  junie.on({ key: KEY, model: "neosmith.intelligent-basic" });

  assert.equal(read(junie.configPath()).id, "neosmith.intelligent-basic",
    "custom:neosmith means 'the tier I connected with'");
  assert.equal(read(junie.profilePath(`${junie.profile}-pro`)).id, "neosmith.intelligent-pro",
    "custom:neosmith-pro always means pro, whatever was wired");
})));

test("junie: the tier list comes from the manifest, so a new SKU lands for free", () => withSandbox(() => withoutJunieHome(() => {
  const { harness, junie } = loadJunie();
  const declared = junie.tierProfiles().map((t) => t.sku).sort();
  assert.deepEqual(declared, Object.values(harness.manifest().models).sort(),
    "hardcoding the four tiers here is how this file goes stale the day a fifth ships");
})));

test("junie off removes every profile it wrote, and only those", () => withSandbox(() => withoutJunieHome(() => {
  const { harness, junie } = loadJunie();
  // A profile of the user's, sitting in the same directory.
  const dir = path.dirname(junie.configPath());
  fs.mkdirSync(dir, { recursive: true });
  const mine = path.join(dir, "ollama.json");
  fs.writeFileSync(mine, '{"id":"qwen3-coder:latest"}\n');

  junie.on({ key: KEY, model: harness.resolveModel("pro") });
  junie.off({});

  assert.deepEqual(fs.readdirSync(dir), ["ollama.json"],
    "every NeoSmith profile is gone and the user's is untouched");
})));

test("junie off puts back a tier profile the user already owned", () => withSandbox(() => withoutJunieHome(() => {
  const { harness, junie } = loadJunie();
  // Someone who already had a profile at the name we want. `on` must merge into
  // it and `off` must hand it back, not delete a file that predates us.
  const file = junie.profilePath(`${junie.profile}-lite`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const original = JSON.stringify({ id: "my-own-model", temperature: 0.1 }, null, 2) + "\n";
  fs.writeFileSync(file, original);

  junie.on({ key: KEY, model: harness.resolveModel("pro") });
  assert.equal(read(file).id, "neosmith.neolite", "on() re-points it");
  assert.equal(read(file).temperature, 0.1, "and keeps what it does not own");

  junie.off({});
  assert.equal(fs.readFileSync(file, "utf8"), original,
    "a profile that existed pre-connect comes back byte-for-byte, not deleted");
})));

test("junie status counts the tier profiles", () => withSandbox(() => withoutJunieHome(() => {
  const { harness, junie } = loadJunie();
  junie.on({ key: KEY, model: harness.resolveModel("pro") });
  const n = Object.keys(harness.manifest().models).length;
  assert.ok(junie.status({}).detail.includes(`${n} tier profile(s)`),
    `status must say how many tiers are installed; got: ${junie.status({}).detail}`);
})));

test("junie: `on` prints a selection line for every profile it wrote", () => withSandbox(() => withoutJunieHome(() => {
  const { harness, junie } = loadJunie();
  const out = [];
  const origLog = console.log;
  console.log = (...a) => out.push(a.join(" "));
  try { junie.on({ key: KEY, model: harness.resolveModel("pro") }); }
  finally { console.log = origLog; }

  const text = out.join("\n");
  for (const t of junie.tierProfiles()) {
    assert.ok(text.includes(`custom:${t.id}`),
      `a profile the user is never told about is one they will never select (${t.id})`);
  }
})));
