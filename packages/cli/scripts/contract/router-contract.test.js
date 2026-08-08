// scripts/contract/router-contract.test.js
//
// The CLI half of the contract with router-v4. The router half —
// "this repo serves what the contract promises" — is
// router_v4/tests/test_cli_contract.py.
//
// What this proves:
//   1. The vendored contract ships in the published package and parses.
//   2. The CLI calls nothing the contract does not declare.
//   3. harnesses.json and the contract agree about environments and wires,
//      so Part 1 (--env) and Part 2 (the contract) cannot drift apart.
//   4. Against a contract-driven fake router, the real binary's verify /
//      models / doctor paths work AND send the headers the contract requires.
//
// (4) is the part the old single-canned-response mock could not do: it
// answered every path identically, so a typo'd URL in the CLI passed.

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const { sandboxForFixture } = require("./_sandbox");

const PKG = path.resolve(__dirname, "..", "..");
const CLI = path.join(PKG, "bin", "neosmith.js");
const MOCK = path.join(__dirname, "_mock_server.js");
const CONTRACT_PATH = path.join(PKG, "contract", "router-contract.v1.json");

const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf8"));
const manifest = require("../../lib/manifest").read().manifest;
const KEY = "sk-slm-contracttest000";

// ── 1 · the file ships and is well-formed ───────────────────────────────────

test("the contract ships inside the published package", () => {
  const pkg = require("../../package.json");
  assert.ok(
    pkg.files.includes("contract/"),
    "contract/ must be in the files allowlist or it is missing from the npm tarball",
  );
  assert.ok(fs.existsSync(CONTRACT_PATH), "contract/router-contract.v1.json exists");
  assert.match(contract.contractVersion, /^1\./, "this copy pins v1");
});

test("the contract declares the sections both repos test against", () => {
  for (const key of ["environments", "auth", "endpoints", "optionalRequestHeaders",
                     "responseHeaders", "skus", "wireByHarness"]) {
    assert.ok(contract[key], `contract is missing ${key}`);
  }
});

// ── 2 · the CLI stays inside the contract ───────────────────────────────────

test("every router path the CLI calls is declared in the contract", () => {
  // Scan the SOURCE for router paths rather than trusting a hand-kept list —
  // that is what catches "someone added a call to an undeclared endpoint".
  const sources = ["lib/http.js", "lib/commands/doctor.js", "lib/commands/verify.js"]
    .map((f) => fs.readFileSync(path.join(PKG, f), "utf8"))
    .join("\n");

  const declared = new Set(contract.endpoints.map((e) => e.path));
  const used = new Set();
  for (const m of sources.matchAll(/\$\{base\}(\/[A-Za-z0-9/_-]+)/g)) used.add(m[1]);
  for (const m of sources.matchAll(/\$\{routerUrl\}(\/[A-Za-z0-9/_-]+)/g)) used.add(m[1]);

  assert.ok(used.size > 0, "the scan found no router paths at all — the regex has drifted");
  const undeclared = [...used].filter((p) => !declared.has(p));
  assert.deepEqual(undeclared, [], `CLI calls undeclared endpoints: ${undeclared.join(", ")}`);
});

test("every harness wire maps to a declared contract endpoint", () => {
  const declared = new Set(contract.endpoints.map((e) => e.path));
  for (const h of manifest.harnesses) {
    if (!h.wire) continue;
    const mapped = contract.wireByHarness[h.wire];
    assert.ok(mapped, `contract.wireByHarness has no entry for wire '${h.wire}' (harness ${h.id})`);
    assert.ok(declared.has(mapped), `wire '${h.wire}' maps to undeclared endpoint ${mapped}`);
  }
});

// This is the assertion that makes the --env work and the contract structurally
// unable to drift apart: both files describe the same environments, and both
// are checked in both directions.
test("contract environments and harnesses.json environments are identical", () => {
  assert.deepEqual(
    Object.keys(contract.environments).sort(),
    Object.keys(manifest.environments).sort(),
    "the two files disagree about which environments exist",
  );
  for (const [name, c] of Object.entries(contract.environments)) {
    const m = manifest.environments[name];
    assert.equal(m.baseUrl, c.baseUrl, `${name}.baseUrl`);
    assert.equal(m.openaiBaseUrl, c.openaiBaseUrl, `${name}.openaiBaseUrl`);
    assert.deepEqual(m.hosts, c.hosts, `${name}.hosts`);
  }
});

test("the CLI honors the router-is-authority key policy", () => {
  assert.equal(
    contract.auth.clientMustNotGateOnPrefix, true,
    "the CLI passes any byte string through; key-shape.test.js pins the behavior",
  );
  // Cross-check that the prefixes the contract lists are the ones the audit
  // redactor covers — a key shape we accept but do not redact would leak.
  const io = require("../../lib/io");
  for (const prefix of contract.auth.keyPrefixes) {
    assert.ok(
      io.AUDIT_KEY_PREFIX.test(prefix + "AAAAAAAAAA"),
      `audit redaction does not cover the '${prefix}' key shape`,
    );
  }
});

test("the model ladder only references SKUs the router can route", () => {
  // The CLI writes these into harness configs. A SKU the router cannot route
  // at all becomes a 400 on the user's first real prompt — which no other
  // offline test would catch.
  const routable = new Set([...contract.skus.catalogue, ...(contract.skus.deprecated || [])]);
  const referenced = new Set(Object.values(manifest.models));
  for (const t of Object.values(manifest.claudeTierMap || {})) referenced.add(t.model);

  const unroutable = [...referenced].filter((m) => !routable.has(m));
  assert.deepEqual(
    unroutable, [],
    `harnesses.json references SKUs the router cannot route: ${unroutable.join(", ")}`,
  );
});

test("the model ladder does not offer SKUs `neosmith models` will not show", () => {
  // Deprecated SKUs still route, so this is not an outage — but a user who
  // runs `neosmith models`, sees four SKUs, then picks a fifth from `--model`
  // has been handed an inconsistency. Surfaces the drift at the moment the
  // router de-lists something, rather than in a support ticket.
  const deprecated = new Set(contract.skus.deprecated || []);
  const offered = { ...manifest.models };
  const stale = Object.entries(offered).filter(([, sku]) => deprecated.has(sku));
  assert.deepEqual(
    stale.map(([tier, sku]) => `${tier} → ${sku}`), [],
    "harnesses.json offers de-listed SKUs. Repoint them at a listed SKU " +
    `(${contract.skus.catalogue.join(", ")}) or ask the router to re-list.`,
  );
});

// ── 3 · the real binary against a contract-driven fake ──────────────────────

function startMock(scenario, port) {
  return new Promise((resolve, reject) => {
    const args = [MOCK, "--contract", "--port", String(port == null ? 0 : port)];
    if (scenario) args.push("--scenario", scenario);
    const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "inherit"] });
    let url = null;
    child.stdout.on("data", (chunk) => {
      if (url) return;
      const line = chunk.toString().trim();
      if (line.startsWith("http://")) { url = line; resolve({ url, child }); }
    });
    child.on("error", reject);
    child.on("close", (code) => { if (!url) reject(new Error(`mock exited early (${code})`)); });
  });
}

// Pass an existing `home` to run a second command against the same sandbox —
// `doctor` only probes harnesses that a prior `on` left connected, so a fresh
// HOME per call would make that assertion vacuous.
function runCli(args, url, existingHome) {
  const home = existingHome || sandboxForFixture({}).home;
  fs.mkdirSync(path.join(home, ".neosmith"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".neosmith", "config.json"),
    JSON.stringify({ keys: { local: KEY, prod: KEY } }),
  );
  const env = {
    ...process.env,
    HOME: home, USERPROFILE: home, APPDATA: home,
    NEOSMITH_BASE_URL: url,
  };
  delete env.NEOSMITH_ENV;
  const r = spawnSync(process.execPath, [CLI, ...args], { env, encoding: "utf8" });
  return { status: r.status, out: (r.stdout || "") + (r.stderr || ""), home };
}

async function requests(url) {
  const res = await fetch(`${url}/__requests`);
  return res.json();
}

test("verify hits /whoami with a Bearer token and exits 0", async () => {
  const { url, child } = await startMock();
  try {
    const r = runCli(["verify"], url);
    assert.equal(r.status, 0, r.out);

    const seen = await requests(url);
    const whoami = seen.find((q) => q.path === "/whoami");
    assert.ok(whoami, `the CLI never called /whoami. Saw: ${seen.map((s) => s.path).join(", ")}`);
    assert.equal(whoami.method, "GET");
    assert.match(whoami.headers.authorization || "", /^Bearer /,
      "the contract's auth scheme is bearer");
  } finally { child.kill(); }
});

test("models hits /v1/models and prints the contract catalogue", async () => {
  const { url, child } = await startMock();
  try {
    const r = runCli(["models"], url);
    assert.equal(r.status, 0, r.out);
    for (const sku of contract.skus.catalogue) {
      assert.ok(r.out.includes(sku), `models output is missing ${sku}`);
    }
  } finally { child.kill(); }
});

test("the Messages probe sends every header the contract requires", async () => {
  // Pins lib/http.js's header set against the contract's
  // requiredRequestHeaders — the router rejects a Messages call without
  // anthropic-version, and nothing else in the suite would notice if it were
  // dropped.
  //
  // Driven in-process rather than through `doctor`: doctor only probes a
  // harness it considers connected, and `envForUrl` correctly refuses to
  // recognize the mock's ephemeral port as the `local` environment (which is
  // declared as 127.0.0.1:4008). Calling http.verifyMessages directly tests
  // the same code path without depending on a fixed port.
  const { url, child } = await startMock();
  try {
    const http = require("../../lib/http");
    const resp = await http.verifyMessages(url, KEY);
    assert.equal(resp.status, 200, `mock rejected the probe: ${resp.body}`);

    const seen = await requests(url);
    const msg = seen.find((q) => q.path === "/v1/messages");
    assert.ok(msg, `no /v1/messages request reached the mock. Saw: ${seen.map((s) => s.path).join(", ")}`);

    const ep = contract.endpoints.find((e) => e.path === "/v1/messages");
    for (const h of ep.requiredRequestHeaders) {
      assert.ok(msg.headers[h], `/v1/messages was sent without the required '${h}' header`);
    }
    assert.match(msg.headers.authorization || "", /^Bearer /);
  } finally { child.kill(); }
});

test("doctor probes each connected harness at its declared wire endpoint", async () => {
  // The mock binds `local`'s declared port so the wiring is recognized as a
  // real environment — an ephemeral port is deliberately NOT `local`.
  let mock;
  try {
    mock = await startMock(null, 4008);
  } catch {
    // Port busy (another test run, a real local router). Skip rather than
    // flake: the header invariant above is already covered.
    return;
  }
  try {
    const on = runCli(["--env", "local", "claude", "on"], mock.url);
    assert.equal(on.status, 0, on.out);
    runCli(["--env", "local", "doctor", "--harness", "claude"], mock.url, on.home);

    const seen = await requests(mock.url);
    const wire = contract.wireByHarness["anthropic-messages"];
    assert.ok(
      seen.some((q) => q.path === wire),
      `doctor never probed ${wire}. Saw: ${seen.map((s) => s.path).join(", ")}`,
    );
  } finally { mock.child.kill(); }
});

test("an undeclared path 404s, so a URL typo cannot pass silently", async () => {
  const { url, child } = await startMock();
  try {
    const res = await fetch(`${url}/v1/nonexistent`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, "no such route");
  } finally { child.kill(); }
});

test("the fake enforces the contract's auth rule on every required endpoint", async () => {
  const { url, child } = await startMock();
  try {
    for (const ep of contract.endpoints.filter((e) => e.auth === "required")) {
      const res = await fetch(`${url}${ep.path}`, {
        method: ep.method,
        ...(ep.method === "POST" ? { body: "{}", headers: { "content-type": "application/json" } } : {}),
      });
      assert.equal(res.status, ep.unauthStatus, `${ep.method} ${ep.path} without auth`);
    }
  } finally { child.kill(); }
});

test("models falls back to the local manifest when the router 500s", async () => {
  const { url, child } = await startMock("500");
  try {
    const r = runCli(["models"], url);
    assert.equal(r.status, 0, `a router 500 must not fail the command: ${r.out}`);
  } finally { child.kill(); }
});
