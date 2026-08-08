// `neosmith doctor [--harness <id>]` — live per-harness protocol check.
//
// For each harness that is currently `on`, dispatch the matching live request
// to the NeoSmith router using the stored key. Recipes are ported verbatim
// from site/reference/verify-connection.md — the bodies are intentionally
// 1-token probes so we don't burn credits.
//
// Failure modes are mapped against the symptom-first troubleshooting table at
// site/reference/troubleshooting.md and printed as remediation lines rather
// than stack traces.

"use strict";

const fs = require("fs");
const path = require("path");

const harness = require("../harness");
const http = require("../http");
const io = require("../io");
const ui = require("../ui");

// ── Failure-mode map (keyed on HTTP status + a one-line regex match) ──────
// Each entry: { match(ctx) → boolean, prefer: "401" | "404" | "400" | "network" }
// Prefer is the normative matching key for the troubleshooting-table lookup.
const FAILURE_MODES = [
  {
    name: "401 Unauthorized",
    match: (ctx) => ctx.status === 401 || ctx.status === 403,
    fix: "Key rejected. Confirm against `/whoami`; check for trailing whitespace.",
  },
  {
    name: "404 (wrong base URL)",
    match: (ctx) => ctx.status === 404,
    fix: "Wrong base URL. For OpenAI-format clients, include `/v1`. For Claude Code, use the bare host.",
  },
  {
    name: "400 Unknown model",
    match: (ctx) => ctx.status === 400 && /unknown\s*model/i.test(ctx.body || ""),
    fix: "Use a `neosmith.*` SKU or `claude-*` id, not `gpt-*`.",
  },
  {
    // body may include wire_api vs chat_completions mismatch
    name: "Wire format mismatch",
    match: (ctx) => ctx.status === 400 && /wire_api|wire format/i.test(ctx.body || ""),
    fix: "For Codex, ensure `wire_api = \"responses\"` is set in ~/.codex/config.toml.",
  },
  {
    name: "Connection refused / timeout",
    match: (ctx) => ctx.networkError,
    // Name the host actually being probed — against `--env staging` or a
    // local router, telling the user to check prod's firewall is misleading.
    fix: () => {
      let host = harness.ROUTER_URL;
      try { host = new URL(harness.ROUTER_URL).host; } catch { /* keep the raw value */ }
      return `Outbound connection to ${host} blocked. Check corporate firewall / proxy.`;
    },
  },
];

function classify(resp, networkError) {
  const ctx = {
    status: resp ? resp.status : null,
    body:   resp ? resp.body : "",
    networkError: !!networkError,
    networkErrorMessage: networkError ? networkError.message : "",
  };
  for (const mode of FAILURE_MODES) {
    // `fix` may be a thunk when the advice depends on the active environment
    // (which host to check the firewall for). Resolve it here so every caller
    // still receives a plain string.
    if (mode.match(ctx)) {
      return { mode: { ...mode, fix: typeof mode.fix === "function" ? mode.fix() : mode.fix }, ctx };
    }
  }
  return { mode: { name: "Unknown failure", fix: "Run `neosmith verify` for raw response." }, ctx };
}

async function probeFor(h, apiKey) {
  const base = harness.ROUTER_URL;
  const wire = (h.manifest && h.manifest().harnesses.find((x) => x.id === h.id) || {}).wire;
  // Brain-dead: each harness module already exposes wire as part of its manifest
  // entry. Use the wire the manifest declared.
  const manifestWire = (harness.manifest().harnesses.find((x) => x.id === h.id) || {}).wire;
  const w = wire || manifestWire || "openai-completions";

  try {
    if (w === "anthropic-messages") {
      // POST /v1/messages — 1-token probe with `claude-haiku-4-5` (cheapest).
      return await http.post(
        `${base}/v1/messages`,
        {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        { model: "claude-haiku-4-5", max_tokens: 1, messages: [{ role: "user", content: "." }] },
      );
    } else if (w === "openai-responses") {
      return await http.post(
        `${base}/v1/responses`,
        {
          "Authorization": `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        { model: "neosmith.intelligent-lite", input: ".", max_output_tokens: 1 },
      );
    } else {
      // openai-completions (or chat-completions alias)
      return await http.post(
        `${base}/v1/chat/completions`,
        {
          "Authorization": `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        { model: "neosmith.intelligent-lite", messages: [{ role: "user", content: "." }], max_tokens: 1 },
      );
    }
  } catch (e) {
    return { networkError: e };
  }
}

async function checkHarness(h, apiKey) {
  const s = h.status({ env: harness.envInfo() });
  if (!s.on) {
    return { harness: h.id, name: h.name, ok: true, detail: "not connected (skipped)", skipped: true };
  }
  const resp = await probeFor(h, apiKey);
  if (resp && resp.networkError) {
    const cls = classify(null, resp.networkError);
    return { harness: h.id, name: h.name, ok: false, detail: cls.mode.name, fix: cls.mode.fix };
  }
  if (resp.status === 200 || resp.status === 201) {
    let parsed = {};
    try { parsed = JSON.parse(resp.body); } catch { /* response body may be empty */ }
    return { harness: h.id, name: h.name, ok: true, detail: `pass (model=${parsed.model || "(unknown)"})` };
  }
  const cls = classify(resp);
  return { harness: h.id, name: h.name, ok: false, detail: cls.mode.name, fix: cls.mode.fix };
}

function checkAuditLog() {
  if (!io.fileExists(io.AUDIT_FILE)) {
    return { kind: "audit", ok: true, detail: "no audit log yet" };
  }
  const text = fs.readFileSync(io.AUDIT_FILE, "utf8");
  const hit = text.match(/sk-(?:plus|std|slm)-[A-Za-z0-9]{6,}|eyJ[A-Za-z0-9_-]{10,}/);
  if (hit) {
    return {
      kind: "audit",
      ok: false,
      detail: `key material found in audit log (${hit[0].slice(0, 12)}…)`,
      fix: "Run `neosmith log --export` to inspect. Audit redaction is broken — file an issue.",
    };
  }
  const lines = text.split("\n").filter(Boolean).length;
  return { kind: "audit", ok: true, detail: `${lines} entries, no redacted key leaks` };
}

function printReport(r) {
  const tag = r.ok ? ui.c("green", "✓") : ui.c("red", "✗");
  const head = `${tag}  ${ui.c("bold", (r.name || r.harness || r.kind).padStart(18))}`;
  ui.log(`  ${head}  ${r.detail}`);
  if (!r.ok && r.fix) ui.log(ui.c("dim", "          fix: " + r.fix));
}

function parseFlags(args) {
  const out = { harness: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--harness" || a === "-H") out.harness = args[++i];
    else if (a.startsWith("--harness=")) out.harness = a.slice("--harness=".length);
  }
  return out;
}

async function run(args) {
  const flags = parseFlags(args);
  const active = harness.envInfo();
  const apiKey = io.readKeyRef(active.keyEnv);
  if (!apiKey) ui.die(`No key found for env=${active.name}. Run \`neosmith --env ${active.name} login <key>\` first.`);

  ui.banner(`NeoSmith · doctor · env=${active.name} (${active.baseUrl})`);

  const harnesses = flags.harness
    ? [harness.get(flags.harness)].filter(Boolean)
    : harness.list();

  if (flags.harness && harnesses.length === 0) {
    ui.die(`Unknown harness: ${flags.harness}. Supported: ${harness.idsSorted().join(", ")}.`);
  }

  let allOk = true;
  for (const h of harnesses) {
    const r = await checkHarness(h, apiKey);
    printReport(r);
    if (!r.ok && !r.skipped) allOk = false;
  }

  // Audit log health check (separate row — it's a global invariant).
  const audit = checkAuditLog();
  printReport({ ...audit, name: "audit-log" });
  if (!audit.ok) allOk = false;

  if (!allOk) {
    ui.warn("\nDoctor found issues. See remediation lines above.");
    process.exitCode = 1;
  } else {
    ui.ok("\nAll checks passed.");
  }
}

module.exports = { run, classify };
