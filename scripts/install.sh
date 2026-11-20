#!/bin/sh
# Install the standalone `revition` binary (T4.1.5, REVITION-CLI-PLAN.md:3047-3068). Served ONLY as a GitHub Release
# asset of Revition/revition-cli (github.com is HSTS-preloaded) and attested by the release workflow.
#
#   curl --proto '=https' --tlsv1.2 -fsSL https://github.com/Revition/revition-cli/releases/latest/download/install.sh | sh
#
# What it does, in order (nothing is installed unless EVERY check passes; nothing downloaded is ever executed first):
#   1. downloads the binary for this OS/arch, SHA256SUMS and its Sigstore bundle, over TLS, into a temporary folder;
#   2. checks the binary's sha256 against SHA256SUMS;
#   3. checks SHA256SUMS's Sigstore signature, whose signer must be OUR release workflow (cosign verify-blob), or, with no
#      cosign, the GitHub attestation of SHA256SUMS by that workflow (gh attestation verify); with neither tool it
#      refuses (it never installs unverified);
#   4. copies the binary to $REVITION_INSTALL_DIR (default ~/.local/bin; no sudo).
# Settings: REVITION_VERSION (default latest), REVITION_INSTALL_DIR. REVITION_INSTALL_BASE replaces the download base
# (a mirror or a test bucket); it changes WHERE files come from, never WHAT is accepted: both checks still apply.
# Uninstall: rm "$REVITION_INSTALL_DIR/revition" (and the unpacked cache, ~/.cache/revition/sea or
# ~/Library/Caches/revition/sea).
set -eu

REPO="Revition/revition-cli"
WORKFLOW_IDENTITY="^https://github.com/${REPO}/\.github/workflows/release\.yml@refs/"
OIDC_ISSUER="https://token.actions.githubusercontent.com"
VERSION="${REVITION_VERSION:-latest}"
PREFIX="${REVITION_INSTALL_DIR:-$HOME/.local/bin}"

fail() { printf 'revition install: %s\n' "$1" >&2; exit 1; }

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) fail "unsupported OS $(uname -s); use npm install -g @revition/cli" ;;
esac
case "$(uname -m)" in
  arm64 | aarch64) arch=arm64 ;;
  x86_64 | amd64) arch=x64 ;;
  *) fail "unsupported CPU $(uname -m); use npm install -g @revition/cli" ;;
esac
asset="revition-${os}-${arch}"

if [ -n "${REVITION_INSTALL_BASE:-}" ]; then
  base="$REVITION_INSTALL_BASE"
elif [ "$VERSION" = latest ]; then
  base="https://github.com/${REPO}/releases/latest/download"
else
  base="https://github.com/${REPO}/releases/download/v${VERSION}"
fi
# HTTPS only, except a loopback test server.
case "$base" in
  https://*) proto='=https' ;;
  http://127.0.0.1:* | http://localhost:*) proto='=http,https' ;;
  *) fail "refusing a non-HTTPS download base: $base" ;;
esac

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT INT TERM
for f in "$asset" SHA256SUMS SHA256SUMS.sigstore.json; do
  curl --proto "$proto" --tlsv1.2 -fsSL -o "$tmp/$f" "$base/$f" || fail "could not download $f from $base"
done

# 2. the sha256 of what was downloaded.
expected="$(awk -v a="$asset" '$2 == a { print $1 }' "$tmp/SHA256SUMS")"
[ -n "$expected" ] || fail "SHA256SUMS lists no $asset"
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$tmp/$asset" | awk '{ print $1 }')"
else
  actual="$(shasum -a 256 "$tmp/$asset" | awk '{ print $1 }')"
fi
[ "$actual" = "$expected" ] || fail "sha256 mismatch for $asset (expected $expected, got $actual): refused, nothing installed"

# 3. the signature of SHA256SUMS, by our release workflow.
if command -v cosign >/dev/null 2>&1; then
  cosign verify-blob --bundle "$tmp/SHA256SUMS.sigstore.json" \
    --certificate-identity-regexp "$WORKFLOW_IDENTITY" --certificate-oidc-issuer "$OIDC_ISSUER" \
    "$tmp/SHA256SUMS" >/dev/null 2>&1 || fail "the Sigstore signature of SHA256SUMS does not verify: refused, nothing installed"
elif command -v gh >/dev/null 2>&1; then
  gh attestation verify "$tmp/SHA256SUMS" --repo "$REPO" --signer-workflow "${REPO}/.github/workflows/release.yml" \
    >/dev/null 2>&1 || fail "the GitHub attestation of SHA256SUMS does not verify: refused, nothing installed"
else
  fail "cannot verify the signature: install cosign (https://docs.sigstore.dev) or the GitHub CLI (gh), then run this again; nothing installed"
fi

# 4. install (the user's own prefix; no sudo).
mkdir -p "$PREFIX"
cp "$tmp/$asset" "$PREFIX/revition.tmp.$$"
chmod 0755 "$PREFIX/revition.tmp.$$"
mv -f "$PREFIX/revition.tmp.$$" "$PREFIX/revition"
printf 'Installed revition (%s, sha256 %s) to %s/revition\n' "$asset" "$actual" "$PREFIX"
case ":$PATH:" in
  *":$PREFIX:"*) ;;
  *) printf 'Add %s to your PATH to run `revition`.\n' "$PREFIX" ;;
esac
