# Roadmap

Order: **Chrome extension → website → Telegram (+ WhatsApp)**.

The logic in `extension/src/shared/` (URL detection, extraction, history
maths, verdicts, affiliate rules) has no browser-only dependencies and already
runs in Node, so the website backend and the Telegram bot can reuse it.

## Phase 1: Chrome extension (this repo, v0.1.0)

Done:
- Panel on Amazon.in / Flipkart / Myntra product pages: price, MRP, chart,
  lowest/highest/average, Hinglish/English verdict, fake-discount warning.
- Track with target price, background re-checks, desktop notifications.
- Popup list, options page, data export/delete.
- Affiliate hook that is off by default and rule-bound (see CHROME_WEB_STORE.md).
- Unit tests + Chromium end-to-end test.

Before publishing:
1. Load the extension and test on 10+ real products per shop (phones, fashion,
   out-of-stock items, variants). Fix selectors where needed.
2. Pick the final name and replace the placeholder in
   `extension/_locales/en/messages.json`.
3. Host `docs/PRIVACY.md` at a public URL (GitHub Pages works) for the store
   listing.
4. Register a Chrome Web Store developer account (one-time US$5 fee) and
   submit `dist/extension-v<version>.zip`.

Good next features:
- Ajio, Nykaa, Croma, Tata CLiQ (add to `stores.js`, `extract.js`, manifest).
- "Join our Telegram for deals" link in the popup (opt-in, once phase 3 exists).

## Phase 2: Website + shared history

- Backend (e.g. Supabase free tier) storing anonymous price points.
- Extension setting, **off by default**: "Share prices anonymously to build
  public history". Only product id + price + time, never the user's identity
  or browsing history. Needs a privacy policy and store listing update.
- Website (e.g. Vercel/Cloudflare free tier): one page per product with full
  history, so Google search brings visitors ("iPhone 16 price history").
- Affiliate links live on the website, with clear disclosure. Amazon
  Associates links belong here, not in the extension. Declare the website in
  your Amazon Associates account.
- Extension panel gets a "See full history" link to the product's page.

## Phase 3: Telegram, then WhatsApp

- Telegram bot (Bot API is free): user sends/shares a product link, the bot
  replies with history, verdict and an alert option. Reuse `stores.js`,
  `extract.js` and `insights.js`.
- Telegram channel: deals posted automatically when a price is X% under its
  30-day average. Label every post as affiliate/#ad.
- WhatsApp channel: post the best few deals by hand (no official API for
  Channels; unofficial tools risk a ban). Never add people to groups without
  their consent.
