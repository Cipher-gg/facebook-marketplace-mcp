import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Point the database at a scratch file before anything opens a handle.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-mkt-test-"));
process.env.FB_MARKETPLACE_DB = path.join(tmpDir, "cars.db");

const { closeDb } = await import("./db.js");
const {
  saveSearchListings,
  saveListingDetail,
  queryListings,
  recordValuation,
  getPhotos,
  getStats,
} = await import("./listings.js");

test.after(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const searchResult = {
  id: "1001",
  title: "2016 Toyota RAV4 XLE AWD",
  price: "$14,500",
  location: "Dedham, MA",
  imageUrl: "https://scontent.example/thumb.jpg",
  sellerName: "Pat Q.",
  postedDate: "2026-08-14T12:00:00.000Z",
  url: "https://www.facebook.com/marketplace/item/1001/",
  isPending: false,
};

test("saving a search result parses the vehicle out of the title", () => {
  const saved = saveSearchListings([searchResult], "rav4");
  assert.deepEqual(saved, [{ id: "1001", isNew: true }]);

  const [row] = queryListings({ limit: 10 });
  assert.equal(row.year, 2016);
  assert.equal(row.make, "Toyota");
  assert.equal(row.model, "RAV4");
  assert.equal(row.trim, "XLE");
  assert.equal(row.price_cents, 1450000);
  assert.equal(row.location, "Dedham, MA");
  assert.equal(row.seller_name, "Pat Q.");
  assert.equal(row.monitor_name, "rav4");
  assert.equal(row.photo_count, 1);
});

test("re-seeing a listing is not new and does not duplicate it", () => {
  const saved = saveSearchListings(
    [{ ...searchResult, price: "$13,900", isPending: true }],
    "rav4"
  );
  assert.deepEqual(saved, [{ id: "1001", isNew: false }]);

  const rows = queryListings({ limit: 10 });
  assert.equal(rows.length, 1);
  // Volatile fields refresh; identity fields stay put.
  assert.equal(rows[0].price_cents, 1390000);
  assert.equal(rows[0].is_pending, 1);
});

test("detail fetch fills in mileage, photos, and description", () => {
  saveListingDetail({
    id: "1001",
    title: "2016 Toyota RAV4 XLE AWD",
    description: "Well maintained, 118,200 miles, clean title.",
    price: "$13,900",
    location: "Dedham, MA",
    imageUrl: "https://scontent.example/thumb.jpg",
    images: [
      "https://scontent.example/1.jpg",
      "https://scontent.example/2.jpg",
    ],
    sellerName: "Pat Q.",
    postedDate: "2026-08-14T12:00:00.000Z",
    url: "https://www.facebook.com/marketplace/item/1001/",
    isPending: true,
    condition: "Used - good",
    seller: { name: "Pat Q.", profileUrl: "https://facebook.com/patq" },
  });

  const [row] = queryListings({ limit: 10 });
  assert.equal(row.mileage, 118200);
  assert.equal(row.condition, "Used - good");
  assert.equal(row.seller_profile_url, "https://facebook.com/patq");
  assert.ok(row.details_fetched_at);
  assert.equal(getPhotos("1001").length, 3);
});

test("needs_details and needs_valuation filters track pipeline state", () => {
  saveSearchListings(
    [{ ...searchResult, id: "1002", title: "2019 Subaru Forester Sport" }],
    "forester"
  );

  const needingDetails = queryListings({ needsDetails: true });
  assert.deepEqual(
    needingDetails.map((r) => r.id),
    ["1002"]
  );

  const needingValuation = queryListings({ needsValuation: true });
  assert.equal(needingValuation.length, 2);
});

test("a price far enough under KBB is flagged as a deal", () => {
  // Asking $13,900 against KBB $17,500 is 20.6% under.
  const result = recordValuation({
    listingId: "1001",
    kbbValue: 17500,
    conditionAssumed: "good",
    sourceUrl: "https://www.kbb.com/toyota/rav4/2016/",
  });

  assert.equal(result.isDeal, true);
  assert.equal(result.thresholdPct, 15);
  assert.ok(result.pctUnder !== null && Math.abs(result.pctUnder - 20.57) < 0.01);

  const [deal] = queryListings({ dealsOnly: true });
  assert.equal(deal.id, "1001");
  assert.equal(deal.valuation?.is_deal, 1);
});

test("a price just inside the threshold is not flagged", () => {
  // Asking $13,900 against KBB $16,000 is 13.1% under — under the 15% bar.
  const result = recordValuation({ listingId: "1001", kbbValue: 16000 });
  assert.equal(result.isDeal, false);
  assert.equal(queryListings({ dealsOnly: true }).length, 0);
});

test("re-valuing a listing overwrites rather than duplicating", () => {
  recordValuation({ listingId: "1001", kbbValue: 17500 });
  const rows = queryListings({ limit: 10 });
  assert.equal(rows.filter((r) => r.id === "1001").length, 1);
  assert.equal(rows.find((r) => r.id === "1001")?.valuation?.kbb_value, 17500);
});

test("a custom threshold overrides the default", () => {
  const result = recordValuation({
    listingId: "1001",
    kbbValue: 15500,
    thresholdPct: 5,
  });
  assert.equal(result.isDeal, true);
  assert.equal(result.thresholdPct, 5);
});

test("an over-KBB price yields a negative discount", () => {
  saveSearchListings(
    [
      {
        ...searchResult,
        id: "1003",
        title: "2020 Subaru Outback Limited",
        price: "$30,000",
      },
    ],
    "outback"
  );
  const result = recordValuation({ listingId: "1003", kbbValue: 25000 });
  assert.equal(result.isDeal, false);
  assert.equal(result.pctUnder, -20);
});

test("valuing an unknown listing is an error", () => {
  assert.throws(
    () => recordValuation({ listingId: "does-not-exist", kbbValue: 10000 }),
    /not in the database/
  );
});

test("stats summarize the pipeline", () => {
  const stats = getStats();
  assert.equal(stats.totalListings, 3);
  assert.equal(stats.needingDetails, 2);
  assert.equal(stats.needingValuation, 1);
  assert.ok(stats.byModel.some((m) => m.model === "RAV4"));
});
