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

// Key material, by the shapes NeoSmith issues. Same set io.AUDIT_KEY_PREFIX
// redacts the audit log with — kept as its own literal here because ui.js is
// deliberately dependency-free (readline and nothing else), and a cycle through
// io.js would be worse than one duplicated regex.
const SECRET = /(sk-(?:plus|std|slm)-[A-Za-z0-9._-]+|eyJ[A-Za-z0-9._-]{8,})/g;

// warn() and die() are ERROR paths. A key has no business on one: no call site
// in lib/ puts a key into either (checked — zero interpolations of ctx.key,
// apiKey or key into a warn/die string), and if one ever does, it is a mistake
// rather than a feature.
//
// So they redact. log()/box()/ok() deliberately do NOT — those are how the CLI
// shows you paste-in values for a UI-driven harness and how `keys --reveal`
// answers the question you asked it.
//
// This is also the sanitiser CodeQL was asking for. js/clear-text-logging
// flagged these two lines at high severity: taint reaches them through HTTP
// RESPONSE objects (the response is derived from a call that took the key, so
// `HTTP ${resp.status}` counts as key-derived), not through any key actually
// being printed. Redacting makes the guarantee real instead of incidental.
function redact(s) {
  return String(s).replace(SECRET, (m) => m.slice(0, 8) + "…redacted(" + m.length + ")");
}

function log(s) { console.log(s); }
function info(s) { console.log(s); }
function warn(s) { console.error(c("yellow", "! ") + redact(s)); }
function die(s) { console.error(c("red", "✗ ") + redact(s)); process.exit(1); }
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

module.exports = { COLORS, isTTY, c, log, info, warn, die, ok, banner, box, prompt, confirm, redact };
