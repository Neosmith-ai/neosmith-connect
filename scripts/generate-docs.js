#!/usr/bin/env node
// scripts/generate-docs.js
//
// Rewrites the manifest-driven sections of the developer guide under
// `site/docs/` from `harnesses.json` at the monorepo root.
//
// Marker form:
//   <!-- BEGIN manifest:<block-id> --> ... <!-- END manifest:<block-id> -->
//
// Invariants:
//   - The "AI Coding Agents" table in `site/docs/index.md` is rebuilt from
//     the manifest's harnesses array, ordered by registryOrder.
//   - The "Agents × Endpoint" table in `site/docs/compatibility.md` is rebuilt.
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
  // BLANK LINES around the markers are load-bearing, not cosmetic.
  //
  // kramdown (what GitHub Pages runs) treats an HTML block as raw until it
  // hits a blank line. `<!-- BEGIN … -->` followed immediately by a table means
  // the table is INSIDE that raw block: it is emitted verbatim and never parsed,
  // so the reader sees `| Endpoint | Format | …` as literal pipes.
  //
  // This shipped that way on all four generated pages. It went unnoticed because
  // the marker blocks previously lived only in site/README.md and
  // site/COMPATIBILITY.md, which were never built — the first time one was
  // published, it broke.
  return text.slice(0, startIdx) + begin + eol + eol + bodyNorm + eol + eol + end + text.slice(endIdx + end.length);
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

// The "Every supported harness" table on the guide's landing page. Was
// hand-written, listed eight harnesses, and told readers Cursor writes
// `cursor.models.*` to VS Code settings — which harnesses.json records as
// verified FALSE ("the string 'cursor.models.' never appears in Cursor's
// workbench bundle"). Published advice to write settings the tool ignores.
const KEY_STORAGE = {
  "literal-anthropic-token": "literal in its config (0600)",
  "literal-openai-key": "literal in its config (0600)",
  "env-key-ref": "`$OPENAI_API_KEY` — an env reference, never the key itself",
  "ui-driven": "entered in the tool's own UI",
  "ui-keychain": "OS keychain (VS Code SecretStorage)",
};

function generateHarnessTable(manifest) {
  const rows = manifestHarnessesSorted(manifest).map((h, i) => {
    const written = h.configFile
      ? (h.configFile.startsWith("vscode://")
        ? "VS Code `chatLanguageModels.json` (per profile)"
        : "`" + h.configFile + "` (0600)")
      : "*(none — configured in the tool's UI)*";
    const key = KEY_STORAGE[h.keyMode] || h.keyMode;
    return `| ${i + 1} | **${h.shortLabel || h.name}** | ${written} | ${key} |`;
  });
  return ["| # | Harness | What gets written | Where the key lives |", "|---|---|---|---|", ...rows].join("\n");
}

// Targets — each: [absolute path, block id, body generator].
//
// All of these live under site/docs/, which is the only documentation tree:
// Jekyll builds it and Pages serves it. There used to be a second copy under
// site/ that these blocks were ALSO generated into, and keeping two hand-copied
// trees in step is what put 119 lines of written documentation on the floor —
// including the whole Authentication section of the troubleshooting reference.
const TARGETS = [
  [
    path.join(MONOREPO_ROOT, "site", "docs", "index.md"),
    "harnesses",
    generateHarnessTable,
  ],
  [
    path.join(MONOREPO_ROOT, "site", "docs", "compatibility.md"),
    "agents-endpoint",
    generateAgentsEndpointTable,
  ],
  [
    path.join(MONOREPO_ROOT, "site", "docs", "agents", "index.md"),
    "agents-index",
    generateAgentsIndexTable,
  ],
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
