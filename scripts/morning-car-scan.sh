#!/usr/bin/env bash
#
# Daily car sweep: scan Marketplace, record new listings, value them against
# KBB. Runs the three skills back to back in one non-interactive Claude call.
#
# Schedule it with launchd — see "Running it every morning" in the README.
# Facebook's session cookies live in the login keychain, so this has to run as
# your logged-in user on the Mac, not as a system daemon.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${CAR_SCAN_LOG_DIR:-$HOME/.fb-marketplace/logs}"
mkdir -p "$LOG_DIR"

LOG_FILE="$LOG_DIR/$(date +%Y-%m-%d).log"

cd "$REPO_DIR"

{
  echo "=== car scan $(date -Iseconds) ==="

  claude -p "Run the /car-scan skill, then /car-record, then /car-value. \
Finish with a short summary of anything flagged as a deal, or say clearly that \
nothing cleared the threshold." \
    --allowedTools "mcp__facebook-marketplace,WebFetch,WebSearch,Read"

  echo "=== done $(date -Iseconds) ==="
} >>"$LOG_FILE" 2>&1

# Surface deals on the desktop. Drop this block if you would rather just read
# the log.
if grep -q "DEAL" "$LOG_FILE" 2>/dev/null; then
  osascript -e 'display notification "Underpriced car found — check the log." with title "Marketplace car scan"' || true
fi
