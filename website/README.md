# Website (phase 2)

Shared price history, product pages, deals and the API the extension talks
to. A single Cloudflare Worker with a D1 (SQLite) database, no framework and
no runtime dependencies.

## Why Cloudflare

- **Free tier fits:** Workers ~100,000 requests/day; D1 5 GB storage,
  5 million rows read and 100,000 rows written per day. Since 1 September
  2026 D1 enforces the daily limits on the free plan: queries fail until
  00:00 UTC once a limit is hit, so watch usage as traffic grows. Each
  uploaded price writes about 3–5 rows, so plan on roughly 20,000 uploads
  a day on the free plan.
- **Vercel's free (Hobby) plan does not fit**: it is for personal,
  non-commercial use only, and an affiliate site is commercial (Pro is
  $20/month).

Check the current Cloudflare limits and terms before launch:
https://developers.cloudflare.com/d1/platform/limits/ and
https://developers.cloudflare.com/workers/platform/limits/

## What it does

| Route | What |
|---|---|
| `/` | Paste a product link (app share links too), today's real price drops, how it works |
| `/p/<store>/<id>` | Product page: price, verdict, fake-sale warning, chart, stats, WhatsApp/Telegram share, buy button. Open Graph tags give a rich preview when shared on WhatsApp |
| `/deals` | Products at least 5% under their 90-day median price |
| `/go/<store>/<id>` | Outbound "buy" redirect (counts clicks, applies affiliate rules) |
| `/lookup?u=...` | Resolves a pasted link, following `amzn.in`, `dl.flipkart.com/s`, `fkrt.it`, `myntr.it` redirects through the shops' own hosts only |
| `POST /api/v1/prices` | Price reports from extensions whose users opted in |
| `GET /api/v1/history/<store>/<id>` | Daily price series for the extension |
| `/sitemap.xml`, `/robots.txt`, `/privacy`, `/disclosure` | SEO and policy pages |

**Data quality.** One stored price per product, per day, per reporter (the
latest wins), and pages show the **median** across reporters, so a single
wrong or fake report cannot move a price once a few people see the product.
Reporter ids and IPs are stored only as salted hashes. Each reporter can send
1,000 prices a day, each IP 5,000.

**Deals are honest by design.** A product is a deal only when it is under its
90-day *median* price. A median ignores a short pre-sale price hike, so
"raise the price, then announce a sale" does not show up as a deal.

## Money: affiliate rules on the website

- **Flipkart / Myntra:** set `FLIPKART_TEMPLATE` / `MYNTRA_TEMPLATE` to your
  network's deep-link format (Cuelinks, EarnKaro, Admitad...). `{url}` is
  replaced with the encoded product URL. The page shows a disclosure under
  the button whenever a template is active. Check your network's terms
  about showing prices and price history.
- **Amazon stays a plain link.** Amazon Associates allows prices next to
  Associates links only when they come from Amazon's own API (now the
  Creators API) and are under 24 hours old, with a timestamp. These prices
  are crowd-sourced, so they do not qualify. Earning from Amazon here needs
  a Creators API integration first (Amazon gives API access after qualifying
  sales).

## Deploy (about 15 minutes)

You need a free Cloudflare account. Run these in `website/`:

```bash
npm install
```

```bash
npx wrangler login
```

```bash
npx wrangler d1 create daamdekho
```

Copy the printed `database_id` into `wrangler.toml`.

```bash
npx wrangler secret put CLIENT_SALT
```

Paste any long random string (for example the output of `openssl rand -hex 32`).

```bash
npm run db:remote
```

```bash
npm run deploy
```

Wrangler prints the address, like `https://daamdekho.<your-subdomain>.workers.dev`.
Then:

1. Put that address in `SITE_URL` in `wrangler.toml` and run `npm run deploy` again.
2. Put the same address in `SITE_URL` in `extension/src/shared/config.js`,
   so the extension can share history and link to product pages.
3. Optional: add your own domain in the Cloudflare dashboard (Workers →
   your worker → Settings → Domains & Routes), then update both `SITE_URL`s.
4. When the extension is live, set `EXTENSION_URL` (and later
   `TELEGRAM_URL`) in `wrangler.toml` and deploy again.

## Local development

```bash
npm run db:local
```

```bash
printf 'CLIENT_SALT="local-dev-salt"\n' > .dev.vars
```

```bash
npm run dev
```

Open http://localhost:8787. Tests (no Cloudflare account needed; they run
the Worker on an in-memory SQLite stand-in for D1):

```bash
npm test
```

## Code map

```
src/index.js        routes, headers, daily cleanup (cron)
src/lib/ingest.js   upload validation, rate limits, storage
src/lib/db.js       queries and aggregates (deals, sitemap, clicks)
src/lib/series.js   daily median series, product aggregates
src/lib/links.js    outbound/affiliate links, short-link resolving
src/lib/paths.js    /p/<store>/<id> parsing
src/lib/shared.js   reuses the extension's stores/insights/affiliate/share modules
src/pages/          HTML pages, CSS/JS assets
migrations/         D1 schema
test/               tests + D1 stand-in
```
