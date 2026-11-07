// Minimal Supabase client: calls Postgres functions through PostgREST
// (POST /rest/v1/rpc/<name>). No dependency on supabase-js.

/**
 * @param {string} url  project URL, e.g. https://abcd.supabase.co
 * @param {string} key  publishable (sb_publishable_...) or legacy anon key
 * @returns {(name: string, args: object) => Promise<any>}
 */
export function supabaseRpc(url, key, fetchImpl = (...a) => fetch(...a)) {
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set');
  const base = url.replace(/\/+$/, '');
  const headers = { apikey: key, 'content-type': 'application/json', accept: 'application/json' };
  // Legacy anon keys are JWTs and also go in Authorization; new publishable keys do not.
  if (!key.startsWith('sb_')) headers.authorization = `Bearer ${key}`;

  return async function rpc(name, args) {
    const res = await fetchImpl(`${base}/rest/v1/rpc/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(args || {}),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Supabase ${name} failed: HTTP ${res.status} ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  };
}
