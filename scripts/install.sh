#!/usr/bin/env bash
# Sleep Network bootstrap (macOS / Linux). Idempotent thin wrapper.
# Ensures Node.js is on PATH, then launches the guided installer UI.
# macOS: also makes sure Homebrew, a working git and GitHub CLI are there first,
# because a fresh Mac has none of them and the installer needs all three.
set -euo pipefail

say() { printf '  %s\n' "$*"; }
ok() { printf '  OK  %s\n' "$*"; }

echo ""
echo "Sleep Network bootstrap"
echo ""

have() { command -v "$1" >/dev/null 2>&1; }

IS_MAC=0
[[ "$(uname -s)" == "Darwin" ]] && IS_MAC=1

# Homebrew lives in /opt/homebrew (Apple Silicon) or /usr/local (Intel).
brew_bin() {
  if [[ -x /opt/homebrew/bin/brew ]]; then echo /opt/homebrew/bin/brew
  elif [[ -x /usr/local/bin/brew ]]; then echo /usr/local/bin/brew
  elif have brew; then command -v brew
  fi
}

# /usr/bin/git on a Mac is only a stub until the Command Line Tools are installed:
# it exists, but running it opens an install dialog instead of working.
mac_git_works() {
  [[ -x /opt/homebrew/bin/git || -x /usr/local/bin/git ]] && return 0
  xcode-select -p >/dev/null 2>&1
}

ensure_brew() {
  local b
  b="$(brew_bin)"
  if [[ -z "$b" ]]; then
    say "Homebrew not found — installing it (it asks for your Mac password once)…"
    # Piped through curl | bash, our stdin is the script: hand Homebrew the real
    # terminal so it can ask for the password instead of failing non-interactive.
    if [[ -r /dev/tty ]]; then
      /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" </dev/tty
    else
      /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    fi
    b="$(brew_bin)"
    if [[ -z "$b" ]]; then
      say "Homebrew did not install. Install it from https://brew.sh, then re-run this command."
      exit 1
    fi
  fi
  eval "$("$b" shellenv)"
  # New Terminal windows (and the desktop launcher) must find brew, node and git too.
  local line="eval \"\$($b shellenv)\""
  local profile="$HOME/.zprofile"
  if ! grep -qsF "$line" "$profile"; then
    printf '\n# Homebrew (added by the Sleep Network installer)\n%s\n' "$line" >>"$profile"
    ok "Homebrew added to $profile"
  fi
  ok "brew $("$b" --version | head -n 1 | awk '{print $2}')"
}

ensure_mac_tools() {
  # A plain string, not an array: macOS still ships bash 3.2, where an empty
  # array under `set -u` is an "unbound variable" error.
  local missing=""
  have node || missing="$missing node"
  mac_git_works || missing="$missing git"
  have gh || missing="$missing gh"
  if [[ -z "$missing" ]]; then
    return
  fi
  say "missing on this Mac:$missing"
  ensure_brew
  # Plain `node`, not node@22: the versioned formula is keg-only and never lands on PATH.
  have node || brew install node
  mac_git_works || brew install git
  have gh || brew install gh
}

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

if [[ "$IS_MAC" == "1" ]]; then
  ensure_mac_tools
fi
ensure_node

# Which branch of the installer to run; a test branch ships a copy of this file
# with SLEEPNET_DEFAULT_BRANCH set to itself.
SLEEPNET_DEFAULT_BRANCH="main"
BRANCH="${SLEEPNET_BRANCH:-$SLEEPNET_DEFAULT_BRANCH}"
[[ "$BRANCH" != "main" ]] && say "installer branch: $BRANCH"

BOOTSTRAP_DIR="${TMPDIR:-/tmp}/sleepmag-installer-${BRANCH//[^A-Za-z0-9._-]/-}"
REPO="https://github.com/tooltim/sleepmag-installer-note-beta.git"

if have git && { [[ "$IS_MAC" != "1" ]] || mac_git_works; }; then
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
