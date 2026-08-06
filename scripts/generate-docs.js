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
  return text.slice(0, startIdx) + begin + "\n" + body + "\n" + end + text.slice(endIdx + end.length);
}

function generateAgentsTable(manifest) {
  const rows = manifestHarnessesSorted(manifest).map((h) => {
    const fmt = WIRE_HUMAN[h.wire] || h.wire;
    const ep = ENDPOINT_HUMAN(h.wire, manifest.router.baseUrl, manifest.router.openaiBaseUrl);
    const docRel = (h.docPage || `agents/${h.id}.md`).replace(/^\.\//, "");
    const label = h.shortLabel || h.name;
    return `| **${label}** | [${docRel}](${docRel}) | ${fmt} | ${ep} |`;
  });
  return ["| Agent | Guide | Format | Endpoint |", "|---|---|---|---|", ...rows].join("\n");
}

function generateAgentsEndpointTable(manifest) {
  const rows = manifestHarnessesSorted(manifest).map((h) => {
    const fmt = WIRE_HUMAN[h.wire] || h.wire;
    const ep = ENDPOINT_HUMAN(h.wire, manifest.router.baseUrl, manifest.router.openaiBaseUrl);
    const docRel = (h.docPage || `agents/${h.id}.md`).replace(/^\.\//, "");
    const label = h.shortLabel || h.name;
    return `| **${label}** | ${fmt} | ${ep} | [${docRel}](${docRel}) |`;
  });
  return ["| Agent | Format | Endpoint | Guide |", "|---|---|---|---|", ...rows].join("\n");
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
