// Sixty days of made-up prices for local screenshots and manual testing.
const DAY = 864e5;

export const DEMO_PRODUCTS = [
  {
    key: 'flipkart:MOBGZ12345', store: 'flipkart', pid: 'MOBGZ12345',
    url: 'https://www.flipkart.com/samsung-galaxy-m35/p/itm123abc?pid=MOBGZ12345',
    title: 'SAMSUNG Galaxy M35 5G (Moonlight Blue, 128 GB) (6 GB RAM)', mrp: 24499,
    plan: [[30, 17999], [15, 16999], [14, 15999], [1, 13999]],
  },
  {
    key: 'amazon:B0TEST1234', store: 'amazon', pid: 'B0TEST1234', url: 'https://www.amazon.in/dp/B0TEST1234',
    title: 'boAt Rockerz 450 Bluetooth On Ear Headphones with Mic, 15 Hours Playback', mrp: 3990,
    plan: [[45, 1499], [14, 2199], [1, 1499]],
  },
  {
    key: 'myntra:1234567', store: 'myntra', pid: '1234567', url: 'https://www.myntra.com/1234567',
    title: 'Roadster Men Black Solid Round Neck Pure Cotton T-shirt', mrp: 999,
    plan: [[40, 499], [19, 449], [1, 399]],
  },
  {
    key: 'myntra:7654321', store: 'myntra', pid: '7654321', url: 'https://www.myntra.com/7654321',
    title: 'HRX by Hrithik Roshan Men Running Shorts', mrp: 1399,
    plan: [[60, 699]],
  },
];

/** Insert the demo products into a PGlite/Postgres database (see test/pg-store.js). */
export async function seedDemo(db, now = Date.now()) {
  const ist = (t) => new Date(t + 330 * 60e3).toISOString().slice(0, 10);
  for (const p of DEMO_PRODUCTS) {
    await db.query(
      'insert into products (key, store, pid, url, title, mrp, first_seen, last_seen) values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict do nothing',
      [p.key, p.store, p.pid, p.url, p.title, p.mrp, now - 60 * DAY, now]
    );
    let d = 59;
    for (const [days, price] of p.plan) {
      for (let i = 0; i < days; i++, d--) {
        const t = now - d * DAY;
        for (const c of ['demo1', 'demo2', 'demo3']) {
          await db.query('insert into observations (key, day, client, price, t) values ($1, $2, $3, $4, $5) on conflict do nothing', [p.key, ist(t), c, price, t]);
        }
      }
    }
    await db.query('select refresh_product($1, $2)', [p.key, now]);
  }
}
