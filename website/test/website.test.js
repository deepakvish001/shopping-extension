import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { createD1 } from './d1-shim.js';
import { refreshAggregates } from '../src/lib/db.js';
import { istDay, dayStart, DAY_MS } from '../src/lib/days.js';
import { dailySeries, aggregates, lowerMedian } from '../src/lib/series.js';
import { resolveProduct, extractUrl } from '../src/lib/links.js';
import { identFromPath } from '../src/lib/paths.js';
import { validatePoint, LIMITS } from '../src/lib/ingest.js';

const FK_URL = 'https://www.flipkart.com/samsung-galaxy-m35/p/itm123abc?pid=MOBGZ12345';
const AMZ_URL = 'https://www.amazon.in/dp/B0TEST1234';

function makeEnv(extra = {}) {
  return {
    DB: createD1(),
    SITE_NAME: 'DaamDekho',
    SITE_URL: 'https://site.test',
    CLIENT_SALT: 'test-salt',
    FLIPKART_TEMPLATE: 'https://net.example/r?id=7&u={url}',
    MYNTRA_TEMPLATE: '',
    EXTENSION_URL: 'https://chromewebstore.google.com/detail/example',
    TELEGRAM_URL: '',
    ...extra,
  };
}

const get = (env, path, init) => worker.fetch(new Request(`https://site.test${path}`, init), env);

function post(env, body, ip = '1.2.3.4') {
  return get(env, '/api/v1/prices', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const point = (over = {}) => ({
  key: 'flipkart:MOBGZ12345',
  url: FK_URL,
  title: 'SAMSUNG Galaxy M35 5G',
  image: 'https://rukminim2.flixcart.com/image/416/416/phone.jpeg',
  mrp: 24499,
  price: 13999,
  t: Date.now() - 60_000,
  ...over,
});

/** Insert history directly (uploads only accept the last 7 days). */
async function seed(env, key, url, prices, { clients = ['a'], title = 'Seeded product', image = null } = {}) {
  const now = Date.now();
  const store = key.split(':')[0];
  const pid = key.slice(store.length + 1);
  await env.DB.prepare('INSERT INTO products (key, store, pid, url, title, image, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(key, store, pid, url, title, image, now - prices.length * DAY_MS, now)
    .run();
  for (let i = 0; i < prices.length; i++) {
    const t = now - (prices.length - 1 - i) * DAY_MS;
    for (const c of clients) {
      await env.DB.prepare('INSERT INTO observations (key, day, client, price, t) VALUES (?, ?, ?, ?, ?)').bind(key, istDay(t), c, prices[i], t).run();
    }
  }
  await refreshAggregates(env.DB, key, now);
}

// ----------------------------------------------------------- pure helpers

test('days are bucketed in India time', () => {
  // 20:00 UTC on 1 Jan is 01:30 IST on 2 Jan.
  assert.equal(istDay(Date.UTC(2026, 0, 1, 20, 0)), '2026-01-02');
  assert.equal(dayStart('2026-01-02'), Date.UTC(2026, 0, 1, 18, 30));
});

test('daily series uses the lower median, so one fake report cannot move a price', () => {
  assert.equal(lowerMedian([5, 1, 3]), 3);
  assert.equal(lowerMedian([4, 1, 3, 2]), 2);
  const series = dailySeries([
    { day: '2026-01-02', price: 100 },
    { day: '2026-01-01', price: 120 },
    { day: '2026-01-02', price: 101 },
    { day: '2026-01-02', price: 1 }, // liar
    { day: '2026-01-02', price: 99 },
  ]);
  assert.deepEqual(series, [[dayStart('2026-01-01'), 120], [dayStart('2026-01-02'), 99]]);
  const agg = aggregates(series, dayStart('2026-01-02') + 1000);
  assert.deepEqual(agg, { last_price: 99, low_price: 99, low_day: '2026-01-02', high_price: 120, typical_price: null, days: 2 });
});

test('identFromPath normalises ids like the extension does', () => {
  assert.deepEqual(identFromPath('amazon', 'b0test1234'), { store: 'amazon', id: 'B0TEST1234', key: 'amazon:B0TEST1234', url: AMZ_URL });
  assert.equal(identFromPath('flipkart', 'mobgz12345').key, 'flipkart:MOBGZ12345');
  assert.equal(identFromPath('flipkart', 'ITMABC9').key, 'flipkart:itmabc9');
  assert.equal(identFromPath('myntra', '7654321').url, 'https://www.myntra.com/7654321');
  assert.equal(identFromPath('ebay', '123456'), null);
  assert.equal(identFromPath('amazon', '%E0%A4'), null, 'bad encoding');
  assert.equal(identFromPath('amazon', 'B0<script>'), null);
});

test('validatePoint rebuilds the URL and rejects junk', () => {
  const now = Date.now();
  const ok = validatePoint(point({ url: FK_URL + '&affid=x', title: ' a\u0000b  c ', image: 'https://evil.example/x.jpg', mrp: 999999 }), now);
  assert.equal(ok.ok, true);
  assert.equal(ok.point.url, FK_URL, 'tracking params dropped');
  assert.equal(ok.point.title, 'a b c');
  assert.equal(ok.point.image, null, 'images only from shop CDNs');
  assert.equal(ok.point.mrp, null, 'MRP over 10x the price is ignored');
  assert.equal(validatePoint(point({ key: 'flipkart:OTHER' }), now).reason, 'url/key mismatch');
  assert.equal(validatePoint(point({ price: -5 }), now).reason, 'bad price');
  assert.equal(validatePoint(point({ price: '₹100' }), now).reason, 'bad price');
  assert.equal(validatePoint(point({ t: now - LIMITS.maxAgeMs - 1 }), now).reason, 'bad time');
  assert.equal(validatePoint(point({ t: now + LIMITS.maxFutureMs + 1 }), now).reason, 'bad time');
});

test('extractUrl and short-link resolution', async () => {
  assert.equal(extractUrl('Check out this product! https://dl.flipkart.com/s/abc123. Cool'), 'https://dl.flipkart.com/s/abc123');
  assert.equal(extractUrl('www.amazon.in/dp/B0TEST1234'), 'https://www.amazon.in/dp/B0TEST1234');
  assert.equal(extractUrl('hello'), null);

  const hops = {
    'https://dl.flipkart.com/s/abc123': 'https://dl.flipkart.com/dl/samsung-galaxy-m35/p/itm123abc?pid=MOBGZ12345&cmpid=share',
    'https://amzn.in/d/xyz': 'https://www.amazon.in/gp/aw/d/B0TEST1234?ref=share',
    'https://amzn.in/d/evil': 'https://evil.example/phish',
    'https://evil.example/phish': 'https://www.amazon.in/dp/B0TEST1234',
  };
  const seen = [];
  const fakeFetch = async (url, opts) => {
    seen.push(url);
    assert.equal(opts.redirect, 'manual');
    return new Response(null, { status: hops[url] ? 301 : 404, headers: hops[url] ? { location: hops[url] } : {} });
  };
  assert.equal((await resolveProduct('Dekho https://dl.flipkart.com/s/abc123', fakeFetch)).key, 'flipkart:MOBGZ12345');
  assert.equal((await resolveProduct('https://amzn.in/d/xyz', fakeFetch)).key, 'amazon:B0TEST1234');
  assert.equal(await resolveProduct('https://amzn.in/d/evil', fakeFetch), null, 'redirects off the shop hosts are not followed');
  assert.ok(!seen.includes('https://evil.example/phish'));
  assert.equal(await resolveProduct('https://example.com/whatever', fakeFetch), null);
  assert.equal((await resolveProduct(AMZ_URL, () => assert.fail('no fetch needed'))).key, 'amazon:B0TEST1234');
});

// ------------------------------------------------------------- ingest API

test('POST /api/v1/prices stores reports and builds the product', async () => {
  const env = makeEnv();
  const res = await post(env, { client: 'client-aaaa-1111', points: [point(), point({ key: 'amazon:B0TEST1234', url: AMZ_URL, price: 1299, title: 'boAt' }), point({ price: -1 })] });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.deepEqual(await res.json(), { accepted: 2, rejected: 1 });

  const row = await env.DB.prepare('SELECT * FROM products WHERE key = ?').bind('flipkart:MOBGZ12345').first();
  assert.equal(row.url, FK_URL);
  assert.equal(row.last_price, 13999);
  assert.equal(row.days, 1);
  assert.equal(row.reporters, 1);
  const obs = await env.DB.prepare('SELECT client FROM observations LIMIT 1').first();
  assert.notEqual(obs.client, 'client-aaaa-1111', 'client ids are stored hashed');
  assert.equal(obs.client.length, 32);
});

test('later reports from the same user on the same day replace the earlier one; first title wins', async () => {
  const env = makeEnv();
  const t = Date.now() - 120_000;
  await post(env, { client: 'client-aaaa-1111', points: [point({ t, price: 15000 })] });
  await post(env, { client: 'client-aaaa-1111', points: [point({ t: t + 60_000, price: 14000, title: 'Spam title' })] });
  await post(env, { client: 'client-aaaa-1111', points: [point({ t: t - 60_000, price: 99999 })] }); // older, ignored
  const rows = (await env.DB.prepare('SELECT price FROM observations').all()).results;
  assert.deepEqual(rows, [{ price: 14000 }]);
  const product = await env.DB.prepare('SELECT title, last_price FROM products').first();
  assert.deepEqual(product, { title: 'SAMSUNG Galaxy M35 5G', last_price: 14000 });
});

test('ingest rejects malformed bodies and enforces daily limits', async () => {
  const env = makeEnv();
  assert.equal((await post(env, 'not json')).status, 400);
  assert.equal((await post(env, { client: 'x', points: [point()] })).status, 400);
  assert.equal((await post(env, { client: 'client-aaaa-1111', points: [] })).status, 400);
  assert.equal((await post(env, { client: 'client-aaaa-1111', points: new Array(51).fill(point()) })).status, 400);
  assert.equal((await post(env, 'x'.repeat(LIMITS.maxBodyBytes + 1))).status, 413);

  const full = makeEnv();
  // Fill a client's quota, then one more point is refused.
  const { hashId } = await import('../src/lib/ingest.js');
  const who = await hashId('test-salt', 'client:client-bbbb-2222');
  await full.DB.prepare('INSERT INTO usage (who, day, points) VALUES (?, ?, ?)').bind(who, istDay(Date.now()), LIMITS.perClientPerDay).run();
  const limited = await post(full, { client: 'client-bbbb-2222', points: [point()] });
  assert.equal(limited.status, 429);
  assert.equal((await full.DB.prepare('SELECT COUNT(*) AS n FROM observations').first()).n, 0);
});

test('CORS preflight for the extension', async () => {
  const res = await get(makeEnv(), '/api/v1/prices', { method: 'OPTIONS' });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-methods'), 'GET, POST, OPTIONS');
  assert.equal(res.headers.get('access-control-allow-headers'), 'content-type');
});

// ------------------------------------------------------------ history API

test('GET /api/v1/history returns the daily series', async () => {
  const env = makeEnv();
  await seed(env, 'flipkart:MOBGZ12345', FK_URL, [15000, 15000, 14500, 13999], { clients: ['a', 'b'] });
  const res = await get(env, '/api/v1/history/flipkart/MOBGZ12345');
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.key, 'flipkart:MOBGZ12345');
  assert.deepEqual(data.series.map((p) => p[1]), [15000, 15000, 14500, 13999]);
  assert.equal(data.reports, 2);
  assert.equal((await get(env, '/api/v1/history/flipkart/NOPE999999')).status, 404);
  assert.equal((await get(env, '/api/v1/history/ebay/123')).status, 404);
});

// ------------------------------------------------------------------ pages

test('product page: data, verdict, share, escaping, OG tags, affiliate disclosure', async () => {
  const env = makeEnv();
  const prices = [17999, 17999, 17999, 17999, 17999, 17999, 16999, 15999, 13999];
  await seed(env, 'flipkart:MOBGZ12345', FK_URL, prices, {
    title: 'Phone <script>alert(1)</script> "quoted"',
    image: 'https://rukminim2.flixcart.com/image/phone.jpeg',
  });
  await env.DB.prepare('UPDATE products SET mrp = 24499').run();
  const res = await get(env, '/p/flipkart/MOBGZ12345');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  const body = await res.text();
  assert.ok(!body.includes('<script>alert(1)</script>'), 'title is escaped');
  assert.match(body, /Phone &lt;script&gt;alert\(1\)&lt;\/script&gt; &quot;quoted&quot;/);
  assert.match(body, /<span class="price">₹13,999<\/span>/);
  assert.match(body, /43% off MRP/);
  assert.match(body, /Ab tak ka sabse kam daam!/);
  assert.match(body, /<svg [^>]*aria-label="Price history chart"/);
  assert.match(body, /<meta property="og:title" content="Phone [^"]*: ₹13,999 \(sabse kam ₹13,999\)">/);
  assert.match(body, /<meta property="og:image" content="https:\/\/rukminim2\.flixcart\.com\/image\/phone\.jpeg">/);
  assert.match(body, /<link rel="canonical" href="https:\/\/site\.test\/p\/flipkart\/MOBGZ12345">/);
  assert.match(body, /href="https:\/\/wa\.me\/\?text=[^"]*site\.test%2Fp%2Fflipkart%2FMOBGZ12345"/);
  assert.match(body, /href="\/go\/flipkart\/MOBGZ12345" rel="sponsored nofollow noopener"/);
  assert.match(body, /Affiliate link:/);
  assert.match(body, /chromewebstore\.google\.com/);
  assert.doesNotMatch(body, /noindex/);
});

test('product page flags a fake sale', async () => {
  const env = makeEnv();
  // 40 days at 1000, raised to 1500 for two weeks, "sale" at 999.
  const prices = [...new Array(40).fill(1000), ...new Array(14).fill(1500), 999];
  await seed(env, 'amazon:B0TEST1234', AMZ_URL, prices, { title: 'Headphones' });
  const body = await (await get(env, '/p/amazon/B0TEST1234')).text();
  assert.match(body, /Sale ka khel\?/);
  assert.doesNotMatch(body, /Ab tak ka sabse kam daam!/, 'verdict must not contradict the warning');
  assert.match(body, /Normal daam, koi khaas deal nahi\./);
  assert.doesNotMatch(body, /Affiliate link:/, 'no affiliate on Amazon');
});

test('unknown product page is a helpful 404, noindex', async () => {
  const env = makeEnv();
  const res = await get(env, '/p/amazon/B0NOTHERE1');
  assert.equal(res.status, 404);
  const body = await res.text();
  assert.match(body, /Is product ka data abhi nahi hai/);
  assert.match(body, /noindex/);
  assert.match(body, /href="https:\/\/www\.amazon\.in\/dp\/B0NOTHERE1"/);
  assert.equal((await get(env, '/p/amazon/bad')).status, 404);
});

test('/go redirects: Amazon plain, Flipkart via the network template, clicks counted', async () => {
  const env = makeEnv();
  await seed(env, 'flipkart:MOBGZ12345', FK_URL, [100, 90]);
  await seed(env, 'amazon:B0TEST1234', AMZ_URL, [100, 90]);
  const fk = await get(env, '/go/flipkart/MOBGZ12345', { redirect: 'manual' });
  assert.equal(fk.status, 302);
  assert.equal(fk.headers.get('location'), 'https://net.example/r?id=7&u=' + encodeURIComponent(FK_URL));
  const amz = await get(env, '/go/amazon/B0TEST1234', { redirect: 'manual' });
  assert.equal(amz.headers.get('location'), AMZ_URL);
  const plainEnv = makeEnv({ FLIPKART_TEMPLATE: '' });
  await seed(plainEnv, 'flipkart:MOBGZ12345', FK_URL, [100]);
  assert.equal((await get(plainEnv, '/go/flipkart/MOBGZ12345', { redirect: 'manual' })).headers.get('location'), FK_URL);
  const clicks = await env.DB.prepare('SELECT clicks FROM products WHERE key = ?').bind('flipkart:MOBGZ12345').first('clicks');
  assert.equal(clicks, 1);
  assert.equal((await get(env, '/go/flipkart/NOPE999999', { redirect: 'manual' })).status, 404);
});

test('/lookup redirects a pasted link to its page, or back home with a message', async () => {
  const env = makeEnv();
  const ok = await get(env, `/lookup?u=${encodeURIComponent('Dekho yeh: ' + FK_URL + '&affid=abc')}`, { redirect: 'manual' });
  assert.equal(ok.headers.get('location'), '/p/flipkart/MOBGZ12345');
  const bad = await get(env, '/lookup?u=hello', { redirect: 'manual' });
  assert.match(bad.headers.get('location'), /^\/\?error=/);
  const home = await (await get(env, bad.headers.get('location'))).text();
  assert.match(home, /Yeh link samajh nahi aaya/);
  assert.match(home, /value="hello"/);
});

test('home and deals list real drops only', async () => {
  const env = makeEnv();
  // Real drop: typical 1000, now 850.
  await seed(env, 'myntra:1234567', 'https://www.myntra.com/1234567', [1000, 1000, 1000, 1000, 1000, 1000, 850], { title: 'Real Deal Tee' });
  // Fake sale: typical 1000 (median), hiked then "discounted" back to 1000.
  await seed(env, 'myntra:7654321', 'https://www.myntra.com/7654321', [1000, 1000, 1000, 1000, 1500, 1500, 1000], { title: 'Fake Sale Shorts' });
  const home = await (await get(env, '/')).text();
  assert.match(home, /Real Deal Tee/);
  assert.match(home, /▼ 15% typical se kam/);
  const deals = await (await get(env, '/deals')).text();
  assert.match(deals, /Real Deal Tee/);
  assert.doesNotMatch(deals, /Fake Sale Shorts/);
});

test('static routes, sitemap, robots, 404, cleanup job', async () => {
  const env = makeEnv();
  await seed(env, 'amazon:B0TEST1234', AMZ_URL, [100, 90]);
  assert.match(await (await get(env, '/static/site.css')).text(), /--accent/);
  assert.equal((await get(env, '/favicon.svg')).headers.get('content-type'), 'image/svg+xml');
  assert.match(await (await get(env, '/robots.txt')).text(), /Sitemap: https:\/\/site\.test\/sitemap\.xml/);
  assert.match(await (await get(env, '/sitemap.xml')).text(), /<loc>https:\/\/site\.test\/p\/amazon\/B0TEST1234<\/loc>/);
  assert.match(await (await get(env, '/privacy')).text(), /salted hash/);
  assert.match(await (await get(env, '/disclosure')).text(), /Amazon ke links abhi affiliate nahi hain/);
  assert.equal((await get(env, '/nope')).status, 404);
  assert.equal((await get(env, '/', { method: 'POST' })).status, 405);

  await env.DB.prepare('INSERT INTO usage (who, day, points) VALUES (?, ?, ?), (?, ?, ?)').bind('old', '2020-01-01', 5, 'new', istDay(Date.now()), 5).run();
  await worker.scheduled({}, env);
  assert.deepEqual((await env.DB.prepare('SELECT who FROM usage').all()).results, [{ who: 'new' }]);
});
