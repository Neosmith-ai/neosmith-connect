#!/usr/bin/env node
// scripts/e2e/run.js — drive the INSTALLED CLI against a real router.
//
//   node scripts/e2e/run.js --harness claude --env staging \
//     [--home <dir>] [--out <dir>] [--bin neosmith] [--json]
//
// This is deliberately a Node script, not inline workflow YAML:
//
//   - It runs identically on macOS and Windows. One implementation instead of
//     a bash copy and a PowerShell copy that drift.
//   - It runs locally against the offline contract mock with no secrets and
//     no cost:
//       node scripts/e2e/run.js --harness copilot --env local --mock
//     so when staging is down you can tell an outage from a CLI bug in one
//     command.
//   - Every child process gets a hard timeout. That is the only real defense
//     against an agentic retry loop inside a real harness burning tokens.
//
// It shells out to the `neosmith` binary and never require()s lib/. That
// separation is what makes the TARBALL, not the source tree, the thing under
// test — the failure mode CONTRIBUTING.md:50-107 exists to prevent.
//
// Harnesses fall into three tiers by what can honestly be automated:
//
//   prompt   claude, codex     — real binary, real prompt through the router
//   config   continue, zed,    — assert what `on` wrote and that `off`
//            copilot, cline      restores byte-for-byte
//   printed  jetbrains, cursor — assert the printed instructions are correct
//                                for THIS platform (writable:false)

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

// ── args ────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { harness: null, env: "staging", home: null, out: null, bin: "neosmith", cliScript: null, json: false, mock: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--harness" || a === "-h") out.harness = argv[++i];
    else if (a === "--env") out.env = argv[++i];
    else if (a === "--home") out.home = argv[++i];
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--bin") out.bin = argv[++i];
    else if (a === "--cli-script") out.cliScript = argv[++i];
    else if (a === "--json") out.json = true;
    else if (a === "--mock") out.mock = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.harness) {
  console.error(
    "usage: run.js --harness <id> [--env staging] [--home dir] [--out dir]\n" +
    "              [--bin neosmith | --cli-script path/to/bin/neosmith.js] [--mock] [--json]");
  process.exit(2);
}

// A hard ceiling on any child. An agentic harness that decides to retry can
// otherwise spend real money for the full job timeout.
const CHILD_TIMEOUT_MS = 120000;

// ── sandbox ─────────────────────────────────────────────────────────────────

const HOME = args.home || fs.mkdtempSync(path.join(os.tmpdir(), "neosmith-e2e-"));
const OUT = args.out || path.join(HOME, "_artifacts");
fs.mkdirSync(OUT, { recursive: true });

// All four must be set. On Windows, APPDATA is read directly by claude.js,
// zed.js and copilot.js — without it those writes land in the runner's real
// roaming profile, outside the sandbox.
const SANDBOX_ENV = {
  HOME,
  USERPROFILE: HOME,
  APPDATA: path.join(HOME, "AppData", "Roaming"),
  XDG_CONFIG_HOME: path.join(HOME, ".config"),
  // The harness binaries have their OWN config-dir overrides, and they win
  // over HOME. Without these, `codex exec` on a developer machine reads the
  // developer's real ~/.codex/config.toml — it reported the wrong model and
  // talked to the wrong router while the sandbox sat untouched, which is a
  // vacuous pass at best and a live-credential leak at worst.
  CODEX_HOME: path.join(HOME, ".codex"),
  CLAUDE_CONFIG_DIR: path.join(HOME, ".claude"),
};
fs.mkdirSync(SANDBOX_ENV.APPDATA, { recursive: true });
fs.mkdirSync(SANDBOX_ENV.XDG_CONFIG_HOME, { recursive: true });

const KEY = process.env.NEOSMITH_E2E_KEY || process.env.NEOSMITH_STAGING_KEY || "";

const checks = [];
const record = (name, ok, detail) => {
  checks.push({ name, ok: !!ok, detail: detail || "" });
  if (!args.json) {
    const tag = ok ? "[32m✓[0m" : "[31m✗[0m";
    console.log(`  ${tag}  ${name}${detail ? `  — ${detail}` : ""}`);
  }
};

// Invoke the CLI. Two modes:
//   default        · resolve the installed `neosmith` binary on PATH — this is
//                    what the staging workflow uses, so the TARBALL is what is
//                    under test.
//   --cli-script   · run `node <path/to/bin/neosmith.js>` from a checkout, for
//                    the offline rehearsal.
//
// Neither goes through a shell. Spawning through one on Windows re-parses the
// command line, so a node path containing a space ("C:\Program Files\...")
// is split and the run dies with `'C:\Program' is not recognized`.
function cli(argv, extraEnv) {
  const env = { ...process.env, ...SANDBOX_ENV, ...(extraEnv || {}) };
  delete env.NEOSMITH_ENV;
  if (!args.mock) delete env.NEOSMITH_BASE_URL;

  let cmd, cmdArgs;
  if (args.cliScript) {
    cmd = process.execPath;
    cmdArgs = [args.cliScript, ...argv];
  } else {
    const resolved = which(args.bin);
    if (!resolved) return { status: null, out: `${args.bin} not found on PATH`, missing: true };
    const isBatch = /\.(cmd|bat)$/i.test(resolved);
    cmd = isBatch ? (process.env.COMSPEC || "cmd.exe") : resolved;
    cmdArgs = isBatch ? ["/d", "/s", "/c", resolved, ...argv] : argv;
  }

  const r = spawnSync(cmd, cmdArgs, {
    env, encoding: "utf8", timeout: CHILD_TIMEOUT_MS,
    // Never inherit stdin: `login` prompts when it is a TTY, and a CI job that
    // blocks on a hidden prompt looks like a hang, not a failure.
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: r.status,
    out: (r.stdout || "") + (r.stderr || ""),
    timedOut: r.error && r.error.code === "ETIMEDOUT",
  };
}

// Resolve an executable on PATH ourselves rather than spawning through a
// shell. On Windows, `shell: true` re-parses the command line, so a multi-word
// prompt is split on spaces and the harness sees a pile of stray arguments —
// which is exactly how `codex exec "reply with ok"` becomes
// "unexpected argument 'with' found". Resolving the real path lets us spawn
// with shell:false and pass argv through untouched on every platform.
const WHICH_CACHE = new Map();
function which(bin) {
  if (WHICH_CACHE.has(bin)) return WHICH_CACHE.get(bin);
  const exts = process.platform === "win32"
    ? (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [""];
  let found = null;
  outer:
  for (const dir of (process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const candidate = path.join(dir, bin + ext);
      try {
        if (fs.statSync(candidate).isFile()) { found = candidate; break outer; }
      } catch { /* keep looking */ }
    }
  }
  WHICH_CACHE.set(bin, found);
  return found;
}

function harnessBin(bin, argv, extraEnv) {
  const env = { ...process.env, ...SANDBOX_ENV, ...(extraEnv || {}) };
  const resolved = which(bin);
  if (!resolved) return { status: null, out: "", missing: true };

  // A .cmd / .bat shim can only be executed through cmd.exe. Invoke it
  // explicitly with /c so argv is still passed as a real argument vector
  // rather than being re-split from a flattened string.
  const isBatch = /\.(cmd|bat)$/i.test(resolved);
  const [cmd, cmdArgs] = isBatch
    ? [process.env.COMSPEC || "cmd.exe", ["/d", "/s", "/c", resolved, ...argv]]
    : [resolved, argv];

  // stdin must be closed, not inherited. `codex exec` and `claude -p` both
  // fall back to reading a prompt from stdin when it looks like a pipe, and on
  // a CI runner that blocks until the timeout kills the job.
  const r = spawnSync(cmd, cmdArgs, {
    env, encoding: "utf8", timeout: CHILD_TIMEOUT_MS, windowsVerbatimArguments: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: r.status,
    out: (r.stdout || "") + (r.stderr || ""),
    timedOut: r.error && r.error.code === "ETIMEDOUT",
    missing: r.error && r.error.code === "ENOENT",
  };
}

const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null);
const save = (name, content) => fs.writeFileSync(path.join(OUT, name), content == null ? "(absent)" : content);

// Redact before anything is written to an artifact. ~/.claude/settings.json
// holds ANTHROPIC_AUTH_TOKEN verbatim, and artifacts get uploaded.
function scrub(text) {
  if (!text) return text;
  let s = text;
  if (KEY) s = s.split(KEY).join("***");
  return s.replace(/sk-(plus|std|slm)-[A-Za-z0-9_-]{4,}/g, "sk-$1-***")
          .replace(/eyJ[A-Za-z0-9_-]{10,}/g, "eyJ***");
}

// ── per-OS config locations (mirrors the harness modules) ───────────────────

function vsCodeUserDir() {
  if (process.platform === "win32") return path.join(SANDBOX_ENV.APPDATA, "Code", "User");
  if (process.platform === "darwin") return path.join(HOME, "Library", "Application Support", "Code", "User");
  return path.join(SANDBOX_ENV.XDG_CONFIG_HOME, "Code", "User");
}

function zedSettingsPath() {
  if (process.platform === "win32") return path.join(SANDBOX_ENV.APPDATA, "Zed", "settings.json");
  if (process.platform === "darwin") return path.join(HOME, "Library", "Application Support", "Zed", "settings.json");
  return path.join(SANDBOX_ENV.XDG_CONFIG_HOME, "zed", "settings.json");
}

const PATHS = {
  claude:   path.join(HOME, ".claude", "settings.json"),
  codex:    path.join(HOME, ".codex", "config.toml"),
  continue: path.join(HOME, ".continue", "config.yaml"),
  zed:      zedSettingsPath(),
  cline:    path.join(HOME, ".cline", "data", "settings", "providers.json"),
  // chatLanguageModels.json is owned by VS Code itself and lives at the
  // PROFILE ROOT — not in the extension's globalStorage.
  copilot:  path.join(vsCodeUserDir(), "chatLanguageModels.json"),
  state:    path.join(HOME, ".neosmith", "state.json"),
  audit:    path.join(HOME, ".neosmith", "audit.log"),
};

// ── setup ───────────────────────────────────────────────────────────────────

const manifest = JSON.parse(read(path.join(__dirname, "..", "..", "harnesses.json")));
const contract = JSON.parse(read(path.join(__dirname, "..", "..", "contract", "router-contract.v1.json")));
const ENV_DEF = manifest.environments[args.env];
if (!ENV_DEF) {
  console.error(`unknown env '${args.env}'. known: ${Object.keys(manifest.environments).join(", ")}`);
  process.exit(2);
}
// Every inference call uses the cheapest sealed SKU. It never escalates to a
// frontier model, so a CI bug cannot produce a frontier-priced bill.
const SMOKE_MODEL = contract.skus.cheapestForSmoke;

// A real prompt is only meaningful against a real router. `--mock` says the
// other end is the contract fake: the config assertions still run — that is
// the point of being able to rehearse locally — but a canned response proves
// nothing about inference, so the prompt step is reported as skipped.
//
// Gated on --mock and NOT on the environment name: `--env local` against a
// router you actually booted on :4008 is a real router, and running the full
// prompt path against it is exactly the loop that lets a router change and a
// CLI change be tested together before either is deployed.
const PROMPTS_ARE_REAL = !args.mock;
function skipPrompt(id) {
  record(`${id}: real prompt (skipped — --mock, the router is a fake)`, true,
    "drop --mock, or use --env staging, for the real round-trip");
}

function login() {
  if (!KEY) {
    record("a key is available", false, "set NEOSMITH_E2E_KEY / NEOSMITH_STAGING_KEY");
    return false;
  }
  const r = cli(["--env", args.env, "login", KEY]);
  record("login stores a key for this environment", r.status === 0, r.status === 0 ? "" : scrub(r.out));
  return r.status === 0;
}

// ── tier: printed instructions (writable:false) ─────────────────────────────
//
// These harnesses are configured by hand in a GUI, so `on` prints values to
// paste. Assert the URL, the model and the UI path — never the key: GitHub
// masks exact secret matches, so a stdout grep for the key can never pass.

function printedTier(id) {
  const r = cli(["--env", args.env, id, "on", "--model", "lite"]);
  save(`${id}.on.txt`, scrub(r.out));
  record(`${id}: on exits 0`, r.status === 0, r.status === 0 ? "" : scrub(r.out));

  const base = r.out.includes(ENV_DEF.openaiBaseUrl) || r.out.includes(ENV_DEF.baseUrl);
  record(`${id}: prints the ${args.env} base URL`, base,
    base ? "" : `expected ${ENV_DEF.openaiBaseUrl} in the printed instructions`);

  record(`${id}: prints the requested model`, r.out.includes(manifest.models.lite));

  if (KEY) {
    record(`${id}: the key is never written to a config file`,
      !filesUnderHomeContaining(KEY).some((f) => !f.includes(".neosmith")));
  }

  const state = JSON.parse(read(PATHS.state) || "{}");
  const flag = (state.harnesses || {})[id];
  record(`${id}: state records the environment`, !!flag && flag.env === args.env,
    flag ? `env=${flag.env}` : "no flag written");

  const off = cli([id, "off"]);
  record(`${id}: off exits 0`, off.status === 0, off.status === 0 ? "" : scrub(off.out));
  const after = JSON.parse(read(PATHS.state) || "{}");
  record(`${id}: off clears the flag`, !((after.harnesses || {})[id]));
}

// ── tier: config write ──────────────────────────────────────────────────────
//
// Seed a realistic pre-existing config, connect, assert the merge preserved
// the user's own entries AND points at this environment, then assert `off`
// restores the seed byte-for-byte.

function configTier(id, seed) {
  const target = PATHS[id];
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, seed);
  save(`${id}.before`, seed);

  const r = cli(["--env", args.env, id, "on", "--model", "lite"]);
  save(`${id}.on.txt`, scrub(r.out));
  record(`${id}: on exits 0`, r.status === 0, r.status === 0 ? "" : scrub(r.out));

  const wired = read(target);
  save(`${id}.wired`, scrub(wired));
  record(`${id}: the config was actually rewritten (not a vacuous pass)`, wired !== seed);
  record(`${id}: points at ${args.env}`, !!wired && wired.includes(ENV_DEF.baseUrl),
    wired ? "" : "config missing after on");

  if (id === "copilot") {
    // The key cannot be pre-seeded into VS Code SecretStorage. VS Code mints
    // its own `${input:chat.lm.secret.<hash>}` handle when the user enters the
    // key, so `on` writes no apiKey at all — an invented handle would not
    // resolve, and a literal key on disk would be a leak.
    const entries = JSON.parse(wired || "[]");
    const neo = Array.isArray(entries) ? entries.find((v) => v && v.name === "NeoSmith") : null;
    record("copilot: writes no apiKey — VS Code mints the SecretStorage handle",
      !!neo && !("apiKey" in neo) && (!KEY || !wired.includes(KEY)));
  }

  const off = cli([id, "off"]);
  save(`${id}.off.txt`, scrub(off.out));
  record(`${id}: off exits 0`, off.status === 0, off.status === 0 ? "" : scrub(off.out));

  const after = read(target);
  save(`${id}.after`, scrub(after));
  record(`${id}: off restores the pre-connect config byte-for-byte`, after === seed,
    after === seed ? "" : "the restored file differs from the seed");
}

// ── tier: real prompt ───────────────────────────────────────────────────────

function claudeTier() {
  const r = cli(["--env", args.env, "claude", "on", "--model", "lite"]);
  save("claude.on.txt", scrub(r.out));
  record("claude: on exits 0", r.status === 0, r.status === 0 ? "" : scrub(r.out));

  const cfg = JSON.parse(read(PATHS.claude) || "{}");
  save("claude.settings.wired.json", scrub(JSON.stringify(cfg, null, 2)));
  record("claude: settings.json points at " + args.env,
    cfg.env && cfg.env.ANTHROPIC_BASE_URL === ENV_DEF.baseUrl,
    cfg.env ? `base=${cfg.env.ANTHROPIC_BASE_URL}` : "no env block");
  record("claude: the auth token was written", !!(cfg.env && cfg.env.ANTHROPIC_AUTH_TOKEN));

  // Export NOTHING. Claude Code must pick the router up from settings.json
  // alone — proving that file is sufficient IS the test.
  const prompt = "Reply with exactly the word NEOSMITHOK and nothing else.";
  const p = PROMPTS_ARE_REAL
    ? harnessBin("claude", ["-p", prompt, "--output-format", "text"])
    : null;
  if (!p) { skipPrompt("claude"); }
  else if (save("claude.prompt.txt", scrub(p.out)), p.missing) {
    record("claude: the real binary is installed", false, "claude not on PATH — harness install failed, not a CLI bug");
  } else if (p.timedOut) {
    record("claude: the prompt completes within the timeout", false, `killed after ${CHILD_TIMEOUT_MS}ms`);
  } else {
    record("claude: a real prompt round-trips through " + args.env,
      p.status === 0 && /NEOSMITHOK/i.test(p.out),
      p.status === 0 ? "" : scrub(p.out).slice(0, 400));
  }

  const off = cli(["claude", "off"]);
  record("claude: off exits 0", off.status === 0, off.status === 0 ? "" : scrub(off.out));
  record("claude: off removes the settings written by on", read(PATHS.claude) === null);
}

function codexTier() {
  const r = cli(["--env", args.env, "codex", "on", "--model", "lite"]);
  save("codex.on.txt", scrub(r.out));
  record("codex: on exits 0", r.status === 0, r.status === 0 ? "" : scrub(r.out));

  const toml = read(PATHS.codex) || "";
  save("codex.config.wired.toml", scrub(toml));
  record("codex: base_url points at " + args.env, toml.includes(`${ENV_DEF.baseUrl}/v1`));
  record("codex: the key is referenced by name, never written",
    toml.includes('env_key = "OPENAI_API_KEY"') && (!KEY || !toml.includes(KEY)));

  // The platform-correctness assertion only a real runner can make honestly.
  // envsetup.test.js asserts this with an INJECTED platform; here the platform
  // is real.
  if (process.platform === "win32") {
    record("codex: prints setx on Windows, not a POSIX export",
      /setx OPENAI_API_KEY/.test(r.out) && !/^\s*export OPENAI_API_KEY=/m.test(r.out));
  } else {
    record("codex: prints export on POSIX, not setx",
      /export OPENAI_API_KEY=/.test(r.out) && !/setx OPENAI_API_KEY/.test(r.out));
  }

  // Negative first: with OPENAI_API_KEY unset, codex must FAIL. That proves
  // the env_key indirection is real rather than decorative.
  const without = PROMPTS_ARE_REAL
    ? harnessBin("codex", ["exec", "say ok"], { OPENAI_API_KEY: "" })
    : { missing: true };
  if (!without.missing) {
    record("codex: fails without OPENAI_API_KEY (the env_key indirection is real)",
      without.status !== 0);
  }

  // Then the positive: export the key ourselves, because `on` deliberately
  // writes only its NAME, and setx does not affect the current process.
  const prompt = "Reply with exactly the word NEOSMITHOK and nothing else.";
  const p = PROMPTS_ARE_REAL
    ? harnessBin("codex", ["exec", prompt], { OPENAI_API_KEY: KEY })
    : null;
  if (!p) { skipPrompt("codex"); }
  else if (save("codex.prompt.txt", scrub(p.out)), p.missing) {
    record("codex: the real binary is installed", false, "codex not on PATH — harness install failed, not a CLI bug");
  } else if (p.timedOut) {
    record("codex: the prompt completes within the timeout", false, `killed after ${CHILD_TIMEOUT_MS}ms`);
  } else {
    record("codex: a real prompt round-trips through " + args.env,
      p.status === 0 && /NEOSMITHOK/i.test(p.out),
      p.status === 0 ? "" : scrub(p.out).slice(0, 400));
  }

  const off = cli(["codex", "off"]);
  record("codex: off exits 0", off.status === 0, off.status === 0 ? "" : scrub(off.out));
}

// ── shared safety assertions ────────────────────────────────────────────────

function filesUnderHomeContaining(needle) {
  const hits = [];
  if (!needle) return hits;
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (p.startsWith(OUT)) continue;              // artifacts are scrubbed separately
      if (e.isDirectory()) { walk(p); continue; }
      let text = null;
      try { text = fs.readFileSync(p, "utf8"); } catch { continue; }
      if (text.includes(needle)) hits.push(p);
    }
  };
  walk(HOME);
  return hits;
}

function safetyChecks() {
  const audit = read(PATHS.audit);
  if (audit) {
    record("the key never reaches the audit log", !KEY || !audit.includes(KEY));
    const envs = audit.split("\n").filter(Boolean)
      .map((l) => { try { return JSON.parse(l).env; } catch { return undefined; } });
    // Entries legitimately span environments: `on` runs with --env, and `off`
    // runs without it (ownership matches any environment by design). What must
    // hold is that every entry names SOME environment, and that the target
    // environment appears — a null env would defeat the point of the field.
    record("every audit entry names an environment",
      envs.length > 0 && envs.every((e) => typeof e === "string" && e),
      `envs=${[...new Set(envs)].join(",")}`);
    record(`the audit log records work against ${args.env}`, envs.includes(args.env));
  }

  // After `off`, no HARNESS config may still hold the key.
  //
  // ~/.neosmith/config.json is excluded deliberately: it is the credential
  // store, `login` put the key there on purpose, and `off` disconnects a
  // harness rather than logging you out. Including it would make this assert
  // "logout happened", which is not what off promises.
  const leaks = filesUnderHomeContaining(KEY)
    .filter((p) => path.resolve(p) !== path.resolve(path.join(HOME, ".neosmith", "config.json")));
  record("after off, no harness config still contains the key", leaks.length === 0,
    leaks.length ? leaks.map((p) => path.relative(HOME, p)).join(", ") : "");

  // The restore ledger holds the user's PRIOR values, which can include their
  // own keys — it must never be uploaded or logged. Assert it is 0600 where
  // the platform has real modes.
  if (process.platform !== "win32" && fs.existsSync(PATHS.state)) {
    const mode = fs.statSync(PATHS.state).mode & 0o777;
    record("the restore ledger is 0600", mode === 0o600, `mode=${mode.toString(8)}`);
  }
}

// ── dispatch ────────────────────────────────────────────────────────────────

const CONTINUE_SEED = [
  "name: my-config",
  "version: 0.0.1",
  "schema: v1",
  "models:",
  "  - name: My Own Model",
  "    provider: openai",
  "    model: gpt-4o",
  "    apiBase: https://my-own-endpoint.example/v1",
  "    apiKey: my-own-key",
  "",
].join("\n");

const ZED_SEED = JSON.stringify({
  theme: "One Dark",
  language_models: {
    openai: {
      api_url: "http://localhost:11434/v1",
      available_models: [{ name: "llama3", max_tokens: 8192 }],
    },
  },
}, null, 2) + "\n";

// A top-level ARRAY of provider entries, with the endpoint as `url` on each
// MODEL — the shape VS Code actually reads.
const COPILOT_SEED = JSON.stringify([
  {
    name: "My Own",
    vendor: "customendpoint",
    apiType: "chat-completions",
    models: [{ id: "gpt-5-user", name: "gpt-5-user", url: "https://my-own.example/v1" }],
  },
], null, 2) + "\n";

// Cline's shared global config: a second provider plus a selection the connect
// must switch and `off` must switch back.
const CLINE_SEED = JSON.stringify({
  version: 1,
  lastUsedProvider: "ollama",
  providers: {
    ollama: { settings: { provider: "ollama", model: "llama3", baseUrl: "http://localhost:11434" } },
  },
}, null, 2) + "\n";

if (!args.json) {
  console.log(`\nNeoSmith e2e · harness=${args.harness} · env=${args.env} (${ENV_DEF.baseUrl})`);
  console.log(`  platform=${process.platform}  home=${HOME}  model=${SMOKE_MODEL}\n`);
}

const loggedIn = login();
if (loggedIn) {
  switch (args.harness) {
    case "claude":   claudeTier(); break;
    case "codex":    codexTier(); break;
    case "continue": configTier("continue", CONTINUE_SEED); break;
    case "zed":      configTier("zed", ZED_SEED); break;
    case "copilot":  configTier("copilot", COPILOT_SEED); break;
    case "cline":    configTier("cline", CLINE_SEED); break;
    case "jetbrains":
    case "cursor":   printedTier(args.harness); break;
    default:
      console.error(`unknown harness '${args.harness}'`);
      process.exit(2);
  }
  safetyChecks();
}

// ── report ──────────────────────────────────────────────────────────────────

const ok = checks.length > 0 && checks.every((c) => c.ok);
const summary = {
  harness: args.harness, env: args.env, platform: process.platform,
  home: HOME, ok, checks,
};
fs.writeFileSync(path.join(OUT, `summary.${args.harness}.json`), JSON.stringify(summary, null, 2));

if (args.json) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${ok ? "PASSED" : "FAILED"} · ${checks.length - failed.length}/${checks.length} checks · artifacts: ${OUT}\n`);
}
process.exit(ok ? 0 : 1);
