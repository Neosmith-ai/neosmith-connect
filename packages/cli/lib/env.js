// Environment resolution — which NeoSmith router does this invocation talk to?
//
// The CLI ships three named environments in harnesses.json (`prod`, `staging`,
// `local`). One is selected per invocation by `--env <name>` or NEOSMITH_ENV,
// and NEOSMITH_BASE_URL remains a raw-URL escape hatch for an address with no
// name (an ephemeral test port, a branch deploy).
//
// Precedence:  NEOSMITH_BASE_URL > --env > NEOSMITH_ENV > defaultEnvironment
//
// The raw URL outranks the named env deliberately: an *address* is strictly
// more specific than a *name*, and the contract tests spawn the real binary
// with NEOSMITH_BASE_URL=http://127.0.0.1:<ephemeral> — a developer with
// `export NEOSMITH_ENV=staging` in their shell must not silently break them.
// The override is never silent: callers surface `overridden` to the user.
//
// Everything here except current() is a pure function of injected inputs, per
// CONTRIBUTING.md's "prefer pure functions of an injected platform" rule — so
// staging behavior is assertable on any OS without touching process.env.

"use strict";

const manifestMod = require("./manifest");

// --- URL helpers -----------------------------------------------------------

function trimSlash(u) {
  return typeof u === "string" ? u.replace(/\/+$/, "") : u;
}

function parse(url) {
  if (typeof url !== "string" || !url) return null;
  try { return new URL(url); } catch { return null; }
}

// Every host declared by any environment, in manifest order.
// Entries may carry a port ("127.0.0.1:4008") or not ("router.neosmith.ai").
function knownHosts(manifest) {
  const out = [];
  for (const def of Object.values((manifest && manifest.environments) || {})) {
    for (const h of hostsFor(def)) if (!out.includes(h)) out.push(h);
  }
  return out;
}

function hostsFor(def) {
  if (!def) return [];
  if (Array.isArray(def.hosts) && def.hosts.length) return def.hosts;
  const u = parse(def.baseUrl);
  return u ? [u.host] : [];
}

// Which environment owns this URL? Exact host match, never a substring test.
//
// A substring test (the old `.includes("router.neosmith.ai")`) also matches
// https://router.neosmith.ai.attacker.example/v1 — an attacker-controlled host
// the CLI would have treated as its own and written a live key into.
//
// A host entry with a port matches on host (hostname:port); without one, on
// hostname. That distinction matters for `local`: matching bare 127.0.0.1
// would make *every* localhost URL NeoSmith-owned, so `neosmith zed off` would
// strip a user's own Ollama provider at http://localhost:11434/v1.
function envForUrl(url, manifest) {
  const u = parse(url);
  if (!u) return null;
  for (const [name, def] of Object.entries((manifest && manifest.environments) || {})) {
    for (const h of hostsFor(def)) {
      if (h.includes(":") ? u.host === h : u.hostname === h) return name;
    }
  }
  return null;
}

// Ownership predicate: "is this config ours to strip or restore?"
// Must match ANY known environment. If it matched only the *active* one, then
// `--env staging claude on` followed by a plain `neosmith claude off` would
// report "nothing to disconnect" and leave the user silently wired to staging.
function isNeosmithUrl(url, manifest) {
  return envForUrl(url, manifest) !== null;
}

// --- flag parsing ----------------------------------------------------------

// Remove `--env <name>` / `--env=<name>` from argv, returning both halves.
// Mirrors the --dry-run strip in bin/neosmith.js so the dispatcher only ever
// sees clean positional args.
function stripEnvFlag(argv) {
  const cleaned = [];
  let envName = null;
  const list = Array.isArray(argv) ? argv : [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a === "--env") { envName = list[++i] || ""; continue; }
    if (typeof a === "string" && a.startsWith("--env=")) { envName = a.slice("--env=".length); continue; }
    cleaned.push(a);
  }
  return { argv: cleaned, envName };
}

// --- resolution ------------------------------------------------------------

function known(manifest) {
  return Object.keys((manifest && manifest.environments) || {});
}

// Pure. Returns the full environment descriptor for one invocation.
function resolveEnv({ argv = [], env = {}, manifest } = {}) {
  const envs = (manifest && manifest.environments) || {};
  const names = known(manifest);
  if (!names.length) throw new Error("harnesses.json declares no `environments`");

  const defaultName = manifest.defaultEnvironment || names[0];
  if (!envs[defaultName]) {
    throw new Error(`harnesses.json defaultEnvironment '${defaultName}' is not a declared environment`);
  }

  const fromFlag = stripEnvFlag(argv).envName;
  const fromVar = env.NEOSMITH_ENV || null;
  const requestedName = fromFlag || fromVar || null;

  // A typo must never silently fall back to production.
  if (requestedName && !envs[requestedName]) {
    throw new Error(
      `Unknown environment '${requestedName}'. Known environments: ${names.join(", ")}. ` +
      `(Use NEOSMITH_BASE_URL=<url> to point at an address with no name.)`,
    );
  }

  const rawUrl = trimSlash(env.NEOSMITH_BASE_URL || "");

  if (rawUrl) {
    const matched = envForUrl(rawUrl, manifest);
    const name = matched || "custom";
    const def = matched ? envs[matched] : null;
    // Only "overridden" when the URL actually differs from what the requested
    // name would have produced — `--env staging` plus staging's own URL is not
    // a conflict worth warning about.
    const wouldHaveBeen = requestedName ? trimSlash(envs[requestedName].baseUrl) : null;
    return {
      name,
      // Which key slot to read/write. An unrecognized address has no slot of
      // its own, so it borrows the one the user asked for by name — and the
      // default environment's when they named none. That keeps `--env staging
      // NEOSMITH_BASE_URL=<branch deploy>` on the staging key rather than
      // silently sending the production key to an arbitrary host.
      keyEnv: matched || requestedName || defaultName,
      baseUrl: rawUrl,
      openaiBaseUrl: def ? def.openaiBaseUrl : `${rawUrl}/v1`,
      portalUrl: def ? def.portalUrl : `${rawUrl}/me/login`,
      label: def ? def.label : "custom",
      isDefault: name === defaultName,
      source: "base-url-override",
      overridden: !!requestedName && wouldHaveBeen !== rawUrl,
      requestedName,
      defaultName,
    };
  }

  const name = requestedName || defaultName;
  const def = envs[name];
  return {
    name,
    keyEnv: name,
    baseUrl: trimSlash(def.baseUrl),
    openaiBaseUrl: trimSlash(def.openaiBaseUrl) || `${trimSlash(def.baseUrl)}/v1`,
    portalUrl: def.portalUrl || `${trimSlash(def.baseUrl)}/me/login`,
    label: def.label || name,
    isDefault: name === defaultName,
    source: fromFlag ? "flag" : (fromVar ? "env-var" : "default"),
    overridden: false,
    requestedName,
    defaultName,
  };
}

// --- process-wide accessor -------------------------------------------------

let CURRENT = null;

// Memoized resolution against the live process. Resolved on first *read*, not
// at require time — that is what lets bin/neosmith.js strip `--env` from argv
// before any URL is computed, without re-exec and without making require order
// load-bearing.
function current() {
  if (CURRENT) return CURRENT;
  CURRENT = resolveEnv({
    argv: process.argv.slice(2),
    env: process.env,
    manifest: manifestMod.read().manifest,
  });
  return CURRENT;
}

function reset() {
  CURRENT = null;
  manifestMod.reset();
}

module.exports = {
  resolveEnv,
  stripEnvFlag,
  knownHosts,
  envForUrl,
  isNeosmithUrl,
  current,
  reset,
};
