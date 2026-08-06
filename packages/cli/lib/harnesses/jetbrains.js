// JetBrains AI Assistant — UI-driven (no writable config file we control).
//
// Individual setup is via the IDE Settings UI; enterprise rollout is via
// JetBrains IDE Services. `on` prints the exact values to paste into
// Settings → Tools → AI Assistant → Providers & API Keys, plus the
// recommended per-feature model assignments. Records an on-flag in
// ~/.neosmith/state.json so `status`/`off` know it's connected.
//
// Values per neosmith-developer-guide/agents/jetbrains-ai.md.

"use strict";

const harness = require("../harness");
const io = require("../io");
const ui = require("../ui");

function on(ctx) {
  const model = ctx.model;
  const key = ctx.key;
  ui.log(ui.c("dim", "JetBrains AI Assistant → NeoSmith (paste these into Settings)"));
  ui.box([
    `Settings → Tools → AI Assistant → Providers & API Keys`,
    ``,
    `  Provider:   OpenAI-compatible`,
    `  URL:        ${harness.OPENAI_BASE_URL}`,
    `  API Key:    ${key}`,
    `  Enable:     ✅ Tool calling`,
    ``,
    `Then assign models per feature (Settings → Tools → AI Assistant → Models):`,
    `  Chat              → ${model}`,
    `  Inline completion → ${harness.MODELS.lite}    (fast, low-cost)`,
    `  Commit message    → ${harness.MODELS.lite}`,
    `  Test/doc gen      → ${harness.MODELS.basic}    (Sonnet-tier)`,
    ``,
    `Works in IntelliJ, PyCharm, GoLand, WebStorm, Rider, CLion, DataGrip,`,
    `RubyMine, RustRover, PhpStorm, and JetBrains Air.`,
  ]);
  io.setHarnessFlag("jetbrains", true, { model });
  ui.ok(`Marked JetBrains AI as on. (Switch it back in the IDE when you run \`neosmith jetbrains off\`.)`);
  return { wrote: false, ui: true };
}

function off(ctx) {
  const wasOn = io.getHarnessFlag("jetbrains");
  io.setHarnessFlag("jetbrains", false);
  if (wasOn) {
    ui.log(ui.c("dim", "JetBrains AI Assistant → restored"));
    ui.box([
      `In Settings → Tools → AI Assistant → Providers, remove the NeoSmith`,
      `OpenAI-compatible provider (or switch features back to your previous models).`,
      `NeoSmith no longer tracks JetBrains AI as connected.`,
    ]);
    ui.ok(`Cleared JetBrains AI on-flag.`);
  } else {
    ui.log("JetBrains AI wasn't marked as on — nothing to do.");
  }
  return { ok: true };
}

function status(ctx) {
  const on = io.getHarnessFlag("jetbrains");
  const state = io.readState();
  const meta = state.harnesses && state.harnesses.jetbrains;
  return {
    on,
    detail: on
      ? `model=${meta ? meta.model : "(unset)"} · UI-configured (re-run on to see the paste values again)`
      : "not connected (run `neosmith jetbrains on` for paste-in values)",
  };
}

function help() {
  return [
    `JetBrains AI Assistant — OpenAI-compatible, configured via the IDE Settings UI.`,
    `No config file is written; \`on\` prints the exact values to paste in.`,
    ``,
    `Examples:`,
    `  neosmith jetbrains on            # prints the paste-in values + per-feature model map`,
    `  neosmith jetbrains on --model neosmith.intelligent-basic`,
    `  neosmith jetbrains off           # clears the on-flag; switch the IDE back in Settings`,
    `  neosmith jetbrains status`,
  ].join("\n");
}

module.exports = {
  id: "jetbrains",
  name: "JetBrains AI",
  writable: false,
  configFile: null,
  on, off, status, help,
};
