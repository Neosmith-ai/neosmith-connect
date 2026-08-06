// `neosmith login [key]` — store + validate a NeoSmith API key.
// Replaces the old `init` command's key-handling. Run `neosmith <harness> on`
// afterwards to wire a specific harness.

"use strict";

const key = require("../key");
const ui = require("../ui");

async function run(args) {
  const explicit = args[0];
  ui.banner("NeoSmith · login");
  await key.login(explicit);
  ui.log("");
  ui.log(ui.c("bold", "Next:") + " connect a harness — e.g. " + ui.c("cyan", "neosmith claude on"));
  ui.log(ui.c("dim", "Supported: claude, codex, continue, cline, jetbrains. Run `neosmith help` for all."));
}

module.exports = { run };
