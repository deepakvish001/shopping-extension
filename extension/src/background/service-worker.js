/*
 * Background service worker.
 *
 * - Owns all writes to price data (content scripts and the popup send
 *   messages), serialised through a lock so concurrent tabs cannot clobber
 *   each other's read-modify-write.
 * - Re-checks tracked products on a timer, parses the fetched HTML in an
 *   offscreen document (service workers have no DOMParser) and shows a
 *   notification on a price drop.
 * - Community history (only after the user opts in, and only when
 *   PTConfig.SITE_URL is set): uploads price observations to the website
 *   and fetches the shared history of a product.
 *
 * Storage layout (chrome.storage.local):
 *   "settings"       -> see shared/settings.js
 *   "p:<store>:<id>" -> product record {key, store, id, url, title, image, mrp,
 *                       inStock, history: [[t, price]...], lastSeen,
 *                       track: null | {addedAt, priceAtAdd, targetPrice,
 *                       lastNotifiedPrice}, lastCheck: {at, ok, error}}
 *   "c:<store>:<id>" -> cached community history {at, series, reports}
 *   "uploadQueue"    -> observations waiting to be uploaded
 *   "clientId"       -> random id sent with uploads (exists only while opted in)
 */
importScripts(
  '../shared/stores.js',
  '../shared/insights.js',
  '../shared/affiliate.js',
  '../shared/settings.js',
  '../shared/config.js'
);

const ALARM = 'check-prices';
const SYNC_ALARM = 'sync-prices';
const PRODUCT_PREFIX = 'p:';
const COMMUNITY_PREFIX = 'c:';
const QUEUE_KEY = 'uploadQueue';
const CLIENT_KEY = 'clientId';
const FETCH_GAP_MS = 4000;
const OFFSCREEN_URL = 'src/offscreen/offscreen.html';
const DAY_MS = 24 * 60 * 60 * 1000;
const COMMUNITY_TTL_MS = 6 * 60 * 60 * 1000;
const QUEUE_MAX = 500;
const UPLOAD_BATCH = 50;
const MAX_UPLOAD_AGE_MS = 7 * DAY_MS;

// ------------------------------------------------------------------ utils ---

let lockChain = Promise.resolve();
/** Run `fn` after every earlier locked call finished. Never call withLock inside fn. */
function withLock(fn) {
  const run = lockChain.then(fn, fn);
  lockChain = run.catch(() => {});
  return run;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithTimeout(url, options, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

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

function communityOn(settings) {
  return settings.community === true && PTConfig.isConfigured();
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

    // recordPoint only adds a point stamped `now` when it is a new observation.
    const last = rec.history[rec.history.length - 1];
    if (last && last[0] === now && communityOn(await getSettings())) {
      await appendToQueueUnlocked([toUploadPoint(rec, last[0], last[1])]);
      flushSoon();
    }
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

// ------------------------------------------------------ community history ---

function toUploadPoint(rec, t, price) {
  return { key: rec.key, url: rec.url, title: rec.title || null, image: rec.image || null, mrp: rec.mrp || null, price, t };
}

async function appendToQueueUnlocked(points) {
  if (!points.length) return;
  const { [QUEUE_KEY]: queue = [] } = await chrome.storage.local.get(QUEUE_KEY);
  const next = queue.concat(points);
  if (next.length > QUEUE_MAX) next.splice(0, next.length - QUEUE_MAX);
  await chrome.storage.local.set({ [QUEUE_KEY]: next });
}

async function getClientId() {
  const { [CLIENT_KEY]: existing } = await chrome.storage.local.get(CLIENT_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ [CLIENT_KEY]: id });
  return id;
}

let flushTimer = null;
function flushSoon() {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => flushQueue(), 3000);
}

let flushing = null;
function flushQueue() {
  if (!flushing) {
    flushing = doFlush()
      .catch(() => ({ sent: 0 }))
      .finally(() => {
        flushing = null;
      });
  }
  return flushing;
}

async function doFlush() {
  if (!communityOn(await getSettings())) return { sent: 0 };
  const client = await getClientId();
  let sent = 0;
  for (let round = 0; round < 10; round++) {
    const { [QUEUE_KEY]: queue = [] } = await chrome.storage.local.get(QUEUE_KEY);
    const batch = queue.slice(0, UPLOAD_BATCH);
    if (!batch.length) break;
    const fresh = batch.filter((p) => Date.now() - p.t < MAX_UPLOAD_AGE_MS);
    let drop = true;
    if (fresh.length) {
      const res = await fetchWithTimeout(
        PTConfig.pricesApiUrl(),
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client, points: fresh }) },
        8000
      );
      // Keep the batch for a later try on server trouble or rate limiting;
      // drop it when the server says it is malformed, so it cannot block the queue.
      if (res.status >= 500 || res.status === 429) drop = false;
      else if (res.ok) sent += fresh.length;
    }
    if (!drop) break;
    const ids = new Set(batch.map((p) => `${p.key}|${p.t}`));
    await withLock(async () => {
      const { [QUEUE_KEY]: q = [] } = await chrome.storage.local.get(QUEUE_KEY);
      await chrome.storage.local.set({ [QUEUE_KEY]: q.filter((p) => !ids.has(`${p.key}|${p.t}`)) });
    });
  }
  return { sent };
}

function validSeries(series) {
  return Array.isArray(series)
    ? series.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[1] > 0).slice(-1000)
    : [];
}

/** Shared history of a product from the website, cached for 6 hours. */
async function getCommunity(key) {
  const settings = await getSettings();
  const ident = PTStores.identify((await getProduct(key) || {}).url);
  if (!ident || !communityOn(settings)) return null;
  const k = COMMUNITY_PREFIX + key;
  const { [k]: cached } = await chrome.storage.local.get(k);
  if (cached && Date.now() - cached.at < COMMUNITY_TTL_MS) return cached;
  try {
    const res = await fetchWithTimeout(PTConfig.historyApiUrl(ident.store, ident.id), {}, 6000);
    let value;
    if (res.status === 404) value = { at: Date.now(), series: [], reports: 0 };
    else if (res.ok) {
      const data = await res.json();
      value = { at: Date.now(), series: validSeries(data.series), reports: Math.max(0, Number(data.reports) || 0) };
    } else throw new Error(`HTTP ${res.status}`);
    await chrome.storage.local.set({ [k]: value });
    return value;
  } catch (_) {
    return cached || null;
  }
}

/** Side effects of switching community history on or off (from any settings writer). */
async function onCommunityChanged(enabled) {
  if (enabled) {
    if (!PTConfig.isConfigured()) return;
    await getClientId();
    await withLock(async () => {
      const cutoff = Date.now() - MAX_UPLOAD_AGE_MS;
      const points = [];
      for (const p of await allProducts()) {
        for (const [t, price] of p.history || []) if (t >= cutoff) points.push(toUploadPoint(p, t, price));
      }
      points.sort((a, b) => a.t - b.t);
      await appendToQueueUnlocked(points);
    });
    flushSoon();
  } else {
    const all = await chrome.storage.local.get(null);
    const remove = Object.keys(all).filter((k) => k.startsWith(COMMUNITY_PREFIX) || k === QUEUE_KEY || k === CLIENT_KEY);
    await chrome.storage.local.remove(remove);
  }
}

async function pruneCommunityCache() {
  const all = await chrome.storage.local.get(null);
  const old = Object.keys(all).filter((k) => k.startsWith(COMMUNITY_PREFIX) && Date.now() - (all[k].at || 0) > 7 * DAY_MS);
  if (old.length) await chrome.storage.local.remove(old);
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
  if (force || !existing || existing.periodInMinutes !== period) {
    await chrome.alarms.create(ALARM, { delayInMinutes: Math.min(period, 30), periodInMinutes: period });
  }
  if (!(await chrome.alarms.get(SYNC_ALARM))) {
    await chrome.alarms.create(SYNC_ALARM, { delayInMinutes: 15, periodInMinutes: 15 });
  }
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
  flushQueue();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) checkAll();
  if (alarm.name === SYNC_ALARM) {
    flushQueue();
    pruneCommunityCache();
  }
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
  if (before.community !== after.community && (before.community === true || after.community === true)) {
    onCommunityChanged(after.community === true);
  }
});

const HANDLERS = {
  async recordPrice(msg) {
    const product = await recordPrice(msg.product);
    return { product, settings: await getSettings() };
  },
  async getProduct(msg) {
    return { product: await getProduct(msg.key), settings: await getSettings() };
  },
  async getCommunity(msg) {
    return { community: await getCommunity(msg.key) };
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
