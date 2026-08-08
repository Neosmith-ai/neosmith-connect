// scripts/contract/env-flag.test.js
//
// Contract test for `--env` end to end, through the real CLI binary in a
// sandboxed HOME. env.test.js proves the resolver in isolation; this proves the
// flag survives argv stripping, reaches disk, and that off/status/on behave
// correctly when the wired environment differs from the active one.
//
// The invariant worth stating plainly: OWNERSHIP is matched against every
// known environment, REPORTING against the exact one. Get that backwards and
// `neosmith claude off` silently leaves a staging-wired user on staging.

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { sandboxForFixture } = require("./_sandbox");

const CLI = path.resolve(__dirname, "..", "..", "bin", "neosmith.js");
const LIB = path.resolve(__dirname, "..", "..", "lib");
const MANIFEST = require("../../lib/manifest").read().manifest;

const PROD = MANIFEST.environments.prod.baseUrl;
const STAGING = MANIFEST.environments.staging.baseUrl;
const KEY = "sk-slm-envflagtest0000";

function run(args, home, extraEnv) {
  const env = { ...process.env, HOME: home, USERPROFILE: home, APPDATA: home, ...(extraEnv || {}) };
  delete env.NEOSMITH_ENV;
  delete env.NEOSMITH_BASE_URL;
  if (extraEnv) Object.assign(env, extraEnv);
  const r = spawnSync(process.execPath, [CLI, ...args], { env, encoding: "utf8" });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "", all: (r.stdout || "") + (r.stderr || "") };
}

function fresh() {
  const { home } = sandboxForFixture({ apiKey: KEY });
  fs.mkdirSync(path.join(home, ".neosmith"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".neosmith", "config.json"),
    JSON.stringify({ keys: { prod: KEY, staging: KEY } }, null, 2),
  );
  return home;
}

const claudeSettings = (home) => path.join(home, ".claude", "settings.json");
const readClaude = (home) => JSON.parse(fs.readFileSync(claudeSettings(home), "utf8"));

// --- the flag reaches disk --------------------------------------------------

test("claude on --env staging writes the staging base URL", () => {
  const home = fresh();
  const r = run(["--env", "staging", "claude", "on"], home);
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}: ${r.all}`);
  const cfg = readClaude(home);
  assert.equal(cfg.env.ANTHROPIC_BASE_URL, STAGING);
  assert.equal(cfg.env.ANTHROPIC_AUTH_TOKEN, KEY);
});

test("--env=staging is accepted in the same position as --env staging", () => {
  const home = fresh();
  assert.equal(run(["--env=staging", "claude", "on"], home).status, 0);
  assert.equal(readClaude(home).env.ANTHROPIC_BASE_URL, STAGING);
});

test("--env after the harness word still applies and is not read as a subcommand", () => {
  // The strip happens before dispatch, so position must not matter.
  const home = fresh();
  const r = run(["claude", "on", "--env", "staging"], home);
  assert.equal(r.status, 0, r.all);
  assert.equal(readClaude(home).env.ANTHROPIC_BASE_URL, STAGING);
  assert.ok(!/Unknown subcommand/.test(r.all), "--env must never be parsed as a harness subcommand");
});

test("NEOSMITH_ENV works without the flag, and the default is still prod", () => {
  const a = fresh();
  assert.equal(run(["claude", "on"], a, { NEOSMITH_ENV: "staging" }).status, 0);
  assert.equal(readClaude(a).env.ANTHROPIC_BASE_URL, STAGING);

  const b = fresh();
  assert.equal(run(["claude", "on"], b).status, 0);
  assert.equal(readClaude(b).env.ANTHROPIC_BASE_URL, PROD, "no --env must stay on production");
});

test("codex on --env staging writes the staging /v1 base_url into config.toml", () => {
  const home = fresh();
  const r = run(["--env", "staging", "codex", "on"], home);
  assert.equal(r.status, 0, r.all);
  const toml = fs.readFileSync(path.join(home, ".codex", "config.toml"), "utf8");
  assert.match(toml, new RegExp(`base_url\\s*=\\s*"${STAGING}/v1"`));
  assert.match(toml, /env_key\s*=\s*"OPENAI_API_KEY"/, "the key is referenced by name, never written");
  assert.ok(!toml.includes(KEY), "codex must never write the key itself to disk");
});

test("an unknown --env exits non-zero and names the known environments", () => {
  const r = run(["--env", "stagng", "status"], fresh());
  assert.notEqual(r.status, 0);
  assert.match(r.all, /Unknown environment 'stagng'/);
  assert.match(r.all, /prod/);
  assert.match(r.all, /staging/);
});

// --- ownership: off must find wiring from ANY environment -------------------

test("off removes staging wiring even when run with the default environment", () => {
  const home = fresh();
  assert.equal(run(["--env", "staging", "claude", "on"], home).status, 0);
  assert.equal(readClaude(home).env.ANTHROPIC_BASE_URL, STAGING);

  // No --env here: the user disconnects the way they always would.
  const off = run(["claude", "off"], home);
  assert.equal(off.status, 0, off.all);
  assert.ok(
    !fs.existsSync(claudeSettings(home)),
    "off must remove the staging wiring, not report 'nothing to disconnect' and leave the user on staging",
  );
});

test("status reports the wired environment and flags a mismatch with the active one", () => {
  const home = fresh();
  run(["claude", "on"], home);                       // wired to prod
  const r = run(["--env", "staging", "status"], home); // viewed as staging
  assert.equal(r.status, 0, r.all);
  assert.match(r.all, /on\(prod\)/, "the tag names the environment on disk");
  assert.match(r.all, /wired to prod, but --env staging is active/);
  assert.match(r.all, /env=staging/, "the banner names the active environment");
});

// --- the cross-environment guard -------------------------------------------

test("on refuses to re-point a prod-wired harness at staging without --force", () => {
  const home = fresh();
  assert.equal(run(["claude", "on"], home).status, 0);

  const r = run(["--env", "staging", "claude", "on"], home);
  assert.notEqual(r.status, 0, "re-pointing across environments must not silently succeed");
  assert.match(r.all, /already connected to NeoSmith prod/);
  assert.match(r.all, /--force/, "the error must name the escape hatch");
  assert.equal(
    readClaude(home).env.ANTHROPIC_BASE_URL, PROD,
    "the refusal must leave the existing wiring untouched",
  );
});

test("--force re-points across environments", () => {
  const home = fresh();
  run(["claude", "on"], home);
  const r = run(["--env", "staging", "claude", "on", "--force"], home);
  assert.equal(r.status, 0, r.all);
  assert.equal(readClaude(home).env.ANTHROPIC_BASE_URL, STAGING);
});

test("a repeat on within the SAME environment still warns and no-ops", () => {
  const home = fresh();
  run(["--env", "staging", "claude", "on"], home);
  const r = run(["--env", "staging", "claude", "on"], home);
  assert.equal(r.status, 0, "same-environment repeat is not an error");
  assert.match(r.all, /already points at NeoSmith \(staging\)/);
});

test("codex refuses a cross-environment re-point but still allows a same-env model switch", () => {
  const home = fresh();
  assert.equal(run(["codex", "on"], home).status, 0);

  const cross = run(["--env", "staging", "codex", "on"], home);
  assert.notEqual(cross.status, 0, "codex must guard environments even though it allows repeat `on`");
  assert.match(cross.all, /already connected to NeoSmith prod/);

  // The documented model-switch path must keep working.
  const same = run(["codex", "on", "--model", "lite"], home);
  assert.equal(same.status, 0, same.all);
  assert.match(fs.readFileSync(path.join(home, ".codex", "config.toml"), "utf8"), /neosmith\.intelligent-lite/);
});

// --- key isolation ---------------------------------------------------------

test("login --env staging never writes the staging key to the legacy api_key slot", () => {
  const { home } = sandboxForFixture({});
  const stagingKey = "sk-slm-stagingonly000";
  // login round-trips /whoami; point it at a dead port so it stores offline.
  const r = run(["--env", "staging", "login", stagingKey], home, {
    NEOSMITH_BASE_URL: "http://127.0.0.1:9",
  });
  assert.equal(r.status, 0, r.all);

  const cfg = JSON.parse(fs.readFileSync(path.join(home, ".neosmith", "config.json"), "utf8"));
  assert.equal(cfg.keys.staging, stagingKey);
  assert.notEqual(
    cfg.api_key, stagingKey,
    "api_key is what install.sh and older CLIs read as the production key",
  );
});

test("a legacy bare {api_key} file is still readable as the default environment", () => {
  const { home } = sandboxForFixture({});
  fs.mkdirSync(path.join(home, ".neosmith"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".neosmith", "config.json"),
    JSON.stringify({ api_key: KEY }),
  );
  assert.equal(run(["claude", "on"], home).status, 0, "pre-0.9 config must keep working");
  assert.equal(readClaude(home).env.ANTHROPIC_AUTH_TOKEN, KEY);
});

test("a prod-only key file does not silently authenticate a staging invocation", () => {
  const { home } = sandboxForFixture({});
  fs.mkdirSync(path.join(home, ".neosmith"), { recursive: true });
  fs.writeFileSync(path.join(home, ".neosmith", "config.json"), JSON.stringify({ api_key: KEY }));
  const r = run(["--env", "staging", "claude", "on"], home);
  assert.notEqual(r.status, 0, "the production key must not be sent to staging by default");
  assert.match(r.all, /No key found for env=staging/);
});

// --- the NEOSMITH_BASE_URL override ----------------------------------------

test("NEOSMITH_BASE_URL overrides --env and says so out loud", () => {
  const home = fresh();
  // The override URL is `local`'s own address, so it resolves to the local
  // environment — including local's key slot. Seed it.
  const cfgPath = path.join(home, ".neosmith", "config.json");
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  cfg.keys.local = KEY;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));

  const r = run(["--env", "staging", "claude", "on"], home, {
    NEOSMITH_BASE_URL: "http://127.0.0.1:4008",
  });
  assert.equal(r.status, 0, r.all);
  assert.match(r.all, /overrides --env staging/, "a silent override is the bug this warning exists to prevent");
  assert.equal(readClaude(home).env.ANTHROPIC_BASE_URL, "http://127.0.0.1:4008");
});

test("an unnamed override address borrows the requested environment's key slot", () => {
  // A branch deploy has no name and no key slot of its own. `--env staging`
  // plus an arbitrary URL must use the STAGING key — never production's.
  const home = fresh();
  const r = run(["--env", "staging", "claude", "on"], home, {
    NEOSMITH_BASE_URL: "https://pr-42.router.example",
  });
  assert.equal(r.status, 0, r.all);
  const cfg = readClaude(home);
  assert.equal(cfg.env.ANTHROPIC_BASE_URL, "https://pr-42.router.example");
  assert.equal(cfg.env.ANTHROPIC_AUTH_TOKEN, KEY);
});

// --- the convention guard ---------------------------------------------------

test("no module destructures ROUTER_URL or OPENAI_BASE_URL at import time", () => {
  // These are lazy getters. A destructuring import captures the value at
  // require time — correct today, silently non-reactive to --env forever after.
  const offenders = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) { walk(p); continue; }
      if (!name.endsWith(".js")) continue;
      // Strip comments first — the guidance comment in harness.js quotes the
      // exact pattern it forbids, and matching prose is not a finding.
      const src = fs.readFileSync(p, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      if (/(?:const|let|var)\s*\{[^}]*\b(?:ROUTER_URL|OPENAI_BASE_URL|DEFAULT_ROUTER)\b[^}]*\}\s*=\s*require\(/.test(src)) {
        offenders.push(path.relative(LIB, p));
      }
    }
  };
  walk(LIB);
  assert.deepEqual(offenders, [], `destructured lazy getters in: ${offenders.join(", ")}`);
});

test("the audit log records which environment each write targeted", () => {
  const home = fresh();
  assert.equal(run(["--env", "staging", "claude", "on"], home).status, 0);
  const lines = fs.readFileSync(path.join(home, ".neosmith", "audit.log"), "utf8")
    .split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(lines.length, "on must produce audit entries");
  assert.ok(lines.every((e) => e.env === "staging"), "every entry names the environment it acted on");
  // The environment name is not a secret, but the key still must not appear.
  assert.ok(!lines.some((e) => JSON.stringify(e).includes(KEY)), "audit must never contain key material");
});
