// `neosmith help [harness]` — top-level or per-harness help.

"use strict";

const harness = require("../harness");
const ui = require("../ui");

function top() {
  ui.banner("NeoSmith CLI");
  ui.log("  Route AI coding agents through " + ui.c("cyan", "https://router.neosmith.ai") + ".");
  ui.log("  Same experience, ~60% lower inference cost.");
  ui.log("");
  ui.log(ui.c("bold", "Quick start"));
  ui.log("  " + ui.c("cyan", "neosmith login") + "             # store + verify your NeoSmith key");
  ui.log("  " + ui.c("cyan", "neosmith claude on") + "        # wire Claude Code (first harness)");
  ui.log("  " + ui.c("cyan", "neosmith claude status") + "    # confirm it's connected");
  ui.log("");
  ui.log(ui.c("bold", "Commands"));
  ui.log("  " + ui.c("cyan", "neosmith login [key]") + "           Store + verify a key");
  ui.log("  " + ui.c("cyan", "neosmith <harness> on") + "          Connect a harness to NeoSmith");
  ui.log("  " + ui.c("cyan", "neosmith <harness> off") + "         Restore a harness's pre-connect config");
  ui.log("  " + ui.c("cyan", "neosmith <harness> status") + "      Show one harness's state");
  ui.log("  " + ui.c("cyan", "neosmith status") + "                Show all harnesses + stored key");
  ui.log("  " + ui.c("cyan", "neosmith verify") + "                Hit /whoami with the stored key");
  ui.log("  " + ui.c("cyan", "neosmith doctor") + "               Per-harness live protocol check + audit-log integrity");
  ui.log("  " + ui.c("cyan", "neosmith models") + "                List available NeoSmith model SKUs");
  ui.log("  " + ui.c("cyan", "neosmith setup") + "                Detect installed tools, wire selected, run doctor");
  ui.log("  " + ui.c("cyan", "neosmith reset [--all]") + "         Disconnect every harness (clears key; --keep-audit to keep log)");
  ui.log("  " + ui.c("cyan", "neosmith feedback [bug|idea]") + "   Open GitHub issue template in browser (auto-filled env block)");
  ui.log("  " + ui.c("cyan", "neosmith uninstall") + "             Disconnect all + remove ~/.neosmith");
  ui.log("  " + ui.c("cyan", "neosmith help [harness]") + "        This message, or per-harness help");
  ui.log("");
  ui.log(ui.c("bold", "Harnesses"));
  ui.log("  " + harness.idsSorted().join(" · "));
  ui.log("");
  ui.log(ui.c("bold", "Options for `on`"));
  ui.log("  --model <sku>     neosmith.intelligent-pro (default) | -basic | -lite | -maestro");
  ui.log("  --autocomplete    (continue only) also route inline completions via -lite");
  ui.log("  --key <key>       use this key instead of the stored one");
  ui.log("  --dry-run         (global) print what would be written without touching disk");
  ui.log("");
  ui.log(ui.c("dim", "No NeoSmith account yet? Email contact-us@neosmith.ai for a trial key."));
  ui.log(ui.c("dim", "Full guide: https://github.com/Neosmith-ai/neosmith-connect/blob/main/packages/cli/README.md"));
  ui.log(ui.c("dim", "Docs site: https://neosmith-ai.github.io/neosmith-connect/ · Issues: https://github.com/Neosmith-ai/neosmith-connect/issues"));
  ui.log(ui.c("dim", "Report a bug or request a feature: neosmith feedback [bug|idea]"));
}

function one(id) {
  const mod = harness.get(id.toLowerCase());
  if (!mod) {
    ui.warn(`Unknown harness: ${id}. Supported: ${harness.ids().join(", ")}.`);
    top();
    return;
  }
  ui.banner(`${mod.name} · help`);
  ui.log(mod.help());
}

async function run(args) {
  if (args[0]) one(args[0]);
  else top();
}

module.exports = { run, top, one };
