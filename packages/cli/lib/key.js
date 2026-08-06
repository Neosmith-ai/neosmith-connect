// Key validation + storage. NeoSmith keys (per neosmith-developer-guide and
// the ground-truth memory):
//   sk-plus-*  (Pro / Opus-tier, default)
//   sk-std-*   (Basic / Sonnet-tier)
//   sk-slm-*   (Lite / SLM-only)
//   eyJ*       (Cognito JWT, browser-issued SSO)
// Stored as a plaintext literal at ~/.neosmith/config.json (mode 0600). No
// OS keychain — the developer-guide stores all harness keys as 0600 literals.

"use strict";

const io = require("./io");
const http = require("./http");
const ui = require("./ui");

const KEY_RE = /^(sk-(plus|std|slm)-|eyJ)/;

function looksLikeKey(s) {
  return typeof s === "string" && KEY_RE.test(s);
}

function describe(s) {
  if (!s) return "none";
  if (/^sk-plus-/.test(s)) return "sk-plus-* (Pro / Opus-tier)";
  if (/^sk-std-/.test(s)) return "sk-std-* (Basic / Sonnet-tier)";
  if (/^sk-slm-/.test(s)) return "sk-slm-* (Lite / SLM-only)";
  if (/^eyJ/.test(s)) return "Cognito JWT";
  return "unknown shape";
}

// Resolve the key to use for a command: explicit arg > stored ref.
// If none and TTY, prompt to paste. Dies if still none.
async function resolveKey(explicit) {
  if (explicit) return explicit;
  const stored = io.readKeyRef();
  if (stored) return stored;
  if (ui.isTTY) {
    const pasted = (await ui.prompt("Paste your NeoSmith API key (sk-plus-*, sk-std-*, sk-slm-*, or eyJ… JWT): ")).trim();
    if (pasted) return pasted;
  }
  ui.die("No key found. Run `neosmith login <key>` first, or pass --key.");
}

// login [key]: validate shape, verify against /whoami, store the ref.
async function login(explicitKey, opts = {}) {
  let key = explicitKey;
  if (!key) {
    if (ui.isTTY) {
      key = (await ui.prompt("Paste your NeoSmith API key: ")).trim();
    }
    if (!key) ui.die("No key provided. Aborting.");
  }

  if (!looksLikeKey(key)) {
    ui.warn(`That doesn't look like a NeoSmith API key (expected sk-plus-*, sk-std-*, sk-slm-*, or a Cognito JWT).`);
    if (!(await ui.confirm("Proceed anyway?"))) ui.die("Aborted.");
  }

  const routerUrl = opts.routerUrl || http.DEFAULT_ROUTER;
  ui.log(ui.c("dim", `Verifying key against ${routerUrl}/whoami …`));
  let identity = null;
  try {
    const resp = await http.whoami(routerUrl, key);
    if (resp.status === 200) {
      identity = resp.data;
      ui.ok(`NeoSmith active · ${describe(key)}`);
      if (identity && identity.dev_slug) {
        ui.log(`  dev:  ${ui.c("bold", identity.dev_slug)}   org: ${identity.org_id || "?"}   tier: ${identity.tier || "?"}`);
        if (identity.cap) {
          const used = (identity.cap.consumed_30d || 0).toLocaleString();
          const cap = (identity.cap.effective_cap_tokens || 0).toLocaleString();
          const rem = (identity.cap.remaining ?? 0).toLocaleString();
          ui.log(`  cap:  ${used} / ${cap} tokens used in last 30 days (${rem} remaining)`);
        }
      }
    } else if (resp.status === 401 || resp.status === 403) {
      ui.warn(`Key rejected by NeoSmith (HTTP ${resp.status}). Storing it anyway — re-verify with \`neosmith verify\` once activated.`);
    } else {
      ui.warn(`NeoSmith returned ${resp.status}. Storing the key; run \`neosmith verify\` to retry.`);
    }
  } catch (e) {
    ui.warn(`Could not reach ${routerUrl}/whoami (${e.message}). Storing the key; run \`neosmith verify\` when you're online.`);
  }

  io.writeKeyRef(key);
  ui.ok(`Key stored in ${io.CONFIG_FILE}`);
  return { key, identity };
}

module.exports = { KEY_RE, looksLikeKey, describe, resolveKey, login };
