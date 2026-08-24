// Codex — file-writable.
//
// Writes ~/.codex/config.toml (0600). OpenAI Responses API on
// https://router.neosmith.ai/v1. Per site/agents/codex.md:
//
//   model = "neosmith.intelligent-pro"
//   model_provider = "neosmith"
//
//   [model_providers.neosmith]
//   name      = "NeoSmith"
//   base_url  = "https://router.neosmith.ai/v1"
//   env_key   = "OPENAI_API_KEY"
//   wire_api  = "responses"
//
// The key is referenced via env_key (Codex reads $OPENAI_API_KEY at runtime),
// so we also instruct the user to set it. We DO NOT bake the key into the
// TOML — Codex's contract is env_key indirection. `neosmith login` stores the
// key in ~/.neosmith/config.json; on() prints platform-correct instructions for
// persisting the env var (setx on Windows, shell rc on POSIX) plus the
// full-restart steps for GUI editors. See lib/envsetup.js for why that split
// matters — a POSIX `export` line is dead copy on Windows outside Git Bash.
//
// TOML merge via `smol-toml` (same lib fireconnect uses). If the dependency is
// somehow missing, we fall back to a regex/string merge and warn.
//
// What `on` writes is fenced off behind a "NeoSmith managed block" banner and
// the two top-level keys carry a trailing marker comment, so a user opening
// config.toml can see at a glance which lines are ours and which are theirs
// (issue #22). `off` removes exactly the marked region: everything the user
// added elsewhere in the file — including their comments — survives.

"use strict";

const fs = require("fs");
const path = require("path");
const harness = require("../harness");
const io = require("../io");
const preserve = require("../preserve");
const ui = require("../ui");
const envsetup = require("../envsetup");

const CONFIG_DIR = path.join(io.HOME, ".codex");
const CONFIG = path.join(CONFIG_DIR, "config.toml");
const PROVIDER_BLOCK = "neosmith";

// Every pointer on() writes into the parsed TOML, for the restore ledger.
const WRITTEN_POINTERS = [
  ["model"],
  ["model_provider"],
  ["model_providers", PROVIDER_BLOCK],
];

// The two top-level keys NeoSmith owns. Everything else at the top level is
// the user's and is never rewritten or removed.
const TOP_LEVEL_KEYS = ["model", "model_provider"];

const MANAGED_TAG = "# NeoSmith managed - see the block below";
const BANNER = [
  "# --------------------------------------------------------------------------",
  "# NeoSmith managed block - please don't put your own settings in here.",
  "# `neosmith codex off` deletes exactly these lines and puts back whatever was",
  "# here before. Anything you add ELSEWHERE in this file is kept when you",
  "# disconnect, so that is where your own settings belong.",
  "# --------------------------------------------------------------------------",
];

let toml;
try { toml = require("smol-toml"); } catch { toml = null; }

// ── the managed-block markers ───────────────────────────────────────────────
// Banner lines are recognised by exact text, not by "is a comment": a user
// comment sitting directly above our table is theirs, and `off` must leave it.
const BANNER_SET = new Set(BANNER.map((l) => l.trim()));
function isBannerLine(line) { return BANNER_SET.has(String(line).trim()); }

// A TOML table header at column 0, e.g. `[model_providers.neosmith]` or
// `[[x]]`, with an optional trailing comment. Anything else is a key, a
// comment or blank.
function tableHeaderName(line) {
  const m = String(line).match(/^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/);
  return m ? m[1] : null;
}

// Is this line a top-level assignment to one of the keys NeoSmith owns?
function topLevelKeyOf(line) {
  const m = String(line).match(/^\s*(model|model_provider)\s*=/);
  return m && TOP_LEVEL_KEYS.includes(m[1]) ? m[1] : null;
}

// Fence the region NeoSmith owns: the banner above the provider table, and a
// trailing marker on each top-level key. Applied to the serialized TOML rather
// than the parsed object because smol-toml has nowhere to carry a comment.
function annotate(text) {
  const out = [];
  let seenHeader = false;
  for (const line of String(text).split("\n")) {
    const header = tableHeaderName(line);
    if (header !== null) {
      seenHeader = true;
      if (header === `model_providers.${PROVIDER_BLOCK}`) {
        if (out.length && out[out.length - 1].trim() !== "") out.push("");
        out.push(...BANNER);
      }
      out.push(line);
      continue;
    }
    const key = !seenHeader && topLevelKeyOf(line);
    out.push(key && !line.includes(MANAGED_TAG) ? `${line}  ${MANAGED_TAG}` : line);
  }
  return out.join("\n");
}

// The prior value the ledger recorded for one pointer. `undefined` means the
// ledger has nothing to say about it, which is different from io.ABSENT ("the
// key was not there before") and must not be treated as a licence to delete.
function priorOf(ledger, pointer) {
  const want = JSON.stringify(pointer);
  const entry = (ledger || []).find((e) => JSON.stringify(e.pointer) === want);
  return entry ? entry.prior : undefined;
}

// Remove NeoSmith's managed region from the live TOML text, line by line.
//
// The obvious implementation — parse, applyRestore, stringify — round-trips the
// whole document and drops the user's comments and key order along with it.
// That is the very thing `off` is trying not to do here: this path only runs
// because the user edited the file while connected (issue #22). So the removal
// is textual and surgical:
//
//   • the banner + `[model_providers.neosmith]` table, up to the next table
//     header at column 0
//   • the top-level `model` / `model_provider` lines, rewritten to the value
//     the ledger says was there pre-connect, or dropped if there was none
//
// Returns null when the ledger cannot be honoured this way (a prior value that
// is not a plain string, a `[model_providers.neosmith]` the user owned before
// connecting); the caller then falls back to the parse/stringify merge, which
// is less tidy but always correct.
function textUnwire(text, ledger) {
  const providerPrior = priorOf(ledger, ["model_providers", PROVIDER_BLOCK]);
  if (providerPrior !== io.ABSENT && providerPrior !== undefined) return null;

  const priors = {};
  for (const key of TOP_LEVEL_KEYS) {
    const prior = priorOf(ledger, [key]);
    if (prior === undefined) return null;
    if (prior !== io.ABSENT && typeof prior !== "string") return null;
    priors[key] = prior;
  }

  const out = [];
  let inNeoTable = false;
  let seenHeader = false;
  const rewritten = {};

  // Lines swallowed by our table so far. The trailing run of comments and blanks
  // in here belongs to whatever comes NEXT, not to us — TOML comments sit above
  // the thing they describe — so it is handed back when the table ends.
  let pending = [];
  function flushPending() {
    let at = pending.length;
    while (at > 0) {
      const l = pending[at - 1];
      if (l.trim() === "" || /^\s*#/.test(l)) at--;
      else break;
    }
    for (const l of pending.slice(at)) out.push(l);
    pending = [];
  }

  for (const line of String(text).split("\n")) {
    const header = tableHeaderName(line);
    if (header !== null) {
      if (inNeoTable) flushPending();
      seenHeader = true;
      inNeoTable = header === `model_providers.${PROVIDER_BLOCK}`;
      if (inNeoTable) {
        // Drop the banner block (and the blank line before it) we wrote
        // directly above this header — but only lines that are ours verbatim.
        while (out.length && isBannerLine(out[out.length - 1])) out.pop();
        while (out.length && out[out.length - 1].trim() === "") out.pop();
        continue;
      }
    }
    if (inNeoTable) { pending.push(line); continue; }

    const key = !seenHeader && topLevelKeyOf(line);
    if (key && !rewritten[key]) {
      rewritten[key] = true;
      if (priors[key] === io.ABSENT) continue;      // NeoSmith introduced it
      out.push(`${key} = ${JSON.stringify(priors[key])}`);
      continue;
    }
    out.push(line);
  }
  if (inNeoTable) flushPending();

  return out.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "");
}

// Never write a config.toml we have not re-read. The surgery above is textual,
// so it is checked against the parser before it goes to disk: our table gone,
// and the two top-level keys holding exactly what the ledger promised.
function verifyUnwired(text, ledger) {
  let parsed;
  try { parsed = toml.parse(text); } catch { return false; }
  if (parsed.model_providers && parsed.model_providers[PROVIDER_BLOCK]) return false;
  for (const key of TOP_LEVEL_KEYS) {
    const prior = priorOf(ledger, [key]);
    const present = Object.prototype.hasOwnProperty.call(parsed, key);
    if (prior === io.ABSENT) { if (present) return false; }
    else if (!present || parsed[key] !== prior) return false;
  }
  return true;
}

function buildProviderSection(model) {
  return [
    `name = "NeoSmith"`,
    `base_url = "${harness.OPENAI_BASE_URL}"`,
    `env_key = "OPENAI_API_KEY"`,
    `wire_api = "responses"`,
  ];
}

// String-based fallback merge when smol-toml isn't installed. Good enough for
// the documented shape: top-level model/model_provider keys + one provider block.
function stringMerge(existingText, model) {
  let text = (existingText || "").trim();
  // Drop a banner we wrote on an earlier run, so re-running `on` doesn't stack
  // copies of it above the block.
  text = text.split("\n").filter((l) => !isBannerLine(l)).join("\n");
  // Drop any prior neosmith provider block (handles re-runs / model changes).
  text = text.replace(/\n?\[model_providers\.neosmith\][^\[]*/g, "").trim();
  // Drop prior top-level model / model_provider lines.
  text = text.replace(/(^|\n)\s*model\s*=.*(?=\n)/g, "").trim();
  text = text.replace(/(^|\n)\s*model_provider\s*=.*(?=\n)/g, "").trim();

  const lines = [];
  lines.push(`model = "${model}"  ${MANAGED_TAG}`);
  lines.push(`model_provider = "${PROVIDER_BLOCK}"  ${MANAGED_TAG}`);
  lines.push(``);
  lines.push(...BANNER);
  lines.push(`[model_providers.${PROVIDER_BLOCK}]`);
  lines.push(...buildProviderSection(model));
  const header = lines.join("\n") + "\n";

  if (text) return header + "\n" + text + "\n";
  return header + "\n";
}

function on(ctx) {
  const model = ctx.model;
  io.ensureDir(CONFIG_DIR);

  const existingText = io.readText(CONFIG);
  let out;
  if (toml) {
    let parsed = {};
    try { parsed = toml.parse(existingText || ""); } catch (e) {
      ui.warn(`Existing ${CONFIG} had a TOML parse error (${e.message}); merging as fresh with the prior text preserved in a snapshot.`);
    }
    if (!parsed || typeof parsed !== "object") parsed = {};
    // Snapshot + ledger are both write-once, so a second `on` (e.g. to switch
    // model tiers) refreshes the config without losing the pre-connect
    // baseline. Before issue #15 this re-snapshotted the already-NeoSmith TOML
    // and `off` then restored *that*.
    guardCrossEnv(existingText, ctx);
    io.snapshot("codex", CONFIG);
    io.recordRestore("codex", CONFIG, io.planRestore(parsed, WRITTEN_POINTERS));

    parsed.model = model;
    parsed.model_provider = PROVIDER_BLOCK;
    parsed.model_providers = parsed.model_providers || {};
    parsed.model_providers[PROVIDER_BLOCK] = {
      name: "NeoSmith",
      base_url: harness.OPENAI_BASE_URL,
      env_key: "OPENAI_API_KEY",
      wire_api: "responses",
    };
    try {
      out = annotate(toml.stringify(parsed));
    } catch (e) {
      ui.warn(`TOML stringify failed (${e.message}); using string fallback.`);
      out = stringMerge(existingText, model);
    }
  } else {
    ui.warn("`smol-toml` not installed — using a string-based TOML merge. Run `npm install` in the CLI dir for robust parsing.");
    guardCrossEnv(existingText, ctx);
    io.snapshot("codex", CONFIG);
    out = stringMerge(existingText, model);
    // No parser → no ledger. `off` falls back to the same string surgery.
  }

  io.writeText(CONFIG, out, 0o600);
  // Stamp the file as we left it, so `off` can tell a config.toml the user has
  // since edited from one nobody touched (issue #22). Re-stamped on every `on`.
  io.recordFingerprint("codex", CONFIG);
  ui.ok(`Wrote ${CONFIG}`);
  ui.log("");
  ui.log(ui.c("dim", `The NeoSmith lines in that file are fenced behind a "managed block" banner.`));
  ui.log(ui.c("dim", `Keep your own settings outside it: \`neosmith codex off\` removes exactly`));
  ui.log(ui.c("dim", `those lines and keeps everything else you have added since.`));

  // The TOML holds `env_key = "OPENAI_API_KEY"` — a NAME, not the secret. Codex
  // resolves it from the environment on every launch, so this step is what
  // actually makes the connection work. Instructions are platform-specific:
  // printing POSIX `export` on Windows sends the user down a path that fails
  // in PowerShell, cmd, and VS-Code-launched Codex. See lib/envsetup.js.
  const vars = [
    ["OPENAI_API_KEY", ctx.key],
    ["OPENAI_BASE_URL", harness.OPENAI_BASE_URL],
  ];
  ui.log("");
  ui.log(ui.c("dim", `Codex reads the key from $OPENAI_API_KEY at runtime — the TOML`));
  ui.log(ui.c("dim", `holds only the variable's name, never the key itself.`));
  ui.log("");
  for (const l of envsetup.envSetupLines(vars)) ui.log(ui.c("dim", l));
  ui.log("");
  for (const l of envsetup.vscodeRestartLines()) ui.log(ui.c("dim", l));

  return { wrote: true, needsEnv: true };
}

function off(ctx) {
  if (!io.fileExists(CONFIG)) {
    preserve.finish("codex", CONFIG);
    ui.log(`${CONFIG} not present — nothing to disconnect.`);
    return { ok: true };
  }

  // Nobody touched config.toml since `on` wrote it, and we still hold the
  // pre-connect bytes — put them back exactly, comments and all.
  if (preserve.disposition("codex", CONFIG) === "snapshot") {
    io.restoreSnapshot("codex", CONFIG);
    preserve.finish("codex", CONFIG);
    ui.ok(`Restored pre-NeoSmith ${CONFIG} from snapshot.`);
    return { ok: true, mode: "snapshot" };
  }

  // The file changed after `on` wrote it — the user added a provider, an
  // approval policy, a comment. Restoring the snapshot would delete all of it
  // (issue #22), so remove our managed block from the file they have now.
  const text = io.readText(CONFIG) || "";
  const ledger = toml
    ? preserve.ledgerFor("codex", CONFIG, WRITTEN_POINTERS, (raw) => toml.parse(raw))
    : null;

  let out = null;
  let preservedEdits = false;

  if (ledger && toml) {
    // Preferred: textual surgery, which leaves every line that isn't ours
    // exactly as the user typed it.
    const surgical = textUnwire(text, ledger);
    if (surgical !== null && verifyUnwired(surgical, ledger)) {
      out = surgical.endsWith("\n") ? surgical : surgical + "\n";
      preservedEdits = true;
    } else {
      // Correct but lossier: parse/stringify drops comments and normalises key
      // order, while still keeping every setting the user added.
      try {
        const parsed = toml.parse(text) || {};
        io.applyRestore(parsed, ledger);
        out = toml.stringify(parsed);
        preservedEdits = true;
      } catch (e) {
        ui.warn(`Could not replay the restore ledger (${e.message}); falling back to a text strip.`);
      }
    }
  }

  if (out === null) {
    // Last resort — no ledger and no parser. Strip our block via string
    // surgery; the user's own model / model_provider cannot be recovered.
    let t = text.split("\n").filter((l) => !isBannerLine(l)).join("\n");
    t = t.replace(/\n?\[model_providers\.neosmith\][^\[]*/g, "").trim();
    t = t.replace(/(^|\n)\s*model\s*=.*(?=\n)/g, "").trim();
    t = t.replace(/(^|\n)\s*model_provider\s*=.*(?=\n)/g, "").trim();
    out = t + "\n";
  }

  io.writeText(CONFIG, out, 0o600);
  preserve.finish("codex", CONFIG);
  ui.ok(preservedEdits
    ? `Removed the NeoSmith block from ${CONFIG} — the settings you changed while connected are still there.`
    : `Removed NeoSmith block from ${CONFIG} (no pre-connect snapshot or ledger was available).`);
  return { ok: true, mode: "merge", partial: !preservedEdits };
}

// The provider block is keyed on the provider NAME, which is environment
// independent — that is why detection here never string-matched a host. But
// the base_url inside it does say which environment, and `status` should.
// Unlike claude, codex deliberately does NOT short-circuit a repeat `on` — it
// is the documented way to switch model tiers (pinned by codex.test.js). But
// re-pointing across ENVIRONMENTS is a different thing: the snapshot and the
// ledger are write-once, so it would strand the pre-connect baseline and leave
// `off` unable to restore either environment deterministically.
function guardCrossEnv(existingText, ctx) {
  const wired = wiredEnvOf(existingText);
  const active = (ctx && ctx.env && ctx.env.name) || harness.envName();
  if (wired && wired !== active && !(ctx && ctx.force)) {
    ui.die(
      `Codex is already connected to NeoSmith ${wired} (${baseUrlOf(existingText)}).
` +
      `  Run \`neosmith codex off\` first, then \`neosmith --env ${active} codex on\`.
` +
      `  Or pass --force to re-point it, abandoning the ${wired} wiring.`,
    );
  }
}

function baseUrlOf(text) {
  const m = String(text || "").match(/base_url\s*=\s*"([^"]+)"/);
  return m ? m[1] : null;
}

function wiredEnvOf(text) {
  const base = baseUrlOf(text);
  return base ? harness.envForUrl(base) : null;
}

function status(ctx) {
  if (!io.fileExists(CONFIG)) return { on: false, detail: `${CONFIG} does not exist` };
  const text = io.readText(CONFIG) || "";
  const hasBlock = /\[model_providers\.neosmith\]/.test(text) || /model_provider\s*=\s*"neosmith"/.test(text);
  const modelMatch = text.match(/^\s*model\s*=\s*"([^"]+)"/m);
  const wiredEnv = wiredEnvOf(text);
  return {
    on: hasBlock,
    env: wiredEnv,
    detail: hasBlock
      ? `model=${modelMatch ? modelMatch[1] : "(unset)"} wire=responses base=${baseUrlOf(text) || "(unset)"}`
      : "no neosmith provider block",
  };
}

function help() {
  return [
    `Codex — OpenAI Responses API (/v1/responses).`,
    `Wires: ~/.codex/config.toml (merges your existing providers).`,
    `Key storage: Codex reads $OPENAI_API_KEY at runtime — \`on\` prints the`,
    `  platform-correct way to persist it (setx on Windows, shell rc on macOS/Linux).`,
    ``,
    `The NeoSmith lines are fenced behind a "managed block" banner — keep your own`,
    `settings outside it. \`off\` restores the pre-connect file byte-for-byte if you`,
    `have not touched it since \`on\`; if you have, it deletes only the managed block`,
    `and keeps everything else, comments included.`,
    ``,
    `Examples:`,
    `  neosmith codex on`,
    `  neosmith codex off`,
    `  neosmith codex status`,
  ].join("\n");
}

// Codex never stores the key. config.toml holds `env_key = "<NAME>"` and Codex
// reads that variable at runtime — which is exactly what `neosmith keys` has to
// report, rather than implying the config contains a credential it does not.
function keyRef() {
  if (!io.fileExists(CONFIG)) return null;
  const text = io.readText(CONFIG) || "";
  if (!/\[model_providers\.neosmith\]/.test(text)) return null;
  const m = text.match(/env_key\s*=\s*"([^"]+)"/);
  if (!m) return null;
  return { kind: "env-ref", name: m[1], file: CONFIG };
}

module.exports = {
  id: "codex",
  name: "Codex",
  writable: true,
  configFile: CONFIG,
  on, off, status, help, keyRef,
};
