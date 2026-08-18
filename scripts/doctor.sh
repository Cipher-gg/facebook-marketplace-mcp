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

  # Chrome 96+ keeps cookies at <profile>/Network/Cookies; older builds put it
  # at <profile>/Cookies. Search deep enough to catch both, and keep stderr so
  # a permission problem is not mistaken for an absent file.
  find_err="$(mktemp)"
  cookie_dbs="$(find "$CHROME_DIR" -maxdepth 4 -name Cookies -type f 2>"$find_err")"

  if [ -s "$find_err" ] && [ -z "$cookie_dbs" ]; then
    bad "Could not search the Chrome directory"
    while IFS= read -r line; do fix "$line"; done < "$find_err"
    fix "If these say 'Operation not permitted', grant your terminal Full Disk Access"
    fix "System Settings > Privacy & Security > Full Disk Access"
  fi
  rm -f "$find_err"

  # A Chrome that was installed but never taken through first-run setup has the
  # top directory and the keychain entry, but no profile directory at all.
  if [ -z "$cookie_dbs" ] && [ ! -d "$CHROME_DIR/Default" ]; then
    warn "No '$CHROME_DIR/Default' profile directory — Chrome has not finished first-run setup"
    fix "Open Chrome, click through the welcome screens, then load facebook.com"
  fi

  if ! command -v sqlite3 >/dev/null 2>&1; then
    # Without sqlite3 every profile would look empty, which reads as "not
    # logged in" and sends you to log in again for no reason.
    bad "sqlite3 not found — cannot inspect Chrome cookies, results would be misleading"
    fix "macOS ships it at /usr/bin/sqlite3 — check your PATH"
  elif [ -z "$cookie_dbs" ]; then
    bad "Chrome has run, but no cookie database exists yet"
    fix "Open Chrome, go to facebook.com and log in"
    fix "Then QUIT Chrome (cmd-Q) so it flushes cookies to disk, and rerun this"
    fix "Searched: $CHROME_DIR/*/Cookies and $CHROME_DIR/*/Network/Cookies"
  else
    profiles_with_fb=""
    while IFS= read -r cookie_db; do
      [ -f "$cookie_db" ] || continue

      dir="$(dirname "$cookie_db")"
      # Step out of Network/ so the profile is reported as "Default", not
      # "Network" — CHROME_PROFILE expects the profile directory name.
      [ "$(basename "$dir")" = "Network" ] && dir="$(dirname "$dir")"
      profile="$(basename "$dir")"

      tmp="$(mktemp)"
      if cp "$cookie_db" "$tmp" 2>/dev/null; then
        # Keep sqlite3's stderr. "file is not a database" and "no such table"
        # mean very different things, and both were previously reported as an
        # unreadable file with no explanation.
        sql_err="$(mktemp)"
        fb_all=$(sqlite3 "$tmp" \
          "SELECT COUNT(*) FROM cookies WHERE host_key LIKE '%facebook.com';" \
          2>"$sql_err")

        if [ -s "$sql_err" ]; then
          bad "Cookie database for profile '$profile' could not be read"
          while IFS= read -r line; do fix "sqlite3: $line"; done < "$sql_err"
          fix "'file is not a database' — Chrome was mid-write; quit Chrome (cmd-Q) and rerun"
          fix "'unable to open database file' — grant your terminal Full Disk Access"
          fix "'no such table: cookies' — Chrome has not initialised the profile yet"
          rm -f "$sql_err" "$tmp"
          continue
        fi
        rm -f "$sql_err"

        fb_user=$(sqlite3 "$tmp" \
          "SELECT COUNT(*) FROM cookies WHERE host_key LIKE '%facebook.com' AND name='c_user';" \
          2>/dev/null || echo 0)

        if [ "${fb_user:-0}" -gt 0 ]; then
          ok "Facebook login found in profile: $profile"
          profiles_with_fb="$profiles_with_fb $profile"
        elif [ "${fb_all:-0}" -gt 0 ]; then
          warn "Profile '$profile' has $fb_all facebook.com cookies but no c_user"
          fix "That means Facebook was visited but not logged in — log in, quit Chrome, rerun"
        else
          warn "Profile '$profile' has no facebook.com cookies"
        fi
      else
        warn "Could not read the cookie DB for profile '$profile'"
      fi
      rm -f "$tmp"
    done < <(printf '%s\n' "$cookie_dbs")

    if [ -z "$profiles_with_fb" ]; then
      bad "No Chrome profile has a Facebook session"
      fix "Log into facebook.com in Chrome, quit Chrome, then rerun this script"
    else
      # shellcheck disable=SC2086
      set -- $profiles_with_fb
      if [ "$1" != "Default" ]; then
        warn "Facebook lives in '$1', not 'Default' — the server needs to be told"
        fix "claude mcp add facebook-marketplace --env CHROME_PROFILE='$1' -- node '$REPO_DIR/dist/index.js'"
      fi
    fi
  fi
else
  bad "Chrome not found at $CHROME_DIR"
  fix "Install Google Chrome and log into Facebook in it"
fi

if [ "$(uname -s)" = "Darwin" ]; then
  if [ ! -d "$CHROME_DIR" ]; then
    # Chrome creates this keychain entry on first launch. Reporting it as a
    # failure here just sends you chasing a keychain problem you do not have.
    warn "Keychain check skipped — Chrome creates 'Chrome Safe Storage' on first run"
  elif security find-generic-password -s "Chrome Safe Storage" -a "Chrome" >/dev/null 2>&1; then
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
