// Continue — file-writable.
//
// Writes ~/.continue/config.yaml (0600). OpenAI-compatible provider on
// https://router.neosmith.ai/v1. Per site/agents/continue.md:
//
//   models:
//     - name: NeoSmith
//       provider: openai
//       apiBase: https://router.neosmith.ai/v1
//       model: neosmith.intelligent-pro
//       apiKey: <key>
//
// Optional tabAutocompleteModel with intelligent-lite for inline completions.
// The key is baked as a plaintext literal (0600) — Continue has no env-key
// indirection for the openai provider.
//
// YAML merge via the `yaml` package. Falls back to a string block merge if
// the dependency is missing.

"use strict";

const path = require("path");
const harness = require("../harness");
const io = require("../io");
const ui = require("../ui");

const CONFIG_DIR = path.join(io.HOME, ".continue");
const CONFIG = path.join(CONFIG_DIR, "config.yaml");

let yaml;
try { yaml = require("yaml"); } catch { yaml = null; }

function neosmithModelBlock(model, key) {
  return {
    name: "NeoSmith",
    provider: "openai",
    apiBase: harness.OPENAI_BASE_URL,
    model,
    apiKey: key,
  };
}

function neosmithAutocompleteBlock(key) {
  return {
    title: "NeoSmith Autocomplete",
    provider: "openai",
    apiBase: harness.OPENAI_BASE_URL,
    model: harness.MODELS.lite,
    apiKey: key,
  };
}

// String fallback: emit a clean NeoSmith block at the top, preserve the rest.
function stringMerge(existingText, model, key, withAutocomplete) {
  const lines = [];
  lines.push(`name: Local Config`);
  lines.push(`version: 1.0.0`);
  lines.push(`schema: v1`);
  lines.push(``);
  lines.push(`models:`);
  lines.push(`  - name: NeoSmith`);
  lines.push(`    provider: openai`);
  lines.push(`    apiBase: ${harness.OPENAI_BASE_URL}`);
  lines.push(`    model: ${model}`);
  lines.push(`    apiKey: ${key}`);
  if (withAutocomplete) {
    lines.push(``);
    lines.push(`tabAutocompleteModel:`);
    lines.push(`  title: NeoSmith Autocomplete`);
    lines.push(`  provider: openai`);
    lines.push(`  apiBase: ${harness.OPENAI_BASE_URL}`);
    lines.push(`  model: ${harness.MODELS.lite}`);
    lines.push(`  apiKey: ${key}`);
  }
  return lines.join("\n") + "\n";
}

function on(ctx) {
  const model = ctx.model;
  const key = ctx.key;
  const withAutocomplete = !!ctx.autocomplete;
  io.ensureDir(CONFIG_DIR);

  const existingText = io.readText(CONFIG);
  let out;
  if (yaml) {
    let parsed = {};
    try { parsed = yaml.parse(existingText || "") || {}; }
    catch (e) {
      ui.warn(`Existing ${CONFIG} had a YAML parse error (${e.message}); starting fresh with a snapshot of the old file.`);
      parsed = {};
    }
    if (!parsed || typeof parsed !== "object") parsed = {};

    const models = Array.isArray(parsed.models) ? parsed.models.slice() : [];
    // Replace any prior NeoSmith entry; keep others.
    const filtered = models.filter((m) => !(m && m.name === "NeoSmith"));
    filtered.push(neosmithModelBlock(model, key));
    parsed.models = filtered;

    if (withAutocomplete) parsed.tabAutocompleteModel = neosmithAutocompleteBlock(key);
    else if (parsed.tabAutocompleteModel && parsed.tabAutocompleteModel.title === "NeoSmith Autocomplete") {
      delete parsed.tabAutocompleteModel;
    }

    io.snapshot("continue", CONFIG);
    out = yaml.stringify(parsed);
  } else {
    ui.warn("`yaml` package not installed — writing a fresh NeoSmith block (your existing config is snapshotted for `off`). Run `npm install` in the CLI dir for a true merge.");
    io.snapshot("continue", CONFIG);
    out = stringMerge(existingText, model, key, withAutocomplete);
  }

  io.writeText(CONFIG, out, 0o600);
  ui.ok(`Wrote ${CONFIG}`);
  if (!withAutocomplete) {
    ui.log(ui.c("dim", `Tip: add --autocomplete to also route inline completions through NeoSmith (intelligent-lite).`));
  }
  return { wrote: true };
}

function off(ctx) {
  if (!io.fileExists(CONFIG)) {
    io.clearSnapshot("continue");
    ui.log(`${CONFIG} not present — nothing to disconnect.`);
    return { ok: true };
  }
  const restored = io.restoreSnapshot("continue", CONFIG);
  if (!restored) {
    if (yaml) {
      let parsed = {};
      try { parsed = yaml.parse(io.readText(CONFIG) || "") || {}; } catch { parsed = {}; }
      if (Array.isArray(parsed.models)) {
        parsed.models = parsed.models.filter((m) => !(m && m.name === "NeoSmith"));
      }
      if (parsed.tabAutocompleteModel && parsed.tabAutocompleteModel.title === "NeoSmith Autocomplete") {
        delete parsed.tabAutocompleteModel;
      }
      io.writeText(CONFIG, yaml.stringify(parsed), 0o600);
    } else {
      // Crude string strip.
      let text = io.readText(CONFIG) || "";
      text = text.replace(/\n?\s*-\s+name:\s*NeoSmith[\s\S]*?(?=\n\s*-\s+name:|\ntabAutocompleteModel:|\n[a-z]|$)/g, "");
      text = text.replace(/\n?tabAutocompleteModel:[\s\S]*?(?=\n[a-z]|$)/g, "");
      io.writeText(CONFIG, text + "\n", 0o600);
    }
    ui.ok(`Removed NeoSmith entries from ${CONFIG} (no pre-connect snapshot was available).`);
    return { ok: true, partial: true };
  }
  ui.ok(`Restored pre-NeoSmith ${CONFIG} from snapshot.`);
  return { ok: true };
}

function status(ctx) {
  if (!io.fileExists(CONFIG)) return { on: false, detail: `${CONFIG} does not exist` };
  const text = io.readText(CONFIG) || "";
  const hasNeo = /name:\s*NeoSmith/.test(text);
  const modelMatch = text.match(/model:\s*(neosmith\.\S+)/);
  const hasAutocomplete = /title:\s*NeoSmith Autocomplete/.test(text);
  return {
    on: hasNeo,
    detail: hasNeo
      ? `model=${modelMatch ? modelMatch[1] : "(unset)"}${hasAutocomplete ? " +autocomplete" : ""}`
      : "no NeoSmith model entry",
  };
}

function help() {
  return [
    `Continue — OpenAI-compatible provider (config.yaml).`,
    `Wires: ~/.continue/config.yaml (merges your existing models).`,
    `Key storage: apiKey baked into config.yaml (mode 0600).`,
    ``,
    `Examples:`,
    `  neosmith continue on`,
    `  neosmith continue on --autocomplete   # also route inline completions via intelligent-lite`,
    `  neosmith continue off`,
    `  neosmith continue status`,
  ].join("\n");
}

module.exports = {
  id: "continue",
  name: "Continue",
  writable: true,
  configFile: CONFIG,
  on, off, status, help,
};
