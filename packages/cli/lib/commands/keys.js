// `neosmith keys [--reveal] [--json]`
//
// Reprint the NeoSmith API keys this machine is configured with, and say where
// each one is actually wired.
//
// Why this exists: `login` stores the key at ~/.neosmith/config.json (0600, one
// slot per environment) and `status` reports only its SHAPE — "Key stored ·
// sk-plus-* (Pro / Opus-tier)". Once the terminal scrollback is gone there was
// no way to read your own key back out of the CLI that is holding it in
// plaintext. That is this command's first half.
//
// The second half is the one `status` could never answer: WHICH key a given
// harness has. `status` says on/off and names the environment from the base
// URL, but a harness wired months ago can be sitting on a key that has since
// been rotated — same URL, same "on", dead credential. Each harness module may
// expose keyRef() (see the interface note in lib/harness.js); this command
// collects those and compares them against every stored key, so a mismatch is
// visible instead of being discovered as a 401 inside an editor.
//
// Secret handling, mirroring lib/commands/originals.js --show (the existing
// precedent for printing the user's own credentials):
//   - masked by default, full value only under --reveal
//   - read-only: nothing is written, so no audit-log record is emitted and the
//     redaction contract in io.appendAuditLog is untouched
//   - --env is a GLOBAL flag consumed by bin/neosmith.js, so this command never
//     defines its own; it always lists every environment that has a key. That
//     is the point — "which keys do I have" is not an per-environment question.

"use strict";

const harness = require("../harness");
const key = require("../key");
const io = require("../io");
const originals = require("../originals");
const ui = require("../ui");

function parseFlags(args) {
  const out = { reveal: false, json: false };
  for (const a of args) {
    if (a === "--reveal" || a === "--show" || a === "-r") { out.reveal = true; continue; }
    if (a === "--json") { out.json = true; continue; }
  }
  return out;
}

// Enough of the head to recognise the shape, enough of the tail to tell two
// keys of the same shape apart — which is the whole job when the question is
// "is the key in Zed the same one I logged in with". Same head length as
// io.redactAuditString, so the two never disagree about how much is safe.
function mask(s) {
  if (typeof s !== "string" || !s) return "";
  if (s.length <= 12) return s.slice(0, 4) + "…";
  return s.slice(0, 8) + "…" + s.slice(-4);
}

function show(value, reveal) {
  return reveal ? value : mask(value);
}

// Stored keys, default environment first and the rest alphabetical, so the one
// most invocations actually use is the one at the top.
function storedKeys() {
  const defaultName = harness.envInfo().defaultName;
  const names = io.storedKeyEnvs();
  names.sort((a, b) => {
    if (a === defaultName) return -1;
    if (b === defaultName) return 1;
    return a.localeCompare(b);
  });
  return names
    .map((env) => ({ env, value: io.readKeyRef(env) }))
    .filter((e) => !!e.value)
    .map((e) => ({ ...e, shape: key.describe(e.value) }));
}

// What each harness is holding. A harness whose config is unreadable must not
// take the whole command down with it — `keys` is what you reach for when
// something is already wrong.
function harnessKeys() {
  const out = [];
  for (const id of harness.idsSorted()) {
    const mod = harness.get(id);
    let ref;
    try {
      ref = mod.keyRef();
    } catch (e) {
      out.push({ id, name: mod.name, kind: "error", detail: e && e.message ? e.message : String(e) });
      continue;
    }
    if (!ref) continue;
    out.push({ id, name: mod.name, ...ref });
  }
  return out;
}

// Which stored environment a harness's literal key belongs to, or null when it
// matches none of them.
function matchEnv(value, stored) {
  const hit = stored.find((s) => s.value === value);
  return hit ? hit.env : null;
}

function printTable(stored, held, reveal) {
  ui.banner("NeoSmith · configured keys");

  if (!stored.length) {
    ui.warn(`No key stored. Run \`neosmith login <key>\` first.`);
    ui.log(ui.c("dim", `  Keys are kept per environment in ${originals.tilde(io.CONFIG_FILE)} (mode 0600).`));
  } else {
    ui.log(ui.c("dim", `  Stored in ${originals.tilde(io.CONFIG_FILE)} · one slot per environment.`));
    ui.log("");
    for (const s of stored) {
      const wired = held
        .filter((h) => h.kind === "literal" && h.value === s.value)
        .map((h) => h.id);
      ui.log(`  ${ui.c("bold", s.env.padEnd(9))} ${ui.c("cyan", show(s.value, reveal))}`);
      ui.log(ui.c("dim", `            ${s.shape}`));
      ui.log(ui.c("dim", `            wired into  ${wired.length ? wired.join(" · ") : "—"}`));
      ui.log("");
    }
  }

  if (held.length) {
    ui.log(ui.c("bold", "  Credentials held by each harness"));
    ui.log("");
    for (const h of held) {
      const label = `  ${h.id.padEnd(10)}`;
      if (h.kind === "literal") {
        const env = matchEnv(h.value, stored);
        const note = env
          ? ui.c("dim", `matches the ${env} key`)
          : ui.c("yellow", "! does not match any stored key");
        ui.log(`${label} ${ui.c("cyan", show(h.value, reveal))}  ${note}`);
      } else if (h.kind === "env-ref") {
        ui.log(`${label} ${ui.c("dim", `reads $${h.name} at runtime — no key in its config`)}`);
      } else if (h.kind === "keychain") {
        ui.log(`${label} ${ui.c("dim", h.detail || "stored in an OS keychain — not readable")}`);
      } else if (h.kind === "error") {
        ui.log(`${label} ${ui.c("yellow", `! could not be read: ${h.detail}`)}`);
      }
      if (h.file) ui.log(ui.c("dim", `             ${originals.tilde(h.file)}`));
    }
    ui.log("");
  } else if (stored.length) {
    ui.log(ui.c("dim", "  No harness is currently holding a key. Run `neosmith <harness> on`."));
    ui.log("");
  }

  if (!reveal && (stored.length || held.some((h) => h.kind === "literal"))) {
    ui.log(ui.c("dim", "  Values are masked. Print them in full:  neosmith keys --reveal"));
  }
  if (reveal) {
    ui.log(ui.c("dim", "  These are live credentials. Anything that can read this output can use them."));
  }
}

async function run(args) {
  const flags = parseFlags(args);
  const stored = storedKeys();
  const held = harnessKeys();

  if (flags.json) {
    const payload = {
      configFile: io.CONFIG_FILE,
      revealed: flags.reveal,
      stored: stored.map((s) => ({
        env: s.env,
        shape: s.shape,
        key: show(s.value, flags.reveal),
      })),
      harnesses: held.map((h) => {
        const base = { harness: h.id, name: h.name, kind: h.kind, file: h.file || null };
        if (h.kind === "literal") {
          return { ...base, key: show(h.value, flags.reveal), matchesEnv: matchEnv(h.value, stored) };
        }
        if (h.kind === "env-ref") return { ...base, envVar: h.name };
        return { ...base, detail: h.detail || null };
      }),
    };
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  printTable(stored, held, flags.reveal);
}

module.exports = { run, parseFlags, mask, storedKeys, harnessKeys, matchEnv };
