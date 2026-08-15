---
name: car-value
description: Look up the Kelley Blue Book private party value for saved Marketplace car listings and flag anything priced 15% or more under it. Use after car-record, or when the user asks which cars are underpriced, what the KBB value of a listing is, or to see the current deals.
---

# KBB private party valuation

Step 3 of 3. Prices each recorded car against its Kelley Blue Book private
party value and flags the ones asking well under.

## How the value gets in

**There is no public KBB API.** The value has to be looked up the way a person
would — reading it off KBB's published pricing page for that car — and then
written to the database with `record_valuation`. Look up only the cars in the
queue, a handful per morning; this is a person's shopping research, not a
crawl. If a value cannot be found for a car, leave it unvalued and say so.
**Never invent a KBB number, and never substitute a guess based on similar
listings** — a fabricated baseline turns this whole tool into noise.

`record_valuation` does the arithmetic and the flagging:

```
pct_under = (kbb_value - asking_price) / kbb_value * 100
is_deal   = pct_under >= 15
```

## Steps

### 1. Pull the queue

```
query_listings(needs_valuation=true, limit=25)
```

Skip, and report as unvaluable, any listing missing **year, make, or model** —
there is nothing to look up.

Listings missing **mileage** need a decision. Mileage is the single biggest
input to a used car's value, so:

- Re-read the description first; the mileage may be phrased in a way the parser
  missed ("just turned over 100k").
- If it is genuinely absent, either skip the car or look up the value at
  typical mileage for its age (~12,000 mi/year) — and if you do that, say so in
  the `notes` field and in your report. Do not flag a deal off an assumed
  odometer reading.

### 2. Look up each car on KBB

Use `WebFetch` against kbb.com's pricing page for the exact year/make/model/
trim, with the listing's mileage and a condition rating. The URL pattern is
roughly:

```
https://www.kbb.com/<make>/<model>/<year>/<trim>/?mileage=<miles>&pricetype=private-party&condition=good
```

That pattern changes from time to time. If it does not resolve, `WebSearch` for
`kbb private party value <year> <make> <model> <trim>` and fetch the result.

Three things to get right:

1. **Take the Private Party number.** KBB publishes several figures on the same
   page. Trade-In is thousands lower and Dealer Retail is thousands higher.
   Grabbing the wrong one is the most likely way this skill produces a
   confidently wrong answer.
2. **Condition: default to "good".** That is KBB's own most-common rating and
   the right assumption for a private sale you have not inspected. Move to
   "very good" or "fair" only when the description and photos clearly support
   it, and record which you used.
3. **Capture the URL** you read the number from, so the figure can be audited
   later.

If KBB has no entry for the trim, use the base trim and note the substitution.

### 3. Record it

```
record_valuation(
  listing_id       = "...",
  kbb_value        = <private party dollars>,
  range_low        = <low end, if published>,
  range_high       = <high end, if published>,
  condition_assumed= "good",
  source_url       = "<the page you read>",
  notes            = "<assumptions: trim substituted, mileage estimated, etc.>"
)
```

Re-valuing a listing overwrites the old figure, so it is safe to re-run when a
price drops.

### 4. Sanity-check the flags before reporting

```
query_listings(deals_only=true)
```

A car 15% under KBB is worth a look. A car **35%+ under KBB is usually
explained by something the price is telling you**, and reporting it as a
bargain without comment is the failure mode to avoid here. Before presenting a
big discount, check the description and note anything you find:

- Salvage, rebuilt, or branded title — KBB private party values assume a clean
  title and do not apply. Say the value is not comparable rather than reporting
  a huge discount.
- Stated mechanical trouble: transmission, head gasket (common on older
  Subarus), timing chain, "needs work", "mechanic's special".
- Rust, accident damage, no title in hand, salvage auction resale.
- Price bait: a $500 4Runner is a scam or a keyword-stuffed listing, not a
  find.

Flag these in the report. Do not silently drop them from the database — the row
stays, with the caveat attached.

### 5. Report

Lead with the deals, best discount first. For each:

- Year, make, model, trim, mileage
- Asking price vs KBB private party value, and the percentage under
- Location and seller
- Any caveat from step 4
- Link to the listing

Then a one-line tally: how many valued, how many flagged, how many skipped and
why.

If nothing cleared 15%, say that plainly. Most mornings nothing will, and a
quiet morning reported as quiet is the skill working correctly.

## Notes

- The 15% threshold is the default and lives in `DEAL_THRESHOLD_PCT`. Pass
  `threshold_pct` to `record_valuation` to override it for a single car.
- KBB private party values are a national baseline with a regional adjustment;
  they lag a fast-moving market by a few weeks. Treat the flag as "worth a
  look", not an appraisal.
- Values move with mileage bands. A car re-valued after a price drop should be
  re-valued at the same mileage, not a fresh estimate.
