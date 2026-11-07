/*
 * Background service worker.
 *
 * - Owns all writes to price data (content scripts and the popup send
 *   messages), serialised through a lock so concurrent tabs cannot clobber
 *   each other's read-modify-write.
 * - Re-checks tracked products on a timer, parses the fetched HTML in an
 *   offscreen document (service workers have no DOMParser) and shows a
 *   notification on a price drop.
 *
 * Storage layout (chrome.storage.local):
 *   "settings"      -> see shared/settings.js
 *   "p:<store>:<id>" -> product record {key, store, id, url, title, image, mrp,
 *                       inStock, history: [[t, price]...], lastSeen,
 *                       track: null | {addedAt, priceAtAdd, targetPrice,
 *                       lastNotifiedPrice}, lastCheck: {at, ok, error}}
 */
importScripts('../shared/stores.js', '../shared/insights.js', '../shared/affiliate.js', '../shared/settings.js');

const ALARM = 'check-prices';
const PRODUCT_PREFIX = 'p:';
const FETCH_GAP_MS = 4000;
const OFFSCREEN_URL = 'src/offscreen/offscreen.html';

// ------------------------------------------------------------------ utils ---

let lockChain = Promise.resolve();
function withLock(fn) {
  const run = lockChain.then(fn, fn);
  lockChain = run.catch(() => {});
  return run;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return PTSettings.normalize(settings);
}

async function getProduct(key) {
  const k = PRODUCT_PREFIX + key;
  const got = await chrome.storage.local.get(k);
  return got[k] || null;
}

async function saveProduct(rec) {
  await chrome.storage.local.set({ [PRODUCT_PREFIX + rec.key]: rec });
}

async function allProducts() {
  const all = await chrome.storage.local.get(null);
  return Object.keys(all)
    .filter((k) => k.startsWith(PRODUCT_PREFIX))
    .map((k) => all[k]);
}

function currentPrice(rec) {
  const h = rec && rec.history;
  return h && h.length ? h[h.length - 1][1] : null;
}

// -------------------------------------------------------- price recording ---

/** Store one observation of a product. `product` comes from PTExtract.extract(). */
function recordPrice(product, now = Date.now()) {
  return withLock(async () => {
    const ident = PTStores.identify(product && product.url);
    if (!ident || ident.key !== product.key) throw new Error('invalid product');
    const rec = (await getProduct(product.key)) || {
      key: product.key,
      store: product.store,
      id: product.id,
      url: product.url,
      history: [],
      track: null,
      firstSeen: now,
    };
    if (product.title) rec.title = String(product.title).slice(0, 300);
    if (product.image) rec.image = product.image;
    if (product.mrp) rec.mrp = product.mrp;
    if (product.inStock !== null && product.inStock !== undefined) rec.inStock = product.inStock;
    rec.url = product.url;
    rec.lastSeen = now;
    if (Number.isFinite(product.price)) rec.history = PTInsights.recordPoint(rec.history, product.price, now);
    await saveProduct(rec);
    return rec;
  });
}

function trackProduct(key, targetPrice) {
  return withLock(async () => {
    const rec = await getProduct(key);
    if (!rec) throw new Error('unknown product');
    const price = currentPrice(rec);
    const target = Number(targetPrice);
    rec.track = {
      addedAt: Date.now(),
      priceAtAdd: price,
      targetPrice: Number.isFinite(target) && target > 0 ? target : null,
      lastNotifiedPrice: null,
    };
    await saveProduct(rec);
    await ensureAlarm();
    return rec;
  });
}

function untrackProduct(key) {
  return withLock(async () => {
    const rec = await getProduct(key);
    if (!rec) return null;
    rec.track = null;
    await saveProduct(rec);
    return rec;
  });
}

async function listTracked() {
  const products = await allProducts();
  return products.filter((p) => p.track).sort((a, b) => b.track.addedAt - a.track.addedAt);
}

// ------------------------------------------------------- background checks ---

let creatingOffscreen = null;
async function ensureOffscreen() {
  const url = chrome.runtime.getURL(OFFSCREEN_URL);
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] });
    if (contexts.length) return;
  }
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen
      .createDocument({ url: OFFSCREEN_URL, reasons: ['DOM_PARSER'], justification: 'Read prices from product pages of tracked items' })
      .catch((err) => {
        if (!/single offscreen/i.test(String(err && err.message))) throw err;
      })
      .finally(() => {
        creatingOffscreen = null;
      });
  }
  await creatingOffscreen;
}

async function closeOffscreen() {
  try {
    await chrome.offscreen.closeDocument();
  } catch (_) {
    // already closed
  }
}

async function parseHtml(html, url) {
  await ensureOffscreen();
  return chrome.runtime.sendMessage({ target: 'offscreen', type: 'parse', html, url });
}

/** Turn fetched page HTML into a price observation and maybe an alert. */
async function processFetchedHtml(key, html, url, settings) {
  const product = await parseHtml(html, url);
  if (!product || product.key !== key || !Number.isFinite(product.price)) {
    await markCheck(key, false, 'price not found');
    return { ok: false };
  }
  await recordPrice(product);
  const alert = await withLock(async () => {
    const rec = await getProduct(key);
    if (!rec || !rec.track) return null;
    const result = PTInsights.evaluateAlert(rec.track, product.price, settings.dropThresholdPct, settings.lang);
    rec.track = result.track;
    rec.lastCheck = { at: Date.now(), ok: true, error: null };
    await saveProduct(rec);
    return result.alert ? { rec, alert: result.alert } : null;
  });
  if (alert && settings.notifications) await notify(alert.rec, alert.alert);
  return { ok: true, price: product.price, alerted: !!alert };
}

function markCheck(key, ok, error) {
  return withLock(async () => {
    const rec = await getProduct(key);
    if (!rec) return;
    rec.lastCheck = { at: Date.now(), ok, error };
    await saveProduct(rec);
  });
}

let checking = null;
function checkAll() {
  if (!checking) {
    checking = runChecks().finally(() => {
      checking = null;
    });
  }
  return checking;
}

async function runChecks() {
  const settings = await getSettings();
  const tracked = await listTracked();
  const results = [];
  try {
    for (let i = 0; i < tracked.length; i++) {
      const rec = tracked[i];
      if (i > 0) await sleep(FETCH_GAP_MS); // be gentle with the shops
      try {
        const res = await fetch(rec.url, { credentials: 'omit', redirect: 'follow' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const html = await res.text();
        results.push({ key: rec.key, ...(await processFetchedHtml(rec.key, html, rec.url, settings)) });
      } catch (err) {
        await markCheck(rec.key, false, String((err && err.message) || err));
        results.push({ key: rec.key, ok: false });
      }
    }
  } finally {
    await closeOffscreen();
  }
  return results;
}

async function ensureAlarm(force = false) {
  const settings = await getSettings();
  const period = settings.checkIntervalHours * 60;
  const existing = await chrome.alarms.get(ALARM);
  if (!force && existing && existing.periodInMinutes === period) return;
  await chrome.alarms.create(ALARM, { delayInMinutes: Math.min(period, 30), periodInMinutes: period });
}

// ---------------------------------------------------- notifications/links ---

async function notify(rec, alert) {
  await chrome.notifications.create(rec.key, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: (rec.title || PTStores.storeLabel(rec.store)).slice(0, 80),
    message: alert.text,
    contextMessage: PTStores.storeLabel(rec.store),
    priority: 1,
  });
}

/**
 * Open a product in a new tab after a user click. `fromAlert` marks a click on
 * a price-drop notification. Affiliate rules live in shared/affiliate.js.
 */
async function openProduct(key, { fromAlert = false } = {}) {
  const rec = await getProduct(key);
  if (!rec) return null;
  const settings = await getSettings();
  const price = currentPrice(rec);
  const userClickedDeal = fromAlert || PTInsights.isDealNow(rec.track, price);
  const out = PTAffiliate.buildOutboundUrl({ url: rec.url, store: rec.store, settings, userClickedDeal });
  await chrome.tabs.create({ url: out.href });
  return out;
}

// --------------------------------------------------------------- wiring ---

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm(true);
});

chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) checkAll();
});

chrome.notifications.onClicked.addListener((key) => {
  openProduct(key, { fromAlert: true });
  chrome.notifications.clear(key);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  const before = PTSettings.normalize(changes.settings.oldValue);
  const after = PTSettings.normalize(changes.settings.newValue);
  if (before.checkIntervalHours !== after.checkIntervalHours) ensureAlarm(true);
});

const HANDLERS = {
  async recordPrice(msg) {
    const product = await recordPrice(msg.product);
    return { product, settings: await getSettings() };
  },
  async getProduct(msg) {
    return { product: await getProduct(msg.key), settings: await getSettings() };
  },
  async track(msg) {
    return { product: await trackProduct(msg.key, msg.targetPrice) };
  },
  async untrack(msg) {
    return { product: await untrackProduct(msg.key) };
  },
  async listTracked() {
    return { products: await listTracked(), settings: await getSettings() };
  },
  async checkNow() {
    return { results: await checkAll() };
  },
  async openProduct(msg) {
    return await openProduct(msg.key);
  },
  async saveSettings(msg) {
    const settings = PTSettings.normalize(msg.settings);
    await chrome.storage.local.set({ settings });
    return { settings };
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target === 'offscreen') return false;
  if (sender.id !== chrome.runtime.id) return false;
  const handler = HANDLERS[msg.type];
  if (!handler) return false;
  handler(msg)
    .then((data) => sendResponse({ ok: true, ...data }))
    .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
  return true;
});
