/*
 * Read product details (title, price, MRP, image, stock) from a product page.
 *
 * Works on the live page (content script) and on HTML fetched in the
 * background and parsed with DOMParser (offscreen document), so it must only
 * use the DOM API, never layout or computed styles.
 *
 * Order of sources, most reliable first:
 *   1. Structured data the shop embeds (JSON-LD, Myntra's page state)
 *   2. Known element selectors for each shop
 *   3. Generic meta tags
 * Shops change their markup often: when a price stops being read, update the
 * selector lists below and add a fixture test.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./stores.js'));
  else root.PTExtract = factory(root.PTStores);
})(typeof self !== 'undefined' ? self : this, function (PTStores) {
  'use strict';

  const SELECTORS = {
    amazon: {
      title: ['#productTitle', '#title'],
      price: [
        '#corePriceDisplay_desktop_feature_div .priceToPay .a-offscreen',
        '#corePriceDisplay_desktop_feature_div .a-price:not(.a-text-price) .a-offscreen',
        '#corePrice_desktop .a-price:not(.a-text-price) .a-offscreen',
        '#corePrice_feature_div .a-price:not(.a-text-price) .a-offscreen',
        '#apex_desktop .priceToPay .a-offscreen',
        '#priceblock_dealprice',
        '#priceblock_ourprice',
        '#price_inside_buybox',
        '#newBuyBoxPrice',
        '#tp_price_block_total_price_ww .a-offscreen',
      ],
      priceWhole: ['#corePriceDisplay_desktop_feature_div .priceToPay', '#corePrice_feature_div .a-price'],
      mrp: [
        '#corePriceDisplay_desktop_feature_div .basisPrice .a-offscreen',
        '#corePriceDisplay_desktop_feature_div .a-price.a-text-price .a-offscreen',
        '#corePrice_desktop .a-price.a-text-price .a-offscreen',
        '#priceblock_ourprice_row .a-text-strike',
        '.basisPrice .a-offscreen',
      ],
      image: ['#landingImage', '#imgBlkFront', '#main-image'],
      availability: ['#availability'],
    },
    flipkart: {
      title: ['span.VU-ZEz', 'span.B_NuCI', 'h1 span', 'h1'],
      price: ['div.Nx9bqj.CxhGGd', 'div._30jeq3._16Jk6d', 'div.Nx9bqj', 'div._30jeq3'],
      mrp: ['div.yRaY8j.A6\\+E6v', 'div._3I9_wc._2p6lqe', 'div.yRaY8j', 'div._3I9_wc'],
      image: ['img.DByuf4', 'img._396cs4', 'img._2r_T1I'],
      availability: ['div.Z8JjpR', 'div._16FRp0'],
    },
    myntra: {
      title: ['.pdp-title', '.pdp-name'],
      price: ['.pdp-price strong', '.pdp-price'],
      mrp: ['.pdp-mrp s', '.pdp-mrp'],
      image: ['.image-grid-image'],
      availability: ['.size-buttons-out-of-stock'],
    },
  };

  const OUT_OF_STOCK_RE = /(currently unavailable|out of stock|sold out|coming soon)/i;

  function text(el) {
    return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }

  /** First element matching any selector; with `needText`, only elements that have text. */
  function first(doc, selectors, needText = true) {
    for (const sel of selectors || []) {
      let el = null;
      try {
        el = doc.querySelector(sel);
      } catch (_) {
        el = null; // invalid selector in this DOM implementation
      }
      if (el && (!needText || text(el))) return el;
    }
    return null;
  }

  function firstPrice(doc, selectors) {
    for (const sel of selectors || []) {
      let els = [];
      try {
        els = doc.querySelectorAll(sel);
      } catch (_) {
        els = [];
      }
      for (const el of els) {
        const p = PTStores.parseINR(text(el));
        if (p) return p;
      }
    }
    return null;
  }

  function meta(doc, names) {
    for (const name of names) {
      const el = doc.querySelector(`meta[property="${name}"], meta[name="${name}"], meta[itemprop="${name}"]`);
      const v = el && el.getAttribute('content');
      if (v && v.trim()) return v.trim();
    }
    return null;
  }

  function absoluteUrl(src, base) {
    if (!src) return null;
    try {
      return new URL(src, base).href;
    } catch (_) {
      return null;
    }
  }

  /** Collect every JSON-LD object of type Product on the page. */
  function jsonLdProduct(doc) {
    const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    for (const s of scripts) {
      let data;
      try {
        data = JSON.parse(s.textContent || '');
      } catch (_) {
        continue;
      }
      const queue = Array.isArray(data) ? [...data] : [data];
      while (queue.length) {
        const node = queue.shift();
        if (!node || typeof node !== 'object') continue;
        if (Array.isArray(node['@graph'])) queue.push(...node['@graph']);
        const type = node['@type'];
        const isProduct = type === 'Product' || (Array.isArray(type) && type.includes('Product'));
        if (!isProduct) continue;
        const offers = Array.isArray(node.offers) ? node.offers[0] : node.offers;
        const price = offers ? PTStores.parseINR(offers.price ?? offers.lowPrice) : null;
        let image = node.image;
        if (Array.isArray(image)) image = image[0];
        if (image && typeof image === 'object') image = image.url;
        const availability = offers && typeof offers.availability === 'string' ? offers.availability : '';
        return {
          title: typeof node.name === 'string' ? node.name.trim() : null,
          price,
          image: typeof image === 'string' ? image : null,
          inStock: availability ? !/OutOfStock|SoldOut|Discontinued/i.test(availability) : null,
        };
      }
    }
    return null;
  }

  /** Myntra embeds the product as `window.__myx = {...}` in a script tag. */
  function myntraState(doc, expectedId) {
    for (const s of doc.querySelectorAll('script')) {
      const src = s.textContent || '';
      const at = src.indexOf('window.__myx');
      if (at === -1) continue;
      const start = src.indexOf('{', at);
      const end = src.lastIndexOf('}');
      if (start === -1 || end <= start) continue;
      let data;
      try {
        data = JSON.parse(src.slice(start, end + 1));
      } catch (_) {
        continue;
      }
      const pdp = data && data.pdpData;
      if (!pdp) continue;
      // After in-app navigation the script still describes the first product.
      if (expectedId && pdp.id !== undefined && String(pdp.id) !== String(expectedId)) return null;
      const price = pdp.price || {};
      const album = pdp.media && Array.isArray(pdp.media.albums) ? pdp.media.albums[0] : null;
      const img = album && Array.isArray(album.images) ? album.images[0] : null;
      const brand = pdp.brand && pdp.brand.name ? pdp.brand.name : '';
      const name = pdp.name || '';
      return {
        title: (name.toLowerCase().startsWith(brand.toLowerCase()) ? name : `${brand} ${name}`).trim() || null,
        price: PTStores.parseINR(price.discounted ?? price.mrp),
        mrp: PTStores.parseINR(price.mrp),
        image: img ? img.secureSrc || img.imageURL || img.src || null : null,
        inStock: pdp.flags && typeof pdp.flags.outOfStock === 'boolean' ? !pdp.flags.outOfStock : null,
      };
    }
    return null;
  }

  function imageFromElement(el, base) {
    if (!el) return null;
    const src =
      el.getAttribute('data-old-hires') ||
      el.getAttribute('src') ||
      el.getAttribute('data-src') ||
      (() => {
        const style = el.getAttribute('style') || '';
        const m = style.match(/url\(["']?([^"')]+)["']?\)/);
        return m ? m[1] : null;
      })();
    if (!src || src.startsWith('data:')) return null;
    return absoluteUrl(src, base);
  }

  function amazonPriceFromParts(doc) {
    for (const sel of SELECTORS.amazon.priceWhole) {
      const box = doc.querySelector(sel);
      if (!box) continue;
      const whole = text(box.querySelector('.a-price-whole')).replace(/[^\d,]/g, '');
      const fraction = text(box.querySelector('.a-price-fraction')).replace(/\D/g, '');
      const p = PTStores.parseINR(whole ? `${whole}${fraction ? '.' + fraction : ''}` : '');
      if (p) return p;
    }
    return null;
  }

  /**
   * Extract the product on `doc`, which was loaded from `url`.
   * @returns {null | {store, id, key, url, title, price, mrp, image, inStock}}
   *   `price` may be null when the page is a product page but no price was found.
   */
  function extract(doc, url) {
    const ident = PTStores.identify(url);
    if (!ident || !doc) return null;
    const sel = SELECTORS[ident.store];

    const structured = ident.store === 'myntra' ? myntraState(doc, ident.id) || jsonLdProduct(doc) : jsonLdProduct(doc);

    let price = (structured && structured.price) || firstPrice(doc, sel.price);
    if (!price && ident.store === 'amazon') price = amazonPriceFromParts(doc);
    if (!price) price = PTStores.parseINR(meta(doc, ['product:price:amount', 'og:price:amount', 'price']));

    // Amazon swaps variants in place: the URL can already name the new ASIN
    // while the page still shows the old one. Do not record a price then.
    if (ident.store === 'amazon') {
      const asinInput = doc.querySelector('input#ASIN, input[name="ASIN"]');
      const pageAsin = asinInput && (asinInput.getAttribute('value') || '').trim().toUpperCase();
      if (pageAsin && pageAsin !== ident.id) price = null;
    }

    let mrp = (structured && structured.mrp) || firstPrice(doc, sel.mrp);
    if (mrp && price && mrp <= price) mrp = null; // not a real "was" price

    let title = (structured && structured.title) || '';
    if (!title) {
      if (ident.store === 'myntra') {
        title = [text(doc.querySelector('.pdp-title')), text(doc.querySelector('.pdp-name'))].filter(Boolean).join(' ');
      } else {
        title = text(first(doc, sel.title));
      }
    }
    if (!title) title = meta(doc, ['og:title']) || text(doc.querySelector('title'));

    const image =
      absoluteUrl(structured && structured.image, ident.url) ||
      imageFromElement(first(doc, sel.image, false), ident.url) ||
      absoluteUrl(meta(doc, ['og:image']), ident.url);

    let inStock = structured ? structured.inStock : null;
    const availability = text(first(doc, sel.availability));
    if (availability && OUT_OF_STOCK_RE.test(availability)) inStock = false;

    return {
      store: ident.store,
      id: ident.id,
      key: ident.key,
      url: ident.url,
      title: title ? title.slice(0, 300) : null,
      price: price || null,
      mrp: mrp || null,
      image: image || null,
      inStock: inStock === undefined ? null : inStock,
    };
  }

  return { extract, SELECTORS, _internal: { jsonLdProduct, myntraState } };
});
