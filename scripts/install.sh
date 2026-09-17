#!/usr/bin/env bash
# Sleep Network bootstrap (macOS / Linux). Idempotent thin wrapper.
# Ensures Node.js is on PATH, then runs the Node installer from this repo.
set -euo pipefail

say() { printf '  %s\n' "$*"; }
ok() { printf '  OK  %s\n' "$*"; }

echo ""
echo "Sleep Network bootstrap"
echo ""

have() { command -v "$1" >/dev/null 2>&1; }

ensure_node() {
  if have node; then
    ok "node $(node --version)"
    return
  fi
  say "Node.js not found — installing…"
  if have brew; then
    brew install node@22 || brew install node
  elif [[ "$(uname -s)" == "Linux" ]] && have apt-get; then
    sudo apt-get update -y
    sudo apt-get install -y nodejs npm
  else
    say "Install Node 18+ from https://nodejs.org, then re-run."
    exit 1
  fi
  # Refresh common brew paths in this shell
  export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
  if ! have node; then
    say "Node still missing after install attempt."
    exit 1
  fi
  ok "node $(node --version)"
}

ensure_node

BOOTSTRAP_DIR="${TMPDIR:-/tmp}/sleep-network-bootstrap"
REPO="https://github.com/tooltim/sleep-network-bootstrap.git"

if have git; then
  if [[ ! -d "$BOOTSTRAP_DIR/.git" ]]; then
    rm -rf "$BOOTSTRAP_DIR"
    git clone -q "$REPO" "$BOOTSTRAP_DIR"
  else
    git -C "$BOOTSTRAP_DIR" pull -q --ff-only || true
  fi
else
  say "Git not found — downloading bootstrap zip…"
  ZIP="${TMPDIR:-/tmp}/sleep-network-bootstrap.zip"
  curl -fsSL -o "$ZIP" "https://github.com/tooltim/sleep-network-bootstrap/archive/refs/heads/main.zip"
  rm -rf "$BOOTSTRAP_DIR" "${TMPDIR:-/tmp}/sleep-network-bootstrap-main"
  unzip -q "$ZIP" -d "${TMPDIR:-/tmp}"
  mv "${TMPDIR:-/tmp}/sleep-network-bootstrap-main" "$BOOTSTRAP_DIR"
fi

ENTRY="$BOOTSTRAP_DIR/bin/install.js"
if [[ ! -f "$ENTRY" ]]; then
  say "Bootstrap entry not found at $ENTRY"
  exit 1
fi

exec node "$ENTRY"
