const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../extension/src/shared/affiliate.js');

const TPL = 'https://network.example/r?id=123&url={url}';
const on = { affiliate: { enabled: true, templates: { flipkart: TPL, myntra: TPL } } };
const FK = 'https://www.flipkart.com/x/p/itm1?pid=ABC';

test('Amazon links are never affiliated', () => {
  const amazonOn = { affiliate: { enabled: true, templates: { amazon: TPL } } };
  const r = A.buildOutboundUrl({ url: 'https://www.amazon.in/dp/B0TEST1234', store: 'amazon', settings: amazonOn, userClickedDeal: true });
  assert.deepEqual(r, { href: 'https://www.amazon.in/dp/B0TEST1234', affiliate: false, reason: 'store-excluded' });
});

test('stays plain when disabled, without a deal click, or without a template', () => {
  assert.equal(A.buildOutboundUrl({ url: FK, store: 'flipkart', settings: {}, userClickedDeal: true }).reason, 'disabled');
  assert.equal(A.buildOutboundUrl({ url: FK, store: 'flipkart', settings: on, userClickedDeal: false }).reason, 'no-direct-benefit');
  const noTpl = { affiliate: { enabled: true, templates: { flipkart: 'https://network.example/no-placeholder' } } };
  assert.equal(A.buildOutboundUrl({ url: FK, store: 'flipkart', settings: noTpl, userClickedDeal: true }).reason, 'no-template');
});

test('never replaces an existing affiliate marker', () => {
  const r = A.buildOutboundUrl({ url: FK + '&affid=someoneelse', store: 'flipkart', settings: on, userClickedDeal: true });
  assert.equal(r.reason, 'existing-affiliate');
  assert.equal(r.href, FK + '&affid=someoneelse');
  assert.equal(A.hasAffiliateMarker('https://x.example/?utm_medium=Affiliate'), true);
  assert.equal(A.hasAffiliateMarker('https://x.example/?utm_medium=email'), false);
});

test('builds the network deep link for a deal click', () => {
  const r = A.buildOutboundUrl({ url: FK, store: 'flipkart', settings: on, userClickedDeal: true });
  assert.equal(r.affiliate, true);
  assert.equal(r.href, 'https://network.example/r?id=123&url=' + encodeURIComponent(FK));
});

test('template validation requires https and {url}', () => {
  assert.equal(A.isValidTemplate(TPL), true);
  assert.equal(A.isValidTemplate('http://network.example/?u={url}'), false);
  assert.equal(A.isValidTemplate('javascript:alert({url})'), false);
  assert.equal(A.isValidTemplate(''), false);
});
