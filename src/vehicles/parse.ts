// Extracts structured vehicle attributes from Marketplace listing text.
// Facebook puts most of it in the title ("2016 Toyota RAV4 XLE AWD") and
// leaves mileage to the subtitle or description, so we scan both.

export interface VehicleAttributes {
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  mileage: number | null;
}

interface ModelSpec {
  /** Canonical model name as stored in the database. */
  name: string;
  /** Lowercase spellings sellers actually type. */
  aliases: string[];
  /** Known trims, matched longest-first so "TRD Off-Road" beats "TRD". */
  trims: string[];
}

const MAKES: Record<string, ModelSpec[]> = {
  Toyota: [
    {
      name: "RAV4",
      aliases: ["rav4", "rav 4", "rav-4"],
      trims: [
        "TRD Off-Road",
        "XLE Premium",
        "Limited Hybrid",
        "Adventure",
        "Woodland",
        "Platinum",
        "Limited",
        "XSE",
        "XLE",
        "LE",
        "SE",
        "Sport",
        "Base",
      ],
    },
    {
      name: "4Runner",
      aliases: ["4runner", "4 runner", "four runner", "forerunner"],
      trims: [
        "TRD Off-Road Premium",
        "SR5 Premium",
        "TRD Off-Road",
        "TRD Sport",
        "TRD Pro",
        "Nightshade",
        "Trailhunter",
        "Wilderness",
        "Limited",
        "Venture",
        "Platinum",
        "Trail",
        "SR5",
      ],
    },
  ],
  Subaru: [
    {
      name: "Outback",
      aliases: ["outback"],
      trims: [
        "Onyx Edition XT",
        "Limited XT",
        "Touring XT",
        "Onyx Edition",
        "Wilderness",
        "Premium",
        "Limited",
        "Touring",
        "3.6R",
        "2.5i",
        "Base",
      ],
    },
    {
      name: "Forester",
      aliases: ["forester"],
      trims: [
        "Wilderness",
        "Premium",
        "Limited",
        "Touring",
        "Sport",
        "2.5i",
        "2.5X",
        "XT",
        "Base",
      ],
    },
  ],
};

const CURRENT_YEAR = new Date().getFullYear();
const MIN_YEAR = 1960;
const MAX_YEAR = CURRENT_YEAR + 2;

/** Upper bound for a believable odometer reading. */
const MAX_MILEAGE = 600_000;

export function parseVehicle(
  title: string,
  description = ""
): VehicleAttributes {
  const haystack = `${title}\n${description}`;

  const { make, model } = matchMakeModel(haystack);

  return {
    year: parseYear(title) ?? parseYear(description),
    make,
    model: model?.name ?? null,
    trim: model ? parseTrim(haystack, model) : null,
    mileage: parseMileage(haystack),
  };
}

function matchMakeModel(text: string): {
  make: string | null;
  model: ModelSpec | null;
} {
  const lower = text.toLowerCase();

  for (const [make, models] of Object.entries(MAKES)) {
    for (const model of models) {
      if (model.aliases.some((alias) => lower.includes(alias))) {
        return { make, model };
      }
    }
  }

  // Model didn't match but the make might still be stated — worth recording.
  for (const make of Object.keys(MAKES)) {
    if (lower.includes(make.toLowerCase())) {
      return { make, model: null };
    }
  }

  return { make: null, model: null };
}

export function parseYear(text: string): number | null {
  // Prefer a model year at the start of the title, which is the convention.
  const leading = text.trim().match(/^(?:'|’)?(\d{2}|\d{4})\b/);
  if (leading) {
    const year = normalizeYear(leading[1]);
    if (year) return year;
  }

  for (const match of text.matchAll(/\b(19\d{2}|20\d{2})\b/g)) {
    const year = normalizeYear(match[1]);
    if (year) return year;
  }

  return null;
}

function normalizeYear(raw: string): number | null {
  let year = Number(raw);
  if (raw.length === 2) {
    // '98 -> 1998, '16 -> 2016
    year += year <= CURRENT_YEAR % 100 ? 2000 : 1900;
  }
  return year >= MIN_YEAR && year <= MAX_YEAR ? year : null;
}

function parseTrim(text: string, model: ModelSpec): string | null {
  const lower = text.toLowerCase();

  // Longest trim first so multi-word trims win over their prefixes.
  const byLength = [...model.trims].sort((a, b) => b.length - a.length);

  for (const trim of byLength) {
    // Trims contain regex-significant characters (".", "-"), so escape them.
    const pattern = new RegExp(
      `(?:^|[^a-z0-9])${escapeRegex(trim.toLowerCase())}(?:$|[^a-z0-9])`
    );
    if (pattern.test(lower)) return trim;
  }

  return null;
}

// "96k" / "123,456" / "123456". The k-suffixed form must come first, or
// "96k miles" matches the bare-digits branch and reads as 96.
const MILEAGE_NUMBER = String.raw`\d{1,3}(?:\.\d)?\s*k|\d{1,3}(?:,\d{3})+|\d{1,7}`;

export function parseMileage(text: string): number | null {
  const candidates: number[] = [];

  // "123,456 miles" / "123456 mi" / "96k miles"
  const withUnit = new RegExp(
    String.raw`\b(${MILEAGE_NUMBER})\s*(?:miles|mile|mi)\b`,
    "gi"
  );
  for (const match of text.matchAll(withUnit)) {
    const value = normalizeMileage(match[1]);
    if (value !== null) candidates.push(value);
  }

  // "mileage: 123,456" / "odometer 123456"
  const withLabel = new RegExp(
    String.raw`\b(?:mileage|odometer|odo)\b\s*[:\-–]?\s*(${MILEAGE_NUMBER})\b`,
    "gi"
  );
  for (const match of text.matchAll(withLabel)) {
    const value = normalizeMileage(match[1]);
    if (value !== null) candidates.push(value);
  }

  if (candidates.length === 0) return null;

  // Sellers often mention several numbers ("new tires at 90k, now 145k miles").
  // The odometer is the largest plausible one.
  return Math.max(...candidates);
}

function normalizeMileage(raw: string): number | null {
  const cleaned = raw.replace(/,/g, "").trim().toLowerCase();

  let value: number;
  if (cleaned.endsWith("k")) {
    value = Math.round(parseFloat(cleaned.slice(0, -1).trim()) * 1000);
  } else {
    value = Number(cleaned);
  }

  if (!Number.isFinite(value) || value <= 0 || value > MAX_MILEAGE) {
    return null;
  }
  return value;
}

/** "$12,345" / "12345" / "Free" -> cents, or null when unparseable. */
export function parsePriceCents(priceText: string): number | null {
  if (!priceText) return null;
  if (/free/i.test(priceText)) return 0;

  const match = priceText.replace(/,/g, "").match(/(\d+(?:\.\d{1,2})?)/);
  if (!match) return null;

  const dollars = parseFloat(match[1]);
  if (!Number.isFinite(dollars) || dollars < 0) return null;

  return Math.round(dollars * 100);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
