# NeoSmith CLI installer (Windows, native PowerShell).
#
# Source URL (per the build brief Section 2, the install URL stays on raw
# GitHub until a specific trigger requires a redirect):
#   https://raw.githubusercontent.com/Neosmith-ai/cli/main/install.ps1
#
# One-liner from a fresh PowerShell session:
#   irm https://raw.githubusercontent.com/Neosmith-ai/cli/main/install.ps1 | iex
#
# Mirrors install.sh's six sections:
#   1. ensure_node_runtime    — winget install OpenJS.NodeJS.LTS or fall back
#   2. ensure_durable_source  — Invoke-WebRequest zip + Expand-Archive (no git)
#   3. ensure_dependencies    — npm install --omit=dev
#   4. install_cli_launcher   — write neosmith.cmd under %USERPROFILE%\.neosmith\bin\
#   5. add_bin_dir_to_path    — [Environment]::SetEnvironmentVariable('Path', …, 'User')
#   6. smoke test + banner
#
# Prerequisites: PowerShell 5.1+ (for Invoke-WebRequest + Expand-Archive),
# Node.js 18+ (bootstrapped via winget if missing). Does NOT require git.
# Idempotency: re-running does not duplicate PATH entries; the CLI is
# re-downloaded and replaces the prior install (the upgrade path).

$ErrorActionPreference = 'Stop'

$MinMajor = 18
$BinDir   = Join-Path $env:USERPROFILE '.neosmith\bin'
$CliDir   = Join-Path $env:USERPROFILE '.neosmith\cli'
$Launcher = Join-Path $BinDir 'neosmith.cmd'
# GitHub codeload zip — extracts to a top-level <repo>-<ref>/ directory.
# Using .zip (not .tar.gz) so Expand-Archive works on PowerShell 5.1 without
# needing the tar.exe that only ships with Windows 10+.
$Source   = 'https://codeload.github.com/Neosmith-ai/cli/zip/refs/heads/main'

# AllSigned-aware preamble. If the user's execution policy is AllSigned, ask
# them to prepend `Set-ExecutionPolicy -Scope Process Bypass`; do not change
# the policy for them. (Decision recorded.)
$policy = Get-ExecutionPolicy -Scope CurrentUser -ErrorAction SilentlyContinue
if ($policy -eq 'AllSigned') {
  Write-Host "Detected AllSigned execution policy. Re-run with this prefix:" -ForegroundColor Yellow
  Write-Host ("  Set-ExecutionPolicy -Scope Process Bypass; " +
              "irm https://raw.githubusercontent.com/Neosmith-ai/cli/main/install.ps1 | iex") -ForegroundColor Yellow
  exit 1
}

function Test-NodeVersion {
  param([int]$min)
  try {
    $v = & node -p "process.versions.node.split('.')[0]" 2>$null
    return ($v -as [int]) -ge $min
  } catch {
    return $false
  }
}

function Install-Node {
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    & winget install --id OpenJS.NodeJS.LTS -e --silent `
        --accept-package-agreements --accept-source-agreements --disable-interactivity
    if ($LASTEXITCODE -ne 0) {
      Write-Host "winget install failed (exit $LASTEXITCODE)." -ForegroundColor Red
      Write-Host "Install Node.js $MinMajor+ from https://nodejs.org/ and re-run this installer." -ForegroundColor Red
      exit 1
    }
    return
  }
  Write-Host "winget not available. Install Node.js $MinMajor+ from https://nodejs.org/ and re-run this installer." -ForegroundColor Red
  exit 1
}

function Install-CLI {
  # Download the CLI as a zip (no git prereq) and extract to ~/.neosmith/cli.
  # GitHub codeload zips extract to a top-level <repo>-<ref>/ directory; we
  # rename that to $CliDir. Re-running re-downloads and replaces (the upgrade
  # path) — we wipe first to avoid stale files from a prior version.
  $staging = Join-Path $env:USERPROFILE '.neosmith\cli-download'
  $zip     = Join-Path $staging 'cli.zip'

  Write-Host "  Downloading NeoSmith CLI…" -ForegroundColor White
  Remove-Item -Recurse -Force $staging -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $staging | Out-Null

  try {
    Invoke-WebRequest -Uri $Source -OutFile $zip -UseBasicParsing
  } catch {
    Write-Host "Download failed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Check network access to github.com and re-run." -ForegroundColor Red
    exit 1
  }

  try {
    Expand-Archive -Path $zip -DestinationPath $staging -Force
  } catch {
    Write-Host "Extract failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
  }

  # Find the single top-level directory GitHub produced (e.g. "cli-main").
  $extracted = Get-ChildItem -Path $staging -Directory | Select-Object -First 1
  if (-not $extracted) {
    Write-Host "Zip extracted but no top-level directory was found." -ForegroundColor Red
    exit 1
  }

  # Move into place (wipe any prior install first).
  if (Test-Path $CliDir) { Remove-Item -Recurse -Force $CliDir }
  Move-Item $extracted.FullName $CliDir
  Remove-Item -Recurse -Force $staging -ErrorAction SilentlyContinue

  Push-Location $CliDir
  try {
    & npm install --omit=dev --no-fund --no-audit
    if ($LASTEXITCODE -ne 0) {
      Write-Host "npm install failed (exit $LASTEXITCODE)." -ForegroundColor Red
      Pop-Location
      exit 1
    }
  } finally {
    Pop-Location
  }
}

function Install-Launcher {
  New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
  $nodeExe = (Get-Command node).Source
  $cliPath = Join-Path $CliDir 'bin\neosmith.js'
  $launcherBody = "@echo off`r`n`"$nodeExe`" `"$cliPath`" %*`r`n"
  [System.IO.File]::WriteAllText($Launcher, $launcherBody, [System.Text.Encoding]::ASCII)
}

function Add-BinDirToPath {
  $current = [Environment]::GetEnvironmentVariable('Path', 'User')
  if ($current -notlike "*$BinDir*") {
    [Environment]::SetEnvironmentVariable('Path', "$BinDir;$current", 'User')
    # Also update the current session's PATH so the user can run `neosmith`
    # without re-opening their shell.
    $env:Path = "$BinDir;$env:Path"
  }
}

if (-not (Test-NodeVersion -min $MinMajor)) {
  Write-Host "Node.js $MinMajor+ not detected." -ForegroundColor Yellow
  Install-Node
}

Install-CLI
Install-Launcher
Add-BinDirToPath

# Smoke test: the launcher runs and prints top-level help without error.
# Use Out-Null so a successful install is quiet.
try {
  & node "$CliDir\bin\neosmith.js" help | Out-Null
} catch {
  Write-Host "Smoke test failed: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "NeoSmith CLI ready. Open a new shell and run:" -ForegroundColor Green
Write-Host "  neosmith login sk-plus-yourname-xxxxxx" -ForegroundColor Green
Write-Host "  neosmith claude on" -ForegroundColor Green
Write-Host ""
Write-Host "Launcher: $Launcher" -ForegroundColor DarkGray
Write-Host "Source:   $CliDir" -ForegroundColor DarkGray
