-- Products seen by any user, with aggregates refreshed on every upload.
CREATE TABLE IF NOT EXISTS products (
  key TEXT PRIMARY KEY,              -- "<store>:<id>", e.g. "flipkart:MOBGZ12345"
  store TEXT NOT NULL,
  pid TEXT NOT NULL,
  url TEXT NOT NULL,                 -- canonical product URL
  title TEXT,
  image TEXT,
  mrp REAL,
  first_seen INTEGER NOT NULL,       -- ms since epoch
  last_seen INTEGER NOT NULL,
  last_price REAL,                   -- today's (or latest day's) median price
  low_price REAL,
  low_day TEXT,
  high_price REAL,
  typical_price REAL,                -- median of daily prices over the last 90 days
  days INTEGER NOT NULL DEFAULT 0,   -- days with at least one report
  reporters INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_products_last_seen ON products(last_seen);

-- One price per product, per day (IST), per anonymous reporter: the latest wins.
CREATE TABLE IF NOT EXISTS observations (
  key TEXT NOT NULL,
  day TEXT NOT NULL,                 -- YYYY-MM-DD in India time
  client TEXT NOT NULL,              -- salted hash of the extension's random id
  price REAL NOT NULL,
  t INTEGER NOT NULL,
  PRIMARY KEY (key, day, client)
);

-- Daily upload counters for rate limiting (per client hash and per IP hash).
CREATE TABLE IF NOT EXISTS usage (
  who TEXT NOT NULL,
  day TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (who, day)
);
