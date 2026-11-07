// Turn raw reports into one price per day, and the aggregates kept on products.
import { dayStart, istDay, DAY_MS } from './days.js';

/** Lower median: always a price someone actually reported. */
export function lowerMedian(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

/**
 * rows: [{day, price}] (many reporters per day) -> [[dayStartMs, price], ...].
 * A median per day means one wrong or fake report cannot move the price
 * once a few people report the same product.
 */
export function dailySeries(rows) {
  const byDay = new Map();
  for (const r of rows) {
    if (!byDay.has(r.day)) byDay.set(r.day, []);
    byDay.get(r.day).push(r.price);
  }
  return [...byDay.keys()].sort().map((day) => [dayStart(day), lowerMedian(byDay.get(day))]);
}

/** Aggregates stored on the product row; null when there is no data. */
export function aggregates(series, now) {
  if (!series.length) return null;
  let low = series[0];
  let high = series[0];
  for (const p of series) {
    if (p[1] <= low[1]) low = p; // most recent day at the lowest price
    if (p[1] > high[1]) high = p;
  }
  const recent = series.filter((p) => p[0] >= now - 90 * DAY_MS).map((p) => p[1]);
  return {
    last_price: series[series.length - 1][1],
    low_price: low[1],
    low_day: istDay(low[0]),
    high_price: high[1],
    typical_price: recent.length >= 5 ? lowerMedian(recent) : null,
    days: series.length,
  };
}
