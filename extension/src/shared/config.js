/*
 * Where the website (phase 2) lives.
 *
 * Set SITE_URL to the deployed website, for example
 *   'https://daamdekho.your-account.workers.dev'
 * Leave it empty to switch off community history and website share links;
 * everything else keeps working locally.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PTConfig = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SITE_URL = '';

  function siteUrl() {
    return SITE_URL.replace(/\/+$/, '');
  }

  function isConfigured() {
    return /^https:\/\/[^/]+/.test(SITE_URL);
  }

  function siteHost() {
    try {
      return new URL(SITE_URL).host;
    } catch (_) {
      return '';
    }
  }

  function productPageUrl(store, id) {
    return `${siteUrl()}/p/${encodeURIComponent(store)}/${encodeURIComponent(id)}`;
  }

  function historyApiUrl(store, id) {
    return `${siteUrl()}/api/v1/history/${encodeURIComponent(store)}/${encodeURIComponent(id)}`;
  }

  function pricesApiUrl() {
    return `${siteUrl()}/api/v1/prices`;
  }

  return { SITE_URL, siteUrl, siteHost, isConfigured, productPageUrl, historyApiUrl, pricesApiUrl };
});
