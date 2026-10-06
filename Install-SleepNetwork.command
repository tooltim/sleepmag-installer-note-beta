#!/bin/bash
# Sleep Network - one-click install (macOS). Double-click me
# (first time: right-click > Open, because macOS blocks downloaded scripts).
# This file only fetches and runs scripts/install.sh, so there is never a second, stale copy.
curl -fsSL https://raw.githubusercontent.com/tooltim/sleepmag-installer-note-beta/main/scripts/install.sh | bash
status=$?
if [[ $status -ne 0 ]]; then
  echo ""
  echo "Something did not work. Copy everything above and send it to Tim."
  echo "Or run this in Terminal:"
  echo "  curl -fsSL https://raw.githubusercontent.com/tooltim/sleepmag-installer-note-beta/main/scripts/install.sh | bash"
  echo ""
  read -r -p "Press Enter to close..."
fi
exit $status
