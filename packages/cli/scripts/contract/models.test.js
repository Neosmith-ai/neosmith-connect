// scripts/contract/models.test.js
//
// Contract test for `neosmith models`.
//
//   1. The router's GET /v1/models response is an OpenAI-compatible list
//      { object: "list", data: [{ id, name?, modelName?, description? }] }.
//   2. The CLI prints the id, modelName, and description of every model.
//   3. The default model is highlighted (tagged with "← default").
//   4. If the router is unreachable or returns a non-200, the CLI falls back to
//      the local manifest.

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const { sandboxForFixture } = require("./_sandbox");

const CLI = path.resolve(__dirname, "..", "..", "bin", "neosmith.js");
const MOCK_SERVER = path.resolve(__dirname, "_mock_server.js");

function writeKey(home, apiKey) {
  const dir = path.join(home, ".neosmith");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ api_key: apiKey }, null, 2));
}

function spawnMock(status, body) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [MOCK_SERVER, "0", String(status), JSON.stringify(body)], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    let url = null;
    child.stdout.on("data", (chunk) => {
      if (url) return;
      const line = chunk.toString().trim();
      if (line.startsWith("http://")) {
        url = line;
        resolve({ url, child });
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (!url) reject(new Error(`mock server exited early with code ${code}`));
    });
  });
}

function runCli(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

function cleanup(child) {
  if (child && !child.killed) child.kill();
}

function modelsResponse(models) {
  return { object: "list", data: models };
}

test("models command prints router-provided model list with default tag", async () => {
  const { url, child } = await spawnMock(200, modelsResponse([
    { id: "neosmith.intelligent-pro", modelName: "NeoSmith Intelligent · Pro", description: "Opus fallback" },
    { id: "neosmith.intelligent-basic", modelName: "NeoSmith Intelligent · Basic" },
    { id: "neosmith.intelligent-lite", description: "SLM-only" },
  ]));
  const { home, env } = sandboxForFixture({
    apiKey: "sk-test-aaaaaaaa",
    extraEnv: { NEOSMITH_BASE_URL: url },
  });
  writeKey(home, "sk-test-aaaaaaaa");
  try {
    const result = await runCli(["models"], env);
    assert.equal(result.status, 0, `CLI should exit 0. stderr: ${result.stderr}`);
    const stdout = result.stdout;
    assert.ok(stdout.includes("Available models (3):"), "must show router list header");
    assert.ok(stdout.includes("neosmith.intelligent-pro"), "must print pro id");
    assert.ok(stdout.includes("NeoSmith Intelligent · Pro"), "must print pro modelName");
    assert.ok(stdout.includes("Opus fallback"), "must print pro description");
    assert.ok(stdout.includes("neosmith.intelligent-basic"), "must print basic id");
    assert.ok(stdout.includes("NeoSmith Intelligent · Basic"), "must print basic modelName");
    assert.ok(stdout.includes("neosmith.intelligent-lite"), "must print lite id");
    assert.ok(stdout.includes("SLM-only"), "must print lite description");
    assert.ok(stdout.includes("← default"), "must mark the default model");
  } finally {
    cleanup(child);
  }
});

test("models command falls back to local manifest when router returns 500", async () => {
  const { url, child } = await spawnMock(500, { error: "boom" });
  const { home, env } = sandboxForFixture({
    apiKey: "sk-test-aaaaaaaa",
    extraEnv: { NEOSMITH_BASE_URL: url },
  });
  writeKey(home, "sk-test-aaaaaaaa");
  try {
    const result = await runCli(["models"], env);
    assert.equal(result.status, 0, `CLI should exit 0 even on router 500. stderr: ${result.stderr}`);
    const stdout = result.stdout;
    assert.ok(stdout.includes("Local manifest defaults"), "must show fallback header");
    assert.ok(stdout.includes("neosmith.intelligent-pro"), "fallback must include pro id");
    assert.ok(stdout.includes("← default"), "fallback must mark the default model");
  } finally {
    cleanup(child);
  }
});

test("models command falls back to local manifest when router is unreachable", async () => {
  const { home, env } = sandboxForFixture({
    apiKey: "sk-test-aaaaaaaa",
    extraEnv: { NEOSMITH_BASE_URL: "http://127.0.0.1:1" },
  });
  writeKey(home, "sk-test-aaaaaaaa");
  const result = await runCli(["models"], env);
  assert.equal(result.status, 0, `CLI should exit 0 on unreachable router. stderr: ${result.stderr}`);
  const stdout = result.stdout;
  assert.ok(stdout.includes("Local manifest defaults"), "must show fallback header");
  assert.ok(stdout.includes("neosmith.intelligent-pro"), "fallback must include pro id");
});
