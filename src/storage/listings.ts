import { getDb } from "./db.js";
import { parseVehicle, parsePriceCents } from "../vehicles/parse.js";
import type {
  MarketplaceListing,
  MarketplaceListingDetail,
} from "../facebook/types.js";

/** Percent below KBB private party value that counts as a deal. */
export const DEFAULT_DEAL_THRESHOLD_PCT = Number(
  process.env.DEAL_THRESHOLD_PCT ?? 15
);

export interface StoredListing {
  id: string;
  title: string;
  url: string;
  price_cents: number | null;
  price_text: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  mileage: number | null;
  location: string | null;
  seller_name: string | null;
  seller_profile_url: string | null;
  description: string | null;
  condition: string | null;
  is_pending: number;
  posted_at: string | null;
  monitor_name: string | null;
  first_seen_at: string;
  last_seen_at: string;
  details_fetched_at: string | null;
}

export interface StoredValuation {
  listing_id: string;
  kbb_value: number;
  kbb_range_low: number | null;
  kbb_range_high: number | null;
  condition_assumed: string | null;
  source_url: string | null;
  notes: string | null;
  pct_under: number | null;
  is_deal: number;
  threshold_pct: number;
  valued_at: string;
}

export interface ListingWithValuation extends StoredListing {
  photo_count: number;
  valuation: StoredValuation | null;
}

export interface SaveResult {
  id: string;
  isNew: boolean;
}

/**
 * Insert search results, or refresh price/pending state on ones we've seen.
 * Vehicle attributes are parsed from the title; `saveListingDetail` fills in
 * the rest once the listing page has been fetched.
 */
export function saveSearchListings(
  listings: MarketplaceListing[],
  monitorName?: string
): SaveResult[] {
  const db = getDb();
  const now = new Date().toISOString();

  const exists = db.prepare<[string], { id: string }>(
    "SELECT id FROM listings WHERE id = ?"
  );

  const insert = db.prepare(`
    INSERT INTO listings (
      id, title, url, price_cents, price_text, year, make, model, trim,
      mileage, location, seller_name, is_pending, posted_at, monitor_name,
      first_seen_at, last_seen_at
    ) VALUES (
      @id, @title, @url, @price_cents, @price_text, @year, @make, @model, @trim,
      @mileage, @location, @seller_name, @is_pending, @posted_at, @monitor_name,
      @now, @now
    )
  `);

  // A listing already in the table keeps its first_seen_at and any enriched
  // fields; only the volatile ones get refreshed.
  const update = db.prepare(`
    UPDATE listings
       SET price_cents  = COALESCE(@price_cents, price_cents),
           price_text   = COALESCE(@price_text, price_text),
           is_pending   = @is_pending,
           last_seen_at = @now
     WHERE id = @id
  `);

  const insertPhoto = db.prepare(`
    INSERT OR IGNORE INTO listing_photos (listing_id, position, url)
    VALUES (?, 0, ?)
  `);

  const run = db.transaction((rows: MarketplaceListing[]): SaveResult[] => {
    const results: SaveResult[] = [];

    for (const listing of rows) {
      if (!listing.id) continue;

      const vehicle = parseVehicle(listing.title);
      const row = {
        id: listing.id,
        title: listing.title,
        url: listing.url,
        price_cents: parsePriceCents(listing.price),
        price_text: listing.price || null,
        year: vehicle.year,
        make: vehicle.make,
        model: vehicle.model,
        trim: vehicle.trim,
        mileage: vehicle.mileage,
        location: listing.location || null,
        seller_name: listing.sellerName || null,
        is_pending: listing.isPending ? 1 : 0,
        posted_at: listing.postedDate || null,
        monitor_name: monitorName ?? null,
        now,
      };

      const isNew = !exists.get(listing.id);
      if (isNew) {
        insert.run(row);
      } else {
        update.run(row);
      }

      if (listing.imageUrl) {
        insertPhoto.run(listing.id, listing.imageUrl);
      }

      results.push({ id: listing.id, isNew });
    }

    return results;
  });

  return run(listings);
}

/**
 * Fold a fetched listing page into the row: description, condition, photos,
 * and the mileage/trim that are usually only stated in the description.
 */
export function saveListingDetail(detail: MarketplaceListingDetail): void {
  const db = getDb();
  const now = new Date().toISOString();
  const vehicle = parseVehicle(detail.title, detail.description);

  const update = db.prepare(`
    UPDATE listings
       SET title              = COALESCE(NULLIF(@title, ''), title),
           description        = COALESCE(NULLIF(@description, ''), description),
           condition          = COALESCE(NULLIF(@condition, ''), condition),
           location           = COALESCE(NULLIF(@location, ''), location),
           seller_name        = COALESCE(NULLIF(@seller_name, ''), seller_name),
           seller_profile_url = COALESCE(NULLIF(@seller_profile_url, ''), seller_profile_url),
           price_cents        = COALESCE(@price_cents, price_cents),
           price_text         = COALESCE(NULLIF(@price_text, ''), price_text),
           year               = COALESCE(@year, year),
           make               = COALESCE(@make, make),
           model              = COALESCE(@model, model),
           trim               = COALESCE(@trim, trim),
           mileage            = COALESCE(@mileage, mileage),
           is_pending         = @is_pending,
           last_seen_at       = @now,
           details_fetched_at = @now
     WHERE id = @id
  `);

  const insertPhoto = db.prepare(`
    INSERT OR IGNORE INTO listing_photos (listing_id, position, url)
    VALUES (?, ?, ?)
  `);
  const photoCount = db.prepare<[string], { n: number }>(
    "SELECT COUNT(*) AS n FROM listing_photos WHERE listing_id = ?"
  );

  db.transaction(() => {
    update.run({
      id: detail.id,
      title: detail.title,
      description: detail.description,
      condition: detail.condition,
      location: detail.location,
      seller_name: detail.seller?.name || detail.sellerName,
      seller_profile_url: detail.seller?.profileUrl ?? "",
      price_cents: parsePriceCents(detail.price),
      price_text: detail.price,
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      trim: vehicle.trim,
      mileage: vehicle.mileage,
      is_pending: detail.isPending ? 1 : 0,
      now,
    });

    // Append photos after whatever the search result already stored.
    let position = photoCount.get(detail.id)?.n ?? 0;
    for (const url of detail.images) {
      insertPhoto.run(detail.id, position++, url);
    }
  })();
}

export interface QueryFilters {
  /** Only listings whose page has not been fetched yet. */
  needsDetails?: boolean;
  /** Only listings with no KBB valuation recorded. */
  needsValuation?: boolean;
  /** Only listings flagged as at/under the deal threshold. */
  dealsOnly?: boolean;
  /** ISO timestamp — only listings first seen at or after this. */
  since?: string;
  make?: string;
  model?: string;
  monitorName?: string;
  limit?: number;
}

export function queryListings(
  filters: QueryFilters = {}
): ListingWithValuation[] {
  const db = getDb();
  const where: string[] = [];
  const params: Record<string, unknown> = {};

  if (filters.needsDetails) where.push("l.details_fetched_at IS NULL");
  if (filters.needsValuation) where.push("v.listing_id IS NULL");
  if (filters.dealsOnly) where.push("v.is_deal = 1");
  if (filters.since) {
    where.push("l.first_seen_at >= @since");
    params.since = filters.since;
  }
  if (filters.make) {
    where.push("LOWER(l.make) = LOWER(@make)");
    params.make = filters.make;
  }
  if (filters.model) {
    where.push("LOWER(l.model) = LOWER(@model)");
    params.model = filters.model;
  }
  if (filters.monitorName) {
    where.push("l.monitor_name = @monitorName");
    params.monitorName = filters.monitorName;
  }

  params.limit = filters.limit ?? 100;

  const rows = db
    .prepare(
      `
      SELECT l.*,
             (SELECT COUNT(*) FROM listing_photos p WHERE p.listing_id = l.id)
               AS photo_count,
             v.listing_id AS v_listing_id, v.kbb_value, v.kbb_range_low,
             v.kbb_range_high, v.condition_assumed, v.source_url, v.notes,
             v.pct_under, v.is_deal, v.threshold_pct, v.valued_at
        FROM listings l
        LEFT JOIN valuations v ON v.listing_id = l.id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY COALESCE(v.pct_under, -1e9) DESC, l.first_seen_at DESC
       LIMIT @limit
      `
    )
    .all(params) as Record<string, unknown>[];

  return rows.map(toListingWithValuation);
}

export function getListing(id: string): ListingWithValuation | null {
  const rows = getDb()
    .prepare(
      `
      SELECT l.*,
             (SELECT COUNT(*) FROM listing_photos p WHERE p.listing_id = l.id)
               AS photo_count,
             v.listing_id AS v_listing_id, v.kbb_value, v.kbb_range_low,
             v.kbb_range_high, v.condition_assumed, v.source_url, v.notes,
             v.pct_under, v.is_deal, v.threshold_pct, v.valued_at
        FROM listings l
        LEFT JOIN valuations v ON v.listing_id = l.id
       WHERE l.id = ?
      `
    )
    .all(id) as Record<string, unknown>[];

  return rows.length ? toListingWithValuation(rows[0]) : null;
}

export function getPhotos(listingId: string): string[] {
  return (
    getDb()
      .prepare<[string], { url: string }>(
        "SELECT url FROM listing_photos WHERE listing_id = ? ORDER BY position"
      )
      .all(listingId) as { url: string }[]
  ).map((r) => r.url);
}

export interface ValuationInput {
  listingId: string;
  kbbValue: number;
  rangeLow?: number;
  rangeHigh?: number;
  conditionAssumed?: string;
  sourceUrl?: string;
  notes?: string;
  thresholdPct?: number;
}

export interface ValuationOutcome {
  listing: StoredListing;
  pctUnder: number | null;
  isDeal: boolean;
  thresholdPct: number;
}

/**
 * Record a KBB private party value and score the listing against it.
 * `pct_under` is positive when the asking price is below KBB.
 */
export function recordValuation(input: ValuationInput): ValuationOutcome {
  const db = getDb();

  const listing = db
    .prepare<[string], StoredListing>("SELECT * FROM listings WHERE id = ?")
    .get(input.listingId) as StoredListing | undefined;

  if (!listing) {
    throw new Error(
      `Listing ${input.listingId} is not in the database. Save it first.`
    );
  }
  if (!Number.isFinite(input.kbbValue) || input.kbbValue <= 0) {
    throw new Error(`kbb_value must be a positive dollar amount.`);
  }

  const threshold = input.thresholdPct ?? DEFAULT_DEAL_THRESHOLD_PCT;

  let pctUnder: number | null = null;
  if (listing.price_cents !== null && listing.price_cents > 0) {
    const askDollars = listing.price_cents / 100;
    pctUnder = ((input.kbbValue - askDollars) / input.kbbValue) * 100;
    pctUnder = Math.round(pctUnder * 100) / 100;
  }

  const isDeal = pctUnder !== null && pctUnder >= threshold;

  db.prepare(
    `
    INSERT INTO valuations (
      listing_id, kbb_value, kbb_range_low, kbb_range_high, condition_assumed,
      source_url, notes, pct_under, is_deal, threshold_pct, valued_at
    ) VALUES (
      @listing_id, @kbb_value, @kbb_range_low, @kbb_range_high, @condition_assumed,
      @source_url, @notes, @pct_under, @is_deal, @threshold_pct, @valued_at
    )
    ON CONFLICT(listing_id) DO UPDATE SET
      kbb_value         = excluded.kbb_value,
      kbb_range_low     = excluded.kbb_range_low,
      kbb_range_high    = excluded.kbb_range_high,
      condition_assumed = excluded.condition_assumed,
      source_url        = excluded.source_url,
      notes             = excluded.notes,
      pct_under         = excluded.pct_under,
      is_deal           = excluded.is_deal,
      threshold_pct     = excluded.threshold_pct,
      valued_at         = excluded.valued_at
    `
  ).run({
    listing_id: input.listingId,
    kbb_value: Math.round(input.kbbValue),
    kbb_range_low: input.rangeLow ? Math.round(input.rangeLow) : null,
    kbb_range_high: input.rangeHigh ? Math.round(input.rangeHigh) : null,
    condition_assumed: input.conditionAssumed ?? null,
    source_url: input.sourceUrl ?? null,
    notes: input.notes ?? null,
    pct_under: pctUnder,
    is_deal: isDeal ? 1 : 0,
    threshold_pct: threshold,
    valued_at: new Date().toISOString(),
  });

  return { listing, pctUnder, isDeal, thresholdPct: threshold };
}

export function recordScanRun(
  monitorName: string,
  found: number,
  newCount: number,
  error?: string
): void {
  getDb()
    .prepare(
      `INSERT INTO scan_runs (monitor_name, ran_at, found, new_count, error)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(monitorName, new Date().toISOString(), found, newCount, error ?? null);
}

export interface DbStats {
  totalListings: number;
  needingDetails: number;
  needingValuation: number;
  deals: number;
  newToday: number;
  byModel: { make: string; model: string; count: number }[];
  lastScanAt: string | null;
}

export function getStats(): DbStats {
  const db = getDb();
  const scalar = (sql: string, ...args: unknown[]): number =>
    (db.prepare(sql).get(...args) as { n: number }).n;

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  return {
    totalListings: scalar("SELECT COUNT(*) AS n FROM listings"),
    needingDetails: scalar(
      "SELECT COUNT(*) AS n FROM listings WHERE details_fetched_at IS NULL"
    ),
    needingValuation: scalar(
      `SELECT COUNT(*) AS n FROM listings l
        LEFT JOIN valuations v ON v.listing_id = l.id
        WHERE v.listing_id IS NULL`
    ),
    deals: scalar("SELECT COUNT(*) AS n FROM valuations WHERE is_deal = 1"),
    newToday: scalar(
      "SELECT COUNT(*) AS n FROM listings WHERE first_seen_at >= ?",
      startOfToday.toISOString()
    ),
    byModel: db
      .prepare(
        `SELECT COALESCE(make, 'Unknown') AS make,
                COALESCE(model, 'Unknown') AS model,
                COUNT(*) AS count
           FROM listings GROUP BY make, model ORDER BY count DESC`
      )
      .all() as { make: string; model: string; count: number }[],
    lastScanAt:
      (
        db
          .prepare("SELECT MAX(ran_at) AS ran_at FROM scan_runs")
          .get() as { ran_at: string | null }
      ).ran_at ?? null,
  };
}

function toListingWithValuation(
  row: Record<string, unknown>
): ListingWithValuation {
  const valuation: StoredValuation | null = row.v_listing_id
    ? {
        listing_id: row.v_listing_id as string,
        kbb_value: row.kbb_value as number,
        kbb_range_low: row.kbb_range_low as number | null,
        kbb_range_high: row.kbb_range_high as number | null,
        condition_assumed: row.condition_assumed as string | null,
        source_url: row.source_url as string | null,
        notes: row.notes as string | null,
        pct_under: row.pct_under as number | null,
        is_deal: row.is_deal as number,
        threshold_pct: row.threshold_pct as number,
        valued_at: row.valued_at as string,
      }
    : null;

  return {
    id: row.id as string,
    title: row.title as string,
    url: row.url as string,
    price_cents: row.price_cents as number | null,
    price_text: row.price_text as string | null,
    year: row.year as number | null,
    make: row.make as string | null,
    model: row.model as string | null,
    trim: row.trim as string | null,
    mileage: row.mileage as number | null,
    location: row.location as string | null,
    seller_name: row.seller_name as string | null,
    seller_profile_url: row.seller_profile_url as string | null,
    description: row.description as string | null,
    condition: row.condition as string | null,
    is_pending: row.is_pending as number,
    posted_at: row.posted_at as string | null,
    monitor_name: row.monitor_name as string | null,
    first_seen_at: row.first_seen_at as string,
    last_seen_at: row.last_seen_at as string,
    details_fetched_at: row.details_fetched_at as string | null,
    photo_count: row.photo_count as number,
    valuation,
  };
}
