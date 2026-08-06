// Cline — UI-driven (no writable config file).
//
// Cline stores its provider config in extension internal state, not a text
// file we can safely write. So `on` prints the exact values to paste into
// Cline's settings UI and records an on-flag in ~/.neosmith/state.json so
// `status`/`off` know it's connected. `off` clears the flag and reminds the
// user to switch Cline back in the UI.
//
// Values per site/agents/cline.md.

"use strict";

const harness = require("../harness");
const io = require("../io");
const ui = require("../ui");

function on(ctx) {
  const model = ctx.model;
  const key = ctx.key;
  ui.log(ui.c("dim", "Cline → NeoSmith (paste these into Cline's settings)"));
  ui.box([
    `Open Cline's settings (gear icon in the Cline panel) and set:`,
    ``,
    `  API Provider:  OpenAI Compatible`,
    `  Base URL:      ${harness.OPENAI_BASE_URL}`,
    `  API Key:       ${key}`,
    `  Model ID:      ${model}`,
    ``,
    `Enable streaming + tool/function calling (required for Cline's agentic actions).`,
    `Save. Cline's plan/act/verify loops now run on NeoSmith.`,
  ]);
  io.setHarnessFlag("cline", true, { model });
  ui.ok(`Marked Cline as on. (Switch it back in the Cline UI when you run \`neosmith cline off\`.)`);
  return { wrote: false, ui: true };
}

function off(ctx) {
  const wasOn = io.getHarnessFlag("cline");
  io.setHarnessFlag("cline", false);
  if (wasOn) {
    ui.log(ui.c("dim", "Cline → restored"));
    ui.box([
      `In Cline's settings, switch the API Provider back to your previous provider`,
      `(or remove the NeoSmith entry). NeoSmith no longer tracks Cline as connected.`,
    ]);
    ui.ok(`Cleared Cline on-flag.`);
  } else {
    ui.log("Cline wasn't marked as on — nothing to do.");
  }
  return { ok: true };
}

function status(ctx) {
  const on = io.getHarnessFlag("cline");
  const state = io.readState();
  const meta = state.harnesses && state.harnesses.cline;
  return {
    on,
    detail: on
      ? `model=${meta ? meta.model : "(unset)"} · UI-configured (re-run on to see the paste values again)`
      : "not connected (run `neosmith cline on` for paste-in values)",
  };
}

function help() {
  return [
    `Cline — OpenAI-compatible, configured via Cline's settings UI.`,
    `No config file is written; \`on\` prints the exact values to paste in.`,
    ``,
    `Examples:`,
    `  neosmith cline on            # prints the paste-in values`,
    `  neosmith cline on --model neosmith.intelligent-lite`,
    `  neosmith cline off           # clears the on-flag; switch Cline back in its UI`,
    `  neosmith cline status`,
  ].join("\n");
}

module.exports = {
  id: "cline",
  name: "Cline",
  writable: false,
  configFile: null,
  on, off, status, help,
};
