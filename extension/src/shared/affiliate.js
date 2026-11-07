/*
 * Outbound links, kept inside the rules this project has to follow.
 *
 * Chrome Web Store affiliate policy (enforced since 10 June 2025): an
 * extension may use an affiliate link only when
 *   - the affiliate program is disclosed (store listing, UI, before install),
 *   - the user takes an action first (a click), and
 *   - the link is tied to a direct benefit for the user at that moment.
 * Amazon Associates forbids Special Links inside client-side software such as
 * browser extensions, so Amazon links always stay plain here.
 *
 * Therefore buildOutboundUrl() returns the plain product URL unless ALL hold:
 *   1. the store is not Amazon,
 *   2. the user enabled affiliate links in Options and filled a template,
 *   3. the call comes from a user click on a deal (price dropped / hit target),
 *   4. the URL does not already carry someone else's affiliate marker.
 * Never call this to rewrite links automatically, on page load, or in bulk.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PTAffiliate = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Query parameters that indicate the link already credits an affiliate. */
  const AFFILIATE_PARAMS = ['tag', 'ascsubtag', 'affid', 'affextparam1', 'affextparam2', 'aff_id', 'affiliate_id', 'aff', 'clickid', 'irclickid'];

  const EXCLUDED_STORES = new Set(['amazon']);

  function hasAffiliateMarker(url) {
    let u;
    try {
      u = new URL(url);
    } catch (_) {
      return false;
    }
    for (const [name, value] of u.searchParams) {
      const n = name.toLowerCase();
      if (AFFILIATE_PARAMS.includes(n)) return true;
      if (n === 'utm_medium' && /affiliate/i.test(value)) return true;
    }
    return false;
  }

  /** A template is valid when it is an https URL containing the {url} placeholder once or more. */
  function isValidTemplate(template) {
    if (typeof template !== 'string' || !template.includes('{url}')) return false;
    try {
      const u = new URL(template.split('{url}').join('https%3A%2F%2Fexample.com'));
      return u.protocol === 'https:';
    } catch (_) {
      return false;
    }
  }

  /**
   * @param {{url: string, store: string, settings: object, userClickedDeal: boolean}} p
   * @returns {{href: string, affiliate: boolean, reason: string}}
   */
  function buildOutboundUrl({ url, store, settings, userClickedDeal }) {
    const plain = (reason) => ({ href: url, affiliate: false, reason });
    if (EXCLUDED_STORES.has(store)) return plain('store-excluded');
    const aff = settings && settings.affiliate;
    if (!aff || !aff.enabled) return plain('disabled');
    if (!userClickedDeal) return plain('no-direct-benefit');
    const template = aff.templates && aff.templates[store];
    if (!isValidTemplate(template)) return plain('no-template');
    if (hasAffiliateMarker(url)) return plain('existing-affiliate');
    const href = template.split('{url}').join(encodeURIComponent(url));
    return { href, affiliate: true, reason: 'ok' };
  }

  return { AFFILIATE_PARAMS, EXCLUDED_STORES, hasAffiliateMarker, isValidTemplate, buildOutboundUrl };
});
