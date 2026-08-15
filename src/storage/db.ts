import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";

const STORAGE_DIR = path.join(os.homedir(), ".fb-marketplace");

export function databasePath(): string {
  return process.env.FB_MARKETPLACE_DB ?? path.join(STORAGE_DIR, "cars.db");
}

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const file = databasePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });

  db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);

  return db;
}

/** Test/CLI helper — drops the cached handle so a new path takes effect. */
export function closeDb(): void {
  db?.close();
  db = null;
}

function migrate(conn: Database.Database): void {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS listings (
      id                 TEXT PRIMARY KEY,
      title              TEXT NOT NULL,
      url                TEXT NOT NULL,
      price_cents        INTEGER,
      price_text         TEXT,
      year               INTEGER,
      make               TEXT,
      model              TEXT,
      trim               TEXT,
      mileage            INTEGER,
      location           TEXT,
      seller_name        TEXT,
      seller_profile_url TEXT,
      description        TEXT,
      condition          TEXT,
      is_pending         INTEGER NOT NULL DEFAULT 0,
      posted_at          TEXT,
      monitor_name       TEXT,
      first_seen_at      TEXT NOT NULL,
      last_seen_at       TEXT NOT NULL,
      details_fetched_at TEXT
    );

    CREATE TABLE IF NOT EXISTS listing_photos (
      listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
      position   INTEGER NOT NULL,
      url        TEXT NOT NULL,
      PRIMARY KEY (listing_id, position)
    );

    CREATE TABLE IF NOT EXISTS valuations (
      listing_id        TEXT PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
      kbb_value         INTEGER NOT NULL,
      kbb_range_low     INTEGER,
      kbb_range_high    INTEGER,
      condition_assumed TEXT,
      source_url        TEXT,
      notes             TEXT,
      pct_under         REAL,
      is_deal           INTEGER NOT NULL DEFAULT 0,
      threshold_pct     REAL NOT NULL,
      valued_at         TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scan_runs (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      monitor_name TEXT NOT NULL,
      ran_at       TEXT NOT NULL,
      found        INTEGER NOT NULL DEFAULT 0,
      new_count    INTEGER NOT NULL DEFAULT 0,
      error        TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_listings_first_seen ON listings(first_seen_at);
    CREATE INDEX IF NOT EXISTS idx_listings_model      ON listings(make, model);
    CREATE INDEX IF NOT EXISTS idx_valuations_deal     ON valuations(is_deal);
  `);
}
