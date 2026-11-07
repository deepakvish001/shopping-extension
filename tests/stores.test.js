const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../extension/src/shared/stores.js');

test('identifies Amazon.in product URLs and drops tracking junk', () => {
  const r = S.identify('https://www.amazon.in/boAt-Rockerz-450/dp/b0test1234/ref=sr_1_3?tag=someone-21&th=1');
  assert.deepEqual(r, { store: 'amazon', id: 'B0TEST1234', key: 'amazon:B0TEST1234', url: 'https://www.amazon.in/dp/B0TEST1234' });
  assert.equal(S.identify('https://www.amazon.in/gp/product/B0TEST1234').id, 'B0TEST1234');
  assert.equal(S.identify('https://www.amazon.in/s?k=headphones'), null);
  assert.equal(S.identify('https://www.amazon.com/dp/B0TEST1234'), null, 'only amazon.in');
});

test('identifies Flipkart product URLs by pid, falling back to the item id', () => {
  const r = S.identify('https://www.flipkart.com/samsung-galaxy-m35/p/itm123abc?pid=MOBGZ12345&lid=LST&affid=x');
  assert.equal(r.key, 'flipkart:MOBGZ12345');
  assert.equal(r.url, 'https://www.flipkart.com/samsung-galaxy-m35/p/itm123abc?pid=MOBGZ12345');
  assert.equal(S.identify('https://www.flipkart.com/x/p/itmABC999').id, 'itmabc999');
  assert.equal(S.identify('https://www.flipkart.com/search?q=phone'), null);
});

test('identifies Myntra product URLs', () => {
  const r = S.identify('https://www.myntra.com/tshirts/roadster/roadster-men-black/1234567/buy?utm_source=x');
  assert.equal(r.key, 'myntra:1234567');
  assert.equal(r.url, 'https://www.myntra.com/tshirts/roadster/roadster-men-black/1234567/buy');
  assert.equal(S.identify('https://www.myntra.com/men-tshirts'), null);
});

test('rejects other sites and garbage', () => {
  assert.equal(S.identify('https://example.com/dp/B0TEST1234'), null);
  assert.equal(S.identify('not a url'), null);
  assert.equal(S.storeForUrl('https://flipkart.com/'), 'flipkart');
});

test('parseINR handles rupee formats', () => {
  assert.equal(S.parseINR('₹1,23,456.00'), 123456);
  assert.equal(S.parseINR('Rs. 1,299'), 1299);
  assert.equal(S.parseINR(' ₹ 449 '), 449);
  assert.equal(S.parseINR('₹54,999.50'), 54999.5);
  assert.equal(S.parseINR('₹499 - ₹999'), 499);
  assert.equal(S.parseINR(13999), 13999);
  assert.equal(S.parseINR('free'), null);
  assert.equal(S.parseINR('₹0'), null);
  assert.equal(S.parseINR(null), null);
});

test('understands app share link shapes', () => {
  const fk = S.identify('https://dl.flipkart.com/dl/samsung-galaxy-m35/p/itm123abc?pid=MOBGZ12345&_appId=CL');
  assert.equal(fk.key, 'flipkart:MOBGZ12345');
  assert.equal(fk.url, 'https://www.flipkart.com/samsung-galaxy-m35/p/itm123abc?pid=MOBGZ12345');
  assert.equal(S.identify('https://dl.flipkart.com/s/abc123'), null, 'short links need resolving first');
  const my = S.identify('https://www.myntra.com/7654321');
  assert.deepEqual([my.key, my.url], ['myntra:7654321', 'https://www.myntra.com/7654321']);
  assert.equal(S.identify('https://www.myntra.com/123'), null);
});
