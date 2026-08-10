// scripts/contract/copilot.profiles.test.js
//
// Contract for the two things that made `neosmith copilot on` a silent no-op
// in the field: the file it writes, and the profiles it writes it to.
//
//   1. WHERE. chatLanguageModels.json is owned by VS Code, not by the
//      github.copilot-chat extension, and lives at the PROFILE ROOT. Writing
//      globalStorage/github.copilot-chat/ produced a file nothing ever read.
//   2. WHICH. VS Code keeps a separate copy per profile. A user on a named
//      profile saw an empty model picker no matter how many times they ran
//      `on`, because only the default profile was wired.
//   3. Profiles carrying useDefaultFlags.languageModels inherit the default
//      profile's list — writing them a file of their own is wrong.
//   4. A pre-0.9 snapshot points at the OLD path. Once id "copilot" started
//      meaning the default-profile file, replaying that snapshot would delete
//      or clobber a config it never came from. That must never happen.

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
  for (const id of HARNESS_MODULES) {
    delete require.cache[require.resolve(`../../lib/harnesses/${id}`)];
  }
  return { io: require("../../lib/io"), harness: require("../../lib/harness") };
}

const KEY = "sk-plus-test-aaaaaaaaaaaa";

// _sandbox points HOME, USERPROFILE, APPDATA and XDG_CONFIG_HOME at the temp
// dir, so this resolves to the same place lib/harnesses/copilot.js does.
function userDir(home) {
  if (process.platform === "win32") return path.join(home, "Code", "User");
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "Code", "User");
  return path.join(home, ".config", "Code", "User");
}

function writeProfileRegistry(home, profiles) {
  const p = path.join(userDir(home), "globalStorage", "storage.json");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ userDataProfiles: profiles }, null, 2));
}

function readJSONFile(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function neoEntry(list) {
  return list.find((v) => v && v.name === "NeoSmith");
}

test("copilot: on() writes the profile-root file VS Code actually reads", () => withSandbox((home) => {
  const { harness } = loadAll();
  const copilot = harness.get("copilot");

  copilot.on({ key: KEY, model: harness.resolveModel("pro") });

  const target = path.join(userDir(home), "chatLanguageModels.json");
  assert.ok(fs.existsSync(target), "the default profile's chatLanguageModels.json must exist");
  assert.equal(copilot.configFile, target, "configFile must name the profile-root file");

  const legacy = path.join(userDir(home), "globalStorage", "github.copilot-chat", "chatLanguageModels.json");
  assert.ok(!fs.existsSync(legacy), "nothing may be written to the globalStorage path VS Code ignores");
}));

test("copilot: the written entry matches VS Code's schema", () => withSandbox((home) => {
  const { harness } = loadAll();
  harness.get("copilot").on({ key: KEY, model: harness.resolveModel("pro") });

  const parsed = readJSONFile(path.join(userDir(home), "chatLanguageModels.json"));
  assert.ok(Array.isArray(parsed), "the file root is an array of providers, not {vendors:[…]}");

  const neo = neoEntry(parsed);
  assert.ok(neo, "provider is keyed `name`, not `displayName`");
  assert.equal(neo.vendor, "customendpoint");
  assert.equal(neo.apiType, "chat-completions");
  assert.ok(!("baseUrl" in neo), "no provider-level baseUrl — VS Code reads url per model");
  assert.ok(!("apiKey" in neo),
    "apiKey must be left for VS Code to mint; an invented ${input:…} name is not a handle it resolves");

  const model = neo.models[0];
  assert.equal(model.id, harness.resolveModel("pro"));
  assert.equal(model.url, "https://router.neosmith.ai/v1", "the endpoint lives on the model");
  assert.equal(model.toolCalling, true);
  assert.equal(model.vision, true);
}));

test("copilot: on() wires every named profile, not just the default", () => withSandbox((home) => {
  const { harness } = loadAll();
  writeProfileRegistry(home, [
    { location: "2ceb44ea", name: "router-v4-IP-license" },
    { location: "abc12345", name: "Second" },
  ]);

  harness.get("copilot").on({ key: KEY, model: harness.resolveModel("pro") });

  for (const loc of ["2ceb44ea", "abc12345"]) {
    const f = path.join(userDir(home), "profiles", loc, "chatLanguageModels.json");
    assert.ok(fs.existsSync(f), `profile ${loc} must be wired`);
    assert.ok(neoEntry(readJSONFile(f)), `profile ${loc} must carry the NeoSmith provider`);
  }
  assert.ok(neoEntry(readJSONFile(path.join(userDir(home), "chatLanguageModels.json"))),
    "the default profile must be wired too");
}));

test("copilot: a profile inheriting languageModels is left alone", () => withSandbox((home) => {
  const { harness } = loadAll();
  writeProfileRegistry(home, [
    { location: "builtin/agents", name: "Agents", useDefaultFlags: { languageModels: true } },
  ]);

  harness.get("copilot").on({ key: KEY, model: harness.resolveModel("pro") });

  const inherited = path.join(userDir(home), "profiles", "builtin", "agents", "chatLanguageModels.json");
  assert.ok(!fs.existsSync(inherited),
    "a profile that inherits language models reads the default file — giving it its own would shadow that");
}));

test("copilot: off() removes the entry from every profile it wired", () => withSandbox((home) => {
  const { harness } = loadAll();
  writeProfileRegistry(home, [{ location: "2ceb44ea", name: "router-v4-IP-license" }]);

  const seed = JSON.stringify([
    { name: "My Own", vendor: "customendpoint", models: [{ id: "x", url: "https://example.com/v1" }] },
  ], null, 2) + "\n";
  const profileFile = path.join(userDir(home), "profiles", "2ceb44ea", "chatLanguageModels.json");
  fs.mkdirSync(path.dirname(profileFile), { recursive: true });
  fs.writeFileSync(profileFile, seed);

  const copilot = harness.get("copilot");
  copilot.on({ key: KEY, model: harness.resolveModel("pro") });
  assert.ok(neoEntry(readJSONFile(profileFile)), "precondition: the profile was wired");

  copilot.off({});

  assert.equal(fs.readFileSync(profileFile, "utf8"), seed,
    "the named profile's pre-connect bytes must come back verbatim");
  assert.ok(!fs.existsSync(path.join(userDir(home), "chatLanguageModels.json")),
    "the default file did not exist pre-connect, so off() removes it");
}));

test("copilot: status() reports every profile carrying the entry", () => withSandbox((home) => {
  const { harness } = loadAll();
  writeProfileRegistry(home, [{ location: "2ceb44ea", name: "router-v4-IP-license" }]);
  const copilot = harness.get("copilot");

  assert.equal(copilot.status({}).on, false, "nothing wired yet");

  copilot.on({ key: KEY, model: harness.resolveModel("pro") });
  const st = copilot.status({});
  assert.equal(st.on, "models-written", "models are written but the key is still pending");
  assert.match(st.detail, /router-v4-IP-license/, "status must name the profiles it found");

  copilot.off({});
  assert.equal(copilot.status({}).on, false);
}));

// ── the key handle ──────────────────────────────────────────────────────────
//
// Verified against a live VS Code build: given an entry with no apiKey, VS Code
// rewrites the file and appends its own SecretStorage reference, leaving
// everything else as written. The hash is per-entry — two profiles pointing at
// the same router URL got different ones — so a handle can never be copied or
// synthesized, and its presence is the CLI's only evidence the manual step is
// done.

// Simulates VS Code writing the handle back after the user enters a key.
function stampKeyHandle(file, hash) {
  const list = readJSONFile(file);
  neoEntry(list).apiKey = "${input:chat.lm.secret." + hash + "}";
  fs.writeFileSync(file, JSON.stringify(list, null, "\t"));
}

test("copilot: status() reaches `on` once VS Code stamps its SecretStorage handle", () => withSandbox((home) => {
  const { harness } = loadAll();
  const copilot = harness.get("copilot");
  copilot.on({ key: KEY, model: harness.resolveModel("pro") });

  assert.equal(copilot.status({}).on, "models-written", "no handle yet — the manual step is outstanding");

  stampKeyHandle(path.join(userDir(home), "chatLanguageModels.json"), "70e22ef4");

  const st = copilot.status({});
  assert.equal(st.on, true, "the handle is observable proof the key was entered");
  assert.match(st.detail, /SecretStorage handle present/);
}));

test("copilot: a handle in one profile flags the profiles still missing one", () => withSandbox((home) => {
  const { harness } = loadAll();
  writeProfileRegistry(home, [{ location: "2ceb44ea", name: "router-v4-IP-license" }]);
  const copilot = harness.get("copilot");
  copilot.on({ key: KEY, model: harness.resolveModel("pro") });

  stampKeyHandle(path.join(userDir(home), "chatLanguageModels.json"), "70e22ef4");

  const st = copilot.status({});
  assert.equal(st.on, true);
  assert.match(st.detail, /key still pending in: router-v4-IP-license/,
    "a key entered in one profile does not carry to another — say so");
}));

test("copilot: an apiKey that is not a VS Code handle does not count as connected", () => withSandbox((home) => {
  const { harness } = loadAll();
  const copilot = harness.get("copilot");
  copilot.on({ key: KEY, model: harness.resolveModel("pro") });

  const target = path.join(userDir(home), "chatLanguageModels.json");
  const list = readJSONFile(target);
  // The pre-0.9 invented reference. VS Code never resolves it, so treating it
  // as proof of a key is exactly the false positive to avoid.
  neoEntry(list).apiKey = "${input:neosmithApiKey}";
  fs.writeFileSync(target, JSON.stringify(list, null, 2));

  assert.equal(copilot.status({}).on, "models-written",
    "only ${input:chat.lm.secret.*} is a handle VS Code resolves");
}));

test("copilot: off() removes an entry VS Code has since stamped a handle onto", () => withSandbox((home) => {
  const { harness } = loadAll();
  const copilot = harness.get("copilot");

  const target = path.join(userDir(home), "chatLanguageModels.json");
  const seed = JSON.stringify([
    { name: "My Own", vendor: "customendpoint", models: [{ id: "x", url: "https://example.com/v1" }] },
  ], null, 2) + "\n";
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, seed);

  copilot.on({ key: KEY, model: harness.resolveModel("pro") });
  stampKeyHandle(target, "70e22ef4");

  copilot.off({});

  assert.equal(fs.readFileSync(target, "utf8"), seed,
    "VS Code rewriting the file must not defeat the snapshot restore");
}));

// ── on/off symmetry ─────────────────────────────────────────────────────────
//
// `on` skips a profile that already carries a NeoSmith entry, and takes no
// snapshot of it. `off` must skip it too: stripping a hand-made entry it never
// wrote destroys user work with nothing to restore from — and, in the real
// case that prompted this, a VS Code SecretStorage handle that cannot be
// regenerated by hand.
//
// This can't strand a CLI-authored entry: every version since 0.8 records a
// restore ledger, and before 0.9 the only file ever written was the
// globalStorage one. A profile-root entry with neither can only be hand-made.

function handMade(hash) {
  return JSON.stringify([{
    name: "Neosmith",
    vendor: "customendpoint",
    apiKey: "${input:chat.lm.secret." + hash + "}",
    apiType: "chat-completions",
    models: [{ id: "neosmith.intelligent-pro", url: "https://router.neosmith.ai/v1" }],
  }], null, "\t");
}

test("copilot: off() leaves a hand-made entry that on() refused to touch", () => withSandbox((home) => {
  const { harness } = loadAll();
  const copilot = harness.get("copilot");

  const dflt = path.join(userDir(home), "chatLanguageModels.json");
  fs.mkdirSync(path.dirname(dflt), { recursive: true });
  fs.writeFileSync(dflt, handMade("-b2c6430"));

  const res = copilot.on({ key: KEY, model: harness.resolveModel("pro") });
  assert.ok(res.alreadyOn, "precondition: on() declines a profile that already has an entry");

  copilot.off({});

  assert.equal(fs.readFileSync(dflt, "utf8"), handMade("-b2c6430"),
    "off() must not strip an entry it never wrote — there is no snapshot to undo it with");
}));

test("copilot: off() reports entries it left, instead of claiming nothing was found", () => withSandbox((home) => {
  const { harness } = loadAll();
  const copilot = harness.get("copilot");

  const dflt = path.join(userDir(home), "chatLanguageModels.json");
  fs.mkdirSync(path.dirname(dflt), { recursive: true });
  fs.writeFileSync(dflt, handMade("-b2c6430"));

  const res = copilot.off({});
  assert.deepEqual(res.leftAlone, [dflt],
    "an entry we declined to remove is still live in VS Code — it must be named, " +
    "not swallowed by a 'nothing to disconnect' line");
  assert.equal(res.partial, true, "this is not a clean disconnect");
}));

test("copilot: a hand-made default entry survives while a wired profile is undone", () => withSandbox((home) => {
  const { harness } = loadAll();
  writeProfileRegistry(home, [{ location: "2ceb44ea", name: "router-v4-IP-license" }]);
  const copilot = harness.get("copilot");

  const dflt = path.join(userDir(home), "chatLanguageModels.json");
  fs.mkdirSync(path.dirname(dflt), { recursive: true });
  fs.writeFileSync(dflt, handMade("-b2c6430"));

  copilot.on({ key: KEY, model: harness.resolveModel("pro") });
  const profileFile = path.join(userDir(home), "profiles", "2ceb44ea", "chatLanguageModels.json");
  assert.ok(fs.existsSync(profileFile), "precondition: the named profile was wired");

  copilot.off({});

  assert.ok(!fs.existsSync(profileFile), "the profile we created is removed");
  assert.equal(fs.readFileSync(dflt, "utf8"), handMade("-b2c6430"), "the one we didn't write is intact");
}));

test("copilot: off() deletes the pre-0.9 file outright when we were its only content", () => withSandbox((home) => {
  const { harness } = loadAll();
  const legacy = path.join(userDir(home), "globalStorage", "github.copilot-chat", "chatLanguageModels.json");
  fs.mkdirSync(path.dirname(legacy), { recursive: true });
  fs.writeFileSync(legacy, JSON.stringify({
    vendors: [{ vendor: "customendpoint", displayName: "NeoSmith", baseUrl: "https://router.neosmith.ai/v1", models: [] }],
  }, null, 2));

  harness.get("copilot").off({});

  assert.ok(!fs.existsSync(legacy),
    "nothing but our entry was in a file VS Code never read — leave no husk behind");
}));

// ── the migration hazard ────────────────────────────────────────────────────

test("copilot: a pre-0.9 tombstone must not delete the default profile's config", () => withSandbox((home) => {
  const { io, harness } = loadAll();
  const copilot = harness.get("copilot");

  // Exactly the state a machine connected by <=0.8 is in: a tombstone recorded
  // against the globalStorage path (the file did not exist before that connect)
  // plus a real, user-authored profile-root config.
  const legacy = path.join(userDir(home), "globalStorage", "github.copilot-chat", "chatLanguageModels.json");
  io.ensureDir(io.SNAPSHOTS_DIR);
  fs.writeFileSync(io.snapshotPath("copilot"), JSON.stringify({ __tombstone: true, path: legacy }));

  const target = path.join(userDir(home), "chatLanguageModels.json");
  const userConfig = JSON.stringify([
    { name: "My Own", vendor: "customendpoint", models: [{ id: "x", url: "https://example.com/v1" }] },
  ], null, 2) + "\n";
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, userConfig);

  copilot.off({});

  assert.ok(fs.existsSync(target), "the user's default-profile config must survive a stale tombstone");
  assert.equal(fs.readFileSync(target, "utf8"), userConfig, "and must be untouched — it holds no NeoSmith entry");
}));

test("copilot: a pre-0.9 byte snapshot must not clobber the default profile's config", () => withSandbox((home) => {
  const { io, harness } = loadAll();
  const copilot = harness.get("copilot");

  // A .bak holding the old {"vendors":[…]} shape can only have come from the
  // globalStorage path — VS Code never writes that shape.
  io.ensureDir(io.SNAPSHOTS_DIR);
  fs.writeFileSync(io.snapshotPath("copilot"), JSON.stringify({ vendors: [{ vendor: "customendpoint" }] }));

  const target = path.join(userDir(home), "chatLanguageModels.json");
  const userConfig = JSON.stringify([{ name: "My Own", vendor: "openai", models: [] }], null, 2) + "\n";
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, userConfig);

  copilot.off({});

  assert.equal(fs.readFileSync(target, "utf8"), userConfig,
    "the stale snapshot must be discarded, not written over the real config");
}));

test("copilot: off() strips our pre-0.9 entry but keeps the file if anything else is in it", () => withSandbox((home) => {
  const { harness } = loadAll();
  const legacy = path.join(userDir(home), "globalStorage", "github.copilot-chat", "chatLanguageModels.json");
  fs.mkdirSync(path.dirname(legacy), { recursive: true });
  fs.writeFileSync(legacy, JSON.stringify({
    vendors: [
      { vendor: "customendpoint", displayName: "NeoSmith", baseUrl: "https://router.neosmith.ai/v1", models: [] },
      { vendor: "customendpoint", displayName: "My Own", baseUrl: "https://example.com/v1", models: [] },
    ],
  }, null, 2));

  harness.get("copilot").off({});

  assert.ok(fs.existsSync(legacy), "someone else's content means the file is not ours to delete");
  const after = readJSONFile(legacy);
  assert.deepEqual(after.vendors.map((v) => v.displayName), ["My Own"],
    "our entry goes, theirs stays — and the pre-0.9 {vendors:[…]} shape is preserved as found");
}));

test("copilot: status() calls out a stale pre-0.9 entry instead of reporting connected", () => withSandbox((home) => {
  const { harness } = loadAll();
  const legacy = path.join(userDir(home), "globalStorage", "github.copilot-chat", "chatLanguageModels.json");
  fs.mkdirSync(path.dirname(legacy), { recursive: true });
  fs.writeFileSync(legacy, JSON.stringify({
    vendors: [{ vendor: "customendpoint", displayName: "NeoSmith", baseUrl: "https://router.neosmith.ai/v1", models: [] }],
  }, null, 2));

  const st = harness.get("copilot").status({});
  assert.equal(st.on, false, "an entry only in the dead path is not connected");
  assert.match(st.detail, /never read/, "and the user must be told why");
}));
