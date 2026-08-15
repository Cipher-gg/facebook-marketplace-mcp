---
name: car-record
description: Fetch full details for newly found Marketplace car listings and record them in the local car database — price, mileage, year, trim, photos, location, and seller. Use after car-scan, or when the user asks to save listings to the database, fill in missing mileage or trim, or check what is stored.
---

# Record car listings to the database

Step 2 of 3. `car-scan` finds listings; this fills in everything the search
results do not carry and writes it down. `car-value` then prices them.

## What the database holds

SQLite at `~/.fb-marketplace/cars.db` (override with `FB_MARKETPLACE_DB`).

| Table | Holds |
|---|---|
| `listings` | One row per car: title, url, price, year, make, model, trim, mileage, location, seller, description, condition, pending flag, first/last seen |
| `listing_photos` | Every photo URL, ordered |
| `valuations` | KBB private party value and the computed discount (written by `car-value`) |
| `scan_runs` | One row per monitor per sweep, for spotting a search that quietly broke |

A search result only gives title, price, location, seller name, and one
thumbnail. **Mileage, trim, condition, the description, and the full photo set
only exist on the listing page** — which is what this skill goes and gets.

## Steps

### 1. Find what needs fetching

```
query_listings(needs_details=true, limit=50)
```

Optionally scope to today's finds with `since` set to this morning's ISO
timestamp.

If nothing comes back, say so and stop — there is nothing to record.

### 2. Fetch each listing

Call `get_listing` with the listing ID for each one. It saves to the database
on its own; `save` defaults to true, so do not pass it unless the user
explicitly wants a dry run.

Each fetch stores: full description, condition, all photo URLs, seller profile
URL, and the mileage and trim parsed out of the description.

**Pace yourself.** The server allows 3 requests per minute, so 20 listings take
about 7 minutes. That is expected and the rate limit exists to keep the account
from being flagged. If there are more than 25 listings pending:

- Fetch the 25 most recent.
- Tell the user how many are still queued and that the next run will pick them
  up.

If a fetch fails, note it and move on. One dead listing (sold, deleted) must
not stop the batch. Listings that fail keep `details_fetched_at` empty, so the
next run retries them naturally.

### 3. Report what landed

Call `query_listings` with `since` set to this morning and summarize each car:

- Year, make, model, trim
- Asking price
- Mileage
- Location, seller
- Photo count

Then flag the gaps explicitly — they matter to the next step:

- **Missing mileage.** Common: plenty of sellers never state it. `car-value`
  cannot produce a trustworthy KBB number without it.
- **Missing year/make/model.** Usually a title the parser could not read
  ("Great family SUV!!"). Read the description and, if the car is identifiable,
  say what it actually is in your report.
- **Missing trim.** Lower stakes; trim moves KBB value less than mileage does.

Finish with `db_stats`.

### 4. Hand off

Continue into `car-value` unless the user asked only to record.

## Notes

- Re-fetching an existing listing is safe. Details are merged field by field —
  a later fetch never blanks out something an earlier one found, and photos are
  deduplicated by URL.
- Photo URLs are Facebook CDN links with expiring signatures. They are stored
  as a reference, not an archive, and go dead after a while. If the user wants
  photos kept permanently, that means downloading the image bytes — say so
  rather than pretending the stored URLs are durable.
- `first_seen_at` is when the scan first saw the car, not when the seller
  posted it. `posted_at` holds Facebook's timestamp when it gives one.
