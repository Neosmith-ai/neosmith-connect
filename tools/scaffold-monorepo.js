// tools/scaffold-monorepo.js
//
// Phase-0 scaffolder for the new neosmith-connect monorepo. Copies the file
// trees of the two source repos (cli and developer-guide) into the monorepo
// layout defined in the build brief (Section 4 + Section M of the plan), then
// `git init`s the destination and creates the feature branch.
//
//   node tools/scaffold-monorepo.js \
//     --cli    ../cli \
//     --site   ../neosmith-developer-guide \
//     --out    ../neosmith-connect \
//     --branch feature/neosmith-dev-setup
//
// Skips:
//   - any path whose basename is exactly ".git"   (no nested git data)
//   - node_modules/                                (re-installed downstream)
//   - the source repo's own SCAFFOLD_SOURCES.json (don't recurse)
//
// Idempotency: re-running will refuse if the destination is already a git repo
// or already contains `packages/` or `site/`. Delete the directory first to
// retry.

"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const EXCLUDE_BASENAMES = new Set([".git", "node_modules", "SCAFFOLD_SOURCES.json"]);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    const v = argv[i + 1];
    if (!k || !k.startsWith("--") || v === undefined) {
      throw new Error(`Bad argv near ${k}; expected --key value pairs`);
    }
    out[k.slice(2)] = v;
  }
  for (const k of ["cli", "site", "out", "branch"]) {
    if (!out[k]) throw new Error(`Missing --${k}`);
  }
  return out;
}

function fail(msg) {
  console.error(`scaffold: ${msg}`);
  process.exitCode = 1;
}

function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const e of entries) {
    if (EXCLUDE_BASENAMES.has(e.name)) continue;
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    const stat = fs.statSync(s);
    if (stat.isDirectory()) {
      copyTree(s, d);
    } else if (stat.isFile()) {
      fs.copyFileSync(s, d);
    } else {
      // sockets / FIFOs / etc. — skip.
    }
  }
}

function gitHead(repo) {
  return execSync(`git -C "${repo}" rev-parse HEAD`, { encoding: "utf8" }).trim();
}

function main() {
  const argv = parseArgs(process.argv.slice(2));
  const out = path.resolve(argv.out);
  const cli = path.resolve(argv.cli);
  const site = path.resolve(argv.site);

  if (!fs.existsSync(cli) || !fs.statSync(cli).isDirectory()) {
    fail(`--cli path not found or not a directory: ${cli}`);
    return;
  }
  if (!fs.existsSync(site) || !fs.statSync(site).isDirectory()) {
    fail(`--site path not found or not a directory: ${site}`);
    return;
  }
  if (fs.existsSync(path.join(out, ".git"))) {
    fail(`${out} is already a git repository; refusing to overwrite. Delete and retry.`);
    return;
  }
  if (fs.existsSync(path.join(out, "packages")) || fs.existsSync(path.join(out, "site"))) {
    fail(`${out} already contains packages/ or site/; refusing to overwrite. Delete and retry.`);
    return;
  }

  console.log(`scaffold: copying cli from ${cli}`);
  copyTree(cli, path.join(out, "packages", "cli"));
  console.log(`scaffold: copying site from ${site}`);
  copyTree(site, path.join(out, "site"));

  // Issue templates from developer-guide land at the monorepo root.
  const tplRoot = path.join(site, ".github", "ISSUE_TEMPLATE");
  if (fs.existsSync(tplRoot)) {
    copyTree(tplRoot, path.join(out, ".github", "ISSUE_TEMPLATE"));
    console.log(`scaffold: copied .github/ISSUE_TEMPLATE/`);
  }

  // Stamp snapshot commits so the initial commit message can cite them.
  fs.writeFileSync(
    path.join(out, "SCAFFOLD_SOURCES.json"),
    JSON.stringify(
      {
        cli: { path: cli, sha: gitHead(cli) },
        site: { path: site, sha: gitHead(site) },
        scaffoldedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`scaffold: wrote SCAFFOLD_SOURCES.json`);

  // Empty harnesses.json schema (router + models block) — filled by T1.
  fs.writeFileSync(
    path.join(out, "harnesses.json"),
    JSON.stringify(
      {
        defaultEnvironment: "prod",
        environments: {
          prod: {
            label: "production",
            baseUrl: "https://router.neosmith.ai",
            openaiBaseUrl: "https://router.neosmith.ai/v1",
            portalUrl: "https://router.neosmith.ai/me/login",
            hosts: ["router.neosmith.ai"],
          },
        },
        models: {
          pro: "neosmith.intelligent-pro",
          basic: "neosmith.intelligent-basic",
          lite: "neosmith.intelligent-lite",
        },
        harnesses: [],
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`scaffold: wrote empty harnesses.json schema`);

  // `git init` and create the feature branch as the active branch.
  // The plan: `init -b main` then `checkout -b feature/...`. This leaves `main`
  // at an empty initial state and `feature/neosmith-dev-setup` as the branch
  // that holds the scaffold commit.
  try {
    execSync(`git -C "${out}" init -q -b main`);
    execSync(`git -C "${out}" checkout -q -b ${argv.branch}`);
    execSync(`git -C "${out}" add -A`);
    const sources = JSON.parse(
      fs.readFileSync(path.join(out, "SCAFFOLD_SOURCES.json"), "utf8"),
    );
    const msg = [
      "scaffold: copy cli and developer-guide without history",
      "",
      `cli source:    ${sources.cli.path} @ ${sources.cli.sha}`,
      `site source:   ${sources.site.path} @ ${sources.site.sha}`,
      `scaffolded at: ${sources.scaffoldedAt}`,
      "",
      "History was intentionally not preserved per the build brief.",
      "Upstream PRs will re-import changes back into the cli and",
      "developer-guide repos after this monorepo stabilizes.",
    ].join("\n");
    execSync(`git -C "${out}" commit -q -F -`, { input: msg });
  } catch (e) {
    fail(`git init failed: ${e.message}`);
    return;
  }

  console.log(`scaffold: complete — branch ${argv.branch} created at ${out}`);
}

main();
