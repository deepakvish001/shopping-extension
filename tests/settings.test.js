const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../extension/src/shared/settings.js');

test('normalize fills defaults and rejects bad values', () => {
  assert.deepEqual(S.normalize(undefined), JSON.parse(JSON.stringify(S.DEFAULTS)));
  const s = S.normalize({ lang: 'fr', checkIntervalHours: 3, dropThresholdPct: 500, notifications: false, affiliate: { enabled: 'yes', templates: { flipkart: '  https://a.example/?u={url} ', amazon: 'x' } } });
  assert.equal(s.lang, 'hi');
  assert.equal(s.checkIntervalHours, 12);
  assert.equal(s.dropThresholdPct, 50);
  assert.equal(s.notifications, false);
  assert.equal(s.affiliate.enabled, false);
  assert.deepEqual(s.affiliate.templates, { flipkart: 'https://a.example/?u={url}', myntra: '' });
});
