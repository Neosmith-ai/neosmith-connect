// Shared terminal UI helpers — TTY-aware colors, prompt, confirm, banners.
// Zero runtime deps; Node stdlib only. Extracted from the original bin/neosmith.js.

"use strict";

const readline = require("readline");

const COLORS = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m",
};

const isTTY = process.stdout.isTTY;
function c(color, s) { return isTTY ? COLORS[color] + s + COLORS.reset : s; }

function log(s) { console.log(s); }
function info(s) { console.log(s); }
function warn(s) { console.error(c("yellow", "! ") + s); }
function die(s) { console.error(c("red", "✗ ") + s); process.exit(1); }
function ok(s) { log(c("green", "✓ ") + s); }

function banner(title) {
  log("");
  log("  " + c("bold", title));
  log("");
}

function box(lines) {
  // Simple indented block, no drawing chars — reads fine in any terminal.
  for (const l of lines) log("  " + l);
}

function prompt(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(q, (ans) => { rl.close(); resolve(ans); });
  });
}

async function confirm(q) {
  if (!isTTY) return true; // default yes in non-interactive
  const ans = (await prompt(`${q} [Y/n] `)).trim().toLowerCase();
  return ans === "" || ans === "y" || ans === "yes";
}

module.exports = { COLORS, isTTY, c, log, info, warn, die, ok, banner, box, prompt, confirm };
