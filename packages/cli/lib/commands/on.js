// `neosmith <harness> on [--model X] [--autocomplete]`
// Writes (or, for UI-driven harnesses, prints) the NeoSmith config for one
// harness. Snapshots the pre-connect state so `off` restores byte-for-byte.

"use strict";

const harness = require("../harness");
const key = require("../key");
const ui = require("../ui");

function parseFlags(args) {
  const out = { model: null, autocomplete: false, positional: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--model" || a === "-m") { out.model = args[++i]; continue; }
    if (a.startsWith("--model=")) { out.model = a.slice("--model=".length); continue; }
    if (a === "--autocomplete" || a === "--ac") { out.autocomplete = true; continue; }
    if (a === "--key" || a === "-k") { out.key = args[++i]; continue; }
    if (a.startsWith("--key=")) { out.key = a.slice("--key=".length); continue; }
    out.positional.push(a);
  }
  return out;
}

async function run(args) {
  const flags = parseFlags(args);
  const h = flags.positional[0];
  if (!h) ui.die("Usage: neosmith <harness> on [--model X] [--autocomplete]. Run `neosmith help`.");
  const mod = harness.get(h.toLowerCase());
  if (!mod) ui.die(`Unknown harness: ${h}. Supported: ${harness.ids().join(", ")}.`);

  const apiKey = await key.resolveKey(flags.key);
  const model = harness.resolveModel(flags.model);

  ui.banner(`${mod.name} → on`);
  const ctx = { key: apiKey, model, autocomplete: flags.autocomplete, routerUrl: harness.ROUTER_URL };
  const res = mod.on(ctx);

  if (res && res.alreadyOn) {
    ui.warn(`${mod.name} is already connected to NeoSmith. To re-apply, run \`neosmith ${h} off\` first.`);
  }
  if (res && res.wrote) {
    if (mod.writable) {
      ui.log(ui.c("dim", `Restart ${mod.name} for the change to take effect.`));
    }
  }
  if (res && res.needsEnv) {
    ui.log(ui.c("dim", `(Set the OPENAI_API_KEY env var in your shell profile; the TOML only holds an env_key reference.)`));
  }
}

module.exports = { run, parseFlags };
