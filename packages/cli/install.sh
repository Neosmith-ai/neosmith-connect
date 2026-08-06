#!/usr/bin/env bash
# NeoSmith CLI installer — curl-pipe-bash, fireconnect-style.
#
#   sh -c "$(curl -fsSL https://raw.githubusercontent.com/Neosmith-ai/cli/main/install.sh)"
#
# Or from a local checkout:
#   bash install.sh
#
# Downloads the CLI tarball to ~/.neosmith/cli, installs the launcher into
# ~/.local/bin, and adds it to your shell PATH. Requires Node.js 18+ and
# `tar` (built into macOS, Linux, and Windows 10+). Does NOT require git.
# Does NOT sign you in or touch harness settings — that's `neosmith login`
# + `neosmith <harness> on`.
set -euo pipefail

# ── defaults ─────────────────────────────────────────────────────────────
# Tarball URL (GitHub codeload). Override with NEOSMITH_SOURCE to point at a
# fork or a specific ref — must be a .tar.gz that extracts to a top-level
# directory (GitHub's codeload tarballs do this as <repo>-<ref>/).
DEFAULT_SOURCE="https://codeload.github.com/Neosmith-ai/cli/tar.gz/refs/heads/main"
SOURCE="${NEOSMITH_SOURCE:-${DEFAULT_SOURCE}}"
MIN_NODE_MAJOR=18
INSTALL_NOTES=()
CLAUDE_SETTINGS_RESTORED=0   # placeholder for parity with future upgrade flow

# Resolve the CLI path. Under curl|bash, BASH_SOURCE[0] is unset, so we clone.
if [[ -n "${BASH_SOURCE[0]:-}" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  CLI="${SCRIPT_DIR}/bin/neosmith.js"
else
  SCRIPT_DIR=""
  CLI=""
fi

# ── helpers ──────────────────────────────────────────────────────────────
red()   { printf '\033[31m%s\033[0m\n' "$1" >&2; }
green() { printf '\033[32m%s\033[0m\n' "$1"; }
dim()   { printf '\033[2m%s\033[0m\n' "$1"; }
step()  { printf '  \033[1m%s\033[0m\n' "$1"; }
ok()    { printf '  \033[32m✓\033[0m %s\n' "$1"; }
install_note() { INSTALL_NOTES+=("$1"); }

node_major_version() {
  node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo "0"
}
node_meets_minimum() {
  local major
  major="$(node_major_version)"
  [[ "${major}" =~ ^[0-9]+$ ]] && (( major >= MIN_NODE_MAJOR ))
}

# ── 1. ensure node ───────────────────────────────────────────────────────
ensure_node_runtime() {
  # Windows (Git Bash / MSYS / Cygwin): node may be installed but not on the
  # PATH that bash sees. Probe C:\Program Files\nodejs before giving up.
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
      if ! command -v node >/dev/null 2>&1; then
        local pf
        pf="$(cygpath -u "$PROGRAMFILES" 2>/dev/null || echo "/c/Program Files")"
        for cand in "$pf/nodejs" "/c/Program Files/nodejs"; do
          if [[ -x "$cand/node.exe" ]]; then export PATH="$cand:$PATH"; break; fi
        done
      fi
      ;;
  esac

  if command -v node >/dev/null 2>&1 && node_meets_minimum; then
    return 0
  fi

  # Node missing or too old. Help the user get it.
  if [[ "$(uname -s)" == "Darwin" ]] && command -v brew >/dev/null 2>&1; then
    if [[ -r /dev/tty ]]; then
      read -r -p "Install Node.js with Homebrew now? [y/N] " install_node </dev/tty
    else
      install_node=""
    fi
    if [[ "${install_node}" =~ ^[Yy]$ ]]; then
      step "Installing Node.js with Homebrew…"
      brew install node
    else
      red "Node.js ${MIN_NODE_MAJOR}+ is required. Install with: brew install node"
      exit 1
    fi
    return 0
  fi

  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
      red "Node.js ${MIN_NODE_MAJOR}+ is required. Install from https://nodejs.org/ and re-run this installer."
      ;;
    *)
      red "Node.js ${MIN_NODE_MAJOR}+ is required. Install via:"
      echo "  - nvm:        https://github.com/nvm-sh/nvm" >&2
      echo "  - NodeSource: curl -fsSL https://deb.nodesource.com/setup_${MIN_NODE_MAJOR}.x | sudo -E bash -" >&2
      echo "  - or:         https://nodejs.org/" >&2
      ;;
  esac
  exit 1
}

# ── 2. durable source ────────────────────────────────────────────────────
# Download the CLI as a tarball (no git prereq) and extract to ~/.neosmith/cli.
# GitHub codeload tarballs extract to a top-level <repo>-<ref>/ directory; we
# rename that to the install_dir. Re-running is a re-download (idempotent
# upgrade) — we wipe first to avoid stale files from a prior version.
ensure_durable_source() {
  local install_dir="${HOME}/.neosmith/cli"
  local staging_dir="${HOME}/.neosmith/cli-download"
  if [[ -n "${CLI}" && -f "${CLI}" ]]; then
    # Running from a local checkout — use it in place.
    return 0
  fi

  step "Downloading NeoSmith CLI…"
  rm -rf "${staging_dir}"
  mkdir -p "${staging_dir}"
  local tarball="${staging_dir}/cli.tar.gz"
  if ! curl -fsSL "${SOURCE}" -o "${tarball}"; then
    red "Failed to download ${SOURCE}. Check network access and re-run."
    exit 1
  fi
  # Extract; GitHub tarballs contain a single top-level dir like "cli-main".
  if ! tar -xzf "${tarball}" -C "${staging_dir}"; then
    red "Failed to extract tarball. \`tar\` is required (built into macOS, Linux, Win10+)."
    exit 1
  fi
  local extracted
  extracted="$(find "${staging_dir}" -mindepth 1 -maxdepth 1 -type d | head -1)"
  if [[ -z "${extracted}" ]]; then
    red "Tarball extracted but no top-level directory was found."
    exit 1
  fi
  # Move the extracted dir into place (wipe any prior install first).
  rm -rf "${install_dir}"
  mv "${extracted}" "${install_dir}"
  rm -rf "${staging_dir}"
  CLI="${install_dir}/bin/neosmith.js"
}

# ── 3. dependencies ──────────────────────────────────────────────────────
ensure_dependencies() {
  local setup_dir
  setup_dir="$(dirname "${CLI}")"   # .../cli/bin  →  .../cli
  setup_dir="$(dirname "${setup_dir}")"
  local npm_loglevel=error
  if [[ "${NEOSMITH_INSTALL_VERBOSE:-}" == "1" ]]; then npm_loglevel=notice; fi
  step "Installing dependencies…"
  if ! (cd "${setup_dir}" && npm install --omit=dev --no-fund --no-audit --loglevel="${npm_loglevel}"); then
    red "Failed to install NeoSmith CLI dependencies."
    exit 1
  fi
}

# ── 4. launcher ──────────────────────────────────────────────────────────
install_cli_launcher() {
  local bin_dir="${HOME}/.local/bin"
  mkdir -p "${bin_dir}"
  local launcher_path="${bin_dir}/neosmith"
  local node_bin
  node_bin="$(command -v node)"

  cat > "${launcher_path}" <<EOF
#!/usr/bin/env bash
# NeoSmith launcher. Uses the Node binary discovered at install time, falling
# back to PATH lookup, so the launcher works without \`node\` on PATH.
NODE_BIN="\${NEOSMITH_NODE_BIN:-${node_bin}}"
[ -x "\$NODE_BIN" ] || NODE_BIN="\$(command -v node 2>/dev/null)"
if [ -z "\$NODE_BIN" ] || ! [ -x "\$NODE_BIN" ]; then
  echo "neosmith: Node.js was not found. Install Node and re-run the NeoSmith installer." >&2
  exit 1
fi
exec "\$NODE_BIN" "${CLI}" "\$@"
EOF
  chmod +x "${launcher_path}"
  ok "Installed launcher → ${launcher_path}"

  # Windows .cmd shim (Git Bash / MSYS / Cygwin), so `neosmith` works in cmd/PS.
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
      if command -v cygpath >/dev/null 2>&1; then
        local cmd_path="${bin_dir}/neosmith.cmd"
        local node_win cli_win
        node_win="$(cygpath -w "${node_bin}")"
        cli_win="$(cygpath -w "${CLI}")"
        cat > "${cmd_path}" <<EOF
@echo off
"${node_win}" "${cli_win}" %*
EOF
        ok "Installed Windows launcher → ${cmd_path}"
        install_note "Wrote a Windows launcher shim at ${cmd_path}."
      fi
      ;;
  esac
}

# ── 5. PATH ──────────────────────────────────────────────────────────────
add_bin_dir_to_path() {
  local bin_dir="${HOME}/.local/bin"
  local path_entry="export PATH=\"${bin_dir}:\$PATH\""
  local shell_config=""
  if [[ -n "${ZSH_VERSION:-}" || "${SHELL:-}" == *"zsh" ]]; then
    shell_config="${HOME}/.zshrc"
  elif [[ -n "${BASH_VERSION:-}" || "${SHELL:-}" == *"bash" ]]; then
    if [[ "$(uname -s)" == "Darwin" ]]; then
      shell_config="${HOME}/.bash_profile"
    else
      shell_config="${HOME}/.bashrc"
    fi
  fi
  if [[ -n "${shell_config}" ]]; then
    touch "${shell_config}"
    if ! grep -qxF "${path_entry}" "${shell_config}" 2>/dev/null; then
      printf '\n%s\n' "${path_entry}" >> "${shell_config}"
      install_note "Added ${bin_dir} to PATH in ${shell_config} (open a new terminal if \`neosmith\` is not found)."
    fi
  else
    install_note "Could not detect your shell rc file. Add ${bin_dir} to your PATH manually."
  fi
}

# ── 6. finalize + banner ─────────────────────────────────────────────────
print_install_notes() {
  if [[ ${#INSTALL_NOTES[@]} -gt 0 ]]; then
    echo ""
    dim "Notes:"
    for n in "${INSTALL_NOTES[@]}"; do
      printf '  • %s\n' "$n"
    done
  fi
}

main() {
  printf '\n  \033[1mNeoSmith CLI installer\033[0m\n\n'

  ensure_node_runtime
  ensure_durable_source
  ensure_dependencies
  install_cli_launcher
  add_bin_dir_to_path

  # Smoke test the installed CLI.
  if node "${CLI}" help >/dev/null 2>&1; then
    ok "NeoSmith CLI ready"
  else
    red "Install finished but \`neosmith help\` failed. Run it manually to diagnose."
  fi

  echo ""
  green "  Next steps:"
  echo "    1. neosmith login            # paste your sk-plus-* / sk-std-* / sk-slm-* key"
  echo "    2. neosmith claude on        # wire Claude Code (or: codex, continue, cline, jetbrains)"
  echo "    3. neosmith claude status    # confirm it's connected"
  echo ""
  dim "  No key yet? Email contact-us@neosmith.ai for a trial."
  echo ""

  print_install_notes
  echo ""
}

main "$@"
