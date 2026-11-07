// POST /api/v1/prices: price reports from extensions whose users opted in.
//
// Body: { client: "<random id>", points: [{ key, url, title, image, mrp, price, t }] }
// Defences against junk and abuse:
//  - every field validated; the canonical URL is rebuilt from the shop URL,
//    never trusted from the client; images only from the shops' CDNs;
//  - one stored price per product, per day, per reporter (latest wins), and
//    pages show the daily median across reporters (Postgres function
//    ingest_prices, supabase/migrations);
//  - daily caps per reporter and per IP; ids and IPs are stored only as
//    salted hashes.
import { PTStores } from './shared.js';
import { istDay } from './days.js';

export const LIMITS = {
  maxBodyBytes: 64 * 1024,
  maxPoints: 50,
  perClientPerDay: 1000,
  perIpPerDay: 5000,
  maxAgeMs: 7 * 24 * 60 * 60 * 1000,
  maxFutureMs: 10 * 60 * 1000,
  maxPrice: 10_000_000,
};

const IMAGE_HOSTS = [/(^|\.)media-amazon\.com$/, /(^|\.)ssl-images-amazon\.com$/, /(^|\.)flixcart\.com$/, /(^|\.)myntassets\.com$/];

export async function hashId(salt, value) {
  const data = new TextEncoder().encode(`${salt}|${value}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

function cleanText(value, max) {
  if (typeof value !== 'string') return null;
  // Drop control characters, collapse whitespace.
  const t = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
}

function cleanImage(value) {
  if (typeof value !== 'string' || value.length > 500) return null;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && IMAGE_HOSTS.some((re) => re.test(u.hostname)) ? u.href : null;
  } catch (_) {
    return null;
  }
}

/** Visitor IP as set by the hosting edge (Vercel sets x-real-ip / x-forwarded-for). */
export function clientIp(request) {
  const h = request.headers;
  return h.get('x-real-ip') || (h.get('x-forwarded-for') || '').split(',')[0].trim() || h.get('cf-connecting-ip') || 'unknown';
}

/** @returns {{ok: true, point} | {ok: false, reason: string}} */
export function validatePoint(p, now) {
  if (!p || typeof p !== 'object') return { ok: false, reason: 'not an object' };
  const ident = PTStores.identify(typeof p.url === 'string' ? p.url : '');
  if (!ident || ident.key !== p.key) return { ok: false, reason: 'url/key mismatch' };
  const price = Number(p.price);
  if (!Number.isFinite(price) || price <= 0 || price > LIMITS.maxPrice) return { ok: false, reason: 'bad price' };
  const t = Number(p.t);
  if (!Number.isFinite(t) || t < now - LIMITS.maxAgeMs || t > now + LIMITS.maxFutureMs) return { ok: false, reason: 'bad time' };
  let mrp = Number(p.mrp);
  if (!Number.isFinite(mrp) || mrp <= price || mrp > price * 10) mrp = null;
  return {
    ok: true,
    point: {
      key: ident.key,
      store: ident.store,
      pid: ident.id,
      url: ident.url,
      title: cleanText(p.title, 300),
      image: cleanImage(p.image),
      mrp,
      price: Math.round(price * 100) / 100,
      t: Math.min(t, now),
    },
  };
}

/** @returns {Promise<{status: number, body: object}>} */
export async function ingest(env, request, now = Date.now()) {
  const text = await request.text();
  if (text.length > LIMITS.maxBodyBytes) return { status: 413, body: { error: 'body too large' } };
  let body;
  try {
    body = JSON.parse(text);
  } catch (_) {
    return { status: 400, body: { error: 'invalid JSON' } };
  }
  const client = body && body.client;
  if (typeof client !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(client)) return { status: 400, body: { error: 'invalid client' } };
  if (!Array.isArray(body.points) || !body.points.length || body.points.length > LIMITS.maxPoints) {
    return { status: 400, body: { error: `points must be 1-${LIMITS.maxPoints} items` } };
  }

  const accepted = [];
  let rejected = 0;
  for (const p of body.points) {
    const v = validatePoint(p, now);
    if (v.ok) accepted.push(v.point);
    else rejected++;
  }
  if (!accepted.length) return { status: 200, body: { accepted: 0, rejected } };

  const salt = env.CLIENT_SALT || 'dev-only-salt';
  const clientHash = await hashId(salt, `client:${client}`);
  const ipHash = await hashId(salt, `ip:${clientIp(request)}`);
  const result = await env.store.ingest({
    clientHash,
    ipHash,
    points: accepted.map((p) => ({ ...p, day: istDay(p.t) })),
    now,
    clientLimit: LIMITS.perClientPerDay,
    ipLimit: LIMITS.perIpPerDay,
  });
  if (result && result.error === 'rate_limited') return { status: 429, body: { error: 'daily limit reached' } };
  return { status: 200, body: { accepted: accepted.length, rejected } };
}
