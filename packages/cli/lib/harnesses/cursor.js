// Cursor — UI-driven (no writable config file).
//
// Why not file-writable: Cursor's BYOK (custom OpenAI base URL + API key +
// custom models) is NOT read from the VS Code `settings.json`. Verified
// 2026-08-07 against the installed Cursor build
// (resources/app/out/vs/workbench/workbench.desktop.main.js):
//   - the string "cursor.models." appears ZERO times in the workbench bundle
//   - Cursor's BYOK config is stored in an encrypted, server-synced store
//     (the aiserver.v1 protobuf carries apiKeyCandidates/baseUrlCandidates and
//     a `byok` message), not in a plaintext settings file we can write.
//   - writing "cursor.models.openai.*" to settings.json is silently ignored —
//     this is exactly the "settings.json does not work" failure users hit.
//
// Native BYOK therefore must be entered through the Cursor UI
// (Settings → Models) and requires an active Cursor Pro/Ultra subscription —
// Cursor does not expose custom OpenAI endpoints on the free tier.
//
// So `on` prints the exact paste-in values and records an on-flag in
// ~/.neosmith/state.json so `status`/`off` know it's connected. `off` clears
// the flag and reminds the user to switch Cursor back in the UI.
//
// The fully scriptable path in Cursor is the Claude Code extension (Path A),
// which reads the env vars that `neosmith claude on` writes — no Pro license
// needed for that beyond the Claude Code extension itself.

"use strict";

const harness = require("../harness");
const io = require("../io");
const ui = require("../ui");

function on(ctx) {
  const model = ctx.model;
  const key = ctx.key;
  const models = harness.MODELS;
  ui.log(ui.c("dim", "Cursor → NeoSmith · native BYOK (enter these in the Cursor UI)"));
  ui.box([
    `Cursor's native BYOK cannot be set from settings.json — it lives in the`,
    `Cursor UI and requires a Cursor Pro/Ultra subscription.`,
    ``,
    `  1. Open Cursor → Settings (Ctrl+,) → Models`,
    `  2. Scroll to "OpenAI API Key" and toggle it on`,
    `  3. Paste your key:        ${key}`,
    `  4. Enable "Override OpenAI Base URL" and set:`,
    `        ${harness.OPENAI_BASE_URL}`,
    `  5. Click "Add model" and add each NeoSmith SKU, then Verify:`,
    `        ${model}            (default)`,
    `        ${models.basic}`,
    `        ${models.lite}`,
    `  6. Pick one of them in the chat model picker.`,
    ``,
    `Notes:`,
    `  • Tab autocomplete may still use Cursor's own backend; Chat and inline`,
    `    edits (Ctrl+K) route to NeoSmith.`,
    `  • Free Cursor tier does not allow custom OpenAI endpoints — Pro/Ultra only.`,
    ``,
    `Fully scriptable alternative (no Pro license needed):`,
    `  neosmith claude on      # then install the "Claude Code" extension in Cursor`,
  ]);
  io.setHarnessFlag("cursor", true, { model, env: (ctx && ctx.env && ctx.env.name) || harness.envName() });
  ui.ok(`Marked Cursor as on. (Switch it back in Cursor → Settings → Models when you run \`neosmith cursor off\`.)`);
  return { wrote: false, ui: true };
}

function off(ctx) {
  const wasOn = io.getHarnessFlag("cursor");
  io.setHarnessFlag("cursor", false);
  if (wasOn) {
    ui.log(ui.c("dim", "Cursor → restored"));
    ui.box([
      `In Cursor → Settings → Models:`,
      `  • Remove the NeoSmith custom models (neosmith.*), and`,
      `  • Turn off "Override OpenAI Base URL" (or repoint it away from NeoSmith),`,
      `  • Remove the NeoSmith OpenAI API key.`,
      `NeoSmith no longer tracks Cursor as connected.`,
    ]);
    ui.ok(`Cleared Cursor on-flag.`);
  } else {
    ui.log("Cursor wasn't marked as on — nothing to do.");
  }
  return { ok: true };
}

function status(ctx) {
  const on = io.getHarnessFlag("cursor");
  const state = io.readState();
  const meta = state.harnesses && state.harnesses.cursor;
  return {
    on,
    env: (meta && meta.env) || null,
    detail: on
      ? `model=${meta ? meta.model : "(unset)"} · UI-configured (re-run on to see the paste-in values again)`
      : "not connected (run `neosmith cursor on` for the Settings → Models paste-in values)",
  };
}

function help() {
  return [
    `Cursor — OpenAI-compatible, configured via Cursor's Settings → Models UI.`,
    `Native BYOK requires a Cursor Pro/Ultra subscription and CANNOT be set via`,
    `settings.json (verified against the installed Cursor build).`,
    `No config file is written; \`on\` prints the exact values to paste in.`,
    `The scriptable path is the Claude Code extension: \`neosmith claude on\`.`,
    ``,
    `Examples:`,
    `  neosmith cursor on            # prints the Settings → Models paste-in values`,
    `  neosmith cursor on --model neosmith.intelligent-basic`,
    `  neosmith cursor off           # clears the on-flag; switch Cursor back in its UI`,
    `  neosmith cursor status`,
  ].join("\n");
}

module.exports = {
  id: "cursor",
  name: "Cursor",
  writable: false,
  configFile: null,
  on, off, status, help,
};
