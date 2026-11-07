# Roadmap

Order: **Chrome extension → website → Telegram (+ WhatsApp)**.

The logic in `extension/src/shared/` (URL detection, extraction, history
maths, verdicts, share text, affiliate rules) has no browser-only
dependencies; the website already reuses it, and the Telegram bot can too.

## Phase 1: Chrome extension

v0.1.0: panel with price history and verdict, fake-MRP check, tracking with
target price, background checks, notifications, popup, options.

v0.2.0 (for growth):
- Verdicts against the typical (median) price, so pre-sale hikes cannot fake a deal.
- "Raise then discount" fake-sale detector.
- WhatsApp / Telegram / copy share from the panel, linking to the website.
- Community price history, opt-in with an in-panel consent prompt: instant
  history for products seen for the first time.

Before publishing:
1. Test on 10+ real products per shop (phones, fashion, out-of-stock,
   variants). Fix selectors where needed.
2. Pick the final name (`_locales/en/messages.json`, `SITE_NAME`).
3. Deploy the website and set `SITE_URL` in `extension/src/shared/config.js`.
4. Host the privacy policy (the website's `/privacy` page, or `docs/PRIVACY.md`).
5. Chrome Web Store developer account (one-time US$5), fill the privacy
   form as described in `docs/CHROME_WEB_STORE.md`, submit `npm run pack` output.

Next ideas: Ajio, Nykaa, Croma, Tata CLiQ; price-drop badge on the toolbar
icon; "Join our Telegram" link once phase 3 exists.

## Phase 2: Website (v0.1.0 ready to deploy)

Done: Cloudflare Worker + D1; upload API with validation, per-day medians and
rate limits; history API for the extension; product pages with chart,
verdict, fake-sale warning, WhatsApp-friendly preview tags and share buttons;
honest deals list (median-based); paste-a-link lookup including app short
links; outbound redirects with affiliate templates and disclosure; sitemap,
privacy, disclosure pages. See `website/README.md`.

Next:
- Deploy, add a custom domain, submit the sitemap to Google Search Console.
- Amazon Creators API (after qualifying Associates sales) to show
  API-sourced Amazon prices with Associates links, per Amazon's rules.
- Category pages ("phones under ₹15,000 at their lowest") for search traffic.

## Phase 3: Telegram, then WhatsApp

- Telegram bot (Bot API is free): user sends or shares a product link, the
  bot replies with history, verdict and the website link. Reuse
  `website/src/lib/links.js` (link resolving) and the shared modules.
- Telegram channel: post deals from the website's `/deals` query
  automatically, each post labelled as affiliate/#ad.
- WhatsApp channel: post the best few deals by hand (no official API for
  Channels; unofficial tools risk a ban). Never add people to groups
  without their consent.
