# shopping-extension

Price history, fake-sale detection and price-drop alerts for Indian shoppers
on **Amazon.in, Flipkart and Myntra**.

Plan: Chrome extension → website → Telegram/WhatsApp. See [docs/ROADMAP.md](docs/ROADMAP.md).

| Part | Folder | Status |
|---|---|---|
| Chrome extension | [`extension/`](extension/) | v0.2.0 |
| Website + API (Cloudflare Workers + D1) | [`website/`](website/) | v0.1.0, ready to deploy ([guide](website/README.md)) |
| Telegram / WhatsApp | – | next |

> Working name: **DaamDekho**, a placeholder. Change it in
> `extension/_locales/en/messages.json` and `SITE_NAME` in `website/wrangler.toml`.

## Extension

- **Price panel on product pages**: current price, MRP, chart, lowest/highest/typical
  price and a verdict in Hinglish or English ("Ab tak ka sabse kam daam!",
  "Ruko: typical daam se 8% mehenga"). Verdicts compare against the
  *typical* (median) price, so a short price hike cannot make a "sale" look
  like a deal.
- **Fake-sale detector**: flags "raised the price, then announced a sale" and
  big "% off MRP" claims that are no real saving.
- **Share to WhatsApp / Telegram / copy** with the price insight, linking to
  the product's page on the website.
- **Track + alerts**: target price, background re-checks, desktop notifications.
- **Community price history (opt-in)**: after the user says yes in the panel,
  prices of viewed products are shared anonymously with the website and the
  panel shows the full history from all users, even for a product seen for
  the first time. Off until the user agrees; nothing is sent before that.
- Popup with tracked products; options for language, alerts, community data,
  affiliate links (off by default, rule-bound), export/delete data.

The website address goes in `extension/src/shared/config.js` (`SITE_URL`).
Left empty, community history and website links are switched off and
everything else works locally.

### Try it in Chrome

1. Open `chrome://extensions` and switch on **Developer mode**.
2. Click **Load unpacked** and pick the `extension/` folder.
3. Open a product on Amazon.in, Flipkart or Myntra. The panel appears at the bottom right.

## Website

Product pages with shared history, honest deals list, paste-a-link lookup
(app share links too), WhatsApp-friendly previews, affiliate "buy" links with
disclosure. Deploy steps, costs and policy notes: [website/README.md](website/README.md).

## Development

```bash
npm install
```

```bash
npm test
```

Runs the extension and website unit tests (Node's built-in runner; the
website runs on an in-memory SQLite stand-in for D1).

```bash
npm run test:e2e
```

Loads the extension in Chromium, serves sample pages on the real shop URLs
and runs the real website Worker in-process, then checks the panel,
tracking, background checks, notifications, popup, options, consent,
uploads, shared history and share links. Needs Playwright
(`npm i -D playwright && npx playwright install chromium`).

```bash
npm run pack
```

Creates `dist/extension-v<version>.zip` for the Chrome Web Store.

## Layout

```
extension/                 the extension (load this folder)
  src/shared/              plain JS, no chrome.* calls, also used by the website
    stores.js extract.js insights.js share.js affiliate.js settings.js config.js
  src/content/ src/background/ src/offscreen/ src/popup/ src/options/
website/                   Cloudflare Worker + D1 (see website/README.md)
tests/                     extension unit tests, fixtures, e2e test
scripts/                   pack.js, make-icons.js
docs/                      roadmap, Chrome Web Store notes, privacy policy
```

## Known limits

- **Selectors are tested only against sample pages.** This environment could
  not open the live shop sites. Before publishing, check several real
  products per shop. When a shop changes its HTML, update `SELECTORS` in
  `extension/src/shared/extract.js` and add a fixture test.
- **App short-link resolving is tested with simulated redirects**, not the
  live shortener services.
- **Background checks run only while Chrome is open.**
