// The whole website as one Web-standard handler: handle(request, env) -> Response.
// env.store is the data layer (src/lib/store.js); the rest of env is config.
// Runs on Vercel (api/index.mjs), the local dev server and in tests.
import { identFromPath } from './lib/paths.js';
import { ingest } from './lib/ingest.js';
import { outboundUrl, affiliateActive, resolveProduct } from './lib/links.js';
import { istDay } from './lib/days.js';
import { CSS, JS, FAVICON } from './pages/assets.js';
import { homePage, dealsPage, productPage, disclosurePage, privacyPage, notFoundPage } from './pages/pages.js';

const SECURITY_HEADERS = {
  'content-security-policy':
    "default-src 'none'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
};

function siteFor(env, url) {
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(url.host);
  return {
    name: env.SITE_NAME || 'DaamDekho',
    base: (local ? url.origin : env.SITE_URL || url.origin).replace(/\/+$/, ''),
    extensionUrl: env.EXTENSION_URL || '',
    telegramUrl: env.TELEGRAM_URL || '',
  };
}

function page(body, { status = 200, maxAge = 300 } = {}) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': `public, max-age=${maxAge}`, ...SECURITY_HEADERS },
  });
}

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...extra } });
}

function withCors(res) {
  const headers = new Headers(res.headers);
  headers.set('access-control-allow-origin', '*');
  headers.set('access-control-allow-methods', 'GET, POST, OPTIONS');
  headers.set('access-control-allow-headers', 'content-type');
  headers.set('access-control-max-age', '86400');
  return new Response(res.body, { status: res.status, headers });
}

function redirect(location, status = 302, extra = {}) {
  return new Response(null, { status, headers: { location, 'cache-control': 'no-store', ...extra } });
}

function asset(body, type, maxAge = 86400) {
  return new Response(body, { headers: { 'content-type': type, 'cache-control': `public, max-age=${maxAge}` } });
}

export async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const now = Date.now();
  const site = siteFor(env, url);
  const store = env.store;

  // ------------------------------------------------------------------ API
  if (path.startsWith('/api/')) {
    if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }));
    if (path === '/api/v1/prices' && request.method === 'POST') {
      const result = await ingest(env, request, now);
      return withCors(json(result.body, result.status, { 'cache-control': 'no-store' }));
    }
    const m = path.match(/^\/api\/v1\/history\/([a-z]+)\/([^/]+)$/);
    if (m && request.method === 'GET') {
      const ident = identFromPath(m[1], m[2]);
      const product = ident && (await store.getProduct(ident.key));
      if (!product) return withCors(json({ error: 'not found' }, 404, { 'cache-control': 'public, max-age=600' }));
      const series = await store.getSeries(ident.key, now);
      return withCors(
        json(
          { key: ident.key, title: product.title, series, reports: product.reporters, updatedAt: product.last_seen },
          200,
          { 'cache-control': 'public, max-age=600' }
        )
      );
    }
    return withCors(json({ error: 'not found' }, 404));
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });

  // ---------------------------------------------------------------- pages
  if (path === '/') {
    const [d, r] = await Promise.all([store.deals(now, 12), store.recentlyTracked(8)]);
    return page(homePage(site, { deals: d, recent: r, error: url.searchParams.get('error'), q: url.searchParams.get('q') }));
  }
  if (path === '/deals') return page(dealsPage(site, { deals: await store.deals(now, 60) }));

  if (path === '/lookup') {
    const q = (url.searchParams.get('u') || '').slice(0, 2000);
    const ident = await resolveProduct(q);
    if (ident) return redirect(`/p/${ident.store}/${encodeURIComponent(ident.id)}`);
    const error = 'Yeh link samajh nahi aaya. Amazon.in, Flipkart ya Myntra ke product page ka link (ya app ka share link) daalo.';
    return redirect(`/?error=${encodeURIComponent(error)}&q=${encodeURIComponent(q)}`);
  }

  let m = path.match(/^\/p\/([a-z]+)\/([^/]+)\/?$/);
  if (m) {
    const ident = identFromPath(m[1], m[2]);
    if (!ident) return page(notFoundPage(site), { status: 404 });
    const product = await store.getProduct(ident.key);
    const series = product ? await store.getSeries(ident.key, now) : [];
    const html = productPage(site, { ident, product, series, now, affiliate: product ? affiliateActive(ident.store, env) : false });
    return page(html, { status: product ? 200 : 404 });
  }

  m = path.match(/^\/go\/([a-z]+)\/([^/]+)\/?$/);
  if (m) {
    const ident = identFromPath(m[1], m[2]);
    const product = ident && (await store.getProduct(ident.key));
    if (!product) return page(notFoundPage(site), { status: 404 });
    await store.recordClick(ident.key);
    return redirect(outboundUrl(product, env).href, 302, { 'x-robots-tag': 'noindex' });
  }

  if (path === '/disclosure') return page(disclosurePage(site), { maxAge: 3600 });
  if (path === '/privacy') return page(privacyPage(site), { maxAge: 3600 });
  if (path === '/static/site.css') return asset(CSS, 'text/css; charset=utf-8');
  if (path === '/static/site.js') return asset(JS, 'text/javascript; charset=utf-8');
  if (path === '/favicon.svg') return asset(FAVICON, 'image/svg+xml');
  if (path === '/robots.txt') {
    return asset(`User-agent: *\nDisallow: /go/\nDisallow: /lookup\nDisallow: /api/\nSitemap: ${site.base}/sitemap.xml\n`, 'text/plain; charset=utf-8', 3600);
  }
  if (path === '/sitemap.xml') {
    const rows = await store.sitemapProducts(5000);
    const urls = rows
      .map((r) => `<url><loc>${site.base}/p/${r.store}/${encodeURIComponent(r.pid)}</loc><lastmod>${istDay(r.last_seen)}</lastmod></url>`)
      .join('');
    const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${site.base}/</loc></url><url><loc>${site.base}/deals</loc></url>${urls}</urlset>`;
    return asset(xml, 'application/xml; charset=utf-8', 3600);
  }

  return page(notFoundPage(site), { status: 404 });
}

/** Wraps handle() so an unexpected error becomes a plain 500 page. */
export async function safeHandle(request, env) {
  try {
    return await handle(request, env);
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    return new Response('Something went wrong', { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
}
