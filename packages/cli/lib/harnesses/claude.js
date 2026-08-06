// Claude Code — file-writable.
//
// Writes ~/.claude/settings.json (0600). Anthropic Messages API:
//   ANTHROPIC_BASE_URL   = https://router.neosmith.ai  (bare host; Claude appends /v1/messages)
//   ANTHROPIC_AUTH_TOKEN = <key>                       (accepted alongside ANTHROPIC_API_KEY)
//   ANTHROPIC_MODEL      = neosmith.intelligent-pro    (mapped via flag --model)
//
// MERGE never clobber: pre-existing env, permissions, hooks, MCP config are
// preserved. `off` restores from the byte-for-byte snapshot taken before `on`.

"use strict";

const fs = require("fs");
const path = require("path");
const harness = require("../harness");
const io = require("../io");
const ui = require("../ui");

const CONFIG = path.join(io.HOME, ".claude", "settings.json");

function hasNeoSmith(s) {
  return s && s.env && (
    (typeof s.env.ANTHROPIC_BASE_URL === "string" && s.env.ANTHROPIC_BASE_URL.includes("router.neosmith.ai")) ||
    (typeof s.env.ANTHROPIC_AUTH_TOKEN === "string") ||
    (typeof s.env.ANTHROPIC_API_KEY === "string" && /^(sk-(plus|std|slm)-|eyJ)/.test(s.env.ANTHROPIC_API_KEY))
  );
}

function on(ctx) {
  const model = ctx.model;
  const key = ctx.key;

  io.ensureDir(path.dirname(CONFIG));
  const existing = io.readJSON(CONFIG) || {};
  if (!existing || typeof existing !== "object") {
    ui.warn(`Existing ${CONFIG} was not valid JSON — backing up as-is and starting clean.`);
    io.writeText(CONFIG + ".corrupt", JSON.stringify(existing), 0o600).catch?.(() => {});
  }

  if (hasNeoSmith(existing)) {
    ui.warn(`${CONFIG} already points at NeoSmith.`);
    return { alreadyOn: true };
  } else if (existing.env && (existing.env.ANTHROPIC_API_KEY || existing.env.ANTHROPIC_BASE_URL || existing.env.ANTHROPIC_AUTH_TOKEN)) {
    ui.log(ui.c("dim", `Backing up pre-connect config → ~/.claude/settings.json.neosmith-snapshot`));
    io.snapshot("claude", CONFIG);
  } else {
    // No prior Anthropic config — record a tombstone so `off` knows to delete.
    io.snapshot("claude", CONFIG);
  }

  const next = { ...existing };
  next.env = { ...(existing.env || {}) };
  next.env.ANTHROPIC_BASE_URL = harness.ROUTER_URL;
  next.env.ANTHROPIC_AUTH_TOKEN = key;     // canonical NeoSmith var per developer-guide
  next.env.ANTHROPIC_MODEL = model;       // neosmith.intelligent-pro by default

  io.writeJSON(CONFIG, next, 0o600);
  ui.ok(`Wrote ${CONFIG}`);
  return { wrote: true };
}

function off(ctx) {
  if (!io.fileExists(CONFIG)) {
    io.clearSnapshot("claude");
    ui.log(`${CONFIG} not present — nothing to disconnect.`);
    return { ok: true };
  }
  const restored = io.restoreSnapshot("claude", CONFIG);
  if (!restored) {
    // No snapshot — strip NeoSmith keys as a fallback.
    const cfg = io.readJSON(CONFIG) || {};
    const env = cfg.env || {};
    delete env.ANTHROPIC_BASE_URL;
    delete env.ANTHROPIC_AUTH_TOKEN;
    delete env.ANTHROPIC_API_KEY; // in case user pre-configured it for us.
    delete env.ANTHROPIC_MODEL;
    if (Object.keys(env).length === 0) delete cfg.env;
    io.writeJSON(CONFIG, cfg, 0o600);
    ui.ok(`Removed NeoSmith keys from ${CONFIG} (no pre-connect snapshot was available).`);
    return { ok: true, partial: true };
  }
  ui.ok(`Restored pre-NeoSmith ${CONFIG} from snapshot.`);
  return { ok: true };
}

function status(ctx) {
  const cfg = io.fileExists(CONFIG) ? io.readJSON(CONFIG) : null;
  if (!cfg) return { on: false, detail: `${CONFIG} does not exist` };
  const env = cfg.env || {};
  const neosmith = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || env.ANTHROPIC_BASE_URL;
  if (!neosmith) return { on: false, detail: "no Anthropic env keys present" };
  const pointingAtNeo = (env.ANTHROPIC_BASE_URL || "").includes("router.neosmith.ai");
  return {
    on: pointingAtNeo,
    detail: pointingAtNeo
      ? `model=${env.ANTHROPIC_MODEL || "(unset)"} base=${env.ANTHROPIC_BASE_URL}`
      : `pointing at non-NeoSmith backend: ${env.ANTHROPIC_BASE_URL || "(base unset)"}`,
  };
}

function help() {
  return [
    `Claude Code — Anthropic Messages API.`,
    `Wires: ~/.claude/settings.json (merges, never clobbers your hooks / permissions / MCP).`,
    `Key storage: ANTHROPIC_AUTH_TOKEN in settings.json (mode 0600).`,
    ``,
    `Examples:`,
    `  neosmith claude on`,
    `  neosmith claude on --model neosmith.intelligent-basic`,
    `  neosmith claude off        # restores the byte-for-byte pre-connect config from snapshot`,
    `  neosmith claude status`,
  ].join("\n");
}

module.exports = {
  id: "claude",
  name: "Claude Code",
  writable: true,
  configFile: CONFIG,
  on, off, status, help,
};
