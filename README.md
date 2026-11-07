# shopping-extension

Price history, fake-discount check and price-drop alerts for Indian shoppers on
**Amazon.in, Flipkart and Myntra**.

This is **phase 1 (Chrome extension)** of a three-phase plan:
Chrome extension → website → Telegram/WhatsApp. See [docs/ROADMAP.md](docs/ROADMAP.md).

> Working name: **DaamDekho**. It is a placeholder. Change it in one place:
> `extension/_locales/en/messages.json`.

## What the extension does

- **Price panel on product pages.** Shows the current price, MRP, a price-history
  chart, lowest/highest/average price, and a verdict in Hinglish or English
  ("Ab tak ka sabse kam daam!", "Ruko: average se 8% mehenga").
- **Fake-discount check.** Flags pages that claim a big "% off MRP" while the
  price is no lower than its own history.
- **Track + alerts.** Track a product with an optional target price. The
  extension re-checks tracked products every 6/12/24 hours and shows a desktop
  notification when the price reaches the target (or, without a target, drops
  by your chosen %).
- **Popup** with all tracked products and how much each has moved.
- **Local only.** All data stays in `chrome.storage.local` in the user's
  browser. Nothing is sent to any server.

Affiliate links are **off by default** and follow strict rules (never on
Amazon, only on a user click on a real deal, never replacing someone else's
link). Read [docs/CHROME_WEB_STORE.md](docs/CHROME_WEB_STORE.md) before you turn
them on.

## Try it in Chrome

1. Open `chrome://extensions` and switch on **Developer mode**.
2. Click **Load unpacked** and pick the `extension/` folder.
3. Open any product on Amazon.in, Flipkart or Myntra. The panel appears at the
   bottom right.

After changing code, press the reload icon on the extension card and refresh
the shop tab.

## Development

```bash
npm install
```

```bash
npm test
```

Unit tests (Node's built-in runner) cover URL detection, price parsing,
extraction from sample pages in `tests/fixtures/`, history maths, alerts, the
affiliate rules and settings.

```bash
npm run test:e2e
```

The end-to-end test loads the extension in Chromium, serves the fixtures on the
real shop URLs and checks the panel, tracking, background re-check,
notifications, popup and options. It needs Playwright
(`npm i -D playwright && npx playwright install chromium`).

```bash
npm run pack
```

Creates `dist/extension-v<version>.zip` for the Chrome Web Store.

## Project layout

```
extension/                 the extension itself (load this folder)
  manifest.json            Manifest V3
  src/shared/              plain JS, no chrome.* calls, also runs in Node
    stores.js              shop + product id from a URL, rupee parsing
    extract.js             title/price/MRP/image from a product page
    insights.js            history, stats, verdicts, alerts, chart
    affiliate.js           outbound-link rules
    settings.js            defaults and validation
  src/content/content.js   reads the page, shows the panel (shadow DOM)
  src/background/          service worker: storage, timed checks, notifications
  src/offscreen/           parses fetched HTML (service workers have no DOMParser)
  src/popup/, src/options/ UI pages
tests/                     unit tests, fixtures, e2e test
scripts/                   pack.js (zip), make-icons.js (icons from assets/icon.svg)
docs/                      roadmap, store listing and policy notes, privacy policy
```

## Known limits (read before publishing)

- **Selectors are tested only against sample pages.** Shops change their HTML
  often, and this environment could not open the live sites. Before
  publishing, open several real products on each shop and confirm the panel
  shows the right price. When a shop changes its HTML, update
  `SELECTORS` in `extension/src/shared/extract.js` and add a fixture test.
- **History starts when this browser first sees a product.** There is no
  shared history yet. Phase 2 (website + backend) fixes that.
- **Background checks run only while Chrome is open.** A check that finds no
  price (for example a captcha page) is recorded as failed and shown in the
  popup.
