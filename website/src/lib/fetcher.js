// Fetch a product page from the shop and read its price with the same
// extractor the extension uses. Runs on the server (Vercel) for links people
// paste and for scheduled re-checks.
//
// The requests say openly who they are (a bot user agent with a link to the
// /bot page). When a shop refuses (403/429/503/captcha) we record that and
// back off; we do not try to get around a shop's bot protection.
import { parseHTML } from 'linkedom';
import { PTExtract } from './shared.js';

const MAX_HTML = 6 * 1024 * 1024;
const BLOCKED_RE = /(enter the characters you see below|api-services-support@amazon\.com|captcha|are you a robot|unusual traffic|access denied|request blocked)/i;

/** "Mozilla/5.0 (compatible; DaamDekhoBot/0.1; +https://site/bot)" */
export function botUserAgent(siteName = 'DaamDekho', siteUrl = '') {
  const name = `${String(siteName).replace(/[^A-Za-z0-9]/g, '') || 'PriceHistory'}Bot/0.1`;
  return `Mozilla/5.0 (compatible; ${name}${siteUrl ? `; +${siteUrl.replace(/\/+$/, '')}/bot` : ''})`;
}

/**
 * @param {{url: string}} ident  from PTStores.identify()
 * @param {{fetchImpl?: Function, userAgent?: string, timeoutMs?: number}} opts
 * @returns {Promise<{ok: true, product: object} | {ok: false, blocked?: boolean, error: string}>}
 */
export async function fetchProduct(ident, { fetchImpl = (...a) => fetch(...a), userAgent = botUserAgent(), timeoutMs = 9000 } = {}) {
  let res;
  try {
    res = await fetchImpl(ident.url, {
      headers: { 'user-agent': userAgent, accept: 'text/html,application/xhtml+xml', 'accept-language': 'en-IN,en;q=0.9' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return { ok: false, error: err && err.name === 'TimeoutError' ? 'timeout' : 'network error' };
  }
  if ([403, 429, 503, 529].includes(res.status)) return { ok: false, blocked: true, error: `blocked (HTTP ${res.status})` };
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
  const html = (await res.text()).slice(0, MAX_HTML);
  const { document } = parseHTML(html);
  const product = PTExtract.extract(document, ident.url, { freshPage: true });
  if (!product || !product.price) {
    if (BLOCKED_RE.test(html.slice(0, 200_000))) return { ok: false, blocked: true, error: 'blocked (captcha)' };
    // Say which page came back, to tell "product unavailable" from "unexpected layout".
    const text = (sel) => ((document.querySelector(sel) || {}).textContent || '').replace(/\s+/g, ' ').trim();
    const title = text('title').slice(0, 80);
    const availability = text('#availability').slice(0, 60);
    const prices = document.querySelectorAll('.a-price, [class*="price"]').length;
    const notes = [`${Math.round(html.length / 1024)} KB`, title && `"${title}"`, availability && `availability: ${availability}`, `${prices} price elements`];
    return { ok: false, error: `price not found (${notes.filter(Boolean).join(', ')})` };
  }
  return { ok: true, product };
}
