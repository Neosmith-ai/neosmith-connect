// scripts/contract/env.test.js
//
// Contract test for lib/env.js — the environment resolver.
//
// Everything asserted here is a pure function of injected (argv, env, manifest),
// so staging and local-dev behavior is provable on any OS without touching
// process.env. Same convention as envsetup.test.js, which asserts Windows
// output while running on Linux CI.
//
// The security-relevant case is `isNeosmithUrl`. The predicate it replaced was
// `.includes("router.neosmith.ai")`, a substring test that also matched
// attacker-controlled lookalike hosts — into which the CLI would have written
// a live API key.

"use strict";

const test = require("node:test");
const assert = require("node:assert");

const env = require("../../lib/env");

// A fixture manifest, deliberately not the shipped one: these assertions are
// about resolution rules, not about today's URLs.
const MANIFEST = {
  defaultEnvironment: "prod",
  environments: {
    prod: {
      label: "production",
      baseUrl: "https://router.neosmith.ai",
      openaiBaseUrl: "https://router.neosmith.ai/v1",
      portalUrl: "https://router.neosmith.ai/me/login",
      hosts: ["router.neosmith.ai"],
    },
    staging: {
      label: "staging",
      baseUrl: "https://staging.router.neosmith.ai",
      openaiBaseUrl: "https://staging.router.neosmith.ai/v1",
      portalUrl: "https://staging.router.neosmith.ai/me/login",
      hosts: ["staging.router.neosmith.ai"],
    },
    local: {
      label: "local dev",
      baseUrl: "http://127.0.0.1:4008",
      openaiBaseUrl: "http://127.0.0.1:4008/v1",
      portalUrl: "http://127.0.0.1:4008/me/login",
      hosts: ["127.0.0.1:4008", "localhost:4008"],
    },
  },
};

const resolve = (argv, vars) => env.resolveEnv({ argv: argv || [], env: vars || {}, manifest: MANIFEST });

// --- resolution ------------------------------------------------------------

test("resolveEnv defaults to the manifest's defaultEnvironment", () => {
  const r = resolve();
  assert.equal(r.name, "prod");
  assert.equal(r.baseUrl, "https://router.neosmith.ai");
  assert.equal(r.openaiBaseUrl, "https://router.neosmith.ai/v1");
  assert.equal(r.source, "default");
  assert.equal(r.isDefault, true);
  assert.equal(r.overridden, false);
});

test("resolveEnv honors --env and --env=", () => {
  for (const argv of [["--env", "staging"], ["--env=staging"]]) {
    const r = resolve(argv);
    assert.equal(r.name, "staging", `argv ${JSON.stringify(argv)}`);
    assert.equal(r.baseUrl, "https://staging.router.neosmith.ai");
    assert.equal(r.openaiBaseUrl, "https://staging.router.neosmith.ai/v1");
    assert.equal(r.source, "flag");
    assert.equal(r.isDefault, false);
  }
});

test("resolveEnv honors NEOSMITH_ENV, and --env outranks it", () => {
  assert.equal(resolve([], { NEOSMITH_ENV: "staging" }).name, "staging");
  assert.equal(resolve([], { NEOSMITH_ENV: "staging" }).source, "env-var");
  assert.equal(resolve(["--env", "local"], { NEOSMITH_ENV: "staging" }).name, "local");
});

test("resolveEnv is a pure function — it never mutates process.env", () => {
  const before = JSON.stringify(process.env);
  resolve(["--env", "staging"], { NEOSMITH_ENV: "local" });
  assert.equal(JSON.stringify(process.env), before);
});

// --- the override ----------------------------------------------------------

test("NEOSMITH_BASE_URL outranks --env and flags itself as an override", () => {
  const r = resolve(["--env", "staging"], { NEOSMITH_BASE_URL: "http://127.0.0.1:9999" });
  assert.equal(r.baseUrl, "http://127.0.0.1:9999");
  assert.equal(r.openaiBaseUrl, "http://127.0.0.1:9999/v1");
  assert.equal(r.source, "base-url-override");
  assert.equal(r.overridden, true, "an override that changes the target must announce itself");
  assert.equal(r.requestedName, "staging", "the requested name survives for the warning message");
  assert.equal(r.name, "custom", "an unrecognized host is not any named environment");
});

test("an override URL whose host is a known environment resolves to that name", () => {
  const r = resolve([], { NEOSMITH_BASE_URL: "https://staging.router.neosmith.ai" });
  assert.equal(r.name, "staging");
  assert.equal(r.label, "staging");
});

test("--env plus that same env's own URL is not reported as an override", () => {
  const r = resolve(["--env", "staging"], { NEOSMITH_BASE_URL: "https://staging.router.neosmith.ai" });
  assert.equal(r.overridden, false, "agreement is not a conflict worth warning about");
});

test("a trailing slash on NEOSMITH_BASE_URL never produces a double slash", () => {
  const r = resolve([], { NEOSMITH_BASE_URL: "http://127.0.0.1:4008/" });
  assert.equal(r.baseUrl, "http://127.0.0.1:4008");
  assert.equal(r.openaiBaseUrl, "http://127.0.0.1:4008/v1");
});

// --- failure modes ---------------------------------------------------------

test("an unknown --env throws and names the known environments", () => {
  assert.throws(
    () => resolve(["--env", "stagng"]),
    (e) => /Unknown environment 'stagng'/.test(e.message) &&
           /prod/.test(e.message) && /staging/.test(e.message) && /local/.test(e.message),
    "a typo must never silently fall back to production",
  );
});

test("an unknown NEOSMITH_ENV throws just as loudly as an unknown --env", () => {
  assert.throws(() => resolve([], { NEOSMITH_ENV: "prd" }), /Unknown environment 'prd'/);
});

test("a manifest with no environments throws rather than guessing", () => {
  assert.throws(
    () => env.resolveEnv({ argv: [], env: {}, manifest: { environments: {} } }),
    /declares no `environments`/,
  );
});

test("a defaultEnvironment that isn't declared throws", () => {
  assert.throws(
    () => env.resolveEnv({
      argv: [], env: {},
      manifest: { defaultEnvironment: "nope", environments: { prod: { baseUrl: "https://x" } } },
    }),
    /defaultEnvironment 'nope' is not a declared environment/,
  );
});

// --- stripEnvFlag ----------------------------------------------------------

test("stripEnvFlag removes both flag forms and leaves positionals intact", () => {
  assert.deepEqual(
    env.stripEnvFlag(["claude", "--env", "staging", "on", "--model", "pro"]),
    { argv: ["claude", "on", "--model", "pro"], envName: "staging" },
  );
  assert.deepEqual(
    env.stripEnvFlag(["--env=local", "status"]),
    { argv: ["status"], envName: "local" },
  );
  assert.deepEqual(
    env.stripEnvFlag(["claude", "on"]),
    { argv: ["claude", "on"], envName: null },
  );
});

// --- ownership: the predicate that replaced the substring test -------------

test("isNeosmithUrl matches every configured host of every environment", () => {
  for (const url of [
    "https://router.neosmith.ai",
    "https://router.neosmith.ai/v1",
    "https://staging.router.neosmith.ai/v1/messages",
    "http://127.0.0.1:4008/v1",
    "http://localhost:4008/v1",
  ]) {
    assert.equal(env.isNeosmithUrl(url, MANIFEST), true, url);
  }
});

test("isNeosmithUrl rejects lookalike hosts a substring test would have matched", () => {
  // Each of these contains "router.neosmith.ai" as a substring. The old
  // predicate accepted all of them.
  for (const url of [
    "https://router.neosmith.ai.attacker.example/v1",
    "https://router.neosmith.ai.evil.co",
    "https://notrouter.neosmith.ai",
    "https://evil.example/?next=https://router.neosmith.ai",
  ]) {
    assert.equal(env.isNeosmithUrl(url, MANIFEST), false, url);
  }
});

test("isNeosmithUrl rejects malformed input instead of throwing", () => {
  for (const bad of ["not-a-url", "", null, undefined, 42, {}]) {
    assert.equal(env.isNeosmithUrl(bad, MANIFEST), false, String(bad));
  }
});

test("a local host entry with a port does not claim every localhost URL", () => {
  // Regression guard: matching bare 127.0.0.1 would make `neosmith zed off`
  // strip a user's own Ollama provider.
  assert.equal(env.isNeosmithUrl("http://localhost:11434/v1", MANIFEST), false);
  assert.equal(env.isNeosmithUrl("http://127.0.0.1:11434/v1", MANIFEST), false);
  assert.equal(env.isNeosmithUrl("http://127.0.0.1:4008/v1", MANIFEST), true);
});

test("envForUrl names the owning environment, not just a boolean", () => {
  assert.equal(env.envForUrl("https://router.neosmith.ai/v1", MANIFEST), "prod");
  assert.equal(env.envForUrl("https://staging.router.neosmith.ai", MANIFEST), "staging");
  assert.equal(env.envForUrl("http://localhost:4008", MANIFEST), "local");
  assert.equal(env.envForUrl("https://example.com", MANIFEST), null);
});

test("knownHosts lists every host across every environment", () => {
  assert.deepEqual(env.knownHosts(MANIFEST), [
    "router.neosmith.ai",
    "staging.router.neosmith.ai",
    "127.0.0.1:4008",
    "localhost:4008",
  ]);
});

// --- the shipped manifest --------------------------------------------------

test("the shipped harnesses.json declares prod, staging and local", () => {
  const shipped = require("../../lib/manifest").read().manifest;
  assert.equal(shipped.defaultEnvironment, "prod", "the default must stay production");
  for (const name of ["prod", "staging", "local"]) {
    const def = shipped.environments[name];
    assert.ok(def, `environments.${name} is declared`);
    assert.ok(/^https?:\/\//.test(def.baseUrl), `${name}.baseUrl is a URL`);
    assert.equal(def.openaiBaseUrl, `${def.baseUrl}/v1`, `${name}.openaiBaseUrl is baseUrl + /v1`);
    assert.ok(Array.isArray(def.hosts) && def.hosts.length, `${name}.hosts is non-empty`);
  }
  assert.equal(shipped.environments.staging.baseUrl, "https://staging.router.neosmith.ai");
  assert.equal(
    env.envForUrl(shipped.environments.prod.baseUrl, shipped), "prod",
    "the shipped manifest's own prod URL must resolve to prod",
  );
});
