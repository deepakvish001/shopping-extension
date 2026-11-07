// Fetch a product page from the shop and read its price with the same
// extractor the extension uses. Runs on the server (Vercel) for links people
// paste and for scheduled re-checks.
import { parseHTML } from 'linkedom';
import { PTExtract } from './shared.js';

const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'en-IN,en;q=0.9,hi;q=0.8',
};

const MAX_HTML = 6 * 1024 * 1024;
const BLOCKED_RE = /(enter the characters you see below|api-services-support@amazon\.com|captcha|are you a robot|unusual traffic|access denied|request blocked)/i;

/**
 * @param {{url: string}} ident  from PTStores.identify()
 * @param {{fetchImpl?: Function, proxyTemplate?: string, timeoutMs?: number}} opts
 *   proxyTemplate: optional scraping-service URL with {url}, used instead of a
 *   direct request (for shops that block direct server requests).
 * @returns {Promise<{ok: true, product: object} | {ok: false, error: string}>}
 */
export async function fetchProduct(ident, { fetchImpl = (...a) => fetch(...a), proxyTemplate = '', timeoutMs = 9000 } = {}) {
  const target = proxyTemplate && proxyTemplate.includes('{url}') ? proxyTemplate.split('{url}').join(encodeURIComponent(ident.url)) : ident.url;
  let res;
  try {
    res = await fetchImpl(target, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    return { ok: false, error: err && err.name === 'TimeoutError' ? 'timeout' : 'network error' };
  }
  if (!res.ok) return { ok: false, error: [403, 429, 503, 529].includes(res.status) ? `blocked (HTTP ${res.status})` : `HTTP ${res.status}` };
  const html = (await res.text()).slice(0, MAX_HTML);
  const { document } = parseHTML(html);
  const product = PTExtract.extract(document, ident.url);
  if (!product || !product.price) return { ok: false, error: BLOCKED_RE.test(html.slice(0, 200_000)) ? 'blocked (captcha)' : 'price not found' };
  return { ok: true, product };
}
