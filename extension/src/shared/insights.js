/*
 * Price history maths and the user-facing verdicts built from it.
 * Pure functions only: no chrome.* or DOM calls, so everything here is unit tested.
 *
 * History format: array of [timestampMs, price] pairs, oldest first.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PTInsights = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;
  const MAX_POINTS = 1000;
  const SAME_PRICE_GAP = 12 * HOUR;

  // ---------------------------------------------------------------- text ---

  const MESSAGES = {
    hi: {
      new: 'Abhi data kam hai. Track karo, hum daam par nazar rakhenge.',
      lowest: 'Ab tak ka sabse kam daam!',
      good: (pct) => `Achha deal: typical daam se ${pct}% sasta.`,
      high: (pct) => `Ruko: typical daam se ${pct}% mehenga.`,
      normal: 'Normal daam, koi khaas deal nahi.',
      inflated: (claimed, real) =>
        `MRP par ${claimed}% off dikh raha hai, lekin pichhle daam ke mukable asli bachat sirf ${real}% hai.`,
      inflatedNegative: (claimed) => `MRP par ${claimed}% off dikh raha hai, lekin yeh daam typical daam se upar hai.`,
      alertTarget: (price, target) => `Daam ${price} ho gaya, aapke target ${target} se kam.`,
      alertDrop: (price, pct) => `Daam ${pct}% gira: ab ${price}.`,
      saleHike: (base, peak, cur) =>
        `Sale ka khel? Pehle daam lagbhag ${base} tha, phir badha kar ${peak} kiya gaya. Ab ${cur} "discount" me hai, jo pehle wale daam se sasta nahi.`,
    },
    en: {
      new: 'Not enough data yet. Track it and we will watch the price.',
      lowest: 'Lowest price seen so far!',
      good: (pct) => `Good deal: ${pct}% below its typical price.`,
      high: (pct) => `Wait: ${pct}% above its typical price.`,
      normal: 'Usual price, nothing special.',
      inflated: (claimed, real) => `Shows ${claimed}% off MRP, but the real saving versus past prices is only ${real}%.`,
      inflatedNegative: (claimed) => `Shows ${claimed}% off MRP, but this price is above its typical price.`,
      alertTarget: (price, target) => `Price is now ${price}, below your target of ${target}.`,
      alertDrop: (price, pct) => `Price dropped ${pct}%: now ${price}.`,
      saleHike: (base, peak, cur) =>
        `Possible fake sale: the price was about ${base}, was raised to ${peak}, and is now ${cur} as a "discount", which is no cheaper than before.`,
    },
  };

  function msg(lang) {
    return MESSAGES[lang] || MESSAGES.hi;
  }

  const inrFormatter = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

  function formatINR(n) {
    if (n === null || n === undefined || !Number.isFinite(n)) return '—';
    return `₹${inrFormatter.format(n)}`;
  }

  // ------------------------------------------------------------- history ---

  /**
   * Add a price observation. A repeat of the last price is stored only when the
   * last point is older than 12 hours, so history stays small but still shows
   * that a price held steady. Keeps at most MAX_POINTS points.
   */
  function recordPoint(history, price, now) {
    const list = Array.isArray(history) ? history.slice() : [];
    if (!Number.isFinite(price) || price <= 0) return list;
    const last = list[list.length - 1];
    if (last && now < last[0]) return list; // clock went backwards; ignore
    if (last && last[1] === price && now - last[0] < SAME_PRICE_GAP) return list;
    list.push([now, price]);
    if (list.length > MAX_POINTS) list.splice(0, list.length - MAX_POINTS);
    return list;
  }

  /**
   * Summary statistics. Average and median are time weighted: each price
   * counts for as long as it was the price (the last one until `now`), so
   * checking a page many times in one hour does not skew them.
   *
   * `median` is the "typical" price that verdicts compare against. Unlike the
   * average, a short pre-sale price hike cannot pull it up, so a "sale" back
   * to the usual price is not mistaken for a deal.
   */
  function stats(history, now) {
    const h = Array.isArray(history) ? history.filter((p) => Number.isFinite(p[1]) && p[1] > 0) : [];
    if (!h.length) return null;
    const end = Math.max(now || 0, h[h.length - 1][0]);
    let min = Infinity;
    let max = -Infinity;
    let minAt = 0;
    let maxAt = 0;
    let weighted = 0;
    let duration = 0;
    let sum = 0;
    const segments = [];
    for (let i = 0; i < h.length; i++) {
      const [t, p] = h[i];
      if (p < min || (p === min && t > minAt)) {
        min = p;
        minAt = t;
      }
      if (p > max) {
        max = p;
        maxAt = t;
      }
      const next = i + 1 < h.length ? h[i + 1][0] : end;
      const span = Math.max(0, next - t);
      weighted += p * span;
      duration += span;
      sum += p;
      segments.push([p, span]);
    }
    const avg = duration > 0 ? weighted / duration : sum / h.length;
    return {
      count: h.length,
      current: h[h.length - 1][1],
      min,
      max,
      minAt,
      maxAt,
      avg: Math.round(avg * 100) / 100,
      median: weightedMedian(segments, duration),
      firstSeen: h[0][0],
      lastSeen: h[h.length - 1][0],
      spanDays: (end - h[0][0]) / DAY,
    };
  }

  /** Price held for at least half of the time (lower median); plain median without durations. */
  function weightedMedian(segments, total) {
    const sorted = segments.slice().sort((a, b) => a[0] - b[0]);
    if (total <= 0) return sorted[Math.floor((sorted.length - 1) / 2)][0];
    let acc = 0;
    for (const [price, span] of sorted) {
      acc += span;
      if (acc >= total / 2) return price;
    }
    return sorted[sorted.length - 1][0];
  }

  function hasEnoughData(s) {
    return !!s && s.count >= 2 && s.spanDays >= 1;
  }

  /**
   * Should the user buy now? Compares the current price with its typical
   * (median) price. "Lowest" also needs the price to be really below typical:
   * a price that is merely back at its usual level after a hike is "normal".
   * @returns {{level: 'new'|'lowest'|'good'|'normal'|'high', text: string, pctVsTypical: number|null}}
   */
  function verdict(s, lang) {
    const m = msg(lang);
    if (!hasEnoughData(s)) return { level: 'new', text: m.new, pctVsTypical: null };
    const pctVsTypical = Math.round(((s.current - s.median) / s.median) * 100);
    if (s.current <= s.min && s.max > s.min && pctVsTypical <= -3) return { level: 'lowest', text: m.lowest, pctVsTypical };
    if (pctVsTypical <= -5) return { level: 'good', text: m.good(Math.abs(pctVsTypical)), pctVsTypical };
    if (pctVsTypical >= 5) return { level: 'high', text: m.high(pctVsTypical), pctVsTypical };
    return { level: 'normal', text: m.normal, pctVsTypical };
  }

  /**
   * Compare the discount the shop advertises (against MRP) with the real saving
   * against the typical price. Flags "inflated" MRP discounts.
   * @returns {null | {claimedPct, realPct, inflated: boolean, text: string|null}}
   */
  function discountCheck(s, mrp, lang) {
    if (!s || !Number.isFinite(mrp) || mrp <= s.current) return null;
    const claimedPct = Math.round(((mrp - s.current) / mrp) * 100);
    if (!hasEnoughData(s)) return { claimedPct, realPct: null, inflated: false, text: null };
    const realPct = Math.round(((s.median - s.current) / s.median) * 100);
    const inflated = claimedPct >= 30 && realPct < 5;
    const m = msg(lang);
    let text = null;
    if (inflated) text = realPct <= 0 ? m.inflatedNegative(claimedPct) : m.inflated(claimedPct, realPct);
    return { claimedPct, realPct, inflated, text };
  }

  function validPoints(history) {
    return Array.isArray(history) ? history.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[1] > 0) : [];
  }

  /**
   * Time-weighted average of the step-shaped price over [from, to). Only the
   * part of the window covered by history counts. Returns null when less than
   * `minDays` of the window is covered.
   */
  function windowAvg(history, from, to, minDays = 3) {
    const h = validPoints(history);
    let weighted = 0;
    let covered = 0;
    for (let i = 0; i < h.length; i++) {
      const start = Math.max(h[i][0], from);
      const end = Math.min(i + 1 < h.length ? h[i + 1][0] : to, to);
      if (end > start) {
        weighted += h[i][1] * (end - start);
        covered += end - start;
      }
    }
    return covered >= minDays * DAY ? weighted / covered : null;
  }

  /**
   * Detect the "raise the price, then announce a sale" pattern:
   * the price in the last 3 weeks was pushed at least 10% above its usual
   * level from the 90 days before, and today's "reduced" price is still not
   * meaningfully below that usual level.
   * @returns {null | {baseline, peak, current, text}}
   */
  function saleHike(history, now, lang) {
    const h = validPoints(history);
    if (h.length < 3) return null;
    const s = stats(h, now);
    if (!s || s.spanDays < 14) return null;
    const recentFrom = now - 21 * DAY;
    const baseline = windowAvg(h, now - 111 * DAY, recentFrom);
    if (!baseline) return null;

    let peak = -Infinity;
    for (let i = 0; i < h.length; i++) {
      const activeUntil = i + 1 < h.length ? h[i + 1][0] : now;
      if (activeUntil > recentFrom) peak = Math.max(peak, h[i][1]);
    }
    const current = s.current;
    if (!(peak >= baseline * 1.1) || current >= peak || current < baseline * 0.97) return null;
    return {
      baseline: Math.round(baseline),
      peak,
      current,
      text: msg(lang).saleHike(formatINR(Math.round(baseline)), formatINR(peak), formatINR(current)),
    };
  }

  /**
   * Combine community history (one point per day, from the website) with this
   * browser's own observations: community points older than the first local
   * point give the long view, local points give the exact recent prices.
   */
  function mergeHistory(local, community) {
    const l = validPoints(local);
    const c = validPoints(community).sort((a, b) => a[0] - b[0]);
    if (!c.length) return l;
    if (!l.length) return c;
    return c.filter((p) => p[0] < l[0][0]).concat(l);
  }

  // -------------------------------------------------------------- alerts ---

  /**
   * Decide whether a newly checked price deserves a notification.
   *
   * `track` = { priceAtAdd, targetPrice|null, lastNotifiedPrice|null }.
   * With a target price set, alerts only when the price reaches the target.
   * Without one, alerts when the price falls `thresholdPct` below the price
   * when tracking started. The same or a higher price is not announced
   * twice; once the price climbs back above the last announced price by the
   * threshold, a later drop alerts again.
   *
   * @returns {{track: object, alert: null | {reason: 'target'|'drop', text: string}}}
   */
  function evaluateAlert(track, newPrice, thresholdPct, lang) {
    if (!track || !Number.isFinite(newPrice) || newPrice <= 0) return { track, alert: null };
    const next = { ...track };
    const threshold = Math.max(0, Number(thresholdPct) || 0) / 100;

    if (next.lastNotifiedPrice && newPrice >= next.lastNotifiedPrice * (1 + threshold) && newPrice > next.lastNotifiedPrice) {
      next.lastNotifiedPrice = null; // price recovered: allow a fresh alert later
    }
    if (next.lastNotifiedPrice && newPrice >= next.lastNotifiedPrice) return { track: next, alert: null };

    const m = msg(lang);
    let alert = null;
    const hasTarget = Number.isFinite(next.targetPrice) && next.targetPrice > 0;
    if (hasTarget) {
      if (newPrice <= next.targetPrice) {
        alert = { reason: 'target', text: m.alertTarget(formatINR(newPrice), formatINR(next.targetPrice)) };
      }
    } else if (Number.isFinite(next.priceAtAdd) && newPrice <= next.priceAtAdd * (1 - threshold) && newPrice < next.priceAtAdd) {
      const pct = Math.round(((next.priceAtAdd - newPrice) / next.priceAtAdd) * 100);
      alert = { reason: 'drop', text: m.alertDrop(formatINR(newPrice), pct) };
    }
    if (alert) next.lastNotifiedPrice = newPrice;
    return { track: next, alert };
  }

  /** True when opening the product right now gives the user a concrete benefit. */
  function isDealNow(track, currentPrice) {
    if (!track || !Number.isFinite(currentPrice)) return false;
    if (Number.isFinite(track.targetPrice) && track.targetPrice > 0 && currentPrice <= track.targetPrice) return true;
    return Number.isFinite(track.priceAtAdd) && currentPrice < track.priceAtAdd;
  }

  // --------------------------------------------------------------- chart ---

  /**
   * Build an inline SVG step chart of the price history (prices hold until
   * they change). Returns markup containing numbers only, safe to inject.
   */
  function chartSvg(history, opts) {
    const o = Object.assign({ width: 280, height: 90, now: Date.now(), color: '#1a73e8' }, opts || {});
    const h = Array.isArray(history) ? history.filter((p) => Number.isFinite(p[1])) : [];
    const W = o.width;
    const H = o.height;
    const pad = 6;
    if (!h.length) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="No price history"></svg>`;

    const t0 = h[0][0];
    const t1 = Math.max(o.now, h[h.length - 1][0], t0 + 1);
    let lo = Math.min(...h.map((p) => p[1]));
    let hi = Math.max(...h.map((p) => p[1]));
    if (hi === lo) {
      lo = lo * 0.95;
      hi = hi * 1.05;
    }
    const x = (t) => pad + ((t - t0) / (t1 - t0)) * (W - 2 * pad);
    const y = (p) => pad + (1 - (p - lo) / (hi - lo)) * (H - 2 * pad);
    const r = (n) => Math.round(n * 10) / 10;

    let d = `M${r(x(h[0][0]))},${r(y(h[0][1]))}`;
    for (let i = 1; i < h.length; i++) {
      d += ` H${r(x(h[i][0]))} V${r(y(h[i][1]))}`;
    }
    d += ` H${r(x(t1))}`;
    const area = `${d} V${H - pad} H${r(x(h[0][0]))} Z`;
    const last = h[h.length - 1];
    const color = /^#[0-9a-f]{3,8}$/i.test(o.color) ? o.color : '#1a73e8';

    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Price history chart">` +
      `<path d="${area}" fill="${color}" fill-opacity="0.12" stroke="none"/>` +
      `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>` +
      `<circle cx="${r(x(t1))}" cy="${r(y(last[1]))}" r="3.5" fill="${color}"/>` +
      `</svg>`
    );
  }

  function daysAgoText(ts, now, lang) {
    const days = Math.floor((now - ts) / DAY);
    if (lang === 'en') return days <= 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`;
    return days <= 0 ? 'aaj' : `${days} din pehle`;
  }

  return {
    MESSAGES,
    MAX_POINTS,
    formatINR,
    recordPoint,
    stats,
    verdict,
    discountCheck,
    saleHike,
    mergeHistory,
    windowAvg,
    evaluateAlert,
    isDealNow,
    chartSvg,
    daysAgoText,
  };
});
