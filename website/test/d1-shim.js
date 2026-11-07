// A tiny in-memory stand-in for Cloudflare D1, backed by node:sqlite, so the
// Worker can be tested with plain `node --test`.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export function createD1() {
  const db = new DatabaseSync(':memory:');
  for (const f of fs.readdirSync(path.join(here, '..', 'migrations')).sort()) {
    db.exec(fs.readFileSync(path.join(here, '..', 'migrations', f), 'utf8'));
  }
  const plain = (row) => (row ? { ...row } : null);

  class Statement {
    constructor(sql, params = []) {
      this.sql = sql;
      this.params = params;
    }
    bind(...params) {
      return new Statement(this.sql, params.map((p) => (p === undefined ? null : p)));
    }
    async first(column) {
      const row = plain(db.prepare(this.sql).get(...this.params));
      return row && column ? row[column] : row;
    }
    async all() {
      return { success: true, results: db.prepare(this.sql).all(...this.params).map(plain) };
    }
    async run() {
      const info = db.prepare(this.sql).run(...this.params);
      return { success: true, meta: { changes: Number(info.changes) } };
    }
  }

  return {
    prepare: (sql) => new Statement(sql),
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const out = [];
        for (const s of statements) out.push(await s.run());
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    raw: db,
  };
}
