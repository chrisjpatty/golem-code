#!/bin/sh
# Summon installer — downloads the latest release binary for your platform.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/chrisjpatty/golem-code/main/install.sh | sh

set -e

REPO="chrisjpatty/golem-code"
INSTALL_DIR="${SUMMON_INSTALL_DIR:-/usr/local/bin}"
BINARY_NAME="summon"

# ── Detect platform ──────────────────────────────────────────────

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin) PLATFORM="darwin" ;;
  *)
    echo "Error: Summon currently only supports macOS."
    echo "See https://github.com/${REPO} for more info."
    exit 1
    ;;
esac

case "$ARCH" in
  arm64|aarch64) ARCH_SUFFIX="arm64" ;;
  x86_64)        ARCH_SUFFIX="x64" ;;
  *)
    echo "Error: Unsupported architecture: ${ARCH}"
    exit 1
    ;;
esac

ASSET_NAME="summon-${PLATFORM}-${ARCH_SUFFIX}"

# ── Fetch latest release ─────────────────────────────────────────

# Use GitHub's predictable redirect URL (no JSON parsing needed)
DOWNLOAD_URL="https://github.com/${REPO}/releases/latest/download/${ASSET_NAME}"

# Get version from the redirect for display
VERSION="$(curl -fsSIo /dev/null -w '%{redirect_url}' "https://github.com/${REPO}/releases/latest" | grep -o '[^/]*$')"
echo "Installing summon ${VERSION} (${PLATFORM}/${ARCH_SUFFIX})..."

# ── Download and install ─────────────────────────────────────────

TMPFILE="$(mktemp)"
trap 'rm -f "$TMPFILE"' EXIT

curl -fsSL "$DOWNLOAD_URL" -o "$TMPFILE"
chmod +x "$TMPFILE"

# Ensure install directory exists
if [ ! -d "$INSTALL_DIR" ]; then
  echo "Creating ${INSTALL_DIR}..."
  mkdir -p "$INSTALL_DIR" 2>/dev/null || sudo mkdir -p "$INSTALL_DIR"
fi

# Move binary into place
if [ -w "$INSTALL_DIR" ]; then
  mv "$TMPFILE" "${INSTALL_DIR}/${BINARY_NAME}"
else
  echo "Need sudo to install to ${INSTALL_DIR}..."
  sudo mv "$TMPFILE" "${INSTALL_DIR}/${BINARY_NAME}"
fi

echo ""
echo "Summon ${VERSION} installed to ${INSTALL_DIR}/${BINARY_NAME}"
echo ""
echo "Next steps:"
echo "  1. Install the Claude Code plugin:"
echo "     Open Claude Code and run:"
echo "       /plugin marketplace add ${REPO}"
echo "       /plugin install golem-code"
echo ""
echo "  2. Start using Summon:"
echo "       summon"
echo ""
