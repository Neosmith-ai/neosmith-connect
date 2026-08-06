// Zed — file-writable.
//
// Writes Zed's settings.json (per-OS path) with an OpenAI-compatible
// language_models entry pointing at https://router.neosmith.ai/v1.
// Merge-never-clobber pattern: snapshot pre-connect, add NeoSmith keys,
// restore byte-for-byte on off. Follows the same shape as claude.js.
//
// Config target (per the build brief T10):
//   Linux:   ~/.config/zed/settings.json
//   macOS:   ~/Library/Application Support/Zed/settings.json
//   Windows: %APPDATA%\Zed\settings.json
//
// Zed's settings schema places OpenAI-compatible providers under
// `language_models.openai`. We set base_url + api_key + default_model.

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const harness = require("../harness");
const io = require("../io");
const ui = require("../ui");

function zedSettingsPath() {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Zed", "settings.json");
  }
  if (process.platform === "darwin") {
    return path.join(io.HOME, "Library", "Application Support", "Zed", "settings.json");
  }
  return path.join(io.HOME, ".config", "zed", "settings.json");
}

const CONFIG = zedSettingsPath();

function hasNeoSmith(s) {
  if (!s || typeof s !== "object") return false;
  const lm = s.language_models;
  if (!lm || typeof lm !== "object") return false;
  const openai = lm.openai;
  if (!openai || typeof openai !== "object") return false;
  return (typeof openai.api_url === "string" && openai.api_url.includes("router.neosmith.ai")) ||
         (typeof openai.base_url === "string" && openai.base_url.includes("router.neosmith.ai"));
}

function on(ctx) {
  const model = ctx.model;
  const key = ctx.key;
  io.ensureDir(path.dirname(CONFIG));
  const existing = io.readJSON(CONFIG) || {};
  if (!existing || typeof existing !== "object") {
    ui.warn(`Existing ${CONFIG} was not valid JSON — backing up as-is and starting clean.`);
  }

  if (hasNeoSmith(existing)) {
    ui.warn(`${CONFIG} already points at NeoSmith.`);
    return { alreadyOn: true };
  }

  io.snapshot("zed", CONFIG);

  const next = { ...existing };
  next.language_models = { ...(existing.language_models || {}) };
  next.language_models.openai = {
    ...(next.language_models.openai || {}),
    api_url: harness.OPENAI_BASE_URL,
    api_key: key,
    available_models: [
      ...(next.language_models.openai && Array.isArray(next.language_models.openai.available_models)
        ? next.language_models.openai.available_models
        : []),
      {
        name: model,
        display_name: "NeoSmith " + model,
        max_tokens: 8192,
        tool_calling: true,
      },
    ],
  };

  io.writeJSON(CONFIG, next, 0o600);
  ui.ok(`Wrote ${CONFIG}`);
  ui.log(ui.c("dim", `Restart Zed for the change to take effect.`));
  return { wrote: true };
}

function off(ctx) {
  if (!io.fileExists(CONFIG)) {
    io.clearSnapshot("zed");
    ui.log(`${CONFIG} not present — nothing to disconnect.`);
    return { ok: true };
  }
  const restored = io.restoreSnapshot("zed", CONFIG);
  if (!restored) {
    // Fallback: strip the NeoSmith openai block.
    const cfg = io.readJSON(CONFIG) || {};
    if (cfg.language_models && cfg.language_models.openai) {
      const o = cfg.language_models.openai;
      delete o.api_url;
      delete o.api_key;
      if (Array.isArray(o.available_models)) {
        o.available_models = o.available_models.filter((m) =>
          !(m && typeof m.name === "string" && (m.name.startsWith("neosmith.") || (m.display_name || "").startsWith("NeoSmith "))));
      }
      if (Object.keys(o).length === 0) delete cfg.language_models.openai;
      if (Object.keys(cfg.language_models).length === 0) delete cfg.language_models;
    }
    io.writeJSON(CONFIG, cfg, 0o600);
    ui.ok(`Removed NeoSmith keys from ${CONFIG} (no pre-connect snapshot was available).`);
    return { ok: true, partial: true };
  }
  ui.ok(`Restored pre-NeoSmith ${CONFIG} from snapshot.`);
  return { ok: true };
}

function status(ctx) {
  if (!io.fileExists(CONFIG)) return { on: false, detail: `${CONFIG} does not exist` };
  const cfg = io.readJSON(CONFIG) || {};
  const lm = cfg.language_models || {};
  const openai = lm.openai || {};
  const pointingAtNeo = (openai.api_url || openai.base_url || "").includes("router.neosmith.ai");
  if (!pointingAtNeo) return { on: false, detail: "no NeoSmith provider in language_models.openai" };
  const models = Array.isArray(openai.available_models)
    ? openai.available_models.map((m) => m.name).join(", ")
    : "(unset)";
  return {
    on: true,
    detail: `models=${models} base=${openai.api_url || openai.base_url}`,
  };
}

function help() {
  return [
    `Zed — OpenAI-compatible language model provider.`,
    `Wires: Zed's settings.json (per-OS path) under language_models.openai.`,
    `Key storage: api_key literal in settings.json (mode 0600).`,
    ``,
    `Examples:`,
    `  neosmith zed on`,
    `  neosmith zed on --model neosmith.intelligent-basic`,
    `  neosmith zed off           # restores pre-connect settings.json from snapshot`,
    `  neosmith zed status`,
  ].join("\n");
}

module.exports = {
  id: "zed",
  name: "Zed",
  writable: true,
  configFile: CONFIG,
  on, off, status, help,
};
