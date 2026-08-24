#!/usr/bin/env node
// scripts/check-published-docs.js
//
// Fetch the PUBLISHED developer guide and assert that every harness the
// manifest declares actually has a page there.
//
// Why a live check when three earlier gates already look at docs:
//
//   generate-docs.js --check   the manifest-driven TABLES match the manifest
//   docs-sync.test.js          every docPage exists under site/
//   sync-docs-mirror.js        every source page has a mirror under site/docs/
//
// All three inspect the repository. None of them proves the page came out the
// other end. agents/copilot.md and agents/zed.md were declared in the manifest
// from 0.3.0, linked from every generated table, and served 404 on the live site
// for months — and would have kept doing so, because nothing ever asked the site
// itself. This asks the site itself.
//
//   node scripts/check-published-docs.js
//   node scripts/check-published-docs.js --base https://example.github.io/repo
//
// Exit 0 if every page resolves, 1 otherwise. A redirect counts as resolved:
// Jekyll's `permalink: pretty` serves /agents/zed as a 301 to /agents/zed/.

"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const { URL } = require("url");

const MONOREPO_ROOT = path.resolve(__dirname, "..");
const MANIFEST_PATH = path.join(MONOREPO_ROOT, "packages", "cli", "harnesses.json");
const DEFAULT_BASE = "https://neosmith-ai.github.io/neosmith-connect";

function baseUrl() {
  const i = process.argv.indexOf("--base");
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1].replace(/\/+$/, "");
  const inline = process.argv.find((a) => a.startsWith("--base="));
  if (inline) return inline.slice("--base=".length).replace(/\/+$/, "");
  return (process.env.DOCS_BASE_URL || DEFAULT_BASE).replace(/\/+$/, "");
}

function head(url, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const client = u.protocol === "http:" ? http : https;
    // GET, not HEAD: GitHub Pages answers HEAD inconsistently behind its CDN.
    const req = client.get(u, { headers: { "user-agent": "neosmith-docs-check" } }, (res) => {
      res.resume();
      resolve({ status: res.statusCode, location: res.headers.location || null });
    });
    req.on("error", (e) => resolve({ status: 0, error: e.message }));
    req.setTimeout(timeoutMs, () => req.destroy(new Error("timeout")));
  });
}

// site/<docPage> mirrors to site/docs/<docPage>, and Jekyll's pretty permalinks
// drop the .md: agents/zed.md -> <base>/agents/zed
function pageUrl(base, docPage) {
  return `${base}/${docPage.replace(/^\.\//, "").replace(/\.md$/, "")}`;
}

async function main() {
  const base = baseUrl();
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const targets = [
    { what: "the guide index", url: `${base}/` },
    ...(manifest.harnesses || []).map((h) => ({
      what: h.shortLabel || h.name,
      url: pageUrl(base, h.docPage || `agents/${h.id}.md`),
    })),
  ];

  console.log(`Checking ${targets.length} pages at ${base}\n`);
  const failed = [];
  for (const t of targets) {
    const res = await head(t.url);
    const ok = res.status >= 200 && res.status < 400;
    console.log(`  ${String(res.status || "ERR").padEnd(4)} ${t.what.padEnd(16)} ${t.url}`);
    if (!ok) failed.push({ ...t, ...res });
  }

  if (!failed.length) {
    console.log(`\nAll ${targets.length} pages are live.`);
    return;
  }

  console.error(`\nERROR: ${failed.length} of ${targets.length} pages are not reachable:`);
  for (const f of failed) {
    console.error(`  ${f.status || "ERR"}  ${f.what} — ${f.url}${f.error ? ` (${f.error})` : ""}`);
  }
  console.error(
    `\n  Every generated table links to these, so each one is a dead link on the\n` +
    `  live site. Usual cause: the page exists under site/ but has no mirror under\n` +
    `  site/docs/, which is the directory Jekyll actually builds.`,
  );
  process.exitCode = 1;
}

main();
