// How the user reached this CLI, and therefore how to tell them to run it again.
//
// `npx @neosmithai/cli setup` runs a copy from npm's throwaway cache
// (<cache>/_npx/<hash>/node_modules/@neosmithai/cli) and installs nothing on
// PATH. Hints like "Run `neosmith claude on`" then send the user straight into
// `'neosmith' is not recognized` — so under npx, hints name the npx form and
// setup ends by saying how to get a real `neosmith` command.
//
// npx prefers an installed copy when one exists (project or PATH), so a path
// under `_npx/` means there is no installed one to point at.

"use strict";

const PKG = "@neosmithai/cli";
const INSTALL_CMD = `npm install -g ${PKG}`;

// __dirname, not argv[1] — same reason as uninstall.npmInstallRoot: on Windows
// argv[1] can be the .cmd shim rather than the script.
function viaNpx(fromDir) {
  const dir = String(fromDir || __dirname).replace(/\\/g, "/").toLowerCase();
  return dir.includes("/_npx/");
}

// The command line to show for a subcommand: `neosmith claude on`, or
// `npx @neosmithai/cli claude on` when there is no `neosmith` to run.
function cmd(rest, fromDir) {
  const base = viaNpx(fromDir) ? `npx ${PKG}` : "neosmith";
  return rest ? `${base} ${rest}` : base;
}

module.exports = { viaNpx, cmd, INSTALL_CMD, PKG };
