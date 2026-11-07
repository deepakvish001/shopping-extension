// Page bodies. Everything user- or shop-supplied goes through html`` escaping.
import { html, raw } from '../lib/html.js';
import { PTStores, PTInsights, PTShare } from '../lib/shared.js';
import { formatDay, istDay } from '../lib/days.js';
import { layout } from './layout.js';

const fmt = PTInsights.formatINR;

function productPath(store, pid) {
  return `/p/${encodeURIComponent(store)}/${encodeURIComponent(pid)}`;
}

function shortTitle(title, max = 70) {
  return PTShare.shorten(title, max);
}

function dealCard(p) {
  const pct = p.typical_price ? Math.round(((p.typical_price - p.last_price) / p.typical_price) * 100) : 0;
  return html`<a class="deal" href="${productPath(p.store, p.pid)}">
    ${p.image ? html`<img src="${p.image}" alt="" loading="lazy" referrerpolicy="no-referrer">` : html`<div class="noimg"></div>`}
    <span class="store">${PTStores.storeLabel(p.store)}</span>
    <span class="t">${p.title || `${PTStores.storeLabel(p.store)} product`}</span>
    <span class="p">${fmt(p.last_price)}</span>
    ${pct > 0 ? html`<span class="drop">▼ ${pct}% typical se kam</span><span class="was">Typical ${fmt(p.typical_price)}</span>` : ''}
  </a>`;
}

/** "5 min pehle" / "3 ghante pehle" / "2 din pehle" for the latest check or report. */
function checkedAgo(product, now) {
  const t = Math.max(product.last_checked || 0, product.last_seen || 0);
  const mins = Math.max(0, Math.round((now - t) / 60000));
  if (mins < 60) return mins <= 1 ? 'abhi' : `${mins} min pehle`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} ghante pehle`;
  return `${Math.round(hours / 24)} din pehle`;
}

function lookupForm(q) {
  return html`<form class="lookup" action="/lookup" method="get" data-loading="Daam la rahe hain…">
      <input name="u" type="text" inputmode="url" autocomplete="off" placeholder="Amazon, Flipkart ya Myntra ka product link paste karo" value="${q || ''}" required aria-label="Product link">
      <button class="btn btn-primary btn-lg" type="submit">Track karo</button>
    </form>`;
}

function grid(items) {
  return html`<div class="grid">${items.map(dealCard)}</div>`;
}

function ctaButtons(site) {
  if (!site.extensionUrl && !site.telegramUrl) return '';
  return html`<div class="cta-row">
    ${site.extensionUrl ? html`<a class="btn btn-primary" href="${site.extensionUrl}" rel="noopener">Chrome extension lagao (free)</a>` : ''}
    ${site.telegramUrl ? html`<a class="btn" href="${site.telegramUrl}" rel="noopener">Telegram deals channel</a>` : ''}
  </div>`;
}

// ------------------------------------------------------------------ home ---

export function homePage(site, { deals, recent, error, q }) {
  const body = html`
  <section class="hero">
    <h1>Sale asli hai ya nakli? Pehle price history dekho.</h1>
    <p class="lead">Amazon, Flipkart ya Myntra ka product link paste karo. Purane daam, sabse kam daam aur "fake sale" ka sach turant.</p>
    <form class="lookup" action="/lookup" method="get">
      <input name="u" type="text" inputmode="url" autocomplete="off" placeholder="Product link paste karo (app ka share link bhi chalega)" value="${q || ''}" required aria-label="Product link">
      <button class="btn btn-primary" type="submit">History dekho</button>
    </form>
    ${error ? html`<p class="notice" role="alert">${error}</p>` : ''}
    ${ctaButtons(site)}
  </section>

  <h2>Aaj ke asli price drops</h2>
  ${deals.length
    ? html`${grid(deals)}<p class="hint"><a href="/deals">Saare deals dekho →</a></p>`
    : html`<p class="empty">Abhi koi bada drop nahi mila. Jaise jaise log products dekhenge, yahan asli deals dikhengi.</p>`}

  ${recent.length ? html`<h2>Haal hi me dekhe gaye</h2>${grid(recent)}` : ''}

  <h2 id="how">Kaise kaam karta hai</h2>
  <ol class="steps">
    <li><strong>Link paste karo ya extension lagao.</strong> Extension Amazon, Flipkart aur Myntra ke product page par hi price history dikha deta hai.</li>
    <li><strong>Sach dekho.</strong> Sabse kam, sabse zyada aur typical daam. MRP wala nakli discount aur "pehle daam badhao, phir sale" wala khel pakda jata hai.</li>
    <li><strong>Sahi waqt par kharido.</strong> Target daam set karo, daam girte hi alert milega. Dosto ko WhatsApp par share karo.</li>
  </ol>`;
  return layout(site, {
    title: `${site.name}: Price history & fake sale check for Amazon, Flipkart, Myntra`,
    description: 'Amazon.in, Flipkart aur Myntra ki price history, sabse kam daam aur fake sale check. Free.',
    path: '/',
    body,
  });
}

export function dealsPage(site, { deals }) {
  const body = html`
  <h1>Asli price drops</h1>
  <p class="lead">Woh products jinka daam abhi apne 90 din ke typical daam se kam se kam 5% neeche hai. Typical daam median hai, isliye sale se pehle badhaya gaya daam ise nahi badal pata.</p>
  ${deals.length ? grid(deals) : html`<p class="empty">Abhi koi deal nahi mili. Thodi der baad dekho.</p>`}`;
  return layout(site, {
    title: `Today's real price drops on Amazon, Flipkart, Myntra | ${site.name}`,
    description: 'Products whose price is genuinely below their usual price, based on price history.',
    path: '/deals',
    body,
  });
}

// --------------------------------------------------------------- product ---

export function productPage(site, { ident, product, series, now, affiliate }) {
  const storeName = PTStores.storeLabel(ident.store);
  const path = productPath(ident.store, ident.id);
  const pageUrl = `${site.base}${path}`;

  if (!product) {
    // Never looked up: offer a live check (Flipkart needs the full link).
    const body = html`
    <p class="crumbs"><a href="/">Home</a> › ${storeName}</p>
    <section class="panel state">
      <h1>Is product ko abhi track nahi kiya gaya</h1>
      <p class="lead">${storeName} product <code>${ident.id}</code> ka daam abhi check karte hain. Uske baad hum ise roz check karenge.</p>
      ${ident.url
        ? html`<div class="cta-row"><a class="btn btn-primary" href="/lookup?u=${encodeURIComponent(ident.url)}" data-loading="Daam la rahe hain…">Abhi daam check karo</a></div>`
        : html`${lookupForm('')}<p class="hint">${storeName} ke product ka poora link paste karo.</p>`}
    </section>`;
    return layout(site, { title: `${storeName} product price history | ${site.name}`, description: 'Track this product.', path, noindex: true, body });
  }

  if (!series.length) {
    // Known product, but no price yet (the shop did not give us the page).
    const body = html`
    <p class="crumbs"><a href="/">Home</a> › ${storeName}</p>
    <section class="panel state">
      <h1>${product.title || `${storeName} product ${ident.id}`}</h1>
      <p class="lead">${storeName} ne abhi daam nahi dikhaya${product.last_error ? html` <span class="muted">(${product.last_error})</span>` : ''}.
      Hum kuch ghante me apne aap dobara check karenge, aur extension users ke dekhte hi bhi daam yahan aa jayega.</p>
      <div class="cta-row">
        <a class="btn btn-primary" href="/lookup?u=${encodeURIComponent(product.url)}" data-loading="Daam la rahe hain…">Dobara try karo</a>
        <a class="btn" href="${product.url}" rel="nofollow noopener">${storeName} par dekho</a>
      </div>
    </section>`;
    return layout(site, { title: `${storeName} product price history | ${site.name}`, description: 'Price check pending.', path, noindex: true, body });
  }

  const s = PTInsights.stats(series, now);
  const v = PTInsights.verdict(s, 'hi');
  const hike = PTInsights.saleHike(series, now, 'hi');
  const dc = PTInsights.discountCheck(s, product.mrp, 'hi');
  const warning = hike ? hike.text : dc && dc.inflated ? dc.text : null;
  const title = product.title || `${storeName} product ${ident.id}`;
  const color = { lowest: '#0b8043', good: '#0b8043', high: '#c5221f', normal: '#b06000' }[v.level] || '#5f6368';

  const shareBase = { title, store: ident.store, stats: s, verdictText: v.text, warning, lang: 'hi' };
  const shareText = PTShare.buildText({ ...shareBase, link: pageUrl });
  const goPath = `/go/${encodeURIComponent(ident.store)}/${encodeURIComponent(ident.id)}`;

  const body = html`
  <p class="crumbs"><a href="/">Home</a> › ${storeName}</p>
  <section class="panel product${product.image ? '' : ' no-pic'}">
    ${product.image ? html`<div class="pic"><img src="${product.image}" alt="${shortTitle(title, 120)}" referrerpolicy="no-referrer"></div>` : ''}
    <div>
      <h1>${title}</h1>
      <div>
        <span class="price">${fmt(s.current)}</span>
        ${dc ? html`<span class="mrp">${fmt(product.mrp)}</span><span class="off">${dc.claimedPct}% off MRP</span>` : ''}
      </div>
      <p class="updated">Last check ${checkedAgo(product, now)} · roz apne aap check hota hai. Kharidne se pehle ${storeName} par final daam dekh lein.</p>
      <p class="verdict v-${v.level}">${v.text}</p>
      ${warning ? html`<p class="warn">⚠️ ${warning}</p>` : ''}
      <div class="cta-row">
        <a class="btn btn-buy" href="${goPath}" rel="sponsored nofollow noopener" target="_blank">${storeName} par dekho</a>
      </div>
      ${affiliate ? html`<p class="disclosure">Affiliate link: is link se kharidne par ${site.name} ko commission mil sakta hai. Aapke liye daam same rehta hai.</p>` : ''}
    </div>
  </section>

  <section class="panel">
    <h2>Price history</h2>
    ${s.count >= 2
      ? html`<div class="chart">${raw(PTInsights.chartSvg(series, { width: 640, height: 200, now, color }))}</div>
        <div class="axis"><span>${formatDay(istDay(series[0][0]))}</span><span>Aaj</span></div>`
      : html`<p class="hint">Abhi sirf ek din ka data hai. Kuch din me graph dikhne lagega.</p>`}
    <dl class="stats">
      <div><dt>Sabse kam</dt><dd>${fmt(s.min)}</dd><small>${product.low_day ? formatDay(product.low_day) : ''}</small></div>
      <div><dt>Sabse zyada</dt><dd>${fmt(s.max)}</dd></div>
      <div><dt>Typical (90 din)</dt><dd>${product.typical_price ? fmt(product.typical_price) : fmt(s.median)}</dd></div>
      <div><dt>Tracking</dt><dd>${product.days} din</dd><small>${product.reporters ? `${product.reporters} users + roz check` : 'roz check'}</small></div>
    </dl>
  </section>

  <section class="panel">
    <h2>Dosto ko batao</h2>
    <div class="share">
      <a class="chip wa" href="${PTShare.whatsappUrl(shareText)}" target="_blank" rel="noopener">WhatsApp</a>
      <a class="chip tg" href="${PTShare.telegramUrl(PTShare.buildText({ ...shareBase, link: null }), pageUrl)}" target="_blank" rel="noopener">Telegram</a>
      <button class="chip" type="button" data-copy="${pageUrl}" data-done="Copy ho gaya!">Link copy</button>
    </div>
  </section>

  <section class="panel">
    <h2>Daam girne par alert chahiye?</h2>
    <p>Extension me "Price track karo" dabao aur target daam daalo. Daam girte hi notification milega.</p>
    ${ctaButtons(site) || html`<p class="hint">Chrome extension jald aa raha hai.</p>`}
  </section>`;

  return layout(site, {
    title: `${shortTitle(title)} price history | ${site.name}`,
    ogTitle: `${shortTitle(title, 80)}: ${fmt(s.current)} (sabse kam ${fmt(s.min)})`,
    description: `${v.text} ${storeName} price history: sabse kam ${fmt(s.min)}, sabse zyada ${fmt(s.max)}.`,
    path,
    image: product.image,
    noindex: product.days < 2,
    body,
  });
}

// ---------------------------------------------------------------- static ---

export function disclosurePage(site) {
  const body = html`<article class="prose">
  <h1>Affiliate disclosure</h1>
  <p>${site.name} free hai. Kharche nikalne ke liye kuch "dekho" buttons affiliate links hote hain: agar aap us link se kharidte ho,
  to store ya affiliate network ${site.name} ko commission de sakta hai. Aapke liye daam same rehta hai.</p>
  <p>Jahan affiliate link hota hai, wahan button ke neeche saaf likha hota hai. Amazon ke links abhi affiliate nahi hain.</p>
  <p>Commission se price history, verdict ya deals ki ranking nahi badalti: deals sirf price data se chune jaate hain.</p>
  </article>`;
  return layout(site, { title: `Affiliate disclosure | ${site.name}`, description: 'How this site earns money.', path: '/disclosure', body });
}

export function privacyPage(site) {
  const body = html`<article class="prose">
  <h1>Privacy</h1>
  <p><strong>Website:</strong> koi account nahi, koi tracking cookie nahi. Server par sirf normal hosting logs ho sakte hain.</p>
  <p><strong>Extension ka community data:</strong> sirf un users se aata hai jinhone extension me "Community price history" chalu ki hai.
  Unke dekhe products ka product id, page ka link, naam, image, daam aur samay aata hai, ek random id ke saath jo server par
  salted hash bana kar hi save hota hai. Naam, account, orders ya baaki browsing kabhi nahi aati. IP address bhi sirf hash bana kar,
  rate limit ke liye, ek din ke counter me rakha jata hai.</p>
  <p>Extension me setting band karte hi upload ruk jata hai aur us browser ki random id mit jaati hai.</p>
  </article>`;
  return layout(site, { title: `Privacy | ${site.name}`, description: 'What data is collected and why.', path: '/privacy', body });
}

export function notFoundPage(site) {
  const body = html`<h1>Page nahi mila</h1><p class="lead">Yeh page maujood nahi hai. <a href="/">Home par jao</a> aur product link paste karo.</p>`;
  return layout(site, { title: `Not found | ${site.name}`, description: '', path: '/404', noindex: true, body });
}
