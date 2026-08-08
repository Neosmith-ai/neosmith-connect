// Codex — file-writable.
//
// Writes ~/.codex/config.toml (0600). OpenAI Responses API on
// https://router.neosmith.ai/v1. Per site/agents/codex.md:
//
//   model = "neosmith.intelligent-pro"
//   model_provider = "neosmith"
//
//   [model_providers.neosmith]
//   name      = "NeoSmith"
//   base_url  = "https://router.neosmith.ai/v1"
//   env_key   = "OPENAI_API_KEY"
//   wire_api  = "responses"
//
// The key is referenced via env_key (Codex reads $OPENAI_API_KEY at runtime),
// so we also instruct the user to export it. We DO NOT bake the key into the
// TOML — Codex's contract is env_key indirection. `neosmith login` stores the
// key in ~/.neosmith/config.json; we print the export line for the shell profile.
//
// TOML merge via `smol-toml` (same lib fireconnect uses). If the dependency is
// somehow missing, we fall back to a regex/string merge and warn.

"use strict";

const fs = require("fs");
const path = require("path");
const harness = require("../harness");
const io = require("../io");
const ui = require("../ui");

const CONFIG_DIR = path.join(io.HOME, ".codex");
const CONFIG = path.join(CONFIG_DIR, "config.toml");
const PROVIDER_BLOCK = "neosmith";

// Every pointer on() writes into the parsed TOML, for the restore ledger.
const WRITTEN_POINTERS = [
  ["model"],
  ["model_provider"],
  ["model_providers", PROVIDER_BLOCK],
];

let toml;
try { toml = require("smol-toml"); } catch { toml = null; }

function buildProviderSection(model) {
  return [
    `name = "NeoSmith"`,
    `base_url = "${harness.OPENAI_BASE_URL}"`,
    `env_key = "OPENAI_API_KEY"`,
    `wire_api = "responses"`,
  ];
}

// String-based fallback merge when smol-toml isn't installed. Good enough for
// the documented shape: top-level model/model_provider keys + one provider block.
function stringMerge(existingText, model) {
  let text = (existingText || "").trim();
  // Drop any prior neosmith provider block (handles re-runs / model changes).
  text = text.replace(/\n?\[model_providers\.neosmith\][^\[]*/g, "").trim();
  // Drop prior top-level model / model_provider lines.
  text = text.replace(/(^|\n)\s*model\s*=.*(?=\n)/g, "").trim();
  text = text.replace(/(^|\n)\s*model_provider\s*=.*(?=\n)/g, "").trim();

  const lines = [];
  lines.push(`model = "${model}"`);
  lines.push(`model_provider = "${PROVIDER_BLOCK}"`);
  lines.push(``);
  lines.push(`[model_providers.${PROVIDER_BLOCK}]`);
  lines.push(...buildProviderSection(model));
  const header = lines.join("\n") + "\n";

  if (text) return header + "\n" + text + "\n";
  return header + "\n";
}

function on(ctx) {
  const model = ctx.model;
  io.ensureDir(CONFIG_DIR);

  const existingText = io.readText(CONFIG);
  let out;
  if (toml) {
    let parsed = {};
    try { parsed = toml.parse(existingText || ""); } catch (e) {
      ui.warn(`Existing ${CONFIG} had a TOML parse error (${e.message}); merging as fresh with the prior text preserved in a snapshot.`);
    }
    if (!parsed || typeof parsed !== "object") parsed = {};
    // Snapshot + ledger are both write-once, so a second `on` (e.g. to switch
    // model tiers) refreshes the config without losing the pre-connect
    // baseline. Before issue #15 this re-snapshotted the already-NeoSmith TOML
    // and `off` then restored *that*.
    io.snapshot("codex", CONFIG);
    io.recordRestore("codex", CONFIG, io.planRestore(parsed, WRITTEN_POINTERS));

    parsed.model = model;
    parsed.model_provider = PROVIDER_BLOCK;
    parsed.model_providers = parsed.model_providers || {};
    parsed.model_providers[PROVIDER_BLOCK] = {
      name: "NeoSmith",
      base_url: harness.OPENAI_BASE_URL,
      env_key: "OPENAI_API_KEY",
      wire_api: "responses",
    };
    try {
      out = toml.stringify(parsed);
    } catch (e) {
      ui.warn(`TOML stringify failed (${e.message}); using string fallback.`);
      out = stringMerge(existingText, model);
    }
  } else {
    ui.warn("`smol-toml` not installed — using a string-based TOML merge. Run `npm install` in the CLI dir for robust parsing.");
    io.snapshot("codex", CONFIG);
    out = stringMerge(existingText, model);
    // No parser → no ledger. `off` falls back to the same string surgery.
  }

  io.writeText(CONFIG, out, 0o600);
  ui.ok(`Wrote ${CONFIG}`);
  ui.log(ui.c("dim", `Codex reads the key from $OPENAI_API_KEY at runtime. Export it in your shell profile:`));
  ui.log(`    export OPENAI_API_KEY=${ctx.key}`);
  ui.log(`    export OPENAI_BASE_URL=${harness.OPENAI_BASE_URL}`);
  return { wrote: true, needsEnv: true };
}

function off(ctx) {
  if (!io.fileExists(CONFIG)) {
    io.clearSnapshot("codex");
    io.clearRestore("codex");
    ui.log(`${CONFIG} not present — nothing to disconnect.`);
    return { ok: true };
  }
  const restored = io.restoreSnapshot("codex", CONFIG);
  if (!restored) {
    // No snapshot — replay the ledger so the user's own model / provider
    // settings come back rather than being regex-stripped away.
    const ledger = io.readRestore("codex", CONFIG);
    const text = io.readText(CONFIG) || "";
    let out = null;
    if (ledger && toml) {
      try {
        const parsed = toml.parse(text) || {};
        io.applyRestore(parsed, ledger);
        out = toml.stringify(parsed);
      } catch (e) {
        ui.warn(`Could not replay the restore ledger (${e.message}); falling back to a text strip.`);
      }
    }
    if (out === null) {
      // Fallback: strip our block via string surgery.
      let t = text;
      t = t.replace(/\n?\[model_providers\.neosmith\][^\[]*/g, "").trim();
      t = t.replace(/(^|\n)\s*model\s*=.*(?=\n)/g, "").trim();
      t = t.replace(/(^|\n)\s*model_provider\s*=.*(?=\n)/g, "").trim();
      out = t + "\n";
    }
    io.writeText(CONFIG, out, 0o600);
    io.clearRestore("codex");
    ui.ok(`Removed NeoSmith block from ${CONFIG} (no pre-connect snapshot was available).`);
    return { ok: true, partial: true };
  }
  io.clearRestore("codex");
  ui.ok(`Restored pre-NeoSmith ${CONFIG} from snapshot.`);
  return { ok: true };
}

function status(ctx) {
  if (!io.fileExists(CONFIG)) return { on: false, detail: `${CONFIG} does not exist` };
  const text = io.readText(CONFIG) || "";
  const hasBlock = /\[model_providers\.neosmith\]/.test(text) || /model_provider\s*=\s*"neosmith"/.test(text);
  const modelMatch = text.match(/^\s*model\s*=\s*"([^"]+)"/m);
  return {
    on: hasBlock,
    detail: hasBlock
      ? `model=${modelMatch ? modelMatch[1] : "(unset)"} wire=responses`
      : "no neosmith provider block",
  };
}

function help() {
  return [
    `Codex — OpenAI Responses API (/v1/responses).`,
    `Wires: ~/.codex/config.toml (merges your existing providers).`,
    `Key storage: Codex reads $OPENAI_API_KEY at runtime — export it in your shell profile.`,
    ``,
    `Examples:`,
    `  neosmith codex on`,
    `  neosmith codex off`,
    `  neosmith codex status`,
  ].join("\n");
}

module.exports = {
  id: "codex",
  name: "Codex",
  writable: true,
  configFile: CONFIG,
  on, off, status, help,
};
