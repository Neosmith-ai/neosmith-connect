// `neosmith status`         — all harnesses + stored key + storage tier
// `neosmith <harness> status` — one harness

"use strict";

const harness = require("../harness");
const key = require("../key");
const io = require("../io");
const originals = require("../originals");
const ui = require("../ui");

// `<harness> status --confirmed` marks a manual, UI-only step as done — the
// harness can't observe it from disk. Documented since 0.3.0 for Copilot Chat,
// but nothing ever wrote the flag, so `status` could never reach its `on`
// state. Setting it merges into the existing meta: overwriting would drop the
// model/env `on` recorded.
function markConfirmed(mod) {
  const state = io.readState();
  const meta = (state.harnesses && state.harnesses[mod.id]) || {};
  io.setHarnessFlag(mod.id, true, { ...meta, confirmed: true });
}

async function run(args) {
  const flags = args.filter((a) => a.startsWith("--"));
  const positional = args.filter((a) => !a.startsWith("--"));
  const h = positional[0];
  const active = harness.envInfo();

  if (h) {
    const mod = harness.get(h.toLowerCase());
    if (!mod) ui.die(`Unknown harness: ${h}. Supported: ${harness.ids().join(", ")}.`);
    if (flags.includes("--confirmed")) markConfirmed(mod);
    printOne(mod, active);
    return;
  }
  if (flags.includes("--confirmed")) {
    ui.die("`--confirmed` marks one harness's manual step as done — name it, e.g. `neosmith copilot status --confirmed`.");
  }

  ui.banner(`NeoSmith · status · env=${active.name} (${active.baseUrl})`);

  // Stored key — per environment, so a staging key is never reported as the
  // prod one. See io.readKeyRef.
  const stored = io.readKeyRef(active.keyEnv);
  if (stored) {
    ui.ok(`Key stored · ${key.describe(stored)} · env=${active.name} · ${io.CONFIG_FILE}`);
  } else {
    ui.warn(`No key stored for env=${active.name}. Run \`neosmith --env ${active.name} login <key>\` first.`);
  }
  ui.log("");

  // Each harness
  for (const mod of harness.list()) {
    printOne(mod, active);
  }

  if (originals.list().length) {
    ui.log("");
    ui.log(ui.c("dim", `  Your pre-connect settings are stored in ${originals.tilde(io.SNAPSHOTS_DIR)}/`));
    ui.log(ui.c("dim", "  and restored by `off`. Run `neosmith originals` to read or export them."));
  }
}

// `status` describes what is on disk. The active environment is context for
// reading that, never an assertion about it — a harness wired to prod is still
// wired to prod when you run with `--env staging`, and saying otherwise would
// hide exactly the mixup this is here to surface.
function printOne(mod, active) {
  const env = active || harness.envInfo();
  const res = mod.status({ env });
  const wired = res.env || null;
  const mismatch = res.on && wired && wired !== env.name;
  const label = res.on ? (wired ? `on(${wired})` : "on ") : "off";
  const tag = res.on ? ui.c(mismatch ? "yellow" : "green", label) : ui.c("dim", label);
  ui.log(`  ${tag}  ${ui.c("bold", mod.name.padEnd(16))} ${res.detail}`);
  if (mismatch) {
    ui.log(ui.c("yellow", `        ! wired to ${wired}, but --env ${env.name} is active`));
  }
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
