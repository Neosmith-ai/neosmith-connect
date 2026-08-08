// `neosmith originals [--show <harness>] [--export <dir>] [--json]`
//
// Show the user where NeoSmith is keeping copies of their pre-connect settings,
// what's in them, and how to keep a copy before `off`/`uninstall` consumes them.
//
// Nothing else in the CLI surfaced this: `status` reported on/off and the
// stored key, and the mapping from ~/.neosmith/snapshots/<id>.bak back to the
// real config file only existed in audit.log.

"use strict";

const originals = require("../originals");
const io = require("../io");
const ui = require("../ui");

function parseFlags(args) {
  const out = { show: null, export: null, json: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--show" || a === "-s") { out.show = args[++i]; continue; }
    if (a.startsWith("--show=")) { out.show = a.slice("--show=".length); continue; }
    if (a === "--export" || a === "-e") { out.export = args[++i]; continue; }
    if (a.startsWith("--export=")) { out.export = a.slice("--export=".length); continue; }
    if (a === "--json") { out.json = true; continue; }
  }
  return out;
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}

function fmtDate(d) {
  // Local, short, no year — these are always recent.
  return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function printTable(entries) {
  ui.banner("NeoSmith · your original settings");

  if (!entries.length) {
    ui.log("  No originals stored.");
    ui.log("");
    ui.log(ui.c("dim", `  NeoSmith copies a config file to ${originals.tilde(io.SNAPSHOTS_DIR)}/ before it`));
    ui.log(ui.c("dim", "  writes to it, and puts it back on `off`. Nothing is stored right now, which"));
    ui.log(ui.c("dim", "  means no harness is currently connected (or you already ran `off`)."));
    return;
  }

  ui.log(ui.c("dim", `  Stored in ${originals.tilde(io.SNAPSHOTS_DIR)}/ · restored by \`neosmith <harness> off\`.`));
  ui.log("");

  for (const e of entries) {
    if (e.tombstone) {
      ui.log(`  ${ui.c("bold", e.label)}  ${ui.c("dim", "· no file existed before connect")}`);
      ui.log(ui.c("dim", `    off    deletes ${originals.tilde(e.source) || "it"}`));
    } else {
      ui.log(`  ${ui.c("bold", e.label)}  ${ui.c("dim", `· ${fmtBytes(e.bytes)} · ${fmtDate(e.mtime)}`)}`);
      ui.log(ui.c("dim", `    from   ${originals.tilde(e.source) || "(source unknown)"}`));
      ui.log(ui.c("dim", `    kept   ${originals.tilde(e.bak)}`));
    }
    ui.log("");
  }

  const real = entries.filter((e) => !e.tombstone);
  ui.log(`  ${entries.length} stored (${real.length} with contents).`);
  if (real.length) {
    ui.log(ui.c("dim", `  Read one:  neosmith originals --show ${real[0].harnessId}`));
    ui.log(ui.c("dim", `  Keep them: neosmith originals --export ./my-settings-backup`));
  }
  ui.log("");
  ui.log(ui.c("dim", "  These copies are consumed when the config is restored. `neosmith uninstall`"));
  ui.log(ui.c("dim", "  removes them outright — export first if you want to keep a copy."));
}

async function run(args) {
  const flags = parseFlags(args);

  if (flags.json) {
    const payload = originals.list().map((e) => ({
      harness: e.harnessId,
      label: e.label,
      source: e.source,
      storedAt: e.bak,
      bytes: e.bytes,
      modified: e.mtime.toISOString(),
      tombstone: e.tombstone,
    }));
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  if (flags.show) {
    const id = flags.show.toLowerCase();
    const entry = originals.get(id);
    if (!entry) {
      const known = originals.list().map((e) => e.harnessId);
      ui.die(known.length
        ? `No original stored for '${id}'. Stored: ${known.join(", ")}.`
        : `No original stored for '${id}' — nothing is stored right now.`);
    }
    if (entry.tombstone) {
      ui.warn(`No file existed at ${originals.tilde(entry.source)} before you connected ${entry.label}.`);
      ui.log(ui.c("dim", "`off` will delete it rather than restore anything."));
      return;
    }
    // Straight to stdout, unbannered, so it can be piped or redirected.
    // This is the user's own file and may contain their own credentials — it
    // is printed here and nowhere else (never into audit.log).
    ui.log(ui.c("dim", `# ${originals.tilde(entry.source)} — as it was before \`neosmith ${originals.splitId(id).baseId} on\``));
    ui.log(ui.c("dim", `# stored at ${originals.tilde(entry.bak)}`));
    process.stdout.write(originals.read(id) || "");
    return;
  }

  if (flags.export) {
    const res = originals.exportAll(flags.export);
    if (!res.written.length) {
      ui.warn(`Nothing to export — no stored originals have contents.`);
      ui.log(ui.c("dim", `A MANIFEST.json was still written to ${res.dir}.`));
      return;
    }
    ui.banner("NeoSmith · export originals");
    for (const w of res.written) {
      ui.ok(`${w.file}  ${ui.c("dim", "← " + originals.tilde(w.from))}`);
    }
    ui.log("");
    ui.log(`  ${res.written.length} file(s) + MANIFEST.json → ${res.dir}`);
    ui.log(ui.c("dim", "  These are plain copies of your own config files — treat them as secrets"));
    ui.log(ui.c("dim", "  if the originals contained API keys."));
    return;
  }

  printTable(originals.list());
}

module.exports = { run, parseFlags };
