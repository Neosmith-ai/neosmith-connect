#!/usr/bin/env node
// scripts/sync-docs-mirror.js
//
// Drift-detection script for the Jekyll "mirror" under site/docs/.
//
// The Jekyll mirror (Just-the-Docs theme) carries hand-edited content beyond
// what a manifest-driven view can reproduce without information loss:
// page-specific intro paragraphs, button markup, BSP table classes, page
// fragments that don't exist in the source-of-truth files at site/ides/ etc.
//
// The script's job in this branch is therefore NOT to auto-rewrite. It is:
//   - For each mirror file (matching site/ides, site/agents, site/platforms,
//     site/reference), compute what a freshly auto-generated mirror would
//     contain (Jekyll front matter + link-rewritten source).
//   - Compare against what's actually in site/docs/<file>.
//   - Report any drift; exit non-zero in `--check` mode.
//
// The hand-edited content in the mirror is preserved untouched; rewriting is
// the maintainer's responsibility once a per-section content-mapping pass is
// designed. This script is a safety net, not an authoring tool.
//
// Future enhancement: add a `--write` mode that emits the auto-generated
// mirror content into site/docs/<file>.next to surface what the script would
// produce; the maintainer diffs and merges content by hand.

"use strict";

const fs = require("fs");
const path = require("path");

const MONOREPO_ROOT = path.resolve(__dirname, "..");
const SITE_ROOT = path.join(MONOREPO_ROOT, "site");
const MIRROR_ROOT = path.join(SITE_ROOT, "docs");

const MIRRORED_SUBDIRS = ["ides", "agents", "platforms", "reference"];

const NAV_PARENT = {
  ides:      "IDEs",
  agents:    "Agents",
  platforms: "Platforms",
  reference: "Reference",
};

function readConfigExcludes() {
  const cfgPath = path.join(MIRROR_ROOT, "_config.yml");
  if (!fs.existsSync(cfgPath)) return new Set();
  const raw = fs.readFileSync(cfgPath, "utf8");
  const excludes = new Set();
  const m = raw.match(/exclude:\s*\n([\s\S]*?)(?=\n[a-zA-Z]|\n$)/);
  if (m) {
    for (const line of m[1].split("\n")) {
      const trimmed = line.trim().replace(/^-\s*"?/, "").replace(/"?\s*$/, "");
      if (trimmed) excludes.add(trimmed);
    }
  }
  return excludes;
}

function rewriteLinks(text) {
  text = text.replace(/\]\(([^)]+?)\.md(#[^)]*)?\)/g, "]($1$2)");
  text = text.replace(
    /\]\(\.\.\/README\.md(#[^)]*)?\)/g,
    "]({{ site.baseurl }}/$1)",
  );
  return text;
}

function frontMatter(meta) {
  return [
    "---",
    `title: ${meta.title}`,
    "layout: default",
    `parent: ${meta.parent}`,
    `nav_order: ${meta.navOrder}`,
    "---",
  ].join("\n");
}

function deriveTitle(sourceText) {
  const m = sourceText.match(/^#\s+(.+?)\s*$/m);
  if (!m) return null;
  return m[1].replace(/\s*\+\s*NeoSmith\s*$/, "").trim();
}

// Stitch: front matter + link-rewritten source body.
// This is what a freshly auto-generated mirror file would look like.
function autoMirror(sourceText, parent, navOrder) {
  const title = deriveTitle(sourceText);
  if (!title) {
    throw new Error(`source file has no H1`);
  }
  const body = rewriteLinks(sourceText).replace(/^---\n[\s\S]*?\n---\n+/m, "");
  return frontMatter({ title, parent, navOrder }) + "\n\n" + body;
}

function* walkMirroredSources() {
  for (const sub of MIRRORED_SUBDIRS) {
    const srcDir = path.join(SITE_ROOT, sub);
    if (!fs.existsSync(srcDir)) continue;
    const files = fs.readdirSync(srcDir).filter((f) => f.endsWith(".md")).sort();
    for (let idx = 0; idx < files.length; idx++) {
      const f = files[idx];
      yield {
        sub,
        f,
        srcPath: path.join(srcDir, f),
        mirrorPath: path.join(MIRROR_ROOT, sub, f),
        parent: NAV_PARENT[sub],
        navOrder: idx + 1,
      };
    }
  }
}

function main() {
  const checkOnly = process.argv.includes("--check");
  let drifting = 0;
  let missing = 0;

  for (const item of walkMirroredSources()) {
    const source = fs.readFileSync(item.srcPath, "utf8");
    const expected = (() => {
      try { return autoMirror(source, item.parent, item.navOrder); }
      catch { return null; }
    })();
    if (expected === null) {
      console.log(`skipped (no H1): ${path.relative(MONOREPO_ROOT, item.srcPath)}`);
      continue;
    }

    if (!fs.existsSync(item.mirrorPath)) {
      console.error(`missing:        ${path.relative(MONOREPO_ROOT, item.mirrorPath)}  (source: ${path.relative(MONOREPO_ROOT, item.srcPath)})`);
      missing++;
      continue;
    }

    const actual = fs.readFileSync(item.mirrorPath, "utf8");
    if (actual !== expected) {
      drifting++;
      if (checkOnly) {
        console.error(`drift:         ${path.relative(MONOREPO_ROOT, item.mirrorPath)}`);
      } else {
        console.log(`drift:         ${path.relative(MONOREPO_ROOT, item.mirrorPath)}  (read-only — fix manually)`);
      }
    } else {
      console.log(`in sync:       ${path.relative(MONOREPO_ROOT, item.mirrorPath)}`);
    }
  }

  if (checkOnly && (drifting > 0 || missing > 0)) {
    console.error(`\nDrift detected: ${drifting} drifting, ${missing} missing.`);
    process.exitCode = 1;
  }
}

main();
