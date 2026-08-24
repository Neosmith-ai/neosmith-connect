#!/usr/bin/env node
// scripts/generate-docs.js
//
// Rewrites the manifest-driven sections of `site/README.md` and
// `site/COMPATIBILITY.md` from `harnesses.json` at the monorepo root.
//
// Marker form:
//   <!-- BEGIN manifest:<block-id> --> ... <!-- END manifest:<block-id> -->
//
// Invariants:
//   - The "AI Coding Agents" table in `site/README.md` is rebuilt from the
//     manifests's harnesses array, ordered by registryOrder.
//   - The "Agents × Endpoint" table in `site/COMPATIBILITY.md` is rebuilt.
//   - Every other block in those files is left untouched.
//
// Idempotent — running this without changes is a no-op.
// Run `node scripts/generate-docs.js --check` to exit non-zero on drift.

"use strict";

const fs = require("fs");
const path = require("path");

const MONOREPO_ROOT = path.resolve(__dirname, "..");
const MANIFEST_PATH = path.join(MONOREPO_ROOT, "packages", "cli", "harnesses.json");

const WIRE_HUMAN = {
  "anthropic-messages":    "Anthropic",
  "openai-responses":      "OpenAI Responses",
  "openai-completions":    "OpenAI",
  "openai-chat-completions": "OpenAI",
};

const ENDPOINT_HUMAN = (wire, routerBase, openaiBase) => {
  if (wire === "anthropic-messages") return "`router.neosmith.ai`";
  if (wire.startsWith("openai")) return "`router.neosmith.ai/v1`";
  return "";
};

function loadManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
}

// The docs describe the environment users get by default. Named environments
// replaced the old top-level `router` block; the generated tables are unchanged
// because ENDPOINT_HUMAN doesn't interpolate these values today.
function defaultEnv(manifest) {
  return manifest.environments[manifest.defaultEnvironment];
}

function manifestHarnessesSorted(manifest) {
  return (manifest.harnesses || [])
    .slice()
    .sort((a, b) => (a.registryOrder || 0) - (b.registryOrder || 0));
}

function replaceMarkerBlock(text, blockId, body) {
  const begin = `<!-- BEGIN manifest:${blockId} -->`;
  const end = `<!-- END manifest:${blockId} -->`;
  const startIdx = text.indexOf(begin);
  const endIdx = text.lastIndexOf(end);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(
      `Marker pair for ${blockId} not found in target. Add <!-- BEGIN manifest:${blockId} --> and <!-- END manifest:${blockId} --> surrounding the rewriteable block.`,
    );
  }
  // Detect the file's line ending and use it for the replacement, so the
  // --check mode doesn't report false drift on Windows (CRLF) vs Unix (LF).
  // The body (table rows joined with \n) is also normalized to match.
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const bodyNorm = body.replace(/\r?\n/g, eol);
  return text.slice(0, startIdx) + begin + eol + bodyNorm + eol + end + text.slice(endIdx + end.length);
}

function generateAgentsTable(manifest) {
  const rows = manifestHarnessesSorted(manifest).map((h) => {
    const fmt = WIRE_HUMAN[h.wire] || h.wire;
    const ep = ENDPOINT_HUMAN(h.wire, defaultEnv(manifest).baseUrl, defaultEnv(manifest).openaiBaseUrl);
    const docRel = (h.docPage || `agents/${h.id}.md`).replace(/^\.\//, "");
    const label = h.shortLabel || h.name;
    return `| **${label}** | [${docRel}](${docRel}) | ${fmt} | ${ep} |`;
  });
  return ["| Agent | Guide | Format | Endpoint |", "|---|---|---|---|", ...rows].join("\n");
}

function generateAgentsEndpointTable(manifest) {
  const rows = manifestHarnessesSorted(manifest).map((h) => {
    const fmt = WIRE_HUMAN[h.wire] || h.wire;
    const ep = ENDPOINT_HUMAN(h.wire, defaultEnv(manifest).baseUrl, defaultEnv(manifest).openaiBaseUrl);
    const docRel = (h.docPage || `agents/${h.id}.md`).replace(/^\.\//, "");
    const label = h.shortLabel || h.name;
    return `| **${label}** | ${fmt} | ${ep} | [${docRel}](${docRel}) |`;
  });
  return ["| Agent | Format | Endpoint | Guide |", "|---|---|---|---|", ...rows].join("\n");
}

// The Agents section index on the docs site. Hand-maintained until now, and it
// showed it: the table still listed five agents long after copilot, zed and
// cursor shipped in 0.3.0. Links are section-relative (Just-the-Docs strips the
// .md), which is why this cannot reuse generateAgentsEndpointTable.
function generateAgentsIndexTable(manifest) {
  const rows = manifestHarnessesSorted(manifest).map((h) => {
    const fmt = WIRE_HUMAN[h.wire] || h.wire;
    const ep = ENDPOINT_HUMAN(h.wire, defaultEnv(manifest).baseUrl, defaultEnv(manifest).openaiBaseUrl);
    const docRel = (h.docPage || `agents/${h.id}.md`).replace(/^\.\//, "");
    // agents/foo.md -> foo ; ides/cursor.md -> ../ides/cursor
    const slug = docRel.replace(/\.md$/, "");
    const link = slug.startsWith("agents/") ? slug.slice("agents/".length) : `../${slug}`;
    const label = h.shortLabel || h.name;
    return `| [${label}](${link}) | ${fmt} | \`${ep.replace(/`/g, "")}\` |`;
  });
  return ["| Agent | Format | Endpoint |", "|---|---|---|", ...rows].join("\n");
}

// Which harnesses speak which wire format, for the endpoints reference. The
// "Used by" lists there were written by hand and stopped at Codex.
function generateEndpointsTable(manifest) {
  const env = defaultEnv(manifest);
  const byWire = { anthropic: [], openai: [] };
  for (const h of manifestHarnessesSorted(manifest)) {
    const label = h.shortLabel || h.name;
    (h.wire === "anthropic-messages" ? byWire.anthropic : byWire.openai).push(label);
  }
  return [
    "| Endpoint | Format | Path examples | Used by |",
    "|---|---|---|---|",
    `| \`${env.baseUrl}\` | **Anthropic Messages API** | \`/v1/messages\` | ${byWire.anthropic.join(", ") || "—"} |`,
    `| \`${env.openaiBaseUrl}\` | **OpenAI API** | \`/v1/chat/completions\`, \`/v1/responses\`, \`/v1/models\` | ${byWire.openai.join(", ")} |`,
  ].join("\n");
}

// The SKU ladder. Generated because the hand-written copy in endpoints.md still
// advertised `neosmith.intelligent-lite`, which the manifest records as
// DE-LISTED — the router still routes it, but GET /v1/models does not list it
// and the real budget tier is neosmith.neolite. Publishing a de-listed SKU as a
// supported option is a bug a reader cannot detect.
function generateSkuTable(manifest) {
  const specs = manifest.modelSpecs || {};
  const rows = Object.values(manifest.claudeTierMap || {}).map((t) => {
    const spec = specs[t.model] || {};
    const ctx = spec.contextWindow ? `${spec.contextWindow / 1000000 >= 1 ? (spec.contextWindow / 1000000) + "M" : (spec.contextWindow / 1000) + "K"}` : "—";
    const isDefault = t.model === manifest.models.pro ? " (**default**)" : "";
    return `| \`${t.model}\` | ${t.name}${isDefault} | ${ctx} | ${t.description} |`;
  });
  return ["| Model SKU | Tier | Context | Behaviour |", "|---|---|---|---|", ...rows].join("\n");
}

// Targets — each: [absolute path, block id, body generator].
const TARGETS = [
  [
    path.join(MONOREPO_ROOT, "site", "README.md"),
    "agents",
    generateAgentsTable,
  ],
  [
    path.join(MONOREPO_ROOT, "site", "COMPATIBILITY.md"),
    "agents-endpoint",
    generateAgentsEndpointTable,
  ],
  [
    path.join(MONOREPO_ROOT, "site", "docs", "agents", "index.md"),
    "agents-index",
    generateAgentsIndexTable,
  ],
  [
    path.join(MONOREPO_ROOT, "site", "reference", "endpoints.md"),
    "endpoints",
    generateEndpointsTable,
  ],
  [
    path.join(MONOREPO_ROOT, "site", "reference", "endpoints.md"),
    "skus",
    generateSkuTable,
  ],
  // The Jekyll mirror is otherwise hand-maintained (see sync-docs-mirror.js),
  // but these two blocks are pure manifest projections with no links to rewrite,
  // so they are identical on both sides. Generating them here is what stops the
  // PUBLISHED site from keeping a de-listed SKU after the source page drops it —
  // which is exactly what had happened.
  [
    path.join(MONOREPO_ROOT, "site", "docs", "reference", "endpoints.md"),
    "endpoints",
    generateEndpointsTable,
  ],
  [
    path.join(MONOREPO_ROOT, "site", "docs", "reference", "endpoints.md"),
    "skus",
    generateSkuTable,
  ],
];

function processFiles({ checkOnly }) {
  const manifest = loadManifest();
  let drifting = false;
  for (const [filePath, blockId, gen] of TARGETS) {
    const before = fs.readFileSync(filePath, "utf8");
    const next = replaceMarkerBlock(before, blockId, gen(manifest));
    if (checkOnly) {
      if (next !== before) {
        console.error(`drift: ${path.relative(MONOREPO_ROOT, filePath)} (block: ${blockId})`);
        drifting = true;
      }
    } else {
      if (next !== before) {
        fs.writeFileSync(filePath, next);
        console.log(`rewrote: ${path.relative(MONOREPO_ROOT, filePath)} (block: ${blockId})`);
      } else {
        console.log(`unchanged: ${path.relative(MONOREPO_ROOT, filePath)} (block: ${blockId})`);
      }
    }
  }
  if (checkOnly && drifting) {
    process.exitCode = 1;
  }
}

function main() {
  const checkOnly = process.argv.includes("--check");
  processFiles({ checkOnly });
}

main();
