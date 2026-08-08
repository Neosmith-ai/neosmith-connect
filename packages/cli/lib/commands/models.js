// `neosmith models` — list available NeoSmith SKUs from GET /v1/models.
//
// Calls the router's OpenAI-compatible model-list endpoint with the stored
// key and prints each model's id + human-readable name. Falls back to the
// manifest's local model ladder when the router is unreachable.

"use strict";

const harness = require("../harness");
const http = require("../http");
const io = require("../io");
const ui = require("../ui");

async function run() {
  ui.banner("NeoSmith · models");

  const apiKey = io.readKeyRef();
  if (!apiKey) ui.die("No key stored. Run `neosmith login <key>` first.");

  ui.log(ui.c("dim", `Fetching models from ${http.DEFAULT_ROUTER}/v1/models …`));
  ui.log("");

  let resp;
  try {
    resp = await http.listModels(http.DEFAULT_ROUTER, apiKey);
  } catch (e) {
    ui.warn(`Could not reach the router (${e.message}). Showing local manifest defaults instead.`);
    printLocalFallback();
    return;
  }

  if (resp.status === 401 || resp.status === 403) {
    ui.warn(`Key rejected (HTTP ${resp.status}). Run \`neosmith login\` to re-authenticate.`);
    printLocalFallback();
    return;
  }

  if (resp.status !== 200) {
    ui.warn(`Router returned HTTP ${resp.status}. Showing local manifest defaults instead.`);
    printLocalFallback();
    return;
  }

  const models = Array.isArray(resp.data && resp.data.data) ? resp.data.data : [];
  if (models.length === 0) {
    ui.warn("Router returned an empty model list. Showing local manifest defaults instead.");
    printLocalFallback();
    return;
  }

  ui.ok(`Available models (${models.length}):`);
  ui.log("");
  for (const m of models) {
    const id = m.id || "(unknown)";
    const name = m.modelName || m.name || "";
    const desc = m.description || m._neosmith_description || "";
    // Highlight the default (pro) model.
    const isDefault = id === harness.MODELS.pro;
    const tag = isDefault ? ui.c("green", " ← default") : "";
    ui.log(`  ${ui.c("bold", id)}${tag}`);
    if (name) ui.log(`    ${name}`);
    if (desc) ui.log(ui.c("dim", `    ${desc}`));
    ui.log("");
  }

  ui.log(ui.c("dim", `Use \`neosmith <harness> on --model <sku>\` to pick a different tier.`));
}

function printLocalFallback() {
  const models = harness.MODELS;
  ui.log("");
  ui.log(ui.c("dim", "Local manifest defaults (offline):"));
  ui.log("");
  const entries = [
    [models.pro,     "NeoSmith Intelligent · Pro · Opus fallback",    "default"],
    [models.basic,   "NeoSmith Intelligent · Basic · Sonnet fallback", ""],
    [models.lite,    "NeoSmith Intelligent · Lite · SLM-only",        ""],
  ];
  if (models.maestro) {
    entries.push([models.maestro, "NeoSmith Maestro · highest-accuracy agentic coding", ""]);
  }
  for (const [id, name, tag] of entries) {
    const marker = tag ? ui.c("green", ` ← ${tag}`) : "";
    ui.log(`  ${ui.c("bold", id)}${marker}`);
    ui.log(`    ${name}`);
    ui.log("");
  }
}

module.exports = { run };
