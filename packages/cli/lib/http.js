// HTTP helpers — zero-dep https.get / https.request for /whoami and the
// /v1/messages verify probe. Extracted from the original bin/neosmith.js.
//
// The router speaks both wire formats:
//   Anthropic: https://router.neosmith.ai/v1/messages  (x-api-key or Bearer)
//   OpenAI:    https://router.neosmith.ai/v1/...        (Bearer)
// /whoami is an unversioned GET on the bare host.

"use strict";

const https = require("https");
const http = require("http");
const { URL } = require("url");

const DEFAULT_ROUTER = process.env.NEOSMITH_BASE_URL || "https://router.neosmith.ai";

function clientFor(url) {
  return url.protocol === "http:" ? http : https;
}

function get(url, headers = {}, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = clientFor(u).get(u, { headers }, (res) => {
      let body = "";
      res.on("data", (chunk) => body += chunk);
      res.on("end", () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => { req.destroy(new Error("timeout")); });
  });
}

function post(url, headers, body, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = typeof body === "string" ? body : JSON.stringify(body);
    const opts = {
      method: "POST",
      hostname: u.hostname,
      port: u.port || (u.protocol === "http:" ? 80 : 443),
      path: u.pathname + u.search,
      headers: { ...headers, "content-length": Buffer.byteLength(payload) },
    };
    const req = clientFor(u).request(opts, (res) => {
      let respBody = "";
      res.on("data", (chunk) => respBody += chunk);
      res.on("end", () => resolve({ status: res.statusCode, body: respBody, headers: res.headers }));
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => { req.destroy(new Error("timeout")); });
    req.write(payload);
    req.end();
  });
}

// GET /whoami with the NeoSmith key. Returns parsed identity or throws.
async function whoami(routerUrl, apiKey) {
  const base = routerUrl || DEFAULT_ROUTER;
  const resp = await get(`${base}/whoami`, { Authorization: `Bearer ${apiKey}` });
  let data = {};
  try { data = JSON.parse(resp.body); } catch { data = {}; }
  return { status: resp.status, data };
}

// Verify probe against the Anthropic Messages endpoint (used by `verify` and
// after `claude on`). A 2xx means the key + router are healthy.
async function verifyMessages(routerUrl, apiKey) {
  const base = routerUrl || DEFAULT_ROUTER;
  return post(
    `${base}/v1/messages`,
    {
      Authorization: `Bearer ${apiKey}`,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    { model: "claude-sonnet-4-6", max_tokens: 1, messages: [{ role: "user", content: "." }] }
  );
}

module.exports = { DEFAULT_ROUTER, get, post, whoami, verifyMessages };
