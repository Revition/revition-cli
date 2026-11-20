# Install the standalone `revition` binary on Windows (T4.1.5, REVITION-CLI-PLAN.md:3047-3068). Served ONLY as a GitHub
# Release asset of Revition/revition-cli (github.com is HSTS-preloaded) and attested by the release workflow.
#
#   Invoke-WebRequest https://github.com/Revition/revition-cli/releases/latest/download/install.ps1 -OutFile install.ps1
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
#
# The same order as install.sh: nothing is installed unless EVERY check passes; nothing downloaded is executed first.
#   1. downloads revition-win32-x64.exe, SHA256SUMS and its Sigstore bundle over TLS 1.2+ into a temporary folder;
#   2. checks the binary's sha256 against SHA256SUMS;
#   3. checks SHA256SUMS's Sigstore signature by OUR release workflow (cosign verify-blob), or, with no cosign, the
#      GitHub attestation by that workflow (gh attestation verify); with neither tool it refuses;
#   4. copies the binary to $env:REVITION_INSTALL_DIR (default %LOCALAPPDATA%\Programs\revition; no admin).
# REVITION_INSTALL_BASE replaces the download base (a mirror or a test bucket): WHERE files come from, never WHAT is
# accepted. Uninstall: Remove-Item "$env:LOCALAPPDATA\Programs\revition" -Recurse.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Repo = 'Revition/revition-cli'
$WorkflowIdentity = "^https://github.com/$Repo/\.github/workflows/release\.yml@refs/"
$OidcIssuer = 'https://token.actions.githubusercontent.com'
$Version = if ($env:REVITION_VERSION) { $env:REVITION_VERSION } else { 'latest' }
$Prefix = if ($env:REVITION_INSTALL_DIR) { $env:REVITION_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'Programs\revition' }

function Fail([string]$Message) {
  [Console]::Error.WriteLine("revition install: $Message")
  exit 1
}

if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64') { Fail "unsupported CPU $($env:PROCESSOR_ARCHITECTURE); use npm install -g @revition/cli" }
$Asset = 'revition-win32-x64.exe'

if ($env:REVITION_INSTALL_BASE) { $Base = $env:REVITION_INSTALL_BASE }
elseif ($Version -eq 'latest') { $Base = "https://github.com/$Repo/releases/latest/download" }
else { $Base = "https://github.com/$Repo/releases/download/v$Version" }
# HTTPS only, except a loopback test server.
if (-not ($Base -match '^https://' -or $Base -match '^http://(127\.0\.0\.1|localhost):')) { Fail "refusing a non-HTTPS download base: $Base" }

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13
$Tmp = Join-Path ([IO.Path]::GetTempPath()) ("revition-install-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Tmp | Out-Null
try {
  foreach ($f in @($Asset, 'SHA256SUMS', 'SHA256SUMS.sigstore.json')) {
    try { Invoke-WebRequest -UseBasicParsing -Uri "$Base/$f" -OutFile (Join-Path $Tmp $f) }
    catch { Fail "could not download $f from $Base" }
  }

  # 2. the sha256 of what was downloaded.
  $Expected = $null
  foreach ($line in Get-Content (Join-Path $Tmp 'SHA256SUMS')) {
    $parts = $line -split '\s+'
    if ($parts.Length -ge 2 -and $parts[1] -eq $Asset) { $Expected = $parts[0].ToLowerInvariant() }
  }
  if (-not $Expected) { Fail "SHA256SUMS lists no $Asset" }
  $Actual = (Get-FileHash -Algorithm SHA256 (Join-Path $Tmp $Asset)).Hash.ToLowerInvariant()
  if ($Actual -ne $Expected) { Fail "sha256 mismatch for $Asset (expected $Expected, got $Actual): refused, nothing installed" }

  # 3. the signature of SHA256SUMS, by our release workflow.
  $Sums = Join-Path $Tmp 'SHA256SUMS'
  if (Get-Command cosign -ErrorAction SilentlyContinue) {
    & cosign verify-blob --bundle (Join-Path $Tmp 'SHA256SUMS.sigstore.json') --certificate-identity-regexp $WorkflowIdentity --certificate-oidc-issuer $OidcIssuer $Sums *> $null
    if ($LASTEXITCODE -ne 0) { Fail 'the Sigstore signature of SHA256SUMS does not verify: refused, nothing installed' }
  }
  elseif (Get-Command gh -ErrorAction SilentlyContinue) {
    & gh attestation verify $Sums --repo $Repo --signer-workflow "$Repo/.github/workflows/release.yml" *> $null
    if ($LASTEXITCODE -ne 0) { Fail 'the GitHub attestation of SHA256SUMS does not verify: refused, nothing installed' }
  }
  else {
    Fail 'cannot verify the signature: install cosign (https://docs.sigstore.dev) or the GitHub CLI (gh), then run this again; nothing installed'
  }

  # 4. install (the user's own prefix; no admin).
  New-Item -ItemType Directory -Force -Path $Prefix | Out-Null
  Copy-Item -Force (Join-Path $Tmp $Asset) (Join-Path $Prefix 'revition.exe')
  Write-Output "Installed revition ($Asset, sha256 $Actual) to $Prefix\revition.exe"
  if (-not (($env:PATH -split ';') -contains $Prefix)) { Write-Output "Add $Prefix to your PATH to run ``revition``." }
}
finally {
  Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
}
