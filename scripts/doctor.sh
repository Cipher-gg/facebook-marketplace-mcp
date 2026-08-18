#!/usr/bin/env bash
#
# Checks everything the car scan needs and prints the exact fix for whatever
# is missing. Safe to run repeatedly; changes nothing.
#
#   ./scripts/doctor.sh

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHROME_DIR="$HOME/Library/Application Support/Google/Chrome"

pass=0
fail=0

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; pass=$((pass + 1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; fail=$((fail + 1)); }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
fix()  { printf '      → %s\n' "$1"; }
head_() { printf '\n\033[1m%s\033[0m\n' "$1"; }

head_ "System"

if [ "$(uname -s)" = "Darwin" ]; then
  ok "macOS $(sw_vers -productVersion 2>/dev/null)"
else
  bad "Not macOS (found $(uname -s)) — cookie extraction needs macOS Chrome + Keychain"
  fix "This tool only runs on your Mac. Nothing below will pass here."
fi

if command -v node >/dev/null 2>&1; then
  node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "$node_major" -ge 22 ] 2>/dev/null; then
    ok "Node $(node --version)"
  else
    bad "Node $(node --version) is too old (need 22+)"
    fix "brew install node   # or: brew upgrade node"
  fi
else
  bad "Node not installed"
  fix "brew install node"
fi

if xcode-select -p >/dev/null 2>&1; then
  ok "Xcode command line tools present"
else
  bad "Xcode command line tools missing — better-sqlite3 cannot compile"
  fix "xcode-select --install"
fi

head_ "Build"

if [ -d "$REPO_DIR/node_modules" ]; then
  ok "Dependencies installed"
else
  bad "node_modules missing"
  fix "cd '$REPO_DIR' && npm install"
fi

if [ -f "$REPO_DIR/dist/index.js" ]; then
  ok "Server built (dist/index.js)"
else
  bad "Not built"
  fix "cd '$REPO_DIR' && npm run build"
fi

skills_found=0
for s in car-scan car-record car-value; do
  [ -f "$REPO_DIR/.claude/skills/$s/SKILL.md" ] && skills_found=$((skills_found + 1))
done
if [ "$skills_found" -eq 3 ]; then
  ok "All three skills present"
else
  bad "Only $skills_found of 3 skills found — wrong branch?"
  fix "git checkout claude/car-marketplace-monitoring-69vpmh"
fi

head_ "Chrome session"

if [ -d "$CHROME_DIR" ]; then
  ok "Chrome profile directory found"

  profiles_with_fb=""
  while IFS= read -r cookie_db; do
    [ -f "$cookie_db" ] || continue
    profile="$(basename "$(dirname "$cookie_db")")"
    tmp="$(mktemp)"
    if cp "$cookie_db" "$tmp" 2>/dev/null; then
      n=$(sqlite3 "$tmp" \
        "SELECT COUNT(*) FROM cookies WHERE host_key LIKE '%facebook.com' AND name='c_user';" \
        2>/dev/null || echo 0)
      if [ "${n:-0}" -gt 0 ]; then
        ok "Facebook login found in profile: $profile"
        profiles_with_fb="$profiles_with_fb $profile"
      else
        warn "No Facebook login in profile: $profile"
      fi
    fi
    rm -f "$tmp"
  done < <(find "$CHROME_DIR" -maxdepth 3 -name Cookies -type f 2>/dev/null)

  if [ -z "$profiles_with_fb" ]; then
    bad "No Chrome profile has a Facebook session"
    fix "Open Chrome, log into facebook.com, then rerun this script"
  else
    # shellcheck disable=SC2086
    set -- $profiles_with_fb
    if [ "$1" != "Default" ]; then
      warn "Facebook lives in '$1', not 'Default' — the server needs to be told"
      fix "claude mcp add facebook-marketplace --env CHROME_PROFILE='$1' -- node '$REPO_DIR/dist/index.js'"
    fi
  fi
else
  bad "Chrome not found at $CHROME_DIR"
  fix "Install Google Chrome and log into Facebook in it"
fi

if [ "$(uname -s)" = "Darwin" ]; then
  if security find-generic-password -s "Chrome Safe Storage" -a "Chrome" >/dev/null 2>&1; then
    ok "Keychain entry 'Chrome Safe Storage' is readable"
  else
    bad "Cannot read the Chrome Safe Storage keychain entry"
    fix "If a prompt appeared, click 'Always Allow' (not 'Allow') and rerun"
    fix "If you clicked Deny before: open Keychain Access, find 'Chrome Safe Storage', delete the deny rule"
  fi
fi

head_ "Registration"

if command -v claude >/dev/null 2>&1; then
  if claude mcp list 2>/dev/null | grep -q facebook-marketplace; then
    ok "MCP server registered with Claude Code"
  else
    bad "MCP server not registered"
    fix "cd '$REPO_DIR' && claude mcp add facebook-marketplace -- node \"\$PWD/dist/index.js\""
  fi
else
  bad "claude CLI not found"
  fix "Install Claude Code, then rerun"
fi

head_ "Database"

db="${FB_MARKETPLACE_DB:-$HOME/.fb-marketplace/cars.db}"
if [ -f "$db" ]; then
  total=$(sqlite3 "$db" "SELECT COUNT(*) FROM listings;" 2>/dev/null || echo "?")
  deals=$(sqlite3 "$db" "SELECT COUNT(*) FROM valuations WHERE is_deal=1;" 2>/dev/null || echo "?")
  last=$(sqlite3 "$db" "SELECT COALESCE(MAX(ran_at),'never') FROM scan_runs;" 2>/dev/null || echo "?")
  ok "Database at $db — $total listings, $deals flagged, last scan: $last"
else
  warn "No database yet at $db (normal before the first scan)"
fi

head_ "Summary"
printf '  %d passed, %d failed\n' "$pass" "$fail"
if [ "$fail" -eq 0 ]; then
  printf '\n  Ready. Run:  cd %s && claude\n  Then: /car-scan\n\n' "$REPO_DIR"
  exit 0
else
  printf '\n  Fix the ✗ items above, then rerun this script.\n\n'
  exit 1
fi
