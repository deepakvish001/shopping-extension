import test from 'node:test';
import assert from 'node:assert/strict';
import { safeHandle } from '../src/app.js';
import { createPgStore } from './pg-store.js';
import { istDay, dayStart, DAY_MS } from '../src/lib/days.js';
import { resolveProduct, extractUrl } from '../src/lib/links.js';
import { identFromPath } from '../src/lib/paths.js';
import { validatePoint, LIMITS, hashId } from '../src/lib/ingest.js';
import { supabaseRpc } from '../src/lib/supabase.js';
import { fetchProduct, botUserAgent } from '../src/lib/fetcher.js';
import { refreshDue, STALE_MS } from '../src/lib/refresh.js';
import fs from 'node:fs';

const fixture = (name) => fs.readFileSync(new URL(`../../tests/fixtures/${name}`, import.meta.url), 'utf8');

/** A fake shop: serves `pages[url]` (string body or a status number) and counts requests. */
function fakeShop(pages) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const page = pages[url];
    if (page === undefined) return new Response('not found', { status: 404 });
    if (typeof page === 'number') return new Response('blocked', { status: page });
    return new Response(page, { status: 200, headers: { 'content-type': 'text/html' } });
  };
  return { fetchImpl, calls };
}

const FK_URL = 'https://www.flipkart.com/samsung-galaxy-m35/p/itm123abc?pid=MOBGZ12345';
const AMZ_URL = 'https://www.amazon.in/dp/B0TEST1234';

async function makeEnv(extra = {}) {
  const { db, rpc, store } = await createPgStore();
  return {
    db,
    rpc,
    store,
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

const get = (env, path, init) => safeHandle(new Request(`https://site.test${path}`, init), env);
const q = async (env, sql, params = []) => (await env.db.query(sql, params)).rows;

function post(env, body, ip = '1.2.3.4') {
  return get(env, '/api/v1/prices', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `${ip}, 10.0.0.1` },
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
  await q(env, 'insert into products (key, store, pid, url, title, image, first_seen, last_seen) values ($1, $2, $3, $4, $5, $6, $7, $8)', [
    key, store, pid, url, title, image, now - prices.length * DAY_MS, now,
  ]);
  for (let i = 0; i < prices.length; i++) {
    const t = now - (prices.length - 1 - i) * DAY_MS;
    for (const c of clients) {
      await q(env, 'insert into observations (key, day, client, price, t) values ($1, $2, $3, $4, $5)', [key, istDay(t), c, prices[i], t]);
    }
  }
  await q(env, 'select refresh_product($1, $2)', [key, now]);
}

// ------------------------------------------------------ database and helpers

test('daily price is the lower median across reporters, so one fake report cannot move it', async () => {
  const env = await makeEnv();
  const key = 'amazon:B0TEST1234';
  const now = dayStart('2026-01-02') + 1000;
  await q(env, 'insert into products (key, store, pid, url, first_seen, last_seen) values ($1, $2, $3, $4, $5, $5)', [key, 'amazon', 'B0TEST1234', AMZ_URL, now]);
  for (const [day, client, price] of [['2026-01-01', 'a', 120], ['2026-01-02', 'a', 100], ['2026-01-02', 'b', 101], ['2026-01-02', 'liar', 1], ['2026-01-02', 'c', 99]]) {
    await q(env, 'insert into observations (key, day, client, price, t) values ($1, $2, $3, $4, $5)', [key, day, client, price, dayStart(day)]);
  }
  assert.deepEqual(await env.store.getSeries(key, now), [[dayStart('2026-01-01'), 120], [dayStart('2026-01-02'), 99]]);
  await q(env, 'select refresh_product($1, $2)', [key, now]);
  const p = await env.store.getProduct(key);
  assert.deepEqual(
    { last: p.last_price, low: p.low_price, lowDay: p.low_day, high: p.high_price, typical: p.typical_price, days: p.days, reporters: p.reporters },
    { last: 99, low: 99, lowDay: '2026-01-02', high: 120, typical: null, days: 2, reporters: 4 }
  );
  assert.equal(p.clicks, undefined, 'internal counters are not exposed');
});

test('days are bucketed in India time in both JS and Postgres', async () => {
  const env = await makeEnv();
  const t = Date.UTC(2026, 0, 1, 20, 0); // 01:30 IST on 2 Jan
  assert.equal(istDay(t), '2026-01-02');
  assert.equal((await q(env, 'select ist_day($1)::text as d', [t]))[0].d, '2026-01-02');
  assert.equal(dayStart('2026-01-02'), Date.UTC(2026, 0, 1, 18, 30));
});

test('the database refuses writes without the write token and hides tables', async () => {
  const env = await makeEnv();
  await assert.rejects(
    env.rpc('ingest_prices', { p_token: 'wrong', p_client: 'c', p_ip: 'i', p_points: [], p_now: Date.now(), p_client_limit: 10, p_ip_limit: 10 }),
    /invalid write token/
  );
  await assert.rejects(env.rpc('record_click', { p_token: null, p_key: 'x' }), /invalid write token/);
  // The public API role cannot touch tables or internal functions directly.
  await q(env, 'set role anon');
  await assert.rejects(q(env, 'select * from config'), /permission denied/);
  await assert.rejects(q(env, 'select * from observations'), /permission denied/);
  await assert.rejects(q(env, "select refresh_product('x', 0)"), /permission denied/);
  assert.deepEqual(await env.rpc('list_recent', { p_limit: 5 }), [], 'read functions work for anon');
  await q(env, 'reset role');
});

test('supabaseRpc sends the right request and surfaces errors', async () => {
  const calls = [];
  const fake = async (url, init) => {
    calls.push({ url, init });
    return url.endsWith('/boom') ? new Response('{"message":"nope"}', { status: 403 }) : new Response('[{"a":1}]', { status: 200 });
  };
  const rpc = supabaseRpc('https://abc.supabase.co/', 'sb_publishable_xyz', fake);
  assert.deepEqual(await rpc('list_recent', { p_limit: 3 }), [{ a: 1 }]);
  assert.equal(calls[0].url, 'https://abc.supabase.co/rest/v1/rpc/list_recent');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.apikey, 'sb_publishable_xyz');
  assert.equal(calls[0].init.headers.authorization, undefined, 'publishable keys are not sent as a bearer token');
  assert.equal(calls[0].init.body, '{"p_limit":3}');
  assert.equal(supabaseRpc('https://abc.supabase.co', 'eyJlegacy', fake) && true, true);
  await assert.rejects(rpc('boom', {}), /Supabase boom failed: HTTP 403/);
  assert.throws(() => supabaseRpc('', 'k'), /SUPABASE_URL/);
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
  const env = await makeEnv();
  const res = await post(env, { client: 'client-aaaa-1111', points: [point(), point({ key: 'amazon:B0TEST1234', url: AMZ_URL, price: 1299, title: 'boAt' }), point({ price: -1 })] });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.deepEqual(await res.json(), { accepted: 2, rejected: 1 });

  const row = await env.store.getProduct('flipkart:MOBGZ12345');
  assert.equal(row.url, FK_URL);
  assert.equal(row.last_price, 13999);
  assert.equal(row.mrp, 24499);
  assert.equal(row.days, 1);
  assert.equal(row.reporters, 1);
  const [obs] = await q(env, 'select client from observations limit 1');
  assert.notEqual(obs.client, 'client-aaaa-1111', 'client ids are stored hashed');
  assert.equal(obs.client.length, 32);
});

test('later reports from the same user on the same day replace the earlier one; first title wins', async () => {
  const env = await makeEnv();
  const t = Date.now() - 120_000;
  await post(env, { client: 'client-aaaa-1111', points: [point({ t, price: 15000 })] });
  await post(env, { client: 'client-aaaa-1111', points: [point({ t: t + 60_000, price: 14000, title: 'Spam title' })] });
  await post(env, { client: 'client-aaaa-1111', points: [point({ t: t - 60_000, price: 99999 })] }); // older, ignored
  const rows = await q(env, 'select price::float8 as price from observations');
  assert.deepEqual(rows, [{ price: 14000 }]);
  const product = await env.store.getProduct('flipkart:MOBGZ12345');
  assert.deepEqual({ title: product.title, last: product.last_price }, { title: 'SAMSUNG Galaxy M35 5G', last: 14000 });
  // Several points for one product and day in a single upload are fine too.
  const res = await post(env, { client: 'client-cccc-3333', points: [point({ t: t + 1000, price: 13500 }), point({ t: t + 2000, price: 13400 })] });
  assert.deepEqual(await res.json(), { accepted: 2, rejected: 0 });
  assert.equal((await q(env, "select count(*)::int as n from observations"))[0].n, 2);
});

test('ingest rejects malformed bodies and enforces daily limits', async () => {
  const env = await makeEnv();
  assert.equal((await post(env, 'not json')).status, 400);
  assert.equal((await post(env, { client: 'x', points: [point()] })).status, 400);
  assert.equal((await post(env, { client: 'client-aaaa-1111', points: [] })).status, 400);
  assert.equal((await post(env, { client: 'client-aaaa-1111', points: new Array(51).fill(point()) })).status, 400);
  assert.equal((await post(env, 'x'.repeat(LIMITS.maxBodyBytes + 1))).status, 413);

  const full = await makeEnv();
  // Fill a client's quota, then one more point is refused.
  const who = await hashId('test-salt', 'client:client-bbbb-2222');
  await q(full, 'insert into usage (who, day, points) values ($1, $2, $3)', [who, istDay(Date.now()), LIMITS.perClientPerDay]);
  const limited = await post(full, { client: 'client-bbbb-2222', points: [point()] });
  assert.equal(limited.status, 429);
  assert.equal((await q(full, 'select count(*)::int as n from observations'))[0].n, 0);
  // The IP limit applies across client ids.
  const ipWho = await hashId('test-salt', 'ip:9.9.9.9');
  await q(full, 'insert into usage (who, day, points) values ($1, $2, $3)', [ipWho, istDay(Date.now()), LIMITS.perIpPerDay]);
  assert.equal((await post(full, { client: 'client-dddd-4444', points: [point()] }, '9.9.9.9')).status, 429);
  assert.equal((await post(full, { client: 'client-dddd-4444', points: [point()] }, '8.8.8.8')).status, 200);
  // Old counters are cleaned up on the way.
  await q(full, "insert into usage (who, day, points) values ('old', '2020-01-01', 5)");
  await post(full, { client: 'client-dddd-4444', points: [point()] }, '7.7.7.7');
  assert.equal((await q(full, "select count(*)::int as n from usage where who = 'old'"))[0].n, 0);
});

test('CORS preflight for the extension', async () => {
  const res = await get(await makeEnv(), '/api/v1/prices', { method: 'OPTIONS' });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-methods'), 'GET, POST, OPTIONS');
  assert.equal(res.headers.get('access-control-allow-headers'), 'content-type');
});

// ------------------------------------------------------------ history API

test('GET /api/v1/history returns the daily series', async () => {
  const env = await makeEnv();
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
  const env = await makeEnv();
  const prices = [17999, 17999, 17999, 17999, 17999, 17999, 16999, 15999, 13999];
  await seed(env, 'flipkart:MOBGZ12345', FK_URL, prices, {
    title: 'Phone <script>alert(1)</script> "quoted"',
    image: 'https://rukminim2.flixcart.com/image/phone.jpeg',
  });
  await q(env, 'update products set mrp = 24499');
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
  const env = await makeEnv();
  // 40 days at 1000, raised to 1500 for two weeks, "sale" at 999.
  const prices = [...new Array(40).fill(1000), ...new Array(14).fill(1500), 999];
  await seed(env, 'amazon:B0TEST1234', AMZ_URL, prices, { title: 'Headphones' });
  const body = await (await get(env, '/p/amazon/B0TEST1234')).text();
  assert.match(body, /Sale ka khel\?/);
  assert.doesNotMatch(body, /Ab tak ka sabse kam daam!/, 'verdict must not contradict the warning');
  assert.match(body, /Normal daam, koi khaas deal nahi\./);
  assert.doesNotMatch(body, /Affiliate link:/, 'no affiliate on Amazon');
});

test('unknown product page offers a live check, noindex', async () => {
  const env = await makeEnv();
  const res = await get(env, '/p/amazon/B0NOTHERE1');
  assert.equal(res.status, 404);
  const body = await res.text();
  assert.match(body, /Is product ko abhi track nahi kiya gaya/);
  assert.match(body, /noindex/);
  assert.match(body, /href="\/lookup\?u=https%3A%2F%2Fwww\.amazon\.in%2Fdp%2FB0NOTHERE1"/);
  const fk = await (await get(env, '/p/flipkart/MOBGZ99999')).text();
  assert.match(fk, /<form class="lookup"/, 'Flipkart needs the full link, so it asks for it');
  assert.equal((await get(env, '/p/amazon/bad')).status, 404);
});

test('/go redirects: Amazon plain, Flipkart via the network template, clicks counted', async () => {
  const env = await makeEnv();
  await seed(env, 'flipkart:MOBGZ12345', FK_URL, [100, 90]);
  await seed(env, 'amazon:B0TEST1234', AMZ_URL, [100, 90]);
  const fk = await get(env, '/go/flipkart/MOBGZ12345', { redirect: 'manual' });
  assert.equal(fk.status, 302);
  assert.equal(fk.headers.get('location'), 'https://net.example/r?id=7&u=' + encodeURIComponent(FK_URL));
  const amz = await get(env, '/go/amazon/B0TEST1234', { redirect: 'manual' });
  assert.equal(amz.headers.get('location'), AMZ_URL);
  const plainEnv = await makeEnv({ FLIPKART_TEMPLATE: '' });
  await seed(plainEnv, 'flipkart:MOBGZ12345', FK_URL, [100]);
  assert.equal((await get(plainEnv, '/go/flipkart/MOBGZ12345', { redirect: 'manual' })).headers.get('location'), FK_URL);
  const [{ clicks }] = await q(env, 'select clicks from products where key = $1', ['flipkart:MOBGZ12345']);
  assert.equal(clicks, 1);
  assert.equal((await get(env, '/go/flipkart/NOPE999999', { redirect: 'manual' })).status, 404);
});

test('/lookup redirects a pasted link to its page, or back home with a message', async () => {
  const env = await makeEnv();
  const ok = await get(env, `/lookup?u=${encodeURIComponent('Dekho yeh: ' + FK_URL + '&affid=abc')}`, { redirect: 'manual' });
  assert.equal(ok.headers.get('location'), '/p/flipkart/MOBGZ12345');
  const bad = await get(env, '/lookup?u=hello', { redirect: 'manual' });
  assert.match(bad.headers.get('location'), /^\/\?error=/);
  const home = await (await get(env, bad.headers.get('location'))).text();
  assert.match(home, /Yeh link samajh nahi aaya/);
  assert.match(home, /value="hello"/);
});

test('home and deals list real drops only', async () => {
  const env = await makeEnv();
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

test('static routes, sitemap, robots, 404', async () => {
  const env = await makeEnv();
  await seed(env, 'amazon:B0TEST1234', AMZ_URL, [100, 90]);
  assert.match(await (await get(env, '/static/site.css')).text(), /--accent/);
  assert.equal((await get(env, '/favicon.svg')).headers.get('content-type'), 'image/svg+xml');
  assert.match(await (await get(env, '/robots.txt')).text(), /Sitemap: https:\/\/site\.test\/sitemap\.xml/);
  assert.match(await (await get(env, '/sitemap.xml')).text(), /<loc>https:\/\/site\.test\/p\/amazon\/B0TEST1234<\/loc>/);
  assert.match(await (await get(env, '/privacy')).text(), /salted hash/);
  assert.match(await (await get(env, '/disclosure')).text(), /Amazon ke links abhi affiliate nahi hain/);
  assert.equal((await get(env, '/nope')).status, 404);
  assert.equal((await get(env, '/', { method: 'POST' })).status, 405);

});

test('a missing or broken database gives a plain 500, not a crash', async () => {
  const env = await makeEnv();
  env.store = { ...env.store, deals: async () => { throw new Error('db down'); } };
  const origError = console.error;
  console.error = () => {};
  try {
    const res = await get(env, '/');
    assert.equal(res.status, 500);
  } finally {
    console.error = origError;
  }
});

// ------------------------------------------------------- live price checks

test('fetchProduct reads the price, and reports blocks, captchas and timeouts', async () => {
  const ident = { url: FK_URL };
  const shop = fakeShop({ [FK_URL]: fixture('flipkart.html') });
  const ok = await fetchProduct(ident, { fetchImpl: shop.fetchImpl });
  assert.equal(ok.ok, true);
  assert.equal(ok.product.price, 13999);
  assert.equal(ok.product.key, 'flipkart:MOBGZ12345');
  assert.equal(shop.calls[0].init.headers['user-agent'], 'Mozilla/5.0 (compatible; DaamDekhoBot/0.1)', 'says openly that it is a bot');
  assert.equal(botUserAgent('Daam Dekho!', 'https://site.test/'), 'Mozilla/5.0 (compatible; DaamDekhoBot/0.1; +https://site.test/bot)');

  assert.deepEqual(await fetchProduct(ident, { fetchImpl: fakeShop({ [FK_URL]: 529 }).fetchImpl }), { ok: false, blocked: true, error: 'blocked (HTTP 529)' });
  assert.deepEqual(await fetchProduct(ident, { fetchImpl: fakeShop({ [FK_URL]: 500 }).fetchImpl }), { ok: false, error: 'HTTP 500' });
  const captcha = '<html><body>Enter the characters you see below</body></html>';
  assert.deepEqual(await fetchProduct({ url: AMZ_URL }, { fetchImpl: fakeShop({ [AMZ_URL]: captcha }).fetchImpl }), { ok: false, blocked: true, error: 'blocked (captcha)' });
  assert.deepEqual(await fetchProduct(ident, { fetchImpl: fakeShop({ [FK_URL]: '<html><head><title>Oops</title></head><body>hi</body></html>' }).fetchImpl }), {
    ok: false,
    error: 'price not found (0 KB, "Oops")',
  });
  const slow = async (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  assert.deepEqual(await fetchProduct(ident, { fetchImpl: slow, timeoutMs: 20 }), { ok: false, error: 'timeout' });

});

test('pasting a link fetches the live price once, then serves it from the database', async () => {
  const shop = fakeShop({ [FK_URL]: fixture('flipkart.html') });
  const env = await makeEnv({ fetchImpl: shop.fetchImpl });
  const res = await get(env, `/lookup?u=${encodeURIComponent('Dekho ' + FK_URL + '&affid=x')}`, { redirect: 'manual' });
  assert.equal(res.headers.get('location'), '/p/flipkart/MOBGZ12345');
  assert.equal(shop.calls.length, 1);
  assert.equal(shop.calls[0].url, FK_URL, 'fetches the clean canonical URL');

  const p = await env.store.getProduct('flipkart:MOBGZ12345');
  assert.equal(p.last_price, 13999);
  assert.equal(p.title, 'SAMSUNG Galaxy M35 5G (Moonlight Blue, 128 GB)');
  assert.equal(p.reporters, 0, 'server checks are not counted as users');
  assert.equal(p.check_failures, 0);
  assert.deepEqual(await q(env, 'select client from observations'), [{ client: 'server' }]);

  const page = await (await get(env, '/p/flipkart/MOBGZ12345')).text();
  assert.match(page, /<span class="price">₹13,999<\/span>/);
  assert.match(page, /Last check abhi · roz apne aap check hota hai/);

  await get(env, `/lookup?u=${encodeURIComponent(FK_URL)}`, { redirect: 'manual' });
  assert.equal(shop.calls.length, 1, 'checked recently, so no second fetch');
});

test('a blocked first check still creates the product and explains it', async () => {
  const shop = fakeShop({ [AMZ_URL]: 503 });
  const env = await makeEnv({ fetchImpl: shop.fetchImpl });
  await get(env, `/lookup?u=${encodeURIComponent(AMZ_URL)}`, { redirect: 'manual' });
  const p = await env.store.getProduct('amazon:B0TEST1234');
  assert.deepEqual([p.check_failures, p.last_error, p.days], [1, 'blocked (HTTP 503)', 0]);
  const res = await get(env, '/p/amazon/B0TEST1234');
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /Amazon ne abhi daam nahi dikhaya/);
  assert.match(body, /blocked \(HTTP 503\)/);
  assert.match(body, /noindex/);
});

test('live checks per visitor are capped', async () => {
  const shop = fakeShop({ [FK_URL]: fixture('flipkart.html') });
  const env = await makeEnv({ fetchImpl: shop.fetchImpl });
  const who = await hashId('test-salt', 'lookup:5.5.5.5');
  await q(env, 'insert into usage (who, day, points) values ($1, $2, 60)', [who, istDay(Date.now())]);
  const res = await get(env, `/lookup?u=${encodeURIComponent(FK_URL)}`, { redirect: 'manual', headers: { 'x-forwarded-for': '5.5.5.5' } });
  assert.equal(res.headers.get('location'), '/p/flipkart/MOBGZ12345', 'still redirects');
  assert.equal(shop.calls.length, 0, 'but does not fetch');
});

test('scheduled refresh: secret required, re-checks the oldest products within budget', async () => {
  const MY = 'https://www.myntra.com/tshirts/roadster/x/1234567/buy';
  const shop = fakeShop({ [FK_URL]: fixture('flipkart.html'), [AMZ_URL]: 503, [MY]: fixture('myntra.html') });
  const env = await makeEnv({ fetchImpl: shop.fetchImpl, CRON_SECRET: 'cron-secret-0123456789' });
  const old = Date.now() - STALE_MS - 1000;
  for (const [key, store, pid, url] of [['flipkart:MOBGZ12345', 'flipkart', 'MOBGZ12345', FK_URL], ['amazon:B0TEST1234', 'amazon', 'B0TEST1234', AMZ_URL], ['myntra:1234567', 'myntra', '1234567', MY]]) {
    await q(env, 'insert into products (key, store, pid, url, first_seen, last_seen, last_checked) values ($1, $2, $3, $4, $5, $5, $5)', [key, store, pid, url, old]);
  }
  await q(env, "update products set last_checked = null where key = 'myntra:1234567'");

  assert.equal((await get(env, '/api/cron/refresh', { method: 'POST' })).status, 401);
  assert.equal((await get(env, '/api/cron/refresh', { method: 'POST', headers: { 'x-cron-secret': 'wrong-secret-000000' } })).status, 401);
  const noSecretEnv = await makeEnv({ CRON_SECRET: '' });
  assert.equal((await get(noSecretEnv, '/api/cron/refresh', { headers: { 'x-cron-secret': '' } })).status, 401, 'disabled without a secret');

  const dueOrder = (await env.store.listDue(Date.now() - STALE_MS, 10)).map((r) => r.key);
  assert.equal(dueOrder[0], 'myntra:1234567', 'never-checked products go first');
  assert.equal(dueOrder.length, 3);

  const res = await get(env, '/api/cron/refresh', { method: 'POST', headers: { authorization: 'Bearer cron-secret-0123456789' } });
  assert.equal(res.status, 200);
  const summary = await res.json();
  assert.deepEqual([summary.due, summary.checked, summary.ok], [3, 3, 2]);
  assert.equal((await env.store.getProduct('myntra:1234567')).last_price, 449);
  assert.equal((await env.store.getProduct('amazon:B0TEST1234')).check_failures, 1);

  // Nothing is due right after a run.
  const again = await (await get(env, '/api/cron/refresh', { headers: { 'x-cron-secret': 'cron-secret-0123456789' } })).json();
  assert.equal(again.due, 0);

  // A failed product backs off: not due again after 6h, only after 12h.
  await q(env, 'update products set last_checked = $1', [old]);
  assert.deepEqual((await env.store.listDue(Date.now() - STALE_MS, 10)).map((r) => r.key).sort(), ['flipkart:MOBGZ12345', 'myntra:1234567']);
  await q(env, "update products set last_checked = $1 where key = 'amazon:B0TEST1234'", [Date.now() - 2 * STALE_MS - 1000]);
  assert.equal((await env.store.listDue(Date.now() - STALE_MS, 10)).length, 3);

  // The time budget stops a run early.
  let t = 0;
  const partial = await refreshDue(env, { budgetMs: 10, concurrency: 1, clock: () => (t += 6) });
  assert.ok(partial.checked < partial.due, `checked ${partial.checked} of ${partial.due}`);
});

test('database: failures count up and stop retries after 30; usage cap; token required', async () => {
  const env = await makeEnv();
  const ident = { key: 'amazon:B0TEST1234', store: 'amazon', id: 'B0TEST1234', url: AMZ_URL };
  for (let i = 0; i < 30; i++) await env.store.markChecked({ ident, now: 1000 + i, ok: false, error: 'blocked' });
  assert.equal((await env.store.getProduct(ident.key)).check_failures, 30);
  assert.deepEqual(await env.store.listDue(Date.now(), 10), [], 'given up after 30 failures');
  await env.store.markChecked({ ident, now: 2000, ok: true });
  const p = await env.store.getProduct(ident.key);
  assert.deepEqual([p.check_failures, p.last_error], [0, null]);

  const now = Date.now();
  assert.equal(await env.store.bumpUsage('x', now, 2), true);
  assert.equal(await env.store.bumpUsage('x', now, 2), true);
  assert.equal(await env.store.bumpUsage('x', now, 2), false);
  await assert.rejects(env.rpc('list_due', { p_token: 'nope', p_before: now, p_limit: 5 }), /invalid write token/);
  await assert.rejects(env.rpc('mark_checked', { p_token: null, p_key: 'k', p_store: 's', p_pid: 'p', p_url: 'u', p_now: 1, p_ok: true, p_error: null }), /invalid write token/);
});

test('when a shop refuses, the rest of its products wait for a later run', async () => {
  const FK2 = 'https://www.flipkart.com/other/p/itm222?pid=MOBOTHER22';
  const shop = fakeShop({ [FK_URL]: 429, [FK2]: fixture('flipkart.html'), [AMZ_URL]: fixture('amazon.html') });
  const env = await makeEnv({ fetchImpl: shop.fetchImpl });
  for (const [key, store, pid, url] of [['flipkart:MOBGZ12345', 'flipkart', 'MOBGZ12345', FK_URL], ['flipkart:MOBOTHER22', 'flipkart', 'MOBOTHER22', FK2], ['amazon:B0TEST1234', 'amazon', 'B0TEST1234', AMZ_URL]]) {
    await q(env, 'insert into products (key, store, pid, url, first_seen, last_seen) values ($1, $2, $3, $4, 1, 1)', [key, store, pid, url]);
  }
  const summary = await refreshDue(env, { concurrency: 1 });
  assert.deepEqual(summary.paused, ['flipkart']);
  assert.deepEqual(shop.calls.map((c) => c.url).sort(), [AMZ_URL, FK_URL].sort(), 'second Flipkart product not requested');
  assert.equal((await env.store.getProduct('flipkart:MOBOTHER22')).last_checked, null, 'left for the next run');
  assert.equal((await env.store.getProduct('amazon:B0TEST1234')).last_price, 1299);
  assert.match(await (await get(env, '/bot')).text(), /bypass karne ki koshish nahi karte/);
});
