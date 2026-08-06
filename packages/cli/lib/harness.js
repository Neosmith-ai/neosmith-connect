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

// NeoSmith defaults, sourced from neosmith-developer-guide/reference/endpoints.md.
// Override via NEOSMITH_BASE_URL env (kept for parity with the pre-monorepo CLI).
const ROUTER_URL = process.env.NEOSMITH_BASE_URL || "https://router.neosmith.ai";
const OPENAI_BASE_URL = `${ROUTER_URL}/v1`;

// Manifest resolution. NEOSMITH_MANIFEST overrides for testing; the default
// resolves to the monorepo root's harnesses.json (and falls back to MONOREPO_ROOT)
// when the package is symlinked or vendored elsewhere.
const DEFAULT_MANIFEST_PATH = path.resolve(__dirname, "..", "..", "..", "harnesses.json");

function readManifest() {
  const manifestPath = process.env.NEOSMITH_MANIFEST || DEFAULT_MANIFEST_PATH;
  const raw = fs.readFileSync(manifestPath, "utf8");
  return { manifestPath, manifest: JSON.parse(raw) };
}

function resolveModel(flag, models) {
  if (!flag) return models.pro;
  const lower = String(flag).toLowerCase();
  if (["pro", "opus", "neosmith.intelligent-pro", "claude-opus-4", "claude-opus-4-8"].includes(lower)) return models.pro;
  if (["basic", "sonnet", "neosmith.intelligent-basic", "claude-sonnet-4-6"].includes(lower)) return models.basic;
  if (["lite", "haiku", "neosmith.intelligent-lite", "claude-haiku-4", "claude-haiku-4-5"].includes(lower)) return models.lite;
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
function list() { return load(); }

module.exports = {
  ROUTER_URL, OPENAI_BASE_URL,
  load, get, list, ids: () => Object.keys(load()), idsSorted,
  resolveModel: resolveModelPub,
  // Exposed for tests + scripts that need to read the manifest without
  // re-implementing the resolution rules.
  manifest: () => { load(); return MANIFEST; },
  manifestPath: () => readManifest().manifestPath,
};
