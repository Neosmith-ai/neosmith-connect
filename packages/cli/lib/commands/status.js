// `neosmith status`         — all harnesses + stored key + storage tier
// `neosmith <harness> status` — one harness

"use strict";

const harness = require("../harness");
const key = require("../key");
const io = require("../io");
const ui = require("../ui");

async function run(args) {
  const h = args[0];

  if (h) {
    const mod = harness.get(h.toLowerCase());
    if (!mod) ui.die(`Unknown harness: ${h}. Supported: ${harness.ids().join(", ")}.`);
    printOne(mod);
    return;
  }

  ui.banner("NeoSmith · status");

  // Stored key
  const stored = io.readKeyRef();
  if (stored) {
    ui.ok(`Key stored · ${key.describe(stored)} · ${io.CONFIG_FILE}`);
  } else {
    ui.warn(`No key stored. Run \`neosmith login <key>\` first.`);
  }
  ui.log("");

  // Each harness
  for (const mod of harness.list()) {
    printOne(mod);
  }
}

function printOne(mod) {
  const res = mod.status({});
  const tag = res.on ? ui.c("green", "on ") : ui.c("dim", "off");
  ui.log(`  ${tag}  ${ui.c("bold", mod.name.padEnd(16))} ${res.detail}`);
}

module.exports = { run };
