#!/usr/bin/env bash
# Sleep Network bootstrap (macOS / Linux). Idempotent thin wrapper.
# Ensures Node.js is on PATH, then launches the guided installer UI.
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
  export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
  if ! have node; then
    say "Node still missing after install attempt."
    exit 1
  fi
  ok "node $(node --version)"
}

ensure_node

# Which branch of the installer to run; a test branch ships a copy of this file
# with SLEEPNET_DEFAULT_BRANCH set to itself.
SLEEPNET_DEFAULT_BRANCH="team-test"
BRANCH="${SLEEPNET_BRANCH:-$SLEEPNET_DEFAULT_BRANCH}"
[[ "$BRANCH" != "main" ]] && say "installer branch: $BRANCH"

BOOTSTRAP_DIR="${TMPDIR:-/tmp}/sleepmag-installer-${BRANCH//[^A-Za-z0-9._-]/-}"
REPO="https://github.com/tooltim/sleepmag-installer-note-beta.git"

if have git; then
  if [[ ! -d "$BOOTSTRAP_DIR/.git" ]]; then
    rm -rf "$BOOTSTRAP_DIR"
    git clone -q --branch "$BRANCH" --single-branch "$REPO" "$BOOTSTRAP_DIR"
  else
    git -C "$BOOTSTRAP_DIR" fetch -q origin "$BRANCH" || true
    git -C "$BOOTSTRAP_DIR" checkout -q -B "$BRANCH" "origin/$BRANCH" || true
  fi
else
  say "Git not found — downloading bootstrap zip…"
  ZIP="${TMPDIR:-/tmp}/sleepmag-installer-note-beta.zip"
  EXTRACT_ROOT="${TMPDIR:-/tmp}/sleepmag-installer-note-beta-extract"
  curl -fsSL -o "$ZIP" "https://github.com/tooltim/sleepmag-installer-note-beta/archive/refs/heads/${BRANCH}.zip"
  rm -rf "$BOOTSTRAP_DIR" "$EXTRACT_ROOT"
  mkdir -p "$EXTRACT_ROOT"
  unzip -q "$ZIP" -d "$EXTRACT_ROOT"
  EXTRACTED="$(find "$EXTRACT_ROOT" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  if [[ -z "$EXTRACTED" ]]; then
    say "Zip extract failed under $EXTRACT_ROOT"
    exit 1
  fi
  mv "$EXTRACTED" "$BOOTSTRAP_DIR"
  rm -rf "$EXTRACT_ROOT"
fi

ENTRY="$BOOTSTRAP_DIR/bin/install.js"
if [[ ! -f "$ENTRY" ]]; then
  say "Bootstrap entry not found at $ENTRY"
  exit 1
fi

ARGS=("$ENTRY")
if [[ "${SLEEPNET_MODE:-}" == "check" || "${SLEEPNET_UI:-}" == "0" ]]; then
  ARGS+=(--cli)
else
  ARGS+=(--ui)
fi

say "Opening the installer…"
exec node "${ARGS[@]}"
