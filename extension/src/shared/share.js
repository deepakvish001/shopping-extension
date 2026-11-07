/*
 * Share messages for WhatsApp / Telegram. Pure functions: the content script
 * and the website both build the same text.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./insights.js'), require('./stores.js'));
  else root.PTShare = factory(root.PTInsights, root.PTStores);
})(typeof self !== 'undefined' ? self : this, function (PTInsights, PTStores) {
  'use strict';

  const WORDS = {
    hi: { now: 'Abhi', on: 'par', lowest: 'Sabse kam', typical: 'Typical', history: 'Price history', check: 'Price history dekho' },
    en: { now: 'Now', on: 'on', lowest: 'Lowest', typical: 'Typical', history: 'Price history', check: 'See the price history' },
  };

  function shorten(text, max) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
  }

  /**
   * @param {{title, store, stats, verdictText, warning, link, lang}} p
   *   `stats` from PTInsights.stats (may be null); `warning` an optional
   *   fake-sale / inflated-MRP line.
   */
  function buildText(p) {
    const w = WORDS[p.lang] || WORDS.hi;
    const s = p.stats;
    const lines = [`🛒 ${shorten(p.title, 90) || PTStores.storeLabel(p.store)}`];
    if (s) {
      lines.push(`${w.now}: ${PTInsights.formatINR(s.current)} ${w.on} ${PTStores.storeLabel(p.store)}`);
      if (s.count >= 2) lines.push(`${w.lowest}: ${PTInsights.formatINR(s.min)} | ${w.typical}: ${PTInsights.formatINR(s.median)}`);
    }
    if (p.verdictText && s && s.count >= 2) lines.push(p.verdictText);
    if (p.warning) lines.push(`⚠️ ${p.warning}`);
    if (p.link) lines.push(`${s && s.count >= 2 ? w.history : w.check}: ${p.link}`);
    return lines.join('\n');
  }

  function whatsappUrl(text) {
    return `https://wa.me/?text=${encodeURIComponent(text)}`;
  }

  /**
   * Telegram takes the link separately and shows its preview, so pass text
   * built without the link: buildText({ ...p, link: null }).
   */
  function telegramUrl(textWithoutLink, link) {
    return `https://t.me/share/url?url=${encodeURIComponent(link || '')}&text=${encodeURIComponent(textWithoutLink)}`;
  }

  return { buildText, whatsappUrl, telegramUrl, shorten };
});
