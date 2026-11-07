// Local development server: node website/scripts/dev.mjs [--demo] [--port 3000]
//
// With SUPABASE_URL, SUPABASE_ANON_KEY and WRITE_TOKEN in the environment it
// uses your Supabase project. Otherwise it runs the same schema in an
// in-memory Postgres (PGlite); --demo fills it with sample products.
import http from 'node:http';
import { safeHandle } from '../src/app.js';
import { createStore } from '../src/lib/store.js';
import { supabaseRpc } from '../src/lib/supabase.js';

const args = process.argv.slice(2);
const port = Number(args[args.indexOf('--port') + 1]) || Number(process.env.PORT) || 3000;
const e = process.env;

let store;
if (e.SUPABASE_URL && e.SUPABASE_ANON_KEY) {
  store = createStore(supabaseRpc(e.SUPABASE_URL, e.SUPABASE_ANON_KEY), { writeToken: e.WRITE_TOKEN });
  console.log(`Using Supabase at ${e.SUPABASE_URL}`);
} else {
  const { createPgStore } = await import('../test/pg-store.js');
  const pg = await createPgStore();
  store = pg.store;
  if (args.includes('--demo')) {
    const { seedDemo } = await import('./demo-data.mjs');
    await seedDemo(pg.db);
  }
  console.log(`Using an in-memory database${args.includes('--demo') ? ' with demo data' : ''}`);
}

const env = { ...e, CLIENT_SALT: e.CLIENT_SALT || 'local-dev-salt', store };

http
  .createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const hasBody = !['GET', 'HEAD'].includes(req.method);
    const request = new Request(`http://${req.headers.host}${req.url}`, {
      method: req.method,
      headers: Object.entries(req.headers).filter(([, v]) => typeof v === 'string'),
      body: hasBody ? Buffer.concat(chunks) : undefined,
    });
    const response = await safeHandle(request, env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(req.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
  })
  .listen(port, () => console.log(`http://localhost:${port}`));
