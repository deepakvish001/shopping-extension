const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../extension/src/shared/insights.js');
const Sh = require('../extension/src/shared/share.js');

const DAY = 864e5;
const T0 = Date.UTC(2026, 0, 1);

test('buildText with history, warning and link', () => {
  const s = I.stats([[T0, 1500], [T0 + 5 * DAY, 1049]], T0 + 6 * DAY);
  const text = Sh.buildText({
    title: 'boAt Rockerz 450',
    store: 'amazon',
    stats: s,
    verdictText: 'Ab tak ka sabse kam daam!',
    warning: 'Sale ka khel?',
    link: 'https://site.example/p/amazon/B0TEST1234?ref=ext',
    lang: 'hi',
  });
  assert.equal(
    text,
    [
      '🛒 boAt Rockerz 450',
      'Abhi: ₹1,049 par Amazon',
      'Sabse kam: ₹1,049 | Typical: ₹1,500',
      'Ab tak ka sabse kam daam!',
      '⚠️ Sale ka khel?',
      'Price history: https://site.example/p/amazon/B0TEST1234?ref=ext',
    ].join('\n')
  );
});

test('buildText for a first sighting skips history lines', () => {
  const s = I.stats([[T0, 999]], T0);
  const text = Sh.buildText({ title: 'x'.repeat(200), store: 'myntra', stats: s, verdictText: 'new', link: 'https://www.myntra.com/a/1234567/buy', lang: 'en' });
  const lines = text.split('\n');
  assert.equal(lines.length, 3);
  assert.equal([...lines[0]].length, 2 + 90, 'title shortened to 90 characters');
  assert.ok(lines[0].endsWith('…'));
  assert.equal(lines[1], 'Now: ₹999 on Myntra');
  assert.equal(lines[2], 'See the price history: https://www.myntra.com/a/1234567/buy');
});

test('share URLs are encoded', () => {
  assert.equal(Sh.whatsappUrl('a b&c\n'), 'https://wa.me/?text=a%20b%26c%0A');
  assert.equal(Sh.telegramUrl('hi there', 'https://x.example/p?a=1'), 'https://t.me/share/url?url=https%3A%2F%2Fx.example%2Fp%3Fa%3D1&text=hi%20there');
});
