// `neosmith login [key]` — store + validate a NeoSmith API key.
// Replaces the old `init` command's key-handling. Run `neosmith <harness> on`
// afterwards to wire a specific harness.

"use strict";

const key = require("../key");
const harness = require("../harness");
const ui = require("../ui");

async function run(args) {
  const explicit = args[0];
  const active = harness.envInfo();
  ui.banner(`NeoSmith · login · env=${active.name} (${active.baseUrl})`);
  await key.login(explicit, { envName: active.keyEnv });
  ui.log("");
  ui.log(ui.c("bold", "Next:") + " connect a harness — e.g. " + ui.c("cyan", "neosmith claude on"));
  ui.log(ui.c("dim", "Supported: claude, codex, continue, cline, jetbrains. Run `neosmith help` for all."));
}

module.exports = { run };
