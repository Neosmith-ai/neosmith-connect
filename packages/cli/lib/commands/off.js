// `neosmith <harness> off` — restore a harness's pre-connect config.
// File-writable harnesses: byte-for-byte restore from ~/.neosmith/snapshots/<id>.bak.
// UI-driven harnesses: clear the on-flag and remind the user to switch the IDE back.

"use strict";

const harness = require("../harness");
const ui = require("../ui");

async function run(args) {
  const h = args[0];
  if (!h) ui.die("Usage: neosmith <harness> off. Run `neosmith help`.");
  const mod = harness.get(h.toLowerCase());
  if (!mod) ui.die(`Unknown harness: ${h}. Supported: ${harness.ids().join(", ")}.`);

  ui.banner(`${mod.name} → off`);
  mod.off({});
  ui.log(ui.c("dim", `Restart ${mod.name} if it was running.`));
}

module.exports = { run };
