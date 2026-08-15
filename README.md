# Facebook Marketplace MCP Server

An MCP server that provides access to Facebook Marketplace via direct GraphQL API calls. No browser automation at runtime — speaks Facebook's internal protocol directly.

## How It Works

Facebook's web client makes all Marketplace requests as `POST /api/graphql/` with a `doc_id` (query hash) and `variables`. This server replays those requests using your existing Facebook session cookies from Chrome.

**Think of it like [pypush](https://github.com/JJTech0130/pypush) for iMessage — direct protocol, no browser.**

## Prerequisites

- **macOS** (cookie extraction uses Keychain)
- **Google Chrome** with an active Facebook login
- **Node.js** 20+

## Installation

```bash
git clone <this-repo>
cd facebook-marketplace-mcp
npm install
npm run build
```

## Setup with Claude Code

```bash
claude mcp add facebook-marketplace -- node /path/to/facebook-marketplace-mcp/dist/index.js
```

Or add to your Claude Code config manually:

```json
{
  "mcpServers": {
    "facebook-marketplace": {
      "command": "node",
      "args": ["/path/to/facebook-marketplace-mcp/dist/index.js"],
      "env": {
        "CHROME_PROFILE": "Default"
      }
    }
  }
}
```

## Tools

### `search_listings`
Search Marketplace by query, location, and filters.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | Search term |
| `latitude` | number | yes | Latitude of search center |
| `longitude` | number | yes | Longitude of search center |
| `radius_km` | number | no | Search radius (default: 50) |
| `min_price` | number | no | Min price in dollars |
| `max_price` | number | no | Max price in dollars |
| `category` | string | no | Category ID |
| `limit` | number | no | Max results (default: 20) |

### `get_listing`
Get full details for a specific listing.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `listing_id` | string | yes | Marketplace listing ID |

### `monitor_search`
Save a search as a monitor to track new listings over time.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | yes | Monitor name |
| `query` | string | yes | Search term |
| `latitude` | number | yes | Search center lat |
| `longitude` | number | yes | Search center lng |
| `radius_km` | number | no | Radius (default: 50) |
| `min_price` | number | no | Min price |
| `max_price` | number | no | Max price |

### `check_monitors`
Check monitors for new listings since last check.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `monitor_name` | string | no | Check specific monitor, or omit for all |

### `list_monitors`
List all saved monitors.

### `delete_monitor`
Delete a saved monitor.

### `query_listings`
Query the car database.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `needs_details` | boolean | no | Only listings whose page hasn't been fetched |
| `needs_valuation` | boolean | no | Only listings with no KBB value recorded |
| `deals_only` | boolean | no | Only listings flagged at/under the deal threshold |
| `since` | string | no | ISO timestamp — only listings first seen since then |
| `make` / `model` | string | no | Filter by make or model |
| `monitor_name` | string | no | Filter by the monitor that found it |
| `limit` | number | no | Max rows (default: 50) |
| `include_photos` | boolean | no | Include photo URLs (default: false) |

### `record_valuation`
Record a KBB private party value and score the asking price against it.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `listing_id` | string | yes | Must already be in the database |
| `kbb_value` | number | yes | Private party value in dollars |
| `range_low` / `range_high` | number | no | Published range ends |
| `condition_assumed` | string | no | excellent / very good / good / fair |
| `source_url` | string | no | Where the figure came from |
| `notes` | string | no | Assumptions and caveats |
| `threshold_pct` | number | no | Deal threshold (default: 15) |

### `db_stats`
Summarize the database: totals, what's awaiting details or valuation, flagged deals.

## Car watching

Three skills in `.claude/skills/` chain into one morning routine:

| Skill | Does |
|---|---|
| `car-scan` | Sweeps four saved monitors — RAV4, 4Runner, Outback, Forester — and saves what's new |
| `car-record` | Fetches each new listing's page for mileage, trim, photos, seller, description |
| `car-value` | Looks up the KBB private party value and flags anything ≥15% under |

Run them in order, or just say "run the morning car scan".

### The database

SQLite at `~/.fb-marketplace/cars.db`.

| Table | Holds |
|---|---|
| `listings` | One row per car — price, year, make, model, trim, mileage, location, seller, description, condition, first/last seen |
| `listing_photos` | Every photo URL, ordered |
| `valuations` | KBB value, computed `pct_under`, deal flag, source URL |
| `scan_runs` | One row per monitor per sweep, including failures |

`check_monitors` writes to it automatically. Known listings get their price and
pending status refreshed on every sweep, so price drops are picked up.

Photo URLs are Facebook CDN links with expiring signatures — a reference, not
an archive. Keeping photos permanently means downloading the bytes.

### Running it every morning

The scan needs your login keychain to decrypt Chrome's cookies, so it has to
run as your logged-in user on the Mac — a LaunchAgent, not a cron daemon, and
not a cloud runner.

```bash
# 1. Point the plist at your checkout
$EDITOR scripts/com.user.car-scan.plist

# 2. Install it
cp scripts/com.user.car-scan.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.user.car-scan.plist
```

Fires at 07:30 daily, logs to `~/.fb-marketplace/logs/`, and posts a desktop
notification when something is flagged. Run `scripts/morning-car-scan.sh` by
hand first to confirm the session works.

## Configuration

| Env Variable | Default | Description |
|-------------|---------|-------------|
| `CHROME_PROFILE` | `Default` | Chrome profile directory name |
| `FB_MARKETPLACE_DB` | `~/.fb-marketplace/cars.db` | Car database path |
| `DEAL_THRESHOLD_PCT` | `15` | Percent under KBB that counts as a deal |

## Development

```bash
npm test        # parser and database tests
npm run typecheck
npm run build
```

## Updating GraphQL Queries

Facebook rotates their `doc_id` values on deploys. If searches stop working:

```bash
npm install -D playwright
npx playwright install chromium
npm run capture-queries
```

This opens a browser, navigates Marketplace, and captures current query IDs. Update `src/facebook/queries.ts` with the new values.

## Rate Limiting

The server self-rate-limits to 3 requests/minute with random jitter to avoid detection. This means searches take a few seconds.

## Limitations

- **macOS only** for automatic cookie extraction
- **Requires Chrome** with active Facebook session
- **Facebook ToS** — automating Facebook violates their Terms of Service
- **Fragile** — `doc_id` values change on Facebook deploys
- **Rate limited** — aggressive use may trigger CAPTCHAs or account flags
- **No write operations** — search/read only, no messaging or listing creation
- **No KBB API** — Kelley Blue Book publishes no public API, so `car-value`
  reads the figure off kbb.com's pricing page for that car and records the
  source URL. It's a handful of lookups a morning, the same ones you'd do by
  hand. The value is a national baseline that lags a fast market by weeks —
  treat a flag as "worth a look", not an appraisal.
- **Vehicle parsing is model-specific** — `src/vehicles/parse.ts` knows the
  trims for RAV4, 4Runner, Outback, and Forester. Watching other models means
  adding them there, or their trim column stays empty.
