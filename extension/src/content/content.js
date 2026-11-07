/*
 * Content script for supported shop pages.
 * Reads the product on the page, records its price (via the service worker)
 * and shows a small price-history panel. The panel lives in a shadow root so
 * the shop's CSS cannot break it and ours cannot break the shop.
 * Page text (product titles) is only ever inserted with textContent.
 */
(() => {
  'use strict';
  if (window.__ptPriceTrackerLoaded) return;
  window.__ptPriceTrackerLoaded = true;

  const APP_NAME = chrome.i18n.getMessage('appShortName') || 'DaamDekho';
  const HOST_ID = 'pt-price-panel-host';
  const MAX_TRIES = 8;

  const LABELS = {
    hi: {
      lowest: 'Sabse kam',
      highest: 'Sabse zyada',
      average: 'Average',
      since: 'Data shuru',
      track: 'Price track karo',
      targetPlaceholder: 'Target daam (optional)',
      tracking: 'Track ho raha hai',
      stop: 'Band karo',
      alertTarget: (t) => `${t} ya kam hone par alert milega`,
      alertDrop: (p) => `${p}% girne par alert milega`,
      offMrp: (p) => `${p}% off MRP`,
      localOnly: 'History sirf aapke browser me save hoti hai.',
      readFailed: 'Is page se daam padh nahi paye.',
      outOfStock: 'Abhi stock me nahi hai.',
      seen: (n) => `${n} baar dekha`,
      minimize: 'Chhota karo',
      close: 'Is page par chhupao',
      expand: 'Price history kholo',
      error: 'Kuch gadbad hui, dobara try karo.',
    },
    en: {
      lowest: 'Lowest',
      highest: 'Highest',
      average: 'Average',
      since: 'Data since',
      track: 'Track price',
      targetPlaceholder: 'Target price (optional)',
      tracking: 'Tracking',
      stop: 'Stop',
      alertTarget: (t) => `Alert when ${t} or lower`,
      alertDrop: (p) => `Alert on a ${p}% drop`,
      offMrp: (p) => `${p}% off MRP`,
      localOnly: 'History is saved only in your browser.',
      readFailed: 'Could not read the price on this page.',
      outOfStock: 'Currently out of stock.',
      seen: (n) => `seen ${n} times`,
      minimize: 'Minimise',
      close: 'Hide on this page',
      expand: 'Open price history',
      error: 'Something went wrong, try again.',
    },
  };

  const LEVEL_COLORS = { lowest: '#0b8043', good: '#0b8043', normal: '#b06000', high: '#c5221f', new: '#5f6368' };

  const state = { url: null, run: 0, key: null, product: null, settings: null, readFailed: false, hidden: false };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function send(msg) {
    try {
      const res = await chrome.runtime.sendMessage(msg);
      return res && res.ok ? res : null;
    } catch (_) {
      return null; // extension reloaded or service worker unavailable
    }
  }

  // ---------------------------------------------------------------- flow ---

  async function run() {
    const url = location.href;
    state.url = url;
    const myRun = ++state.run;
    const ident = PTStores.identify(url);
    if (!ident) {
      state.key = null;
      removePanel();
      return;
    }
    if (state.key !== ident.key) state.hidden = false;
    state.key = ident.key;

    let product = null;
    for (let i = 0; i < MAX_TRIES; i++) {
      await sleep(i === 0 ? 300 : 1000);
      if (myRun !== state.run) return;
      product = PTExtract.extract(document, url);
      if (product && product.price) break;
    }
    if (myRun !== state.run) return;

    const res = product && product.price ? await send({ type: 'recordPrice', product }) : await send({ type: 'getProduct', key: ident.key });
    if (myRun !== state.run || !res) return;
    state.product = res.product;
    state.settings = res.settings;
    state.readFailed = !(product && product.price);
    render();
  }

  // Shops navigate inside the page (Myntra) or swap variants (Amazon):
  // watch for URL changes and re-read.
  setInterval(() => {
    if (location.href !== state.url) run();
  }, 1000);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    let changed = false;
    if (state.key && changes['p:' + state.key]) {
      state.product = changes['p:' + state.key].newValue || null;
      changed = true;
    }
    if (changes.settings) {
      state.settings = changes.settings.newValue || state.settings;
      changed = true;
    }
    if (changed) render();
  });

  // --------------------------------------------------------------- panel ---

  function removePanel() {
    const host = document.getElementById(HOST_ID);
    if (host) host.remove();
  }

  function getRoot() {
    let host = document.getElementById(HOST_ID);
    if (!host) {
      host = document.createElement('div');
      host.id = HOST_ID;
      host.style.cssText = 'all: initial; position: fixed; right: 16px; bottom: 16px; z-index: 2147483646;';
      host.attachShadow({ mode: 'open' });
      document.documentElement.appendChild(host);
    }
    return host.shadowRoot;
  }

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const c of children) if (c) node.append(c);
    return node;
  }

  function render() {
    const settings = state.settings || {};
    if (settings.showPanel === false || state.hidden || !state.key) {
      removePanel();
      return;
    }
    const lang = settings.lang === 'en' ? 'en' : 'hi';
    const L = LABELS[lang];
    const rec = state.product;
    const now = Date.now();
    const s = rec ? PTInsights.stats(rec.history, now) : null;
    const v = PTInsights.verdict(s, lang);
    const color = LEVEL_COLORS[v.level] || LEVEL_COLORS.new;
    const root = getRoot();
    root.replaceChildren(el('style', { text: STYLES }));

    if (settings.panelMinimized) {
      root.append(
        el(
          'button',
          { class: 'pill', title: L.expand, 'aria-label': L.expand, onclick: () => setMinimized(false) },
          el('span', { class: 'dot', style: `background:${color}` }),
          el('span', { text: s ? PTInsights.formatINR(s.current) : APP_NAME })
        )
      );
      return;
    }

    const card = el('section', { class: 'card', 'aria-label': APP_NAME });
    card.append(
      el(
        'header',
        null,
        el('strong', { class: 'brand', text: APP_NAME }),
        el('span', { class: 'store', text: rec ? PTStores.storeLabel(rec.store) : '' }),
        el('button', { class: 'icon', title: L.minimize, 'aria-label': L.minimize, text: '–', onclick: () => setMinimized(true) }),
        el('button', {
          class: 'icon',
          title: L.close,
          'aria-label': L.close,
          text: '×',
          onclick: () => {
            state.hidden = true;
            removePanel();
          },
        })
      )
    );

    if (s) {
      const priceRow = el('div', { class: 'price-row' }, el('span', { class: 'price', text: PTInsights.formatINR(s.current) }));
      const dc = PTInsights.discountCheck(s, rec.mrp, lang);
      if (rec.mrp && rec.mrp > s.current) {
        priceRow.append(el('s', { class: 'mrp', text: PTInsights.formatINR(rec.mrp) }));
        if (dc) priceRow.append(el('span', { class: 'off', text: L.offMrp(dc.claimedPct) }));
      }
      card.append(priceRow);
      card.append(el('p', { class: 'verdict', style: `color:${color};border-color:${color}`, text: v.text }));
      if (dc && dc.inflated && dc.text) card.append(el('p', { class: 'warn', text: dc.text }));
      if (rec.inStock === false) card.append(el('p', { class: 'warn', text: L.outOfStock }));

      if (s.count >= 2) {
        const chart = el('div', { class: 'chart' });
        chart.innerHTML = PTInsights.chartSvg(rec.history, { width: 268, height: 80, now, color }); // numbers only
        card.append(chart);
      }

      card.append(
        el(
          'dl',
          { class: 'stats' },
          stat(L.lowest, PTInsights.formatINR(s.min), PTInsights.daysAgoText(s.minAt, now, lang)),
          stat(L.highest, PTInsights.formatINR(s.max), PTInsights.daysAgoText(s.maxAt, now, lang)),
          stat(L.average, PTInsights.formatINR(s.avg), L.seen(s.count)),
          stat(L.since, PTInsights.daysAgoText(s.firstSeen, now, lang), '')
        )
      );
    }

    if (state.readFailed) card.append(el('p', { class: 'warn', text: L.readFailed }));
    if (rec && s) card.append(trackSection(rec, settings, L));
    card.append(el('p', { class: 'foot', text: L.localOnly }));
    root.append(card);
  }

  function stat(label, value, sub) {
    return el('div', null, el('dt', { text: label }), el('dd', { text: value }), sub ? el('small', { text: sub }) : null);
  }

  function trackSection(rec, settings, L) {
    const box = el('div', { class: 'track' });
    if (rec.track) {
      const rule = rec.track.targetPrice
        ? L.alertTarget(PTInsights.formatINR(rec.track.targetPrice))
        : L.alertDrop(settings.dropThresholdPct || 5);
      box.append(
        el('span', { class: 'ok', text: `✓ ${L.tracking}` }),
        el('small', { text: rule }),
        el('button', { class: 'link', text: L.stop, onclick: () => act({ type: 'untrack', key: rec.key }, L) })
      );
      return box;
    }
    const input = el('input', { type: 'text', inputmode: 'numeric', placeholder: L.targetPlaceholder, 'aria-label': L.targetPlaceholder });
    const submit = () => act({ type: 'track', key: rec.key, targetPrice: PTStores.parseINR(input.value) }, L);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
    box.append(input, el('button', { class: 'primary', text: L.track, onclick: submit }));
    return box;
  }

  async function act(msg, L) {
    const res = await send(msg);
    if (res && res.product) {
      state.product = res.product;
      render();
    } else {
      const root = getRoot();
      const card = root.querySelector('.card');
      if (card) card.append(el('p', { class: 'warn', text: L.error }));
    }
  }

  async function setMinimized(minimized) {
    const settings = { ...(state.settings || {}), panelMinimized: minimized };
    state.settings = settings;
    render();
    const res = await send({ type: 'saveSettings', settings });
    if (res && res.settings) state.settings = res.settings;
  }

  const STYLES = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    .card { width: 300px; max-height: 80vh; overflow: auto; background: #fff; color: #202124; border-radius: 12px;
            box-shadow: 0 6px 24px rgba(0,0,0,.18); border: 1px solid #e0e0e0; padding: 12px 14px; font-size: 13px; line-height: 1.4; }
    header { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
    .brand { font-size: 14px; color: #1a73e8; }
    .store { color: #5f6368; font-size: 12px; flex: 1; }
    button { font: inherit; cursor: pointer; }
    .icon { border: none; background: transparent; color: #5f6368; font-size: 18px; line-height: 1; width: 26px; height: 26px; border-radius: 6px; }
    .icon:hover { background: #f1f3f4; }
    .price-row { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
    .price { font-size: 22px; font-weight: 700; }
    .mrp { color: #80868b; }
    .off { color: #0b8043; font-weight: 600; }
    .verdict { margin: 8px 0; padding: 6px 8px; border-left: 3px solid; background: #f8f9fa; border-radius: 4px; font-weight: 600; }
    .warn { margin: 6px 0; padding: 6px 8px; background: #fef7e0; color: #7a4f01; border-radius: 4px; }
    .chart { margin: 6px 0; }
    .chart svg { display: block; width: 100%; height: auto; }
    .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; margin: 8px 0; }
    .stats div { margin: 0; }
    dt { color: #5f6368; font-size: 11px; }
    dd { margin: 0; font-weight: 600; }
    small { color: #80868b; font-size: 11px; display: block; }
    .track { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 6px; }
    .track input { flex: 1 1 120px; min-width: 0; padding: 7px 8px; border: 1px solid #dadce0; border-radius: 6px; font-size: 13px; }
    .primary { background: #1a73e8; color: #fff; border: none; border-radius: 6px; padding: 8px 12px; font-weight: 600; }
    .primary:hover { background: #1765cc; }
    .ok { color: #0b8043; font-weight: 600; }
    .link { background: none; border: none; color: #1a73e8; padding: 0; text-decoration: underline; }
    .foot { margin: 8px 0 0; color: #80868b; font-size: 11px; }
    .pill { display: flex; align-items: center; gap: 6px; background: #fff; color: #202124; border: 1px solid #dadce0;
            border-radius: 999px; padding: 8px 12px; box-shadow: 0 4px 14px rgba(0,0,0,.18); font-weight: 700; font-size: 13px; }
    .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
  `;

  run();
})();
