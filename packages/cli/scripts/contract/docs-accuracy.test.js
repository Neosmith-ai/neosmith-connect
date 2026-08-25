// scripts/contract/docs-accuracy.test.js
//
// The developer guide is meant to be a MANUAL SUBSTITUTE for the CLI: read the
// page, do it by hand, get the same result. That only holds if the page agrees
// with the module that does it.
//
// It kept not agreeing. Found by hand so far: the landing page told readers
// Cursor writes `cursor.models.*` (harnesses.json records that as verified
// FALSE); the reference page advertised `neosmith.intelligent-lite`, which is
// de-listed; Zed's page would have documented `max_tokens: 8192` as the context
// window. Each was wrong for months because nothing compared prose to code.
//
// So these tests read the ACTUAL configuration each harness module writes —
// into a sandbox HOME, via the real `on` path — and assert the page documents
// the same thing. Nothing here is hand-transcribed; if a module changes what it
// writes, the test fails until the page catches up.

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { withSandbox } = require("./_sandbox");

const ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const DOCS = path.join(ROOT, "site", "docs");
const KEY = "sk-plus-docsaudit-aaaaaaaa";

const HARNESS_MODULES = ["claude", "cline", "codex", "continue", "copilot", "cursor",
  "jetbrains", "zed", "opencode", "openclaw", "junie"];

function loadAll() {
  delete require.cache[require.resolve("../../lib/io")];
  delete require.cache[require.resolve("../../lib/harness")];
  for (const id of HARNESS_MODULES) {
    delete require.cache[require.resolve(`../../lib/harnesses/${id}`)];
  }
  return { io: require("../../lib/io"), harness: require("../../lib/harness") };
}

function docFor(entry) {
  const rel = (entry.docPage || `harnesses/${entry.id}.md`).replace(/^\.\//, "");
  const p = path.join(DOCS, rel);
  return fs.existsSync(p) ? { rel, text: fs.readFileSync(p, "utf8") } : null;
}

// Everything `on` wrote, as one blob, so a page can be checked against the real
// bytes rather than against anyone's recollection of them.
function writtenBy(io, mod, model) {
  mod.on({ key: KEY, model });
  const files = [];
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) { if (!p.includes(".neosmith")) walk(p); }
      else files.push(p);
    }
  };
  walk(io.HOME);
  return files.filter((f) => !f.includes(".neosmith"))
    .map((f) => ({ path: f, body: fs.readFileSync(f, "utf8") }));
}

// Does the page mention this exact URL?
//
// NOT `text.includes(url)`. CodeQL flags that as
// js/incomplete-url-substring-sanitization, and it is right to: a substring test
// for "https://router.neosmith.ai" also matches
// "https://router.neosmith.ai.attacker.example". The CLI itself refuses to make
// that mistake — lib/env.js parses the URL and compares HOSTS precisely, with a
// comment about this exact attack — so a test asserting the docs are correct
// should not model it more loosely than the code does.
//
// Anchored on a trailing boundary, so the /v1 suffix still matches but a longer
// host does not.
function mentionsUrl(text, url) {
  const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escaped + "(?![\\w.-])").test(text);
}

// ── the endpoint each page tells you to use ─────────────────────────────────

test("docs: every harness page states the endpoint its module actually writes", () => withSandbox(() => {
  const { harness } = loadAll();
  const openai = "https://router.neosmith.ai/v1";
  const anthropic = "https://router.neosmith.ai";

  for (const entry of harness.manifest().harnesses) {
    const doc = docFor(entry);
    assert.ok(doc, `${entry.id}: no doc page`);
    if (entry.wire === "anthropic-messages") {
      assert.ok(mentionsUrl(doc.text, anthropic),
        `${doc.rel}: Claude Code takes the BARE host (it appends /v1/messages itself); the page must show ${anthropic}`);
    } else {
      assert.ok(mentionsUrl(doc.text, openai),
        `${doc.rel}: an OpenAI-format client needs the /v1 suffix; the page must show ${openai}`);
    }
  }
}));

// ── the file each page tells you to edit ────────────────────────────────────

test("docs: every writable harness page names the file its module writes", () => withSandbox(() => {
  const { harness } = loadAll();
  for (const entry of harness.manifest().harnesses) {
    if (!entry.writable || !entry.configFile) continue;
    const doc = docFor(entry);
    // The manifest path is the ~/… form; a page may show a per-OS variant, so
    // match on the distinctive tail rather than the whole string.
    const tail = entry.configFile.split("/").slice(-2).join("/");
    assert.ok(doc.text.includes(tail),
      `${doc.rel}: does not mention "${tail}". Someone following this page by hand would edit the wrong file.`);
  }
}));

// ── claims the code contradicts ─────────────────────────────────────────────

test("docs: no page repeats a claim the code records as false", () => {
  const FALSEHOODS = [
    ["cursor.models.", "Cursor ignores these keys — harnesses.json records the string as absent from its workbench bundle"],
    ["neosmith.intelligent-lite", "de-listed SKU; the budget tier is neosmith.neolite"],
    ["max_tokens: 8192", "8192 was the bug: max_tokens is Zed's CONTEXT WINDOW, not an output cap"],
  ];
  const walk = (d, out = []) => {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) walk(p, out);
      else if (f.endsWith(".md")) out.push(p);
    }
    return out;
  };
  for (const file of walk(DOCS)) {
    const text = fs.readFileSync(file, "utf8");
    // Line-scoped, and a line that CALLS IT OUT as de-listed/deprecated is fine —
    // the point is that no page OFFERS it as a working option. A blunt
    // file-wide match would forbid explaining the trap, which is the one thing
    // a reader who has already hit it needs.
    text.split(/\r?\n/).forEach((line, i) => {
      // A line that WARNS about the value is exactly what a reader who has already
      // hit it needs; only a line OFFERING it as a working setting is a bug.
      if (/de-?listed|deprecated|used to|before 0\.|older|was the bug|instead of|ignor|cannot|silently|not supported|never/i.test(line)) return;
      for (const [needle, why] of FALSEHOODS) {
        assert.ok(!line.includes(needle),
          `${path.relative(ROOT, file)}:${i + 1} offers "${needle}" — ${why}`);
      }
    });
  }
});

// ── every SKU a module registers must be findable on its page ───────────────

test("docs: a page for a harness that registers every SKU says so", () => {
  const lite = require("../../lib/harness").MODELS.lite;
  // One sandbox PER harness. Sharing one lets an earlier harness's files land in
  // the next one's blob — codex looked like it registered the whole ladder
  // because continue's config.yaml was still sitting in the same HOME.
  for (const entry of require("../../lib/harness").manifest().harnesses) {
    if (!entry.writable) continue;
    withSandbox(() => {
      const { io, harness } = loadAll();
      const mod = harness.get(entry.id);
      const blob = writtenBy(io, mod, harness.resolveModel("pro")).map((w) => w.body).join("\n");
      if (!blob.includes(lite)) return; // this module does not register the ladder

      const doc = docFor(entry);
      assert.ok(doc.text.includes(lite) || doc.text.includes("512K") || doc.text.includes("512000"),
        `${doc.rel}: \`${entry.id} on\` registers ${lite} with a 512K window, but the page never ` +
        `mentions it — a reader configuring by hand would omit the budget tier entirely`);
    });
  }
});

// ── the env vars a module tells you to set ──────────────────────────────────

test("docs: codex's page names both env vars the CLI tells you to export", () => withSandbox(() => {
  const { harness } = loadAll();
  const entry = harness.manifest().harnesses.find((h) => h.id === "codex");
  const doc = docFor(entry);
  // codex.js writes env_key = "OPENAI_API_KEY" and prints setx/export lines for
  // both OPENAI_API_KEY and OPENAI_BASE_URL. A page that names only one leaves
  // the reader with a config that points nowhere.
  for (const v of ["OPENAI_API_KEY", "OPENAI_BASE_URL"]) {
    assert.ok(doc.text.includes(v), `${doc.rel}: must name ${v}`);
  }
}));

test("docs: Windows sections use setx, not a POSIX export", () => {
  // envsetup.js is explicit about why: a POSIX `export` in ~/.bashrc is invisible
  // to PowerShell, cmd, and anything launched from the Start menu — including
  // VS Code. So a WINDOWS section that shows only `export` is actively wrong.
  //
  // Scoped to the section, not the file. A file-wide check flagged index.md for
  // an `export` that lives in its **macOS** GUI-apps section, where it is right.
  const walk = (d, out = []) => {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) walk(p, out);
      else if (f.endsWith(".md")) out.push(p);
    }
    return out;
  };

  for (const file of walk(DOCS)) {
    const rel = path.relative(ROOT, file);
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    let inWindows = false, depth = 0, sawExport = false, sawSetx = false, heading = "";

    const verdict = () => {
      if (inWindows && sawExport && !sawSetx) {
        assert.fail(`${rel} — section "${heading}" gives Windows instructions with a POSIX ` +
          `\`export\` and no \`setx\`. An rc-file export never reaches PowerShell, cmd, or a ` +
          `GUI-launched editor, so the reader follows it and nothing works.`);
      }
    };

    for (const line of lines) {
      const h = line.match(/^(#{2,4})\s+(.*)$/);
      if (h) {
        verdict();
        const level = h[1].length;
        if (inWindows && level <= depth) inWindows = false;
        if (/windows/i.test(h[2]) && !/wsl/i.test(h[2])) {
          inWindows = true; depth = level; heading = h[2]; sawExport = false; sawSetx = false;
        }
        continue;
      }
      if (!inWindows) continue;
      if (/setx/.test(line)) sawSetx = true;
      if (/^\s*export\s+[A-Z_]+=/.test(line)) sawExport = true;
    }
    verdict();
  }
});
