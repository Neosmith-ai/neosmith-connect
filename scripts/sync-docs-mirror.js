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

// Line endings are not content. See the compare below.
function eol(text) {
  return String(text).replace(/\r\n/g, "\n");
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
    // Compare EOL-normalised. Git checks these out CRLF on Windows while the
    // generated form is always LF, so a raw compare reported EVERY mirrored
    // file as drifting on a Windows checkout — 16 of them, permanently, which
    // is a signal nobody can act on and therefore nobody reads. generate-docs.js
    // already normalises for exactly this reason; this did not.
    if (eol(actual) !== eol(expected)) {
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

  // MISSING and DRIFTING are different failures and deserve different verdicts.
  //
  // A mirror that has drifted still publishes; it just publishes something
  // slightly older than site/. That is the hand-edited content this script's
  // header describes, and failing on it would mean failing forever.
  //
  // A mirror that is MISSING does not publish at all. site/docs/ is the Jekyll
  // source root — a page with no mirror is written, reviewed, merged, and then
  // silently absent from the site. That is exactly how agents/copilot.md and
  // agents/zed.md served 404s from 0.3.0 onward while every generated table
  // linked to them. So `missing` fails, always, and is never waived.
  //
  // Drift is ratcheted instead: --max-drift N fails if the count grows past a
  // committed baseline. It cannot be fixed in one go, but it cannot get worse.
  const maxDriftArg = process.argv.find((a) => a.startsWith("--max-drift="));
  const maxDrift = maxDriftArg ? parseInt(maxDriftArg.split("=")[1], 10) : Infinity;

  console.log(`\n${drifting} drifting, ${missing} missing.`);

  if (missing > 0) {
    console.error(
      `\nERROR: ${missing} source page(s) have no mirror under site/docs/.\n` +
      `  site/docs/ is what Jekyll builds and GitHub Pages serves, so a page with no\n` +
      `  mirror is written but never published — a 404 behind every link to it.\n` +
      `  Create the mirror (front matter + link-rewritten body) and commit it.`,
    );
    process.exitCode = 1;
    return;
  }

  if (drifting > maxDrift) {
    console.error(
      `\nERROR: mirror drift grew to ${drifting}, above the agreed ceiling of ${maxDrift}.\n` +
      `  Bring the new one back in sync, or raise the ceiling deliberately in\n` +
      `  .github/workflows/pages.yml if the drift is intentional hand-edited content.`,
    );
    process.exitCode = 1;
    return;
  }

  if (checkOnly && drifting > 0) {
    console.log(`(within the agreed ceiling of ${maxDrift === Infinity ? "unlimited" : maxDrift})`);
  }
}

main();
