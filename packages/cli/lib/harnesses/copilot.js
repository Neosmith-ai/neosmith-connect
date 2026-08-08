// GitHub Copilot Chat (VS Code) — file-writable for model registration,
// UI-driven for the API key (VS Code stores keys via OS-keychain-backed
// SecretStorage; a script cannot pre-seed it).
//
// Config target: VS Code's `chatLanguageModels.json` under the per-OS
// globalStorage directory for the github.copilot-chat extension:
//   Windows: %APPDATA%\Code\User\globalStorage\github.copilot-chat\chatLanguageModels.json
//   macOS:   ~/Library/Application Support/Code/User/globalStorage/github.copilot-chat/chatLanguageModels.json
//   Linux:   ~/.config/Code/User/globalStorage/github.copilot-chat/chatLanguageModels.json
//
// `on()` writes/merges the model entries (vendor: customendpoint, baseUrl
// https://router.neosmith.ai/v1, model IDs from the manifest, toolCalling
// and vision enabled). The apiKey field is set to a VS Code input-variable
// reference (${input:neosmithApiKey}) so VS Code prompts the user for the
// key the first time the model is used — we cannot bake a literal here.
//
// `status()` returns THREE states (per the build brief's T9 DoD):
//   - { on: false, ... }                              -> not connected
//   - { on: "models-written", ... }                   -> models registered, key pending
//   - { on: true, ... }                               -> fully connected (heuristic only;
//                                                       we can't read SecretStorage from
//                                                       the CLI; this state is reached
//                                                       when the user confirms via
//                                                       `neosmith copilot status --confirmed`
//                                                       after entering the key in VS Code)

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const harness = require("../harness");
const io = require("../io");
const ui = require("../ui");

function vsCodeUserDir() {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Code", "User");
  }
  if (process.platform === "darwin") {
    return path.join(io.HOME, "Library", "Application Support", "Code", "User");
  }
  return path.join(io.HOME, ".config", "Code", "User");
}

const CONFIG = path.join(
  vsCodeUserDir(),
  "globalStorage",
  "github.copilot-chat",
  "chatLanguageModels.json",
);

const VENDOR = "customendpoint";
const INPUT_VAR = "${input:neosmithApiKey}";

function vendorUrl(v) {
  return (v && (v.baseUrl || v.url)) || "";
}

// One vendor entry is ours when it carries our vendor id AND points at a host
// declared by some environment. Exact host match, never a substring test.
function isNeosmithVendor(v) {
  return !!(v && v.vendor === VENDOR && harness.isNeosmithUrl(vendorUrl(v)));
}

function hasNeoSmith(parsed) {
  if (!parsed || typeof parsed !== "object") return false;
  const arr = Array.isArray(parsed.vendors) ? parsed.vendors : [];
  return arr.some(isNeosmithVendor);
}

function on(ctx) {
  const model = ctx.model;
  io.ensureDir(path.dirname(CONFIG));
  const existing = io.readJSON(CONFIG) || {};
  if (!existing || typeof existing !== "object") {
    ui.warn(`Existing ${CONFIG} was not valid JSON — backing up as-is and starting clean.`);
  }

  if (hasNeoSmith(existing)) {
    ui.warn(`${CONFIG} already has a NeoSmith provider entry.`);
    return { alreadyOn: true };
  }

  io.snapshot("copilot", CONFIG);
  // Ledger the prior vendors array so `off` restores it as it was rather than
  // filtering a mutated copy (issue #15).
  io.recordRestore("copilot", CONFIG, io.planRestore(existing, [["vendors"]]));

  const next = { ...existing };
  next.vendors = Array.isArray(existing.vendors) ? existing.vendors.slice() : [];
  next.vendors.push({
    vendor: VENDOR,
    displayName: "NeoSmith",
    apiKey: INPUT_VAR,
    baseUrl: harness.OPENAI_BASE_URL,
    apiType: "chat-completions",
    models: [
      {
        id: model,
        name: "NeoSmith " + model,
        toolCalling: true,
        vision: true,
        maxInputTokens: 200000,
        maxOutputTokens: 8192,
      },
    ],
  });

  io.writeJSON(CONFIG, next, 0o600);
  ui.ok(`Wrote ${CONFIG}`);
  ui.log(ui.c("dim", "One remaining manual step — VS Code stores the API key via OS-keychain SecretStorage,"));
  ui.log(ui.c("dim", "which a script cannot pre-seed. In VS Code:"));
  ui.box([
    `Copilot Chat → Models → Manage Language Models`,
    `  Pick "NeoSmith" → when prompted, paste this key:`,
    `    ${ctx.key}`,
    `  The model entry is registered; the key prompt appears the first time`,
    `  you select the NeoSmith model in the picker.`,
  ]);
  io.setHarnessFlag("copilot", true, { model, env: (ctx && ctx.env && ctx.env.name) || harness.envName() });
  return { wrote: true, needsKeyInUI: true };
}

function off(ctx) {
  if (!io.fileExists(CONFIG)) {
    io.clearSnapshot("copilot");
    io.clearRestore("copilot");
    ui.log(`${CONFIG} not present — nothing to disconnect.`);
    return { ok: true };
  }
  const restored = io.restoreSnapshot("copilot", CONFIG);
  if (!restored) {
    const cfg = io.readJSON(CONFIG) || {};
    const ledger = io.readRestore("copilot", CONFIG);
    if (ledger) {
      io.applyRestore(cfg, ledger);
    } else if (Array.isArray(cfg.vendors)) {
      // No ledger (pre-0.8 connect) — strip the NeoSmith vendor entry by hand.
      // Ownership: strips a vendor pointing at ANY known environment, so a
      // staging-wired entry is removed by a default-env `off` too.
      cfg.vendors = cfg.vendors.filter((v) => !isNeosmithVendor(v));
    }
    io.writeJSON(CONFIG, cfg, 0o600);
    io.clearRestore("copilot");
    ui.ok(`Removed NeoSmith vendor from ${CONFIG} (no pre-connect snapshot was available).`);
    io.setHarnessFlag("copilot", false);
    return { ok: true, partial: true };
  }
  io.clearRestore("copilot");
  io.setHarnessFlag("copilot", false);
  ui.ok(`Restored pre-NeoSmith ${CONFIG} from snapshot.`);
  return { ok: true };
}

function status(ctx) {
  if (!io.fileExists(CONFIG)) {
    return { on: false, detail: `${CONFIG} does not exist` };
  }
  const cfg = io.readJSON(CONFIG) || {};
  const arr = Array.isArray(cfg.vendors) ? cfg.vendors : [];
  const neo = arr.find(isNeosmithVendor);
  const wiredEnv = neo ? harness.envForUrl(vendorUrl(neo)) : null;
  if (!neo) {
    return { on: false, detail: "no NeoSmith provider registered in chatLanguageModels.json" };
  }
  // We can't read VS Code's SecretStorage from the CLI, so "fully connected"
  // is a heuristic: if the user has marked the harness confirmed (via
  // `neosmith copilot status --confirmed` after entering the key in VS Code),
  // we report true. Otherwise we report the intermediate "models-written"
  // state so the user knows there's still a manual step.
  const state = io.readState();
  const meta = state.harnesses && state.harnesses.copilot;
  const confirmed = meta && meta.confirmed;
  if (confirmed) {
    return {
      on: true,
      env: wiredEnv,
      detail: `model=${(meta && meta.model) || "(unset)"} · key entered in VS Code (per --confirmed) · base=${vendorUrl(neo)}`,
    };
  }
  return {
    on: "models-written",
    env: wiredEnv,
    detail: `models registered (base=${vendorUrl(neo)}); key not yet entered — open Copilot Chat → Models → Manage Language Models, pick NeoSmith, paste the key`,
  };
}

function help() {
  return [
    `GitHub Copilot Chat (VS Code) — OpenAI-compatible custom endpoint.`,
    `Wires: chatLanguageModels.json under VS Code's globalStorage/github.copilot-chat/.`,
    `The API key cannot be pre-seeded (VS Code SecretStorage); \`on\` registers the`,
    `model entry and prints the one remaining manual step.`,
    ``,
    `Examples:`,
    `  neosmith copilot on            # registers the NeoSmith model entry`,
    `  neosmith copilot on --model neosmith.intelligent-pro`,
    `  neosmith copilot off           # restores pre-connect chatLanguageModels.json`,
    `  neosmith copilot status        # off | models-written | connected`,
  ].join("\n");
}

module.exports = {
  id: "copilot",
  name: "Copilot Chat",
  writable: true,
  configFile: CONFIG,
  on, off, status, help,
};
