import { html, raw } from '../lib/html.js';

/**
 * Full HTML document.
 * @param {object} site  {name, base, extensionUrl, telegramUrl}
 * @param {object} page  {title, description, path, image, noindex, body}
 */
export function layout(site, page) {
  const canonical = `${site.base}${page.path || '/'}`;
  return html`<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${page.title}</title>
<meta name="description" content="${page.description || ''}">
<link rel="canonical" href="${canonical}">
${page.noindex ? raw('<meta name="robots" content="noindex">') : ''}
<meta property="og:site_name" content="${site.name}">
<meta property="og:type" content="website">
<meta property="og:title" content="${page.ogTitle || page.title}">
<meta property="og:description" content="${page.description || ''}">
<meta property="og:url" content="${canonical}">
${page.image ? html`<meta property="og:image" content="${page.image}">` : ''}
<meta name="twitter:card" content="${page.image ? 'summary_large_image' : 'summary'}">
<meta name="theme-color" content="#1a73e8">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/static/site.css">
<script src="/static/site.js" defer></script>
</head>
<body>
<header class="top"><div class="wrap">
  <a class="logo" href="/"><img src="/favicon.svg" alt="" width="28" height="28">${site.name}</a>
  <nav><a href="/deals">Deals</a><a href="/#how">Kaise kaam karta hai</a>${site.extensionUrl ? html`<a href="${site.extensionUrl}" rel="noopener">Extension</a>` : ''}</nav>
</div></header>
<main><div class="wrap">
${page.body}
</div></main>
<footer><div class="wrap">
  <p>${site.name}: Amazon.in, Flipkart aur Myntra ki price history, users ke dekhe hue daam se bani.
  Daam badalte rehte hain; kharidne se pehle store par final daam check karein.</p>
  <p><a href="/disclosure">Affiliate disclosure</a><a href="/privacy">Privacy</a>${site.telegramUrl ? html`<a href="${site.telegramUrl}" rel="noopener">Telegram</a>` : ''}</p>
</div></footer>
</body>
</html>`.toString();
}
