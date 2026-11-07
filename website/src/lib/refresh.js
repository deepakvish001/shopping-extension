// Server-side price checks: one product on demand, or a batch of due
// products for the schedule (Supabase pg_cron calls /api/cron/refresh).
import { PTStores } from './shared.js';
import { fetchProduct } from './fetcher.js';
import { validatePoint } from './ingest.js';
import { istDay } from './days.js';

/** Reporter id for the website's own checks (real reporters are 32-char hashes). */
export const SERVER_CLIENT = 'server';
/** A product is re-checked when its last check is older than this. */
export const STALE_MS = 6 * 60 * 60 * 1000;

export function isStale(product, now) {
  return !product || !product.last_checked || now - product.last_checked > STALE_MS;
}

/** Fetch one product now, store its price, record the outcome. */
export async function refreshProduct(env, ident, now = Date.now()) {
  const res = await fetchProduct(ident, { fetchImpl: env.fetchImpl, proxyTemplate: env.FETCH_PROXY_TEMPLATE });
  let ok = res.ok;
  let error = res.error || null;
  let price = null;
  if (res.ok) {
    const v = validatePoint({ ...res.product, t: now }, now);
    if (v.ok) {
      await env.store.ingest({
        clientHash: SERVER_CLIENT,
        ipHash: 'server-ip',
        points: [{ ...v.point, day: istDay(now) }],
        now,
        clientLimit: 1_000_000_000,
        ipLimit: 1_000_000_000,
      });
      price = v.point.price;
    } else {
      ok = false;
      error = `invalid data: ${v.reason}`;
    }
  }
  await env.store.markChecked({ ident, now, ok, error });
  return { ok, error, price };
}

/**
 * Re-check the products whose last check is oldest, a few at a time, within
 * a time budget that fits a serverless function call.
 */
export async function refreshDue(env, { now = Date.now(), limit = 30, concurrency = 3, budgetMs = 45_000, clock = Date.now } = {}) {
  const due = await env.store.listDue(now - STALE_MS, limit);
  const started = clock();
  const results = [];
  let next = 0;
  async function worker() {
    while (next < due.length && clock() - started < budgetMs) {
      const row = due[next++];
      const ident = PTStores.identify(row.url);
      if (!ident) {
        await env.store.markChecked({ ident: { key: row.key, store: row.store, id: row.pid, url: row.url }, now: clock(), ok: false, error: 'unrecognised url' });
        results.push({ key: row.key, ok: false, error: 'unrecognised url' });
        continue;
      }
      try {
        results.push({ key: row.key, ...(await refreshProduct(env, ident, clock())) });
      } catch (err) {
        results.push({ key: row.key, ok: false, error: String((err && err.message) || err).slice(0, 200) });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return { due: due.length, checked: results.length, ok: results.filter((r) => r.ok).length, results };
}
