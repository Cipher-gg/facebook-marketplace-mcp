---
name: car-scan
description: Run the daily Facebook Marketplace sweep for the four saved car searches (Toyota RAV4, Toyota 4Runner, Subaru Outback, Subaru Forester). Creates the saved monitors on first run, then checks each for listings that have not been seen before and saves them to the car database. Use when the user asks to check Marketplace for cars, run the morning car scan, or see what new car listings came up.
---

# Morning Marketplace car scan

Step 1 of 3. Finds new listings. `car-record` then enriches them, and
`car-value` prices them against KBB.

## What this covers

Four searches, one saved monitor each:

| Monitor name | Query |
|---|---|
| `rav4` | Toyota RAV4 |
| `4runner` | Toyota 4Runner |
| `outback` | Subaru Outback |
| `forester` | Subaru Forester |

## Before you start

This needs the `facebook-marketplace` MCP server, which reads the Facebook
session cookies out of Chrome on macOS. If its tools are not available, or the
first call fails with a cookie/session error, stop and tell the user — do not
try to work around it by scraping Facebook another way. The usual fix is to
open Chrome and load facebook.com to refresh the session.

The server self-limits to **3 requests per minute**. Four monitors is about a
minute. Do not raise the limit to go faster.

## Steps

### 1. Make sure the four monitors exist

Call `list_monitors`. If any of the four names above is missing, create it with
`monitor_search`.

The monitors need a search center. To get one:

- Call `search_location` with the user's city or town to get coordinates.
- If you do not know where the user searches from, **ask before creating any
  monitor** — a monitor pinned to the wrong coordinates silently returns the
  wrong cars for weeks. This is the one question worth blocking on, and it is
  only asked once, on first run.

Defaults when creating a monitor, unless the user says otherwise:

- `radius_km`: 100
- `min_price`: 2000 — filters out parts listings and scams
- `max_price`: leave unset

Monitor names must match the table exactly. The other two skills and the
database join on them.

### 2. Check the monitors

Call `check_monitors` with no arguments to sweep all four in one pass.

Every result is written to the car database automatically. New listings are
inserted, and listings already on file get their price and pending status
refreshed — that is how a price drop on a known car gets picked up. The tool
reports which listings are new.

If one monitor errors, the others still run. Report the failure; do not retry
more than once.

### 3. Report

Write a short summary:

- Per monitor: how many new, or "nothing new".
- For each new listing: year/make/model, asking price, location, listing ID.
- Total new listings across all four.

Then call `db_stats` and state how many listings are waiting on details and how
many are waiting on a KBB valuation.

### 4. Hand off

If there were new listings, continue straight into the `car-record` skill
unless the user asked only to scan. The three skills are meant to run
back-to-back as one morning routine.

## Notes

- Marketplace search results are capped at roughly 24 per query per sweep. A
  car posted and sold between two daily runs can be missed entirely; that is a
  limit of the platform, not a bug to fix.
- "New" means *not previously in the database*, not "posted since yesterday".
  The first run will therefore flag everything it finds.
- Do not delete monitors to reset them. Deleting loses the seen-listing history
  and the next scan reports every car as new.
