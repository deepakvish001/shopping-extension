/*
 * User settings: defaults and validation. Stored under the "settings" key in
 * chrome.storage.local.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PTSettings = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULTS = Object.freeze({
    lang: 'hi', // 'hi' = Hinglish, 'en' = English
    checkIntervalHours: 12,
    dropThresholdPct: 5,
    notifications: true,
    showPanel: true,
    panelMinimized: false,
    // Community price history: null = not asked yet, true/false = user's answer.
    community: null,
    affiliate: { enabled: false, templates: { flipkart: '', myntra: '' } },
  });

  const INTERVALS = [6, 12, 24];

  function clampInt(v, lo, hi, fallback) {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
  }

  /** Merge stored values over the defaults, dropping anything malformed. */
  function normalize(stored) {
    const s = stored && typeof stored === 'object' ? stored : {};
    const aff = s.affiliate && typeof s.affiliate === 'object' ? s.affiliate : {};
    const templates = aff.templates && typeof aff.templates === 'object' ? aff.templates : {};
    return {
      lang: s.lang === 'en' ? 'en' : 'hi',
      checkIntervalHours: INTERVALS.includes(Number(s.checkIntervalHours)) ? Number(s.checkIntervalHours) : DEFAULTS.checkIntervalHours,
      dropThresholdPct: clampInt(s.dropThresholdPct, 1, 50, DEFAULTS.dropThresholdPct),
      notifications: s.notifications !== false,
      showPanel: s.showPanel !== false,
      panelMinimized: s.panelMinimized === true,
      community: s.community === true ? true : s.community === false ? false : null,
      affiliate: {
        enabled: aff.enabled === true,
        templates: {
          flipkart: typeof templates.flipkart === 'string' ? templates.flipkart.trim() : '',
          myntra: typeof templates.myntra === 'string' ? templates.myntra.trim() : '',
        },
      },
    };
  }

  return { DEFAULTS, INTERVALS, normalize };
});
