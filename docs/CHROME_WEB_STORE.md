# Chrome Web Store: listing, permissions and affiliate rules

Check the current policies before every submission. They change, and this file
is a summary, not legal advice.

## Rules this project follows

**Chrome Web Store affiliate policy** (announced March 2025, enforced from
10 June 2025). An extension may use affiliate links only when:
1. the affiliate program is disclosed in the store listing, in the extension
   UI, and before installation;
2. the user takes an action before any affiliate link, code or cookie is
   applied;
3. the affiliate link is tied to a direct benefit for the user at that moment
   (for example: a coupon extension must not add an affiliate link when no
   coupon is found).
Extensions that break this can be removed from the store.
Source: https://developer.chrome.com/blog/cws-policy-update-affiliate-ads-2025

**Amazon Associates**: the Participation Requirements forbid using Special
Links in client-side software, which they define to include browser plug-ins,
toolbars and extensions. The extension therefore never adds an Amazon
affiliate tag. Amazon affiliate links belong on the website (phase 2).
Source: https://affiliate-program.amazon.com/help/operating/participation/
(the India agreement at https://affiliate-program.amazon.in/gp/associates/agreement
requires following the Participation Requirements; read the India version in
your Associates account).

**Flipkart / Myntra** have no open direct programs for new affiliates; you
join through networks such as Cuelinks, EarnKaro or Admitad. Ask your network
in writing whether traffic from a browser extension is allowed before
entering a template.

**Advertising disclosure in India (ASCI)**: affiliate links count as a
material connection. The label must be upfront and visible.

## How the code enforces this

`extension/src/shared/affiliate.js` returns the plain product URL unless all
of these hold:
- the shop is not Amazon;
- the owner enabled affiliate links in Options and entered an https template;
- the user clicked a deal: a price-drop notification, or "Open" in the popup
  while the price is below the tracking price or at/below the target;
- the URL has no existing affiliate marker (`tag`, `affid`, ...).

Links on shop pages are never rewritten. Cookies are never touched. The popup
shows an affiliate disclosure whenever the feature is on.

If you turn affiliate links on, add the disclosure below to the listing
**before** publishing that version.

## Community price history and the User Data policy

Sending the product pages a user views to a server is handling browsing
data, so the Chrome Web Store requires a **prominent in-product disclosure
and the user's affirmative consent** before any of it is sent. The extension:

- sends nothing until the user presses "Haan, chalu karo" / "Yes, turn on"
  in the panel prompt, which says what is sent (product, price, time), where
  (the website's host name), and what is not sent (name, account, other
  browsing);
- keeps sending only while the setting stays on; turning it off in the
  panel prompt ("Abhi nahi") or in Options deletes the random client id, the
  upload queue and the cached history;
- does nothing at all when `SITE_URL` in `src/shared/config.js` is empty.

## Listing text (draft)

**Name**: from `_locales/en/messages.json`

**Summary (≤132 chars)**: Price history, fake-discount check and price-drop
alerts for Amazon.in, Flipkart and Myntra.

**Description**:

> See if a "sale" is really a sale. On Amazon.in, Flipkart and Myntra product
> pages, [Name] shows the price history, the lowest and highest price seen,
> and a simple verdict: buy now or wait. It warns you when a big "% off MRP"
> is not a real saving. Track any product and get a notification when it
> drops to your target price.
>
> It also catches the "raise the price, then call it a sale" trick, and lets
> you share the price history with friends on WhatsApp or Telegram.
>
> Hindi-English (Hinglish) and English.
>
> Privacy: your price history and tracked products are stored in your
> browser. If you turn on Community price history (it asks first), the
> product, price and time of products you view are shared anonymously with
> [website] so everyone gets full price histories. Nothing else is sent.
>
> Affiliate disclosure (include only when affiliate links are enabled): When
> you open a Flipkart or Myntra deal from a price-drop alert or from the deal
> list, we may use an affiliate link and earn a small commission. Your price
> does not change. We never replace other affiliate links and never add
> affiliate links to Amazon.

**Single purpose**: Show price history and alert users to price drops on
supported Indian shopping sites.

## Permission justifications

| Permission | Why |
|---|---|
| `storage` | Save price history, tracked products and settings in the browser. |
| `alarms` | Re-check tracked products every 6/12/24 hours. |
| `notifications` | Tell the user when a tracked product's price drops. |
| `offscreen` | Parse product page HTML in the background to read the price (service workers have no DOM parser). |
| Host access to `www.amazon.in`, `www.flipkart.com`, `www.myntra.com` | Show the price panel on product pages and fetch tracked product pages to check their price. |

The website API needs no host permission: it answers with CORS headers.

## Privacy practices form

Answer it from what the code does:
- Without community history (or with `SITE_URL` empty): product page content
  (title, price, image) of the three shop sites is read and stored locally;
  no user data is transmitted.
- With community history: the build can transmit, after consent, the
  address and content (title, price, image) of shop product pages the user
  views. Declare this under the form's browsing-related categories (web
  history / website content), state that it is used only to build shared
  price history, not sold, and not used for anything else, and certify the
  Limited Use requirements.

Link the hosted privacy policy (the website's `/privacy` page or
`docs/PRIVACY.md`) and keep it in line with the build you submit.
