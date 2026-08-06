// Cursor — file-writable.
//
// Verified against a real Cursor install on 2026-08-06: Cursor is a VS Code
// fork and stores its settings in the standard VS Code `settings.json` at the
// per-OS user-config path. BYOK (custom OpenAI base URL + key) is configured
// via Cursor-specific settings keys:
//
//   "cursor.models.openai.baseUrl":  "https://router.neosmith.ai/v1"
//   "cursor.models.openai.apiKey":   "sk-plus-..."
//   "cursor.models.customModels":    ["neosmith.intelligent-pro", ...]
//
// Config target (per-OS, standard VS Code fork paths):
//   Windows: %APPDATA%\Cursor\User\settings.json
//   macOS:   ~/Library/Application Support/Cursor/User/settings.json
//   Linux:   ~/.config/Cursor/User/settings.json
//
// Merge-never-clobber pattern (same as claude.js): snapshot pre-connect,
// add the three NeoSmith keys, restore byte-for-byte on off. Other VS Code
// settings in the same file (keybindings, theme, python interpreter, etc.)
// are preserved.

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const harness = require("../harness");
const io = require("../io");
const ui = require("../ui");

function cursorSettingsPath() {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Cursor", "User", "settings.json");
  }
  if (process.platform === "darwin") {
    return path.join(io.HOME, "Library", "Application Support", "Cursor", "User", "settings.json");
  }
  return path.join(io.HOME, ".config", "Cursor", "User", "settings.json");
}

const CONFIG = cursorSettingsPath();

function hasNeoSmith(s) {
  if (!s || typeof s !== "object") return false;
  const baseUrl = s["cursor.models.openai.baseUrl"];
  return typeof baseUrl === "string" && baseUrl.includes("router.neosmith.ai");
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

  io.snapshot("cursor", CONFIG);

  const next = { ...existing };
  next["cursor.models.openai.baseUrl"] = harness.OPENAI_BASE_URL;
  next["cursor.models.openai.apiKey"] = key;
  // Merge customModels rather than clobber — preserve any user-added models.
  const prevModels = Array.isArray(existing["cursor.models.customModels"])
    ? existing["cursor.models.customModels"]
    : [];
  const neoModels = [model];
  const merged = [...new Set([...neoModels, ...prevModels])];
  next["cursor.models.customModels"] = merged;

  io.writeJSON(CONFIG, next, 0o600);
  ui.ok(`Wrote ${CONFIG}`);
  ui.log(ui.c("dim", `Restart Cursor for the change to take effect.`));
  return { wrote: true };
}

function off(ctx) {
  if (!io.fileExists(CONFIG)) {
    io.clearSnapshot("cursor");
    ui.log(`${CONFIG} not present — nothing to disconnect.`);
    return { ok: true };
  }
  const restored = io.restoreSnapshot("cursor", CONFIG);
  if (!restored) {
    // Fallback: strip the three NeoSmith keys.
    const cfg = io.readJSON(CONFIG) || {};
    delete cfg["cursor.models.openai.baseUrl"];
    delete cfg["cursor.models.openai.apiKey"];
    // Strip neosmith.* entries from customModels but keep user-added models.
    if (Array.isArray(cfg["cursor.models.customModels"])) {
      cfg["cursor.models.customModels"] = cfg["cursor.models.customModels"].filter(
        (m) => typeof m !== "string" || !m.startsWith("neosmith."),
      );
      if (cfg["cursor.models.customModels"].length === 0) delete cfg["cursor.models.customModels"];
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
  const baseUrl = cfg["cursor.models.openai.baseUrl"] || "";
  const pointingAtNeo = baseUrl.includes("router.neosmith.ai");
  if (!pointingAtNeo) return { on: false, detail: `no NeoSmith base URL (cursor.models.openai.baseUrl unset or pointing elsewhere: ${baseUrl || "(unset)"})` };
  const models = Array.isArray(cfg["cursor.models.customModels"])
    ? cfg["cursor.models.customModels"].join(", ")
    : "(unset)";
  return {
    on: true,
    detail: `models=${models} base=${baseUrl}`,
  };
}

function help() {
  return [
    `Cursor — OpenAI-compatible, configured via VS Code settings.json.`,
    `Wires: Cursor/User/settings.json (per-OS path) with cursor.models.openai.{baseUrl,apiKey} + cursor.models.customModels.`,
    `Key storage: cursor.models.openai.apiKey literal (mode 0600).`,
    ``,
    `Examples:`,
    `  neosmith cursor on`,
    `  neosmith cursor on --model neosmith.intelligent-basic`,
    `  neosmith cursor off           # restores pre-connect settings.json from snapshot`,
    `  neosmith cursor status`,
  ].join("\n");
}

module.exports = {
  id: "cursor",
  name: "Cursor",
  writable: true,
  configFile: CONFIG,
  on, off, status, help,
};
