// Data access for the website. Every call is one Postgres function (see
// supabase/migrations); `rpc(name, args)` runs it and returns its JSON.
import { istDay, dayStart, DAY_MS } from './days.js';

const HISTORY_DAYS = 730;
const NUMERIC = ['mrp', 'last_price', 'low_price', 'high_price', 'typical_price', 'first_seen', 'last_seen', 'last_checked', 'check_failures', 'days', 'reporters'];

function normalise(row) {
  if (!row) return null;
  const out = { ...row };
  for (const k of NUMERIC) if (out[k] !== null && out[k] !== undefined) out[k] = Number(out[k]);
  return out;
}

export function createStore(rpc, { writeToken } = {}) {
  return {
    async getProduct(key) {
      return normalise(await rpc('get_product', { p_key: key }));
    },

    /** Daily median prices, oldest first: [[dayStartMs, price], ...]. */
    async getSeries(key, now) {
      const rows = (await rpc('get_series', { p_key: key, p_since: istDay(now - HISTORY_DAYS * DAY_MS) })) || [];
      return rows.map((r) => [dayStart(String(r.day)), Number(r.price)]);
    },

    async deals(now, limit = 12) {
      return ((await rpc('list_deals', { p_since: now - 2 * DAY_MS, p_limit: limit })) || []).map(normalise);
    },

    async recentlyTracked(limit = 12) {
      return ((await rpc('list_recent', { p_limit: limit })) || []).map(normalise);
    },

    async sitemapProducts(limit = 5000) {
      return ((await rpc('list_sitemap', { p_limit: limit })) || []).map(normalise);
    },

    async recordClick(key) {
      await rpc('record_click', { p_token: writeToken, p_key: key });
    },

    /** Record a server check (creates the product row on first sight). */
    async markChecked({ ident, now, ok, error }) {
      await rpc('mark_checked', {
        p_token: writeToken,
        p_key: ident.key,
        p_store: ident.store,
        p_pid: ident.id,
        p_url: ident.url,
        p_now: now,
        p_ok: !!ok,
        p_error: error || null,
      });
    },

    /** Products whose last check is older than `before`: [{key, store, pid, url, last_checked}]. */
    async listDue(before, limit = 30) {
      return ((await rpc('list_due', { p_token: writeToken, p_before: before, p_limit: limit })) || []).map(normalise);
    },

    /** Count one use for `who` today; false when the daily limit is reached. */
    async bumpUsage(who, now, limit) {
      return (await rpc('bump_usage', { p_token: writeToken, p_who: who, p_now: now, p_limit: limit })) === true;
    },

    /** @returns {Promise<{accepted: number} | {error: 'rate_limited'}>} */
    ingest({ clientHash, ipHash, points, now, clientLimit, ipLimit }) {
      return rpc('ingest_prices', {
        p_token: writeToken,
        p_client: clientHash,
        p_ip: ipHash,
        p_points: points,
        p_now: now,
        p_client_limit: clientLimit,
        p_ip_limit: ipLimit,
      });
    },
  };
}
