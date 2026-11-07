// Outbound "buy" links and resolving pasted links (including app short links).
import { PTStores, PTAffiliate } from './shared.js';

/**
 * Where the "Buy" button goes. Amazon stays a plain link: Amazon Associates
 * only allows prices next to Associates links when they come from Amazon's own
 * API and are less than 24 hours old, and these prices are crowd-sourced.
 * Flipkart/Myntra use the network template from the environment, if set.
 */
export function outboundUrl(product, env) {
  const settings = {
    affiliate: { enabled: true, templates: { flipkart: env.FLIPKART_TEMPLATE || '', myntra: env.MYNTRA_TEMPLATE || '' } },
  };
  return PTAffiliate.buildOutboundUrl({ url: product.url, store: product.store, settings, userClickedDeal: true });
}

export function affiliateActive(store, env) {
  if (PTAffiliate.EXCLUDED_STORES.has(store)) return false;
  const tpl = store === 'flipkart' ? env.FLIPKART_TEMPLATE : store === 'myntra' ? env.MYNTRA_TEMPLATE : '';
  return PTAffiliate.isValidTemplate(tpl || '');
}

/** Short-link hosts used by the shops' apps, and the hosts their redirects may pass through. */
export const SHORT_HOSTS = new Set(['amzn.in', 'amzn.to', 'dl.flipkart.com', 'fkrt.it', 'fkrt.cc', 'fkrt.co', 'myntr.it', 'myntr.in']);
const HOP_HOSTS = new Set([...SHORT_HOSTS, 'www.amazon.in', 'amazon.in', 'www.flipkart.com', 'flipkart.com', 'www.myntra.com', 'myntra.com']);

/** First http(s) URL in pasted text such as "Check this out! https://dl.flipkart.com/s/abc". */
export function extractUrl(text) {
  const m = String(text || '').match(/https?:\/\/[^\s<>"']+/i);
  if (m) return m[0].replace(/[).,!?]+$/, '');
  const bare = String(text || '').trim();
  return /^[a-z0-9.-]+\.(in|com|it|to|cc|co)\//i.test(bare) ? `https://${bare}` : null;
}

/**
 * Identify a pasted link. Short links are followed (redirects only, at most 5
 * hops, only through the shops' own hosts).
 * @returns {Promise<{store, id, key, url} | null>}
 */
export async function resolveProduct(text, fetchImpl = fetch) {
  let url = extractUrl(text);
  for (let hop = 0; url && hop <= 5; hop++) {
    const ident = PTStores.identify(url);
    if (ident) return ident;
    let u;
    try {
      u = new URL(url);
    } catch (_) {
      return null;
    }
    if (!HOP_HOSTS.has(u.hostname.toLowerCase()) || hop === 5) return null;
    let res;
    try {
      res = await fetchImpl(u.href, { method: 'GET', redirect: 'manual', headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 14) PriceHistoryLinkResolver' } });
    } catch (_) {
      return null;
    }
    const location = res.headers.get('location');
    if (!location || res.status < 300 || res.status >= 400) return null;
    url = new URL(location, u.href).href;
    if (!/^https:/i.test(url)) url = url.replace(/^http:/i, 'https:');
  }
  return null;
}
