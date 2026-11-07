const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../extension/src/shared/insights.js');

const HOUR = 3600e3;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 0, 1);

test('recordPoint skips repeats within 12h, keeps changes, caps size', () => {
  let h = I.recordPoint([], 100, T0);
  h = I.recordPoint(h, 100, T0 + HOUR);
  assert.equal(h.length, 1);
  h = I.recordPoint(h, 90, T0 + 2 * HOUR);
  h = I.recordPoint(h, 90, T0 + 15 * HOUR);
  assert.deepEqual(h, [[T0, 100], [T0 + 2 * HOUR, 90], [T0 + 15 * HOUR, 90]]);
  assert.equal(I.recordPoint(h, NaN, T0 + DAY).length, 3);
  assert.equal(I.recordPoint(h, 80, T0 - DAY).length, 3, 'ignores time going backwards');

  let big = [];
  for (let i = 0; i < I.MAX_POINTS + 10; i++) big = I.recordPoint(big, 100 + (i % 2), T0 + i * HOUR);
  assert.equal(big.length, I.MAX_POINTS);
  assert.equal(big[0][0], T0 + 10 * HOUR);
});

test('stats uses a time-weighted average', () => {
  // 100 for 9 days, then 50 for 1 day: time-weighted avg 95, plain avg would be 75.
  const s = I.stats([[T0, 100], [T0 + 9 * DAY, 50]], T0 + 10 * DAY);
  assert.equal(s.avg, 95);
  assert.equal(s.min, 50);
  assert.equal(s.max, 100);
  assert.equal(s.current, 50);
  assert.equal(s.spanDays, 10);
  assert.equal(I.stats([], T0), null);
});

test('verdict levels', () => {
  const now = T0 + 10 * DAY;
  assert.equal(I.verdict(I.stats([[T0, 100]], T0 + HOUR), 'en').level, 'new');
  assert.equal(I.verdict(I.stats([[T0, 100], [T0 + 9 * DAY, 50]], now), 'en').level, 'lowest');
  // avg = (95*1 + 100*8 + 98*1) / 10 = 99.3; 98 is within 5% => normal
  assert.equal(I.verdict(I.stats([[T0, 95], [T0 + DAY, 100], [T0 + 9 * DAY, 98]], now), 'en').level, 'normal');
  const high = I.verdict(I.stats([[T0, 100], [T0 + 9 * DAY, 120]], now), 'en');
  assert.equal(high.level, 'high');
  assert.match(high.text, /above average/);
  const good = I.verdict(I.stats([[T0, 80], [T0 + DAY, 100], [T0 + 9 * DAY, 90]], T0 + 9 * DAY + HOUR), 'hi');
  assert.equal(good.level, 'good');
  assert.match(good.text, /sasta/);
});

test('discountCheck flags an inflated MRP discount', () => {
  const now = T0 + 10 * DAY;
  // Steady at 1000 for 10 days, "MRP" 2500 => claims 60% off, real saving 0.
  const steady = I.stats([[T0, 1000], [T0 + 5 * DAY, 1000]], now);
  const d = I.discountCheck(steady, 2500, 'en');
  assert.equal(d.claimedPct, 60);
  assert.equal(d.realPct, 0);
  assert.equal(d.inflated, true);
  assert.match(d.text, /60% off MRP/);

  const realDrop = I.stats([[T0, 2000], [T0 + 9 * DAY, 1000]], now);
  assert.equal(I.discountCheck(realDrop, 2500, 'en').inflated, false);
  assert.equal(I.discountCheck(steady, null, 'en'), null);
  assert.equal(I.discountCheck(I.stats([[T0, 1000]], T0), 2000, 'en').realPct, null);
});

test('evaluateAlert: percentage drop without a target', () => {
  const track = { priceAtAdd: 1000, targetPrice: null, lastNotifiedPrice: null };
  assert.equal(I.evaluateAlert(track, 960, 5, 'en').alert, null);
  const r1 = I.evaluateAlert(track, 940, 5, 'en');
  assert.equal(r1.alert.reason, 'drop');
  assert.match(r1.alert.text, /6%/);
  assert.equal(r1.track.lastNotifiedPrice, 940);
  assert.equal(I.evaluateAlert(r1.track, 940, 5, 'en').alert, null, 'same price not announced twice');
  assert.equal(I.evaluateAlert(r1.track, 900, 5, 'en').alert.reason, 'drop', 'a further drop alerts');
  const recovered = I.evaluateAlert(r1.track, 1000, 5, 'en');
  assert.equal(recovered.alert, null);
  assert.equal(recovered.track.lastNotifiedPrice, null, 'price recovered, alerts re-armed');
  assert.equal(I.evaluateAlert(recovered.track, 940, 5, 'en').alert.reason, 'drop');
});

test('evaluateAlert: target price only alerts at the target', () => {
  const track = { priceAtAdd: 1000, targetPrice: 800, lastNotifiedPrice: null };
  assert.equal(I.evaluateAlert(track, 850, 5, 'en').alert, null);
  const r = I.evaluateAlert(track, 799, 5, 'hi');
  assert.equal(r.alert.reason, 'target');
  assert.match(r.alert.text, /₹799/);
  assert.equal(I.evaluateAlert(track, NaN, 5, 'en').alert, null);
});

test('isDealNow', () => {
  assert.equal(I.isDealNow({ priceAtAdd: 1000, targetPrice: null }, 999), true);
  assert.equal(I.isDealNow({ priceAtAdd: 1000, targetPrice: null }, 1000), false);
  assert.equal(I.isDealNow({ priceAtAdd: 1000, targetPrice: 1200 }, 1100), true);
  assert.equal(I.isDealNow(null, 10), false);
});

test('chartSvg draws a step line and only contains numbers', () => {
  const svg = I.chartSvg([[T0, 100], [T0 + DAY, 80]], { width: 200, height: 60, now: T0 + 2 * DAY, color: 'red;"><script>' });
  assert.match(svg, /^<svg /);
  assert.match(svg, /<path d="M6,6 H100 V54 H194"/);
  assert.doesNotMatch(svg, /script/);
  assert.match(svg, /#1a73e8/, 'invalid colours fall back to the default');
  assert.match(I.chartSvg([], {}), /No price history/);
});

test('formatINR uses Indian digit grouping', () => {
  assert.equal(I.formatINR(123456), '₹1,23,456');
  assert.equal(I.formatINR(54999.5), '₹54,999.5');
  assert.equal(I.formatINR(null), '—');
});
