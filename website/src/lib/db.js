// All D1 queries in one place.
import { istDay, DAY_MS } from './days.js';
import { dailySeries, aggregates } from './series.js';

const HISTORY_DAYS = 730;

export function getProduct(db, key) {
  return db.prepare('SELECT * FROM products WHERE key = ?').bind(key).first();
}

/** Daily price series for a product, oldest first. */
export async function getSeries(db, key, now) {
  const since = istDay(now - HISTORY_DAYS * DAY_MS);
  const { results } = await db.prepare('SELECT day, price FROM observations WHERE key = ? AND day >= ?').bind(key, since).all();
  return dailySeries(results);
}

export async function refreshAggregates(db, key, now) {
  const series = await getSeries(db, key, now);
  const agg = aggregates(series, now);
  if (!agg) return null;
  const row = await db.prepare('SELECT COUNT(DISTINCT client) AS n FROM observations WHERE key = ?').bind(key).first();
  await db
    .prepare(
      `UPDATE products SET last_price = ?, low_price = ?, low_day = ?, high_price = ?, typical_price = ?, days = ?, reporters = ?
       WHERE key = ?`
    )
    .bind(agg.last_price, agg.low_price, agg.low_day, agg.high_price, agg.typical_price, agg.days, row ? row.n : 0, key)
    .run();
  return agg;
}

/**
 * Real price drops: seen in the last 2 days, at least 5 days of data, and
 * at least 5% under the typical (90-day median) price. A median ignores a
 * short pre-sale price hike, so "raise then discount" tricks do not qualify.
 */
export async function deals(db, now, limit = 12) {
  const { results } = await db
    .prepare(
      `SELECT key, store, pid, title, image, last_price, typical_price, low_price, days
         FROM products
        WHERE last_seen >= ? AND days >= 5 AND typical_price > 0 AND last_price <= typical_price * 0.95
        ORDER BY last_price / typical_price ASC
        LIMIT ?`
    )
    .bind(now - 2 * DAY_MS, limit)
    .all();
  return results;
}

export async function recentlyTracked(db, limit = 12) {
  const { results } = await db
    .prepare('SELECT key, store, pid, title, image, last_price, typical_price, low_price, days FROM products WHERE days >= 2 ORDER BY last_seen DESC LIMIT ?')
    .bind(limit)
    .all();
  return results;
}

export async function sitemapProducts(db, limit = 5000) {
  const { results } = await db.prepare('SELECT store, pid, last_seen FROM products WHERE days >= 2 ORDER BY last_seen DESC LIMIT ?').bind(limit).all();
  return results;
}

export function recordClick(db, key) {
  return db.prepare('UPDATE products SET clicks = clicks + 1 WHERE key = ?').bind(key).run();
}
