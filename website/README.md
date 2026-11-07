# Website (phase 2)

**Live:** https://daamdekho-three.vercel.app

Shared price history, product pages, deals and the API the extension talks
to. Hosted on **Vercel**, data in **Supabase** (Postgres). No framework and
no runtime dependencies.

```
browser / extension ──► Vercel Function api/index.mjs (region bom1, Mumbai)
                          └─ website/src/app.js  (pages + API, Web Request → Response)
                               └─ website/src/lib/store.js ──► Supabase RPC (PostgREST)
                                                                └─ Postgres functions + tables
                                                                   (supabase/migrations)
```

## What it does

| Route | What |
|---|---|
| `/` | Paste a product link (app share links too), today's real price drops, how it works |
| `/p/<store>/<id>` | Product page: price, verdict, fake-sale warning, chart, stats, WhatsApp/Telegram share, buy button. Open Graph tags give a rich preview on WhatsApp |
| `/deals` | Products at least 5% under their 90-day median price |
| `/go/<store>/<id>` | Outbound "buy" redirect (counts clicks, applies affiliate rules) |
| `/lookup?u=...` | Resolves a pasted link, following `amzn.in`, `dl.flipkart.com/s`, `fkrt.it`, `myntr.it` redirects through the shops' own hosts only |
| `POST /api/v1/prices` | Price reports from extensions whose users opted in |
| `GET /api/v1/history/<store>/<id>` | Daily price series for the extension |
| `/sitemap.xml`, `/robots.txt`, `/privacy`, `/disclosure` | SEO and policy pages |

**Data quality.** One stored price per product, per day, per reporter (the
latest wins); pages show the daily **median** across reporters, so a single
wrong or fake report cannot move a price once a few people see the product.
Deals compare against the 90-day median, so "raise the price, then announce a
sale" does not count as a deal.

## Security model (Supabase)

- Row Level Security is on for every table, with no policies: the public API
  key cannot read or write any table directly.
- The site uses only Postgres functions (`get_product`, `get_series`,
  `list_deals`, `list_recent`, `list_sitemap`, `ingest_prices`,
  `record_click`). They run as their owner (`SECURITY DEFINER`, fixed
  `search_path`).
- The two writing functions need the **write token**, stored in the private
  `config` table and in the `WRITE_TOKEN` env var on Vercel. Calling the RPC
  endpoint directly with the public key cannot write anything.
- Internal functions (`refresh_product`, `check_write_token`, `ist_day`) are
  not executable by the public roles.
- Reporter ids and IPs are stored only as salted hashes (`CLIENT_SALT`), with
  daily limits per reporter (1,000 prices) and per IP (5,000).

Supabase's security advisor lists "RLS enabled, no policy" (INFO) and "public
can execute SECURITY DEFINER function" (WARN) for the seven API functions.
Both are this design on purpose; nothing else is flagged.

## Environment variables (Vercel → Project → Settings → Environment Variables)

| Name | Value |
|---|---|
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `SUPABASE_ANON_KEY` | Supabase publishable key (`sb_publishable_...`) or legacy anon key |
| `WRITE_TOKEN` | Long random string, the same as `config.write_token` in the database (sensitive) |
| `CLIENT_SALT` | Long random string (sensitive) |
| `SITE_NAME` | `DaamDekho` |
| `SITE_URL` | Optional. Defaults to the production domain Vercel reports |
| `EXTENSION_URL` | Chrome Web Store link once published (shows the install buttons) |
| `TELEGRAM_URL` | Telegram channel link (phase 3) |
| `FLIPKART_TEMPLATE`, `MYNTRA_TEMPLATE` | Affiliate network deep-link format with `{url}`; empty = plain links |

After changing a variable, redeploy (Deployments → ⋯ → Redeploy).

To rotate the write token: run
`update config set value = '<new token>' where key = 'write_token';` in the
Supabase SQL editor, update `WRITE_TOKEN` on Vercel and redeploy.

## Costs and limits

- **Vercel Hobby (free) is for non-commercial use only.** While affiliate
  links are off the site earns nothing. **Before you set
  `FLIPKART_TEMPLATE` / `MYNTRA_TEMPLATE`, upgrade the team to Pro
  ($20/month)** or move hosting. The handler is plain Web
  `Request → Response`, so it also runs on other platforms.
- **Supabase free plan:** 500 MB database, and free projects are paused after
  about a week without activity (daily traffic keeps it awake; a paused
  project can be restored from the dashboard). At roughly 100 bytes per
  stored price, 500 MB holds a few million daily prices.

Check current limits on the Vercel and Supabase pricing pages.

## Money: affiliate rules on the website

- **Flipkart / Myntra:** set the templates above to your network's deep-link
  format (Cuelinks, EarnKaro, Admitad...). The product page shows a
  disclosure under the button whenever a template is active. Check your
  network's terms about showing prices and price history.
- **Amazon stays a plain link.** Amazon Associates allows prices next to
  Associates links only when they come from Amazon's own API (now the
  Creators API) and are under 24 hours old, with a timestamp. These prices
  are crowd-sourced, so they do not qualify.

## Deploying changes

The Vercel project `daamdekho` is linked to this GitHub repository:
pushing to `main` deploys production, other branches get preview
deployments (protected by Vercel Authentication). Database changes go in a
new file in `supabase/migrations/`; apply it in the Supabase SQL editor (or
with the Supabase CLI / MCP) before deploying code that needs it.

Custom domain: Vercel → Project → Settings → Domains. Canonical links follow
the production domain automatically; also update `SITE_URL` in
`extension/src/shared/config.js`.

## Local development

```bash
npm run dev:website
```

Runs the site on http://localhost:3000 with the same schema in an in-memory
Postgres (PGlite) and demo products. To use the real database instead, set
`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `WRITE_TOKEN` in the environment.

```bash
npm test
```

Runs the extension and website tests. Website tests apply the real
migration to PGlite and call the functions the way PostgREST does,
including checks that the public role cannot read tables or write without
the token.

## Code map

```
../api/index.mjs        Vercel Function entry
../vercel.json          rewrites every path to the function, region bom1
src/app.js              routes, headers, error handling
src/lib/store.js        data access (one Postgres function per call)
src/lib/supabase.js     tiny PostgREST RPC client
src/lib/ingest.js       upload validation, hashing, rate-limit inputs
src/lib/links.js        outbound/affiliate links, short-link resolving
src/lib/paths.js        /p/<store>/<id> parsing
src/lib/shared.js       reuses the extension's stores/insights/affiliate/share modules
src/pages/              HTML pages, CSS/JS assets
supabase/migrations/    schema, security, functions
scripts/dev.mjs         local server; scripts/demo-data.mjs sample data
test/                   tests; pg-store.js = PGlite + the migration
```
