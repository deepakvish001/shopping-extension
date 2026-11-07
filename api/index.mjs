// Vercel Function serving the whole website (vercel.json rewrites every
// path here). The app itself is a plain Web handler in website/src/app.js.
import { safeHandle } from '../website/src/app.js';
import { createStore } from '../website/src/lib/store.js';
import { supabaseRpc } from '../website/src/lib/supabase.js';

let env = null;

function loadEnv() {
  const e = process.env;
  const productionHost = e.VERCEL_PROJECT_PRODUCTION_URL;
  return {
    SITE_NAME: e.SITE_NAME,
    SITE_URL: e.SITE_URL || (productionHost ? `https://${productionHost}` : ''),
    EXTENSION_URL: e.EXTENSION_URL,
    TELEGRAM_URL: e.TELEGRAM_URL,
    FLIPKART_TEMPLATE: e.FLIPKART_TEMPLATE,
    MYNTRA_TEMPLATE: e.MYNTRA_TEMPLATE,
    CLIENT_SALT: e.CLIENT_SALT,
    store: createStore(supabaseRpc(e.SUPABASE_URL, e.SUPABASE_ANON_KEY), { writeToken: e.WRITE_TOKEN }),
  };
}

async function handler(request) {
  try {
    env = env || loadEnv();
  } catch (err) {
    console.error(err);
    return new Response('Website is not configured yet.', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  return safeHandle(request, env);
}

export const GET = handler;
export const HEAD = handler;
export const POST = handler;
export const OPTIONS = handler;
