// GitHub Copilot Chat (VS Code) — file-writable for model registration,
// UI-driven for the API key (VS Code stores keys via OS-keychain-backed
// SecretStorage; a script cannot pre-seed it).
//
// Config target: `chatLanguageModels.json` is owned by VS CODE ITSELF, not by
// the github.copilot-chat extension, and it lives at the PROFILE ROOT:
//   default profile   %APPDATA%\Code\User\chatLanguageModels.json
//                     ~/Library/Application Support/Code/User/chatLanguageModels.json
//                     ~/.config/Code/User/chatLanguageModels.json
//   named profile     <that User dir>/profiles/<location>/chatLanguageModels.json
//
// Before 0.9 this module wrote to globalStorage/github.copilot-chat/ — a path
// VS Code never reads — so the provider never appeared in the model picker.
// It also wrote `{"vendors":[…]}` with a provider-level `baseUrl`. The real
// format is a top-level ARRAY of provider entries, keyed `name` (not
// `displayName`), with `url` on each MODEL. Both are fixed here; `off` still
// recognizes and cleans up entries written in the old shape and old location.
//
// Profiles: VS Code keeps a separate chatLanguageModels.json per profile, so
// wiring only the default profile leaves every named profile with an empty
// model picker. `on` writes to the default profile AND to every profile in
// globalStorage/storage.json that does not inherit language models from the
// default (useDefaultFlags.languageModels).
//
// apiKey: deliberately NOT written. VS Code mints its own SecretStorage handle
// when the user enters the key in Manage Language Models; an invented
// ${input:…} name is not a handle it resolves.
//
// Verified 2026-08-10 against the installed VS Code build: given an entry with
// no apiKey field, VS Code rewrites the file and APPENDS its own —
//   "apiKey": "${input:chat.lm.secret.70e22ef4}"
// — leaving name/vendor/apiType/models/url exactly as written. The hash is
// per-provider-entry, not global: the same router URL in a second profile got
// "${input:chat.lm.secret.-b2c6430}". So a handle can never be copied between
// profiles or synthesized; omitting the field is the only correct behaviour.
//
// That handle is also an on-disk signal that the key HAS been entered, which is
// what makes the third status state observable rather than self-declared.
//
// `status()` returns THREE states (per the build brief's T9 DoD):
//   - { on: false, ... }             -> not connected
//   - { on: "models-written", ... }  -> models registered, no key handle yet
//   - { on: true, ... }              -> VS Code has stamped a SecretStorage handle
//                                       onto our entry (or the user forced it with
//                                       `neosmith copilot status --confirmed`).
//                                       We still cannot read SecretStorage itself,
//                                       so this proves a key was entered, not that
//                                       the key is valid — `neosmith doctor` is
//                                       what checks the key against the router.

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const harness = require("../harness");
const io = require("../io");
const preserve = require("../preserve");
const ui = require("../ui");

function vsCodeUserDir() {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Code", "User");
  }
  if (process.platform === "darwin") {
    return path.join(io.HOME, "Library", "Application Support", "Code", "User");
  }
  return path.join(io.HOME, ".config", "Code", "User");
}

const FILENAME = "chatLanguageModels.json";
const CONFIG = path.join(vsCodeUserDir(), FILENAME);

// Where <=0.8 wrote. Never read by VS Code; `off` cleans it up so a machine
// connected by an older CLI doesn't keep a dead file with our entry in it.
const LEGACY_CONFIG = path.join(vsCodeUserDir(), "globalStorage", "github.copilot-chat", FILENAME);

const VENDOR = "customendpoint";
const DISPLAY_NAME = "NeoSmith";

// Snapshot ids are one-per-file (io.snapshotPath keys on the id alone). The
// default profile keeps the bare `copilot` id so existing .baks, the restore
// ledger and `neosmith originals` all still resolve; named profiles get the
// compound form that lib/originals.js knows how to split.
function snapshotIdFor(profileId) {
  if (profileId === "default") return "copilot";
  return `copilot-profile-${String(profileId).replace(/[^a-z0-9_-]/gi, "-")}`;
}

// Every chatLanguageModels.json VS Code might read on this machine.
//
// A profile with useDefaultFlags.languageModels inherits the default profile's
// models, so writing the default file already covers it — listing it too would
// create a file VS Code ignores.
function profileTargets() {
  const userDir = vsCodeUserDir();
  const targets = [{
    profileId: "default",
    profileName: "Default",
    file: path.join(userDir, FILENAME),
    snapshotId: snapshotIdFor("default"),
  }];

  const storage = io.readJSON(path.join(userDir, "globalStorage", "storage.json"));
  const profiles = (storage && Array.isArray(storage.userDataProfiles)) ? storage.userDataProfiles : [];
  for (const p of profiles) {
    if (!p || !p.location) continue;
    if (p.useDefaultFlags && p.useDefaultFlags.languageModels) continue;
    const loc = String(p.location);
    targets.push({
      profileId: loc,
      profileName: p.name || loc,
      file: path.join(userDir, "profiles", loc, FILENAME),
      snapshotId: snapshotIdFor(loc),
    });
  }
  return targets;
}

// ── file shape ──────────────────────────────────────────────────────────────
// Real shape is a top-level array. `{vendors:[…]}` is only ever produced by our
// own pre-0.9 writes, and is read (never written) so `off` can undo them.
function readProviders(file) {
  const raw = io.readText(file);
  if (raw === null) return { list: [], existed: false, legacyShape: false, unparsed: false };
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { return { list: [], existed: true, legacyShape: false, unparsed: true }; }
  if (Array.isArray(parsed)) return { list: parsed, existed: true, legacyShape: false, unparsed: false };
  if (parsed && Array.isArray(parsed.vendors)) {
    return { list: parsed.vendors, existed: true, legacyShape: true, unparsed: false };
  }
  return { list: [], existed: true, legacyShape: false, unparsed: false };
}

// The endpoint a provider entry points at. `url` per model is the real format;
// provider-level baseUrl/url is the pre-0.9 shape, still read for ownership.
function providerUrl(p) {
  if (!p || typeof p !== "object") return "";
  if (p.baseUrl) return p.baseUrl;
  if (p.url) return p.url;
  const models = Array.isArray(p.models) ? p.models : [];
  const withUrl = models.find((m) => m && (m.url || m.baseUrl));
  return withUrl ? (withUrl.url || withUrl.baseUrl) : "";
}

// One entry is ours when it carries our vendor id AND points at a host declared
// by some environment. Exact host match, never a substring test.
function isNeosmithProvider(p) {
  return !!(p && p.vendor === VENDOR && harness.isNeosmithUrl(providerUrl(p)));
}

// VS Code stamps this onto a provider entry once the user has entered a key in
// Manage Language Models — it is the reference it resolves against its own
// SecretStorage. Its presence is the only evidence the CLI can see that the
// manual step is done. We never write it (see the header note).
const VSCODE_SECRET_HANDLE = /^\$\{input:chat\.lm\.secret\./;

function hasKeyHandle(p) {
  return !!(p && typeof p.apiKey === "string" && VSCODE_SECRET_HANDLE.test(p.apiKey));
}

function buildEntry(model, url) {
  return {
    name: DISPLAY_NAME,
    vendor: VENDOR,
    apiType: "chat-completions",
    models: [
      {
        id: model,
        name: model,
        // Per-model, not provider-level — this is what VS Code reads.
        url,
        toolCalling: true,
        vision: true,
        maxInputTokens: 1000000,
        maxOutputTokens: 128000,
      },
    ],
  };
}

// The restore ledger addresses object keys, but this file's root is an array.
// Wrapping the list under a synthetic `providers` key lets the shared ledger
// helpers record and replay it unchanged.
function ledgerWrap(list, existed) {
  return existed ? { providers: list } : {};
}

function on(ctx) {
  const model = ctx.model;
  const url = harness.OPENAI_BASE_URL;
  const targets = profileTargets();

  const wrote = [];
  const skipped = [];
  for (const t of targets) {
    const { list, existed, unparsed } = readProviders(t.file);
    if (unparsed) {
      ui.warn(`Existing ${t.file} was not valid JSON — backing it up as-is and starting clean.`);
    }
    if (list.some(isNeosmithProvider)) {
      skipped.push(t);
      continue;
    }

    io.snapshot(t.snapshotId, t.file);
    // Ledger the prior provider list so `off` restores it as it was rather than
    // filtering a mutated copy (issue #15).
    io.recordRestore("copilot", t.file, io.planRestore(ledgerWrap(list, existed), [["providers"]]));

    io.ensureDir(path.dirname(t.file));
    io.writeJSON(t.file, list.concat([buildEntry(model, url)]), 0o600);
    // Post-write fingerprint (issue #22): stamp the file as we left it so
    // `off` can tell a chatLanguageModels.json the user edited from one nobody
    // touched. Keyed on the per-target snapshot id so each profile gets its
    // own fingerprint, matching how the snapshot and the .bak are keyed here.
    io.recordFingerprint(t.snapshotId, t.file);
    wrote.push(t);
  }

  for (const t of skipped) {
    ui.warn(`${t.file} already has a NeoSmith provider entry (profile: ${t.profileName}).`);
  }
  if (!wrote.length) return { alreadyOn: true };

  for (const t of wrote) {
    ui.ok(`Wrote ${t.file}${t.profileId === "default" ? "" : ` (profile: ${t.profileName})`}`);
  }
  ui.log(ui.c("dim", "One remaining manual step — VS Code stores the API key via OS-keychain SecretStorage,"));
  ui.log(ui.c("dim", "which a script cannot pre-seed. In VS Code:"));
  ui.box([
    `Reload the window, then: Copilot Chat → Models → Manage Language Models`,
    `  Pick "${DISPLAY_NAME}" → when prompted, paste this key:`,
    `    ${ctx.key}`,
    `  The model entry is registered; the key prompt appears the first time`,
    `  you select the NeoSmith model in the picker.`,
  ]);
  io.setHarnessFlag("copilot", true, { model, env: (ctx && ctx.env && ctx.env.name) || harness.envName() });
  return { wrote: true, needsKeyInUI: true, profiles: wrote.map((t) => t.profileName) };
}

// Migration guard. A .bak taken by <=0.9 came from the globalStorage path, but
// snapshot id "copilot" now maps to the DEFAULT PROFILE's file. Applying it
// would delete (tombstone) or clobber (byte copy) a config it never came from.
//
// A .bak legitimately belonging to `file` is either a tombstone naming that
// exact path, or a byte copy of a real chatLanguageModels.json — which is
// always a JSON array. The pre-0.9 `{"vendors":[…]}` object is not a shape VS
// Code ever writes, so it can only have come from the old location.
function staleSnapshot(snapshotId, file) {
  const raw = io.readText(io.snapshotPath(snapshotId));
  if (raw === null) return false;
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { return false; } // unparseable → a real file's bytes; restore verbatim
  if (parsed && parsed.__tombstone) return parsed.path !== file;
  return !!(parsed && !Array.isArray(parsed) && Array.isArray(parsed.vendors));
}

// Strip our entries from a file we have no snapshot for. Returns true if the
// file was changed.
function stripNeosmith(file) {
  const { list, existed, legacyShape } = readProviders(file);
  if (!existed) return false;
  const kept = list.filter((p) => !isNeosmithProvider(p));
  if (kept.length === list.length) return false;
  io.writeJSON(file, legacyShape ? { vendors: kept } : kept, 0o600);
  return true;
}

function off(ctx) {
  const targets = profileTargets();
  let touched = 0;
  let partial = false;
  const leftAlone = [];

  for (const t of targets) {
    if (!io.fileExists(t.file) && !io.hasSnapshot(t.snapshotId)) continue;

    if (staleSnapshot(t.snapshotId, t.file)) {
      ui.warn(
        `Discarding a pre-0.9 snapshot for ${t.file} — it was taken from ` +
        `${LEGACY_CONFIG}, a path VS Code never read, so it describes a ` +
        `different file and must not be replayed onto this one.`,
      );
      io.clearSnapshot(t.snapshotId);
    } else if (io.fileExists(t.file) && io.hasSnapshot(t.snapshotId) && preserve.disposition(t.snapshotId, t.file) === "snapshot") {
      // Issue #22 contract: a snapshot restore is byte-for-byte, which throws
      // away every provider the user added while connected. Only the path
      // where the file matches what `on` wrote should take it — a drifted
      // file falls through to the merge path below.
      io.restoreSnapshot(t.snapshotId, t.file);
      preserve.finish(t.snapshotId, t.file);
      ui.ok(`Restored pre-NeoSmith ${t.file} from snapshot.`);
      touched++;
      continue;
    } else if (!io.fileExists(t.file) && io.restoreSnapshot(t.snapshotId, t.file)) {
      // The file was deleted while connected but the snapshot is a real file
      // (not a tombstone), and `off` should restore it. A real tombstone —
      // the file did not exist pre-connect — is fine too; restoreSnapshot
      // already short-circuits if there is nothing to do.
      ui.ok(`Restored pre-NeoSmith ${t.file} from snapshot.`);
      touched++;
      continue;
    }

    // No usable snapshot (or the file drifted): replay the ledger, or fall
    // back to stripping our entries.
    const { list, existed, legacyShape } = readProviders(t.file);
    const ledger = io.readRestore("copilot", t.file);
    if (ledger) {
      const wrapped = ledgerWrap(list, existed);
      io.applyRestore(wrapped, ledger);
      const restored = Array.isArray(wrapped.providers) ? wrapped.providers : [];
      io.writeJSON(t.file, legacyShape ? { vendors: restored } : restored, 0o600);
      preserve.finish(t.snapshotId, t.file);
      ui.ok(`Restored pre-NeoSmith ${t.file} from the restore ledger.`);
      touched++;
      partial = true;
      continue;
    }
    // Neither snapshot nor ledger — distinguish "we wrote this" ("no ledger"
    // means state.json got lost, but the fingerprint survives) from "a hand
    // added this". `on` skips a profile that already carries a NeoSmith entry
    // and takes no snapshot of it — without a fingerprint, we never wrote
    // this file, and stripping would destroy their work.
    if (list.some(isNeosmithProvider) && !io.readFingerprint(t.snapshotId, t.file)) {
      ui.warn(
        `Left the NeoSmith entry in ${t.file} alone — this CLI did not write it ` +
        `(no snapshot, no restore ledger, no fingerprint), so there is nothing to restore if it goes.`,
      );
      leftAlone.push(t.file);
      continue;
    }
    // ... otherwise we DID write this file (fingerprint present), there is just
    // no structural ledger to replay. Strip ours; keep everyone else's. The
    // pre-0.9 path never existed for profile-root files, so a fingerprint here
    // means a 0.9+ connect whose ledger was lost.
    if (list.some(isNeosmithProvider)) {
      const before = list;
      const after = list.filter((p) => !isNeosmithProvider(p));
      if (after.length !== before.length) {
        io.writeJSON(t.file, legacyShape ? { vendors: after } : after, 0o600);
        preserve.finish(t.snapshotId, t.file);
        ui.ok(`Removed the NeoSmith entry from ${t.file} (no restore ledger available).`);
        touched++;
        partial = true;
      }
    }
  }

  // <=0.8 wrote to a path VS Code never reads. Any NeoSmith entry there is
  // unambiguously ours — nothing else creates that file — so clean it up
  // unconditionally, and delete the husk if we were its only content. That is
  // what the pre-0.9 tombstone promised before we discarded it as stale.
  if (io.fileExists(LEGACY_CONFIG)) {
    const before = readProviders(LEGACY_CONFIG);
    if (before.list.some(isNeosmithProvider)) {
      const onlyOurs = before.list.every(isNeosmithProvider);
      if (onlyOurs) {
        // io.writeText routes to a shadow dir under NEOSMITH_DRY_RUN; a raw
        // unlink would have no such escape, so gate it explicitly rather than
        // add a new way for a dry run to destroy a real file.
        if (process.env.NEOSMITH_DRY_RUN !== "1") fs.unlinkSync(LEGACY_CONFIG);
        ui.ok(`Deleted the stale pre-0.9 file ${LEGACY_CONFIG} (VS Code never read it).`);
      } else {
        stripNeosmith(LEGACY_CONFIG);
        ui.ok(`Removed the stale pre-0.9 NeoSmith entry from ${LEGACY_CONFIG}.`);
      }
      touched++;
    }
  }

  // Clear the restore ledger and the per-profile fingerprints we recorded in
  // `on`. Each profile's snapshot id is unique (default → "copilot",
  // named → "copilot-profile-<id>") so the fingerprints are per-profile, but
  // the ledger is shared under harness id "copilot" and `clearRestore` clears
  // every file in one call.
  io.clearRestore("copilot");
  for (const t of targets) io.clearFingerprint(t.snapshotId, t.file);
  io.setHarnessFlag("copilot", false);

  // Saying "nothing to disconnect" right after naming entries we declined to
  // touch reads as a contradiction, and hides the one thing the user has to
  // act on. Entries left in place are the headline here, not an aside.
  if (leftAlone.length) {
    ui.log("");
    ui.log(`  ${leftAlone.length} NeoSmith entr${leftAlone.length === 1 ? "y is" : "ies are"} still in place and still usable by VS Code.`);
    ui.log(`  Delete ${leftAlone.length === 1 ? "it" : "them"} by hand to finish disconnecting:`);
    for (const f of leftAlone) ui.log(ui.c("dim", `    ${f}`));
    return { ok: true, partial: true, leftAlone };
  }
  if (!touched) {
    ui.log(`No NeoSmith provider entry found in any VS Code profile — nothing to disconnect.`);
    return { ok: true };
  }
  return { ok: true, partial };
}

function status(ctx) {
  const targets = profileTargets();
  const found = [];
  for (const t of targets) {
    const { list } = readProviders(t.file);
    const neo = list.find(isNeosmithProvider);
    if (neo) found.push({ target: t, url: providerUrl(neo), keyed: hasKeyHandle(neo) });
  }

  if (!found.length) {
    const stale = readProviders(LEGACY_CONFIG).list.some(isNeosmithProvider);
    return {
      on: false,
      detail: stale
        ? `no NeoSmith provider in any VS Code profile — a stale pre-0.9 entry exists at ${LEGACY_CONFIG}, which VS Code never reads (run \`neosmith copilot off\` then \`on\` to re-wire)`
        : `no NeoSmith provider registered in ${CONFIG}`,
    };
  }

  const wiredEnv = harness.envForUrl(found[0].url);
  const where = found.map((f) => f.target.profileName).join(", ");
  const missing = targets.filter((t) => !found.some((f) => f.target.profileId === t.profileId));

  const state = io.readState();
  const meta = (state.harnesses && state.harnesses.copilot) || {};
  const notYet = ` (not in: ${missing.map((t) => t.profileName).join(", ")})`;

  // The key step is done when VS Code has stamped its SecretStorage handle onto
  // our entry. `--confirmed` stays as a manual override for the case where the
  // user is on a build that stores the reference elsewhere.
  const keyed = found.filter((f) => f.keyed);
  if (keyed.length || meta.confirmed) {
    const how = keyed.length
      ? `key entered in VS Code (SecretStorage handle present in ${keyed.map((f) => f.target.profileName).join(", ")})`
      : `key entered in VS Code (per --confirmed)`;
    const unkeyed = found.filter((f) => !f.keyed).map((f) => f.target.profileName);
    return {
      on: true,
      env: wiredEnv,
      detail: `model=${meta.model || "(unset)"} · ${how} · base=${found[0].url} · profiles: ${where}` +
        (unkeyed.length && keyed.length ? ` · key still pending in: ${unkeyed.join(", ")}` : "") +
        (missing.length ? notYet : ""),
    };
  }
  return {
    on: "models-written",
    env: wiredEnv,
    detail: `models registered (base=${found[0].url}) in profiles: ${where}` +
      (missing.length ? notYet : "") +
      `; key not yet entered — reload VS Code, then Copilot Chat → Models → Manage Language Models, pick ${DISPLAY_NAME}, paste the key`,
  };
}

function help() {
  return [
    `GitHub Copilot Chat (VS Code) — OpenAI-compatible custom endpoint.`,
    `Wires VS Code's own chatLanguageModels.json, at the profile root — the`,
    `default profile plus every profile that does not inherit language models`,
    `from it. The API key cannot be pre-seeded (VS Code SecretStorage); \`on\``,
    `registers the model entry and prints the one remaining manual step.`,
    ``,
    `Examples:`,
    `  neosmith copilot on            # registers the NeoSmith model entry`,
    `  neosmith copilot on --model neosmith.intelligent-pro`,
    `  neosmith copilot off           # restores pre-connect chatLanguageModels.json`,
    `  neosmith copilot status        # off | models-written | connected`,
  ].join("\n");
}

module.exports = {
  id: "copilot",
  name: "Copilot Chat",
  writable: true,
  // The default profile's file. Named-profile files are discovered at call time
  // via profileTargets() — a single path can't represent them.
  configFile: CONFIG,
  legacyConfigFile: LEGACY_CONFIG,
  profileTargets,
  on, off, status, help,
};
