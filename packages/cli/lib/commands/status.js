// `neosmith status`         — all harnesses + stored key + storage tier
// `neosmith <harness> status` — one harness

"use strict";

const harness = require("../harness");
const key = require("../key");
const io = require("../io");
const originals = require("../originals");
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

  if (originals.list().length) {
    ui.log("");
    ui.log(ui.c("dim", `  Your pre-connect settings are stored in ${originals.tilde(io.SNAPSHOTS_DIR)}/`));
    ui.log(ui.c("dim", "  and restored by `off`. Run `neosmith originals` to read or export them."));
  }
}

function printOne(mod) {
  const res = mod.status({});
  const tag = res.on ? ui.c("green", "on ") : ui.c("dim", "off");
  ui.log(`  ${tag}  ${ui.c("bold", mod.name.padEnd(16))} ${res.detail}`);
  // Which of the user's own files we are holding a copy of, and where. Without
  // this, the only trace that a backup exists is the audit log.
  for (const o of originals.forHarness(mod.id)) {
    const what = o.tombstone
      ? `no file before connect · \`off\` deletes ${originals.tilde(o.source) || "it"}`
      : `original ${originals.tilde(o.source) || "(unknown source)"} → ${originals.tilde(o.bak)}`;
    ui.log(ui.c("dim", `        ${what}`));
  }
}

module.exports = { run };
