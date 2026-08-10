// scripts/contract/_mock_server.js
//
// Standalone mock router. The test spawns this process so the server and the
// CLI each have their own event loop.
//
// Two modes:
//
//   node _mock_server.js <port> <status> <json-body>
//     Legacy canned mode — one status + body for every request, whatever the
//     path. Kept because models.test.js uses it to drive specific failure
//     responses (500, unreachable).
//
//   node _mock_server.js --contract [--port 0] [--scenario ok|unauth|500|slow]
//     Contract mode — routes by (method, path) from
//     contract/router-contract.v1.json, synthesizes response bodies containing
//     exactly the keys the contract declares, and enforces the contract's auth
//     rules.
//
// Contract mode is what makes the offline suite mean anything. In canned mode
// every path returns the same 200, so a URL typo in the CLI passes silently.
// Here an undeclared path is a 404 and a missing Authorization header is a
// 401 — both of which surface as test failures.
//
// GET /__requests returns every request this process has seen as
// [{method, path, headers}], so a test can assert what the CLI actually sent
// (e.g. anthropic-version on /v1/messages) rather than only what came back.
//
// Either mode prints its base URL on stdout for the parent to read.

"use strict";

const http = require("http");
const path = require("path");
const fs = require("fs");

const argv = process.argv.slice(2);
const contractMode = argv.includes("--contract");

// ── contract mode ───────────────────────────────────────────────────────────

function flag(name, fallback) {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
}

const CONTRACT_PATH = path.resolve(__dirname, "..", "..", "contract", "router-contract.v1.json");

function loadContract() {
  return JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf8"));
}

// Build a body containing exactly the keys the contract requires, so a test
// that reads a key the contract does not declare fails here rather than in
// production.
function whoamiBody(contract, listenUrl) {
  const ep = contract.endpoints.find((e) => e.path === "/whoami");
  const cap = {};
  for (const k of ep.capRequiredKeys) {
    cap[k] = k === "enabled" ? true
      : k === "effective_cap_tokens" ? 25000000
      : k === "consumed_30d" ? 1234
      : k === "remaining" ? 24998766
      : k === "pct_used" ? 0.005
      : 0.5;
  }
  const body = {};
  for (const k of ep.responseRequiredKeys) {
    body[k] = k === "ok" ? true
      : k === "dev_slug" ? "mock-dev"
      : k === "org_id" ? "mock-org"
      : k === "team_id" ? "mock-team"
      : k === "project_id" ? "mock-project"
      : k === "tier" ? "slm"
      : k === "cap" ? cap
      : k === "router_url" ? listenUrl
      : k === "environment" ? "local"
      : null;
  }
  return body;
}

function modelsBody(contract) {
  const ep = contract.endpoints.find((e) => e.path === "/v1/models");
  return {
    object: ep.objectConst,
    data: contract.skus.catalogue.map((id) => {
      const item = {};
      for (const k of ep.itemRequiredKeys) {
        item[k] = k === "id" ? id
          : k === "object" ? ep.itemObjectConst
          : k === "created" ? 1700000000
          : k === "owned_by" ? ep.ownedByConst
          : null;
      }
      return item;
    }),
  };
}

function startContractServer() {
  const contract = loadContract();
  const scenario = flag("--scenario", "ok");
  const port = parseInt(flag("--port", "0"), 10);
  const seen = [];

  const byRoute = new Map();
  for (const ep of contract.endpoints) byRoute.set(`${ep.method} ${ep.path}`, ep);

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const route = `${req.method} ${url.pathname}`;

    // Request journal — how a test asserts what the CLI SENT.
    if (url.pathname !== "/__requests") {
      seen.push({ method: req.method, path: url.pathname, headers: { ...req.headers } });
    }

    const json = (status, body, extraHeaders) => {
      res.writeHead(status, {
        "content-type": "application/json",
        ...(extraHeaders || {}),
      });
      res.end(JSON.stringify(body));
    };

    if (route === "GET /__requests") return json(200, seen);

    const ep = byRoute.get(route);
    // An undeclared path is a 404. This is the whole point of contract mode:
    // a typo'd URL in the CLI must fail a test, not silently pass.
    if (!ep) return json(404, { error: "no such route", route });

    if (scenario === "500") return json(500, { error: "mock 500" });

    if (ep.auth === "required") {
      const authed = req.headers.authorization || req.headers["x-api-key"];
      if (!authed || scenario === "unauth") {
        return json(contract.auth.unauthenticatedStatus, { error: "missing or invalid credentials" });
      }
    }

    const listenUrl = `http://127.0.0.1:${server.address().port}`;
    const respHeaders = Object.fromEntries(
      contract.responseHeaders.map((h) => [h.toLowerCase(), "mock"]),
    );

    if (route === "GET /whoami")    return json(200, whoamiBody(contract, listenUrl));
    if (route === "GET /v1/models") return json(200, modelsBody(contract));

    if (route === "POST /v1/messages") {
      return json(200, {
        id: "msg_mock", type: "message", role: "assistant",
        model: contract.skus.cheapestForSmoke,
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      }, respHeaders);
    }
    if (route === "POST /v1/chat/completions") {
      return json(200, {
        id: "chatcmpl_mock", object: "chat.completion",
        model: contract.skus.cheapestForSmoke,
        choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      }, respHeaders);
    }
    if (route === "POST /v1/responses") {
      return json(200, {
        id: "resp_mock", object: "response", status: "completed",
        model: contract.skus.cheapestForSmoke,
        output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "ok" }] }],
      }, respHeaders);
    }
    if (route === "GET /health") return json(200, { status: "ok" });
    if (route === "GET /ready")  return json(200, { ready: true, conv_log_queue: 0 });
    if (route === "GET /me/login") {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end("<html><body>mock login</body></html>");
    }

    // Declared in the contract but not implemented here — say so loudly rather
    // than returning a misleading 200.
    return json(501, { error: `contract route ${route} is declared but not mocked` });
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`http://127.0.0.1:${server.address().port}`);
  });
}

// ── legacy canned mode ──────────────────────────────────────────────────────

function startCannedServer() {
  const port = parseInt(argv[0], 10);
  const status = parseInt(argv[1], 10);
  const body = argv[2] || "{}";

  const server = http.createServer((req, res) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(body);
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`http://127.0.0.1:${server.address().port}`);
  });
}

if (contractMode) startContractServer();
else startCannedServer();
