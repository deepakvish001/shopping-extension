// Test database: the real Supabase migration running in PGlite (Postgres
// compiled to WebAssembly), called the way PostgREST calls RPC functions.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from '../src/lib/store.js';

const migrations = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations');

export async function createPgStore({ writeToken = 'test-write-token' } = {}) {
  const db = new PGlite();
  // Roles Supabase provides, so the migration's GRANT/REVOKE statements run.
  await db.exec('create role anon; create role authenticated;');
  for (const f of fs.readdirSync(migrations).sort()) await db.exec(fs.readFileSync(path.join(migrations, f), 'utf8'));
  await db.query('insert into config (key, value) values ($1, $2)', ['write_token', writeToken]);

  /** Like PostgREST: named arguments in, the function's JSON result out. */
  async function rpc(name, args = {}) {
    const keys = Object.keys(args);
    const sql = `select public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`;
    const values = keys.map((k) => (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]));
    const res = await db.query(sql, values);
    return res.rows[0].r ?? null;
  }

  return { db, rpc, store: createStore(rpc, { writeToken }) };
}
