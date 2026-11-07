/* Popup: list of tracked products with their price movement. */
(() => {
  'use strict';

  const LABELS = {
    hi: {
      checkNow: 'Abhi check karo',
      checking: 'Check ho raha hai…',
      checked: (n) => `${n} product check hue.`,
      empty: 'Abhi koi product track nahi ho raha. Amazon.in, Flipkart ya Myntra par koi product kholo aur "Price track karo" dabao.',
      open: 'Kholo',
      remove: 'Hatao',
      since: 'Track shuru',
      lowest: 'Sabse kam',
      target: 'Target',
      checkFailed: 'Pichhla check fail hua',
      disclosure:
        'Affiliate disclosure: price-drop alert ya deal se Flipkart/Myntra kholne par affiliate link lag sakta hai. Aapke liye daam same rehta hai. Amazon links par kabhi affiliate nahi lagta.',
    },
    en: {
      checkNow: 'Check now',
      checking: 'Checking…',
      checked: (n) => `Checked ${n} products.`,
      empty: 'Nothing tracked yet. Open a product on Amazon.in, Flipkart or Myntra and press "Track price".',
      open: 'Open',
      remove: 'Remove',
      since: 'Tracking since',
      lowest: 'Lowest',
      target: 'Target',
      checkFailed: 'Last check failed',
      disclosure:
        'Affiliate disclosure: opening a Flipkart/Myntra deal from a price-drop alert may use an affiliate link. Your price stays the same. Amazon links never carry one.',
    },
  };

  const $ = (id) => document.getElementById(id);
  let L = LABELS.hi;

  async function send(msg) {
    try {
      const res = await chrome.runtime.sendMessage(msg);
      return res && res.ok ? res : null;
    } catch (_) {
      return null;
    }
  }

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const c of children) if (c) node.append(c);
    return node;
  }

  function changeBadge(now, before) {
    if (!Number.isFinite(now) || !Number.isFinite(before) || before <= 0 || now === before) return null;
    const pct = Math.round(((now - before) / before) * 100);
    if (pct === 0) return null;
    return el('span', { class: pct < 0 ? 'down' : 'up', text: `${pct < 0 ? '▼' : '▲'} ${Math.abs(pct)}%` });
  }

  function itemView(p, lang, now) {
    const s = PTInsights.stats(p.history, now);
    const img = /^https:\/\//.test(p.image || '')
      ? el('img', { src: p.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: (e) => e.target.replaceWith(el('div', { class: 'thumb' })) })
      : el('div', { class: 'thumb' });
    const meta = [PTStores.storeLabel(p.store), `${L.since} ${PTInsights.daysAgoText(p.track.addedAt, now, lang)}`];
    if (p.track.targetPrice) meta.push(`${L.target} ${PTInsights.formatINR(p.track.targetPrice)}`);

    return el(
      'article',
      { class: 'item' },
      img,
      el(
        'div',
        null,
        el('p', { class: 'title', title: p.title || '', text: p.title || p.url }),
        el(
          'div',
          { class: 'prices' },
          el('span', { class: 'now', text: PTInsights.formatINR(s && s.current) }),
          changeBadge(s && s.current, p.track.priceAtAdd),
          s ? el('span', { class: 'meta', text: `${L.lowest} ${PTInsights.formatINR(s.min)}` }) : null
        ),
        el('div', { class: 'meta', text: meta.join(' · ') }),
        p.lastCheck && p.lastCheck.ok === false ? el('div', { class: 'error', text: `${L.checkFailed}: ${p.lastCheck.error || ''}` }) : null,
        el(
          'div',
          { class: 'actions' },
          el('button', { type: 'button', text: L.open, onclick: () => send({ type: 'openProduct', key: p.key }).then(() => window.close()) }),
          el('button', { type: 'button', text: L.remove, onclick: () => send({ type: 'untrack', key: p.key }).then(load) })
        )
      )
    );
  }

  async function load() {
    const res = await send({ type: 'listTracked' });
    const settings = (res && res.settings) || {};
    const lang = settings.lang === 'en' ? 'en' : 'hi';
    L = LABELS[lang];
    document.documentElement.lang = lang === 'en' ? 'en' : 'hi-Latn';
    $('check-now').textContent = L.checkNow;
    $('footer').textContent = settings.affiliate && settings.affiliate.enabled ? L.disclosure : '';

    const list = $('list');
    const products = (res && res.products) || [];
    const now = Date.now();
    list.replaceChildren(...(products.length ? products.map((p) => itemView(p, lang, now)) : [el('p', { class: 'empty', text: L.empty })]));
    $('check-now').disabled = !products.length;
  }

  $('app-name').textContent = chrome.i18n.getMessage('appShortName') || 'DaamDekho';
  $('options-link').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
  $('check-now').addEventListener('click', async () => {
    const btn = $('check-now');
    const status = $('status');
    btn.disabled = true;
    status.hidden = false;
    status.textContent = L.checking;
    const res = await send({ type: 'checkNow' });
    status.textContent = res ? L.checked(res.results.length) : '';
    await load();
  });

  load();
})();
