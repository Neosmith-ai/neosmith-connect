// `neosmith verify` — hit /whoami with the stored (or passed) key.
// Preserves the original CLI's verify behaviour.

"use strict";

const harness = require("../harness");
const key = require("../key");
const http = require("../http");
const io = require("../io");
const ui = require("../ui");

async function run(args) {
  // Only `--key X` / `-k X` / `--key=X` passes an explicit key. A bare
  // positional arg is NOT promoted to the key — the router is the
  // authority on validity, so sniffing the prefix would be noise. Without
  // an explicit --key, the stored ref (~/.neosmith/config.json) is used.
  let explicit = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--key" || args[i] === "-k") explicit = args[++i];
    else if (args[i].startsWith("--key=")) explicit = args[i].slice("--key=".length);
  }
  const apiKey = explicit || io.readKeyRef(harness.keyEnv());
  if (!apiKey) ui.die("No key found. Run `neosmith login <key>` first, or pass --key.");

  const routerUrl = harness.ROUTER_URL;
  ui.log(ui.c("dim", `Verifying key against ${routerUrl}/whoami …`));
  let resp;
  try {
    resp = await http.whoami(routerUrl, apiKey);
  } catch (e) {
    ui.die(`Could not reach ${routerUrl}/whoami: ${e.message}`);
  }

  if (resp.status !== 200) {
    ui.warn(`NeoSmith returned ${resp.status}.`);
    if (resp.status === 401 || resp.status === 403) {
      ui.log("Key rejected. Run `neosmith login <key>` with a current key.");
    }
    process.exit(1);
  }

  const d = resp.data || {};
  ui.ok("NeoSmith active");
  if (d.dev_slug) {
    ui.log(`  dev:  ${ui.c("bold", d.dev_slug)}   org: ${d.org_id || "?"}   tier: ${d.tier || "?"}`);
    if (d.cap) {
      const used = (d.cap.consumed_30d || 0).toLocaleString();
      const cap = (d.cap.effective_cap_tokens || 0).toLocaleString();
      const rem = (d.cap.remaining ?? 0).toLocaleString();
      ui.log(`  cap:  ${used} / ${cap} tokens used in last 30 days (${rem} remaining)`);
    }
  }
  ui.log(ui.c("dim", `Portal: ${routerUrl}/me/login`));
}

module.exports = { run };
