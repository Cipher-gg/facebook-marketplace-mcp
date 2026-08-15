import { z } from "zod";
import {
  queryListings,
  recordValuation,
  getStats,
  getPhotos,
  DEFAULT_DEAL_THRESHOLD_PCT,
  type ListingWithValuation,
} from "../storage/listings.js";
import { databasePath } from "../storage/db.js";

export const queryListingsSchema = {
  needs_details: z
    .boolean()
    .optional()
    .describe("Only listings whose detail page has not been fetched yet"),
  needs_valuation: z
    .boolean()
    .optional()
    .describe("Only listings with no KBB value recorded yet"),
  deals_only: z
    .boolean()
    .optional()
    .describe(
      `Only listings priced at or below the deal threshold (default ${DEFAULT_DEAL_THRESHOLD_PCT}% under KBB)`
    ),
  since: z
    .string()
    .optional()
    .describe("ISO timestamp — only listings first seen at or after this"),
  make: z.string().optional().describe("Filter by make, e.g. 'Toyota'"),
  model: z.string().optional().describe("Filter by model, e.g. 'RAV4'"),
  monitor_name: z
    .string()
    .optional()
    .describe("Filter by the monitor that found the listing"),
  limit: z.number().default(50).describe("Max rows to return (default: 50)"),
  include_photos: z
    .boolean()
    .default(false)
    .describe("Include photo URLs for each listing"),
};

export function createQueryListingsHandler() {
  return async (args: {
    needs_details?: boolean;
    needs_valuation?: boolean;
    deals_only?: boolean;
    since?: string;
    make?: string;
    model?: string;
    monitor_name?: string;
    limit: number;
    include_photos: boolean;
  }) => {
    try {
      const rows = queryListings({
        needsDetails: args.needs_details,
        needsValuation: args.needs_valuation,
        dealsOnly: args.deals_only,
        since: args.since,
        make: args.make,
        model: args.model,
        monitorName: args.monitor_name,
        limit: args.limit,
      });

      if (rows.length === 0) {
        return text("No listings matched those filters.");
      }

      const body = rows
        .map((r) => formatListing(r, args.include_photos))
        .join("\n\n");

      return text(`Found ${rows.length} listing(s):\n\n${body}`);
    } catch (error) {
      return errorText("Error querying listings", error);
    }
  };
}

export const recordValuationSchema = {
  listing_id: z
    .string()
    .describe("Marketplace listing ID (must already be in the database)"),
  kbb_value: z
    .number()
    .describe(
      "KBB private party value in dollars — the single figure to compare the asking price against"
    ),
  range_low: z
    .number()
    .optional()
    .describe("Low end of the KBB private party range, if published"),
  range_high: z
    .number()
    .optional()
    .describe("High end of the KBB private party range, if published"),
  condition_assumed: z
    .string()
    .optional()
    .describe("Condition the value assumes: excellent / very good / good / fair"),
  source_url: z
    .string()
    .optional()
    .describe("URL the value came from, so the number can be audited later"),
  notes: z
    .string()
    .optional()
    .describe("How the value was derived, mileage adjustments, caveats"),
  threshold_pct: z
    .number()
    .optional()
    .describe(
      `Percent under KBB that counts as a deal (default: ${DEFAULT_DEAL_THRESHOLD_PCT})`
    ),
};

export function createRecordValuationHandler() {
  return async (args: {
    listing_id: string;
    kbb_value: number;
    range_low?: number;
    range_high?: number;
    condition_assumed?: string;
    source_url?: string;
    notes?: string;
    threshold_pct?: number;
  }) => {
    try {
      const result = recordValuation({
        listingId: args.listing_id,
        kbbValue: args.kbb_value,
        rangeLow: args.range_low,
        rangeHigh: args.range_high,
        conditionAssumed: args.condition_assumed,
        sourceUrl: args.source_url,
        notes: args.notes,
        thresholdPct: args.threshold_pct,
      });

      const ask = result.listing.price_cents;
      const askText = ask !== null ? money(ask / 100) : "unknown";

      if (result.pctUnder === null) {
        return text(
          `Recorded KBB ${money(args.kbb_value)} for "${result.listing.title}".\n` +
            `⚠️ Asking price is ${askText}, so no discount could be computed.`
        );
      }

      const verdict = result.isDeal
        ? `🚩 **DEAL** — ${result.pctUnder.toFixed(1)}% under KBB (threshold: ${result.thresholdPct}%)`
        : result.pctUnder >= 0
          ? `${result.pctUnder.toFixed(1)}% under KBB — below the ${result.thresholdPct}% threshold`
          : `${Math.abs(result.pctUnder).toFixed(1)}% **over** KBB`;

      return text(
        `Recorded valuation for "${result.listing.title}"\n` +
          `Asking: ${askText} | KBB private party: ${money(args.kbb_value)}\n` +
          verdict
      );
    } catch (error) {
      return errorText("Error recording valuation", error);
    }
  };
}

export const dbStatsSchema = {};

export function createDbStatsHandler() {
  return async () => {
    try {
      const s = getStats();
      const breakdown = s.byModel
        .map((m) => `  - ${m.make} ${m.model}: ${m.count}`)
        .join("\n");

      return text(
        [
          `## Car database`,
          `Location: \`${databasePath()}\``,
          "",
          `- Total listings: **${s.totalListings}**`,
          `- First seen today: **${s.newToday}**`,
          `- Awaiting detail fetch: **${s.needingDetails}**`,
          `- Awaiting KBB valuation: **${s.needingValuation}**`,
          `- Flagged deals: **${s.deals}**`,
          `- Last scan: ${s.lastScanAt ?? "never"}`,
          "",
          breakdown ? `### By model\n${breakdown}` : "",
        ]
          .filter(Boolean)
          .join("\n")
      );
    } catch (error) {
      return errorText("Error reading database stats", error);
    }
  };
}

function formatListing(r: ListingWithValuation, includePhotos: boolean): string {
  const name =
    [r.year, r.make, r.model, r.trim].filter(Boolean).join(" ") || r.title;

  const lines = [
    `### ${name}${r.is_pending ? " ⏳ PENDING" : ""}`,
    `- **ID:** \`${r.id}\``,
    `- **Asking:** ${r.price_cents !== null ? money(r.price_cents / 100) : (r.price_text ?? "N/A")}`,
    `- **Mileage:** ${r.mileage !== null ? `${r.mileage.toLocaleString("en-US")} mi` : "unknown"}`,
    `- **Location:** ${r.location ?? "unknown"}`,
    `- **Seller:** ${r.seller_name ?? "unknown"}`,
    `- **Photos:** ${r.photo_count}`,
    `- **First seen:** ${r.first_seen_at}`,
    `- **Details fetched:** ${r.details_fetched_at ? "yes" : "no"}`,
  ];

  if (r.valuation) {
    const v = r.valuation;
    const pct =
      v.pct_under === null
        ? "n/a"
        : v.pct_under >= 0
          ? `${v.pct_under.toFixed(1)}% under`
          : `${Math.abs(v.pct_under).toFixed(1)}% over`;
    lines.push(
      `- **KBB private party:** ${money(v.kbb_value)} (${pct})${v.is_deal ? " 🚩 **DEAL**" : ""}`
    );
    if (v.source_url) lines.push(`- **KBB source:** ${v.source_url}`);
  } else {
    lines.push(`- **KBB:** not valued yet`);
  }

  lines.push(`- 🔗 ${r.url}`);

  if (includePhotos) {
    const photos = getPhotos(r.id);
    if (photos.length) {
      lines.push(
        `- **Photo URLs:**\n${photos.map((u, i) => `  ${i + 1}. ${u}`).join("\n")}`
      );
    }
  }

  return lines.join("\n");
}

function money(dollars: number): string {
  return `$${Math.round(dollars).toLocaleString("en-US")}`;
}

function text(body: string) {
  return { content: [{ type: "text" as const, text: body }] };
}

function errorText(prefix: string, error: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: `${prefix}: ${error instanceof Error ? error.message : String(error)}`,
      },
    ],
    isError: true,
  };
}
