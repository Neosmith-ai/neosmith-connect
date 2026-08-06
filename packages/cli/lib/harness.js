// Harness registry — loads lib/harnesses/*.js, exposes them by subcommand id,
// provides shared defaults (NeoSmith router URL, default SKU, model catalog).
//
// Each harness module exports:
//   { id, name, writable, configFile, on(ctx), off(ctx), status(ctx), help() }
//
// Mirrors fireconnect's per-harness interface but with NeoSmith's wire format
// and auth model (plaintext 0600 key in config, no keychain, no custom headers).

"use strict";

const fs = require("fs");
const path = require("path");

// NeoSmith defaults, sourced from neosmith-developer-guide/reference/endpoints.md.
const ROUTER_URL = process.env.NEOSMITH_BASE_URL || "https://router.neosmith.ai";
const OPENAI_BASE_URL = `${ROUTER_URL}/v1`;

// Default SKU ladder — Pro / Basic / Lite. Anthropic-style ids are accepted
// too (claude-opus-4 → intelligent-pro), but we recommend the NeoSmith branded
// SKUs in config writes so the routing is unambiguous.
const MODELS = {
  pro: "neosmith.intelligent-pro",
  basic: "neosmith.intelligent-basic",
  lite: "neosmith.intelligent-lite",
};

function resolveModel(flag) {
  if (!flag) return MODELS.pro;
  const lower = String(flag).toLowerCase();
  if (["pro", "opus", "neosmith.intelligent-pro", "claude-opus-4", "claude-opus-4-8"].includes(lower)) return MODELS.pro;
  if (["basic", "sonnet", "neosmith.intelligent-basic", "claude-sonnet-4-6"].includes(lower)) return MODELS.basic;
  if (["lite", "haiku", "neosmith.intelligent-lite", "claude-haiku-4", "claude-haiku-4-5"].includes(lower)) return MODELS.lite;
  // Already looks like a NeoSmith SKU — pass through.
  if (flag.startsWith("neosmith.")) return flag;
  return flag;
}

const REGISTRY = {};

function load() {
  if (Object.keys(REGISTRY).length) return REGISTRY;
  const dir = __dirname; // lib/harness.js loads peers lib/harnesses/*.js
  const here = __dirname;
  const harnessDir = path.join(here, "harnesses");
  for (const name of fs.readdirSync(harnessDir)) {
    if (!name.endsWith(".js")) continue;
    const mod = require(path.join(harnessDir, name));
    if (!mod || !mod.id) continue;
    // Defaults that every harness inherits.
    REGISTRY[mod.id] = Object.assign({
      writable: true,
      configFile: null,
      on() { throw new Error(`${mod.id}.on not implemented`); },
      off() { throw new Error(`${mod.id}.off not implemented`); },
      status() { return { on: false, detail: "not implemented" }; },
      help() { return `(${mod.id}: no help available)`; },
    }, mod);
  }
  // Stable display order.
  for (const id of ["claude", "codex", "continue", "cline", "jetbrains"]) {
    if (!REGISTRY[id]) throw new Error(`harness registry missing '${id}'`);
  }
  return REGISTRY;
}

function get(id) { return load()[id]; }
function list() { return Object.values(load()); }
function ids() { return Object.keys(load()); }

module.exports = { ROUTER_URL, OPENAI_BASE_URL, MODELS, resolveModel, load, get, list, ids };
