// Harness registry — loads lib/harnesses/*.js, exposes them by subcommand id,
// provides shared defaults (NeoSmith router URL, default SKU, model catalog).
//
// Each harness module exports:
//   { id, name, writable, configFile, on(ctx), off(ctx), status(ctx), help() }
//
// Mirrors fireconnect's per-harness interface but with NeoSmith's wire format
// and auth model (plaintext 0600 key in config, no keychain, no custom headers).
//
// T1 (feature/neosmith-dev-setup): the canonical harness list and display
// order now live in ../../harnesses.json at the monorepo root. `load()` keeps
// the same throw-on-missing-module failure mode as before — a manifest entry
// whose `.js` module is missing is a release blocker.

"use strict";

const fs = require("fs");
const path = require("path");
const manifestMod = require("./manifest");
const envMod = require("./env");

// Manifest resolution lives in lib/manifest.js — extracted so lib/env.js can
// read harnesses.json without requiring this module (every lib/harnesses/*.js
// requires ../harness, so harness.js can't be on env.js's require path).
function readManifest() {
  return manifestMod.read();
}

function resolveModel(flag, models) {
  if (!flag) return models.pro;
  const lower = String(flag).toLowerCase();
  if (["pro", "opus", "neosmith.intelligent-pro", "claude-opus-4", "claude-opus-4-8"].includes(lower)) return models.pro;
  if (["basic", "sonnet", "neosmith.intelligent-basic", "claude-sonnet-4-6"].includes(lower)) return models.basic;
  // neosmith.intelligent-lite is a de-listed SKU (the router still routes it,
  // but GET /v1/models no longer lists it). Kept as an input alias so anyone
  // who typed it, or has it in a script, still lands on the lite tier.
  if (["lite", "haiku", "neosmith.neolite", "neosmith.intelligent-lite", "claude-haiku-4", "claude-haiku-4-5"].includes(lower)) return models.lite;
  if (models.maestro && ["maestro", "fable", "neosmith.intelligent-maestro", "claude-fable-5"].includes(lower)) return models.maestro;
  // Already looks like a NeoSmith SKU — pass through.
  if (flag.startsWith("neosmith.")) return flag;
  return flag;
}

const REGISTRY = {};
let MANIFEST = null;

function load() {
  if (Object.keys(REGISTRY).length) return REGISTRY;

  const { manifestPath, manifest } = readManifest();
  MANIFEST = manifest;

  // Load every JS module first so missing modules still throw.
  const harnessDir = path.join(__dirname, "harnesses");
  for (const name of fs.readdirSync(harnessDir)) {
    if (!name.endsWith(".js")) continue;
    const mod = require(path.join(harnessDir, name));
    if (!mod || !mod.id) continue;
    REGISTRY[mod.id] = Object.assign({
      writable: true,
      configFile: null,
      on() { throw new Error(`${mod.id}.on not implemented`); },
      off() { throw new Error(`${mod.id}.off not implemented`); },
      status() { return { on: false, detail: "not implemented" }; },
      help() { return `(${mod.id}: no help available)`; },
    }, mod);
  }

  // The manifest owns the canonical id list and the display order. A manifest
  // entry whose .js module is missing throws — same fail-fast as before.
  const declared = manifest.harnesses || [];
  for (const h of declared) {
    if (!REGISTRY[h.id]) {
      throw new Error(
        `harness registry missing '${h.id}' ` +
        `(declared in ${manifestPath}, no matching .js module)`,
      );
    }
  }
  return REGISTRY;
}

// Stable display order from manifest.harnesses[*].registryOrder.
function idsSorted() {
  load();
  return (MANIFEST.harnesses || [])
    .slice()
    .sort((a, b) => (a.registryOrder || 0) - (b.registryOrder || 0))
    .map((h) => h.id);
}

// resolveModel needs the manifest's model ladder — re-exported so callers can
// pass an arbitrary flag and get the same SKU normalization as before.
function resolveModelPub(flag) {
  load();
  return resolveModel(flag, MANIFEST.models);
}

function get(id) { return load()[id]; }
function list() { return Object.values(load()); }

function modelsPub() {
  load();
  return { ...MANIFEST.models };
}

module.exports = {
  // Lazy getters, NOT consts. The router URL must be resolved on first *read*
  // — after bin/neosmith.js has stripped `--env` from argv — not at require
  // time, when every command module is loaded before main() has run.
  //
  // Every consumer reads these as a property access (`harness.ROUTER_URL`), so
  // the getters are transparent. Do NOT destructure them
  // (`const { ROUTER_URL } = require("./harness")`): that captures the value at
  // import time and silently stops reacting to --env. Pinned by the
  // `no-eager-router-url` case in scripts/contract/env-flag.test.js.
  get ROUTER_URL() { return envMod.current().baseUrl; },
  get OPENAI_BASE_URL() { return envMod.current().openaiBaseUrl; },

  // Environment metadata for reporting and guards.
  envInfo: () => envMod.current(),
  envName: () => envMod.current().name,
  // Which stored-key slot the active environment reads/writes. Differs from
  // envName only when NEOSMITH_BASE_URL points at an unnamed address.
  keyEnv: () => envMod.current().keyEnv,
  // Manifest-bound wrappers so callers never re-thread the manifest.
  isNeosmithUrl: (url) => envMod.isNeosmithUrl(url, readManifest().manifest),
  envForUrl: (url) => envMod.envForUrl(url, readManifest().manifest),

  load, get, list, ids: () => Object.keys(load()), idsSorted,
  // Back-compat: pre-monorepo callers read `harness.MODELS.{pro,basic,lite}`.
  // Now sourced from harnesses.json — but the JS shape is identical.
  MODELS: new Proxy({}, {
    get(_t, prop) { load(); return MANIFEST.models[prop]; },
    has(_t, prop) { load(); return prop in MANIFEST.models; },
  }),
  resolveModel: resolveModelPub,
  // Exposed for tests + scripts that need to read the manifest without
  // re-implementing the resolution rules.
  manifest: () => { load(); return MANIFEST; },
  manifestPath: () => readManifest().manifestPath,
};
