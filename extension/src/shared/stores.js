/*
 * Store detection: which shop a URL belongs to, the product id inside it,
 * and a clean canonical URL for that product.
 *
 * Loaded as a classic script in the browser (exposes `PTStores`) and as a
 * CommonJS module in Node tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PTStores = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STORES = {
    amazon: { id: 'amazon', label: 'Amazon', hosts: ['www.amazon.in', 'amazon.in'] },
    flipkart: { id: 'flipkart', label: 'Flipkart', hosts: ['www.flipkart.com', 'flipkart.com', 'dl.flipkart.com'] },
    myntra: { id: 'myntra', label: 'Myntra', hosts: ['www.myntra.com', 'myntra.com'] },
  };

  function toUrl(url) {
    try {
      return url instanceof URL ? url : new URL(url);
    } catch (_) {
      return null;
    }
  }

  function storeForUrl(url) {
    const u = toUrl(url);
    if (!u) return null;
    const host = u.hostname.toLowerCase();
    for (const store of Object.values(STORES)) {
      if (store.hosts.includes(host)) return store.id;
    }
    return null;
  }

  const AMAZON_ASIN_RE = /\/(?:dp|gp\/product|gp\/aw\/d|exec\/obidos\/ASIN)\/([A-Z0-9]{10})(?=[/?#]|$)/i;
  const FLIPKART_ITEM_RE = /\/p\/(itm[a-z0-9]+)/i;
  const MYNTRA_ID_RE = /\/(\d{5,})\/buy(?=[/?#]|$)/i;

  /**
   * Identify a product page from its URL.
   * @returns {{store: string, id: string, key: string, url: string} | null}
   */
  function identify(url) {
    const u = toUrl(url);
    if (!u) return null;
    const store = storeForUrl(u);
    if (!store) return null;

    if (store === 'amazon') {
      const m = u.pathname.match(AMAZON_ASIN_RE);
      if (!m) return null;
      const id = m[1].toUpperCase();
      return make(store, id, `https://www.amazon.in/dp/${id}`);
    }

    if (store === 'flipkart') {
      // App share links look like dl.flipkart.com/dl/<normal path>
      const path = u.hostname.toLowerCase() === 'dl.flipkart.com' ? u.pathname.replace(/^\/dl(?=\/)/, '') : u.pathname;
      const item = path.match(FLIPKART_ITEM_RE);
      if (!item) return null;
      const pid = (u.searchParams.get('pid') || '').trim().toUpperCase();
      const id = pid || item[1].toLowerCase();
      const canonical = `https://www.flipkart.com${path}` + (pid ? `?pid=${encodeURIComponent(pid)}` : '');
      return make(store, id, canonical);
    }

    if (store === 'myntra') {
      const m = u.pathname.match(MYNTRA_ID_RE);
      if (m) return make(store, m[1], `https://www.myntra.com${u.pathname}`);
      const short = u.pathname.match(/^\/(\d{5,})\/?$/); // myntra.com/<style id>
      if (short) return make(store, short[1], `https://www.myntra.com/${short[1]}`);
      return null;
    }

    return null;
  }

  function make(store, id, url) {
    return { store, id, key: `${store}:${id}`, url };
  }

  /**
   * Parse an Indian price string such as "₹1,23,456.00", "Rs. 1,299" or "1299".
   * Returns a number rounded to 2 decimals, or null when no positive price is found.
   */
  function parseINR(text) {
    if (text === null || text === undefined) return null;
    if (typeof text === 'number') return Number.isFinite(text) && text > 0 ? round2(text) : null;
    const m = String(text).replace(/\s+/g, '').match(/\d[\d,]*(?:\.\d+)?/);
    if (!m) return null;
    const value = parseFloat(m[0].replace(/,/g, ''));
    return Number.isFinite(value) && value > 0 ? round2(value) : null;
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function storeLabel(storeId) {
    return (STORES[storeId] && STORES[storeId].label) || storeId;
  }

  return { STORES, storeForUrl, identify, parseINR, storeLabel };
});
