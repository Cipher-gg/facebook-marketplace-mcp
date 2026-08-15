# Facebook Marketplace MCP Server — Context

## Architecture
Direct GraphQL API replay (no browser at runtime). Speaks Facebook's internal `/api/graphql/` protocol using session cookies extracted from Chrome on macOS.

## Key Files
- `src/index.ts` — MCP server entry point (stdio transport)
- `src/facebook/client.ts` — GraphQL HTTP client, session management, token extraction
- `src/facebook/auth.ts` — Chrome cookie extraction (SQLite + Keychain decrypt)
- `src/facebook/queries.ts` — Known `doc_id` values for Marketplace GraphQL operations
- `src/facebook/parser.ts` — Response normalization for search results and listing details
- `src/tools/` — MCP tool handlers (search, listing, monitor, vehicles)
- `src/storage/monitors.ts` — JSON file persistence for saved search monitors (~/.fb-marketplace/)
- `src/storage/db.ts` — SQLite handle + schema migration for the car database
- `src/storage/listings.ts` — listing upsert, queries, KBB valuation scoring
- `src/vehicles/parse.ts` — year/make/model/trim/mileage extraction from listing text
- `.claude/skills/` — car-scan → car-record → car-value, the daily routine
- `scripts/capture-queries.ts` — Playwright-based script to discover new GraphQL doc_ids
- `scripts/morning-car-scan.sh` + `com.user.car-scan.plist` — daily LaunchAgent

## Car Database
SQLite at `~/.fb-marketplace/cars.db` (`FB_MARKETPLACE_DB` overrides). Tables:
`listings`, `listing_photos`, `valuations`, `scan_runs`. Migration is idempotent
`CREATE TABLE IF NOT EXISTS` on open — additive changes only, no migration
framework.

`check_monitors` and `get_listing` write to it as a side effect. New rows are
inserted; known listings get price/pending refreshed so price drops surface.
Detail fields merge with `COALESCE`, so a later fetch never blanks an earlier
one. The database — not `monitors.json` `seenIds` — decides what counts as new.

Deal scoring: `pct_under = (kbb_value - ask) / kbb_value * 100`, flagged at
`DEAL_THRESHOLD_PCT` (default 15). KBB values are supplied by the agent from
kbb.com lookups; there is no API and nothing auto-fetches them.

## Fragility Points
- `doc_id` values change when Facebook deploys (use capture-queries script to update)
- `fb_dtsg` token rotates per session (auto-refreshed on auth errors)
- Facebook DOM structure changes affect listing detail parsing
- Rate limiting: 3 req/min default to avoid detection

## Dependencies
- `@modelcontextprotocol/sdk` — MCP server framework
- `better-sqlite3` — Chrome cookie DB access
- `zod` — Tool schema validation

## Cookie Encryption (macOS Chrome)
- AES-128-CBC, PBKDF2 with SHA-1, salt="saltysalt", 1003 iterations
- Key from Keychain: `security find-generic-password -w -s "Chrome Safe Storage" -a "Chrome"`
- IV: 16 space characters, encrypted values prefixed with "v10"
