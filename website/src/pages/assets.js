// Static assets served by the Worker itself (no build step).

export const CSS = `
:root {
  --bg: #fffaf2; --card: #ffffff; --fg: #111827; --muted: #5b6472; --line: #ece6dc;
  --brand: #16a34a; --brand-dark: #15803d; --brand-ink: #ffffff; --brand-soft: #e8f7ee;
  --accent: #facc15; --accent-soft: #fff4c2; --blue: #1a73e8;
  --good: #15803d; --bad: #dc2626; --amber: #b45309;
  --warn-bg: #fff7e0; --warn-fg: #7a4f01; --soft: #f6f8f7;
  --shadow: 0 1px 2px rgba(17,24,39,.04), 0 8px 24px rgba(17,24,39,.06);
  --radius: 18px;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f1115; --card: #171a21; --fg: #f3f4f6; --muted: #9ca3af; --line: #272c35;
    --brand: #22c55e; --brand-dark: #16a34a; --brand-ink: #052e16; --brand-soft: #12301f;
    --accent: #facc15; --accent-soft: #3a3210; --blue: #8ab4f8;
    --good: #4ade80; --bad: #f87171; --amber: #fbbf24;
    --warn-bg: #3a2f10; --warn-fg: #fde68a; --soft: #1d2129; --shadow: none;
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; color: var(--fg); font: 16px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif;
  background: var(--bg) radial-gradient(1200px 600px at 10% -10%, rgba(255, 196, 140, .28), transparent 60%),
              radial-gradient(900px 500px at 100% 0%, rgba(250, 204, 21, .16), transparent 60%) no-repeat; }
a { color: var(--brand-dark); }
img { max-width: 100%; }
.wrap { max-width: 1040px; margin: 0 auto; padding: 0 16px; }
.muted { color: var(--muted); }

/* header */
.top { position: sticky; top: 0; z-index: 10; background: color-mix(in srgb, var(--bg) 82%, transparent); backdrop-filter: blur(10px); border-bottom: 1px solid var(--line); }
.top .wrap { display: flex; align-items: center; gap: 16px; min-height: 68px; }
.logo { display: flex; align-items: center; gap: 10px; color: var(--fg); text-decoration: none; }
.logo img { width: 38px; height: 38px; }
.logo b { display: block; font-size: 19px; font-weight: 900; letter-spacing: -.02em; line-height: 1.1; }
.logo small { display: block; font-size: 11.5px; color: var(--muted); font-weight: 600; letter-spacing: .02em; }
.top nav { display: flex; gap: 6px; margin-left: auto; align-items: center; }
.top nav a { color: var(--muted); text-decoration: none; font-weight: 600; font-size: 15px; padding: 8px 10px; border-radius: 10px; }
.top nav a:hover { color: var(--fg); background: var(--soft); }
.top nav a.btn { color: var(--brand-ink); }

main { padding: 8px 0 48px; }
h1 { font-size: 28px; line-height: 1.2; margin: 0 0 8px; letter-spacing: -.02em; }
h2 { font-size: 22px; margin: 36px 0 14px; letter-spacing: -.01em; }
.lead { color: var(--muted); margin: 0 0 16px; font-size: 17px; }

/* buttons */
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; font: inherit; font-weight: 800; padding: 12px 18px;
  border-radius: 12px; border: 1px solid var(--line); background: var(--card); color: var(--fg); text-decoration: none; cursor: pointer; white-space: nowrap; }
.btn:hover { border-color: color-mix(in srgb, var(--fg) 25%, var(--line)); }
.btn-primary, .btn-buy { background: var(--brand); color: var(--brand-ink); border-color: var(--brand); box-shadow: 0 6px 16px rgba(22,163,74,.25); }
.btn-primary:hover, .btn-buy:hover { background: var(--brand-dark); border-color: var(--brand-dark); }
.btn-lg { padding: 16px 26px; font-size: 18px; border-radius: 14px; }
.btn svg { width: 20px; height: 20px; }
.is-loading { opacity: .8; pointer-events: none; }
.is-loading::before { content: ''; width: 16px; height: 16px; border-radius: 50%; border: 2px solid currentColor; border-right-color: transparent; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* hero */
.hero { text-align: center; padding: 40px 0 8px; }
.pill { display: inline-flex; align-items: center; gap: 8px; background: var(--accent-soft); color: var(--warn-fg); font-weight: 700; font-size: 14px;
  padding: 8px 16px; border-radius: 999px; margin-bottom: 22px; }
.pill i { width: 8px; height: 8px; border-radius: 50%; background: var(--brand); display: inline-block; }
.hero-title { font-size: clamp(36px, 8.4vw, 78px); font-weight: 900; line-height: 1.02; letter-spacing: -.035em; margin: 0 0 22px; }
.hero-title span { display: block; }
.hero-title .hl { display: inline-block; margin-top: 8px; padding: 0 .14em .04em; text-transform: uppercase;
  background: linear-gradient(transparent 58%, var(--accent-soft) 58%); border-bottom: .09em solid var(--accent); }
.hero-sub { font-size: clamp(17px, 2.6vw, 22px); color: var(--muted); margin: 0 auto 30px; max-width: 640px; line-height: 1.5; }
.hero-sub mark { background: var(--accent); color: #3b2f00; padding: 1px 10px; border-radius: 8px; font-weight: 800; box-shadow: 0 2px 0 rgba(0,0,0,.08); }
.lookup { display: flex; flex-direction: column; gap: 10px; max-width: 760px; margin: 0 auto 8px; }
.lookup input { width: 100%; font: inherit; font-size: 17px; padding: 16px 18px; border-radius: 14px; border: 1px solid var(--line); background: var(--card); color: var(--fg); box-shadow: var(--shadow); }
.lookup input:focus { outline: 3px solid color-mix(in srgb, var(--brand) 35%, transparent); border-color: var(--brand); }
.hint { color: var(--muted); font-size: 14px; margin: 8px 0; }
.notice { background: var(--warn-bg); color: var(--warn-fg); padding: 12px 14px; border-radius: 12px; margin: 14px auto; max-width: 760px; }
.cta-row { display: flex; gap: 10px; flex-wrap: wrap; margin: 16px 0; }
.hero .cta-row { justify-content: center; }

/* feature cards */
.features { display: grid; gap: 16px; margin: 44px 0 8px; }
.feature { background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); padding: 26px 22px; text-align: center; box-shadow: var(--shadow); }
.feature .ico { width: 58px; height: 58px; border-radius: 16px; background: var(--brand); color: #fff; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 14px; }
.feature .ico svg { width: 28px; height: 28px; }
.feature h3 { margin: 0 0 8px; font-size: 20px; letter-spacing: -.01em; }
.feature p { margin: 0; color: var(--muted); }

/* product grids */
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(165px, 1fr)); gap: 14px; }
.deal { display: flex; flex-direction: column; background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 12px;
  text-decoration: none; color: var(--fg); box-shadow: var(--shadow); transition: transform .12s ease; }
.deal:hover { transform: translateY(-2px); }
.deal img, .deal .noimg { width: 100%; aspect-ratio: 1; object-fit: contain; background: #fff; border-radius: 10px; }
.deal .noimg { display: flex; align-items: center; justify-content: center; background: var(--soft); aspect-ratio: 2; }
.deal .noimg::after { content: '🛒'; font-size: 28px; opacity: .5; }
.deal .t { font-size: 14px; margin: 8px 0 4px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.deal .p { font-weight: 900; font-size: 17px; }
.deal .was { color: var(--muted); font-size: 13px; }
.drop { color: var(--good); font-weight: 800; font-size: 13px; }
.store { display: inline-block; font-size: 12px; color: var(--muted); font-weight: 600; }

/* product page */
.panel { background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); padding: 20px; box-shadow: var(--shadow); margin: 0 0 16px; }
.panel h2 { margin-top: 0; }
.state { text-align: center; padding: 32px 20px; }
.state .cta-row { justify-content: center; }
.state .lookup { margin-top: 12px; }
.product { display: grid; gap: 18px; }
.product .pic { background: #fff; border-radius: 14px; border: 1px solid var(--line); display: flex; align-items: center; justify-content: center; padding: 10px; }
.product .pic img { max-height: 280px; object-fit: contain; }
.price { font-size: 38px; font-weight: 900; letter-spacing: -.02em; }
.mrp { color: var(--muted); text-decoration: line-through; margin-left: 10px; }
.off { color: var(--good); font-weight: 800; margin-left: 10px; }
.updated { color: var(--muted); font-size: 13.5px; }
.verdict { font-weight: 800; padding: 12px 14px; border-radius: 12px; border-left: 5px solid currentColor; background: var(--soft); margin: 14px 0; }
.v-lowest, .v-good { color: var(--good); } .v-high { color: var(--bad); } .v-normal { color: var(--amber); } .v-new { color: var(--muted); }
.warn { background: var(--warn-bg); color: var(--warn-fg); padding: 12px 14px; border-radius: 12px; margin: 10px 0; }
.chart svg { display: block; width: 100%; height: auto; }
.axis { display: flex; justify-content: space-between; color: var(--muted); font-size: 12px; margin-top: 6px; }
.stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin: 16px 0 0; }
.stats div { background: var(--soft); border-radius: 12px; padding: 12px; }
.stats dt { color: var(--muted); font-size: 13px; }
.stats dd { margin: 2px 0 0; font-weight: 900; font-size: 19px; }
.stats small { color: var(--muted); font-size: 12px; }
.share { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.chip { display: inline-flex; align-items: center; border-radius: 999px; padding: 9px 16px; font-weight: 800; font-size: 14px; text-decoration: none;
  border: 1.5px solid var(--line); background: var(--card); color: var(--fg); cursor: pointer; font-family: inherit; }
.chip.wa { border-color: #25d366; color: #128c4b; } .chip.tg { border-color: #2aabee; color: #1c7cb5; }
@media (prefers-color-scheme: dark) { .chip.wa { color: #4ade80; } .chip.tg { color: #7dd3fc; } }
.disclosure { color: var(--muted); font-size: 13px; margin: 8px 0 0; }
.crumbs { font-size: 14px; color: var(--muted); margin: 18px 0 10px; }
.crumbs a { color: var(--muted); }
code { font-size: .9em; background: var(--soft); padding: 1px 6px; border-radius: 6px; }

/* how it works */
.steps { display: grid; gap: 12px; padding: 0; list-style: none; counter-reset: s; }
.steps li { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 16px 16px 16px 58px; position: relative; box-shadow: var(--shadow); }
.steps li::before { counter-increment: s; content: counter(s); position: absolute; left: 16px; top: 16px; width: 28px; height: 28px; border-radius: 50%;
  background: var(--brand); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 14px; }
.empty { color: var(--muted); background: var(--card); border: 1px dashed var(--line); border-radius: 16px; padding: 20px; }

footer { border-top: 1px solid var(--line); color: var(--muted); font-size: 14px; padding: 22px 0 36px; }
footer a { color: var(--muted); margin-right: 14px; }
.prose { max-width: 720px; }

@media (max-width: 520px) {
  .logo small { display: none; }
  .top nav a:not(.btn) { display: none; }
  .top nav a.nav-keep { display: inline-flex; }
}
@media (min-width: 680px) {
  .lookup { flex-direction: row; }
  .lookup .btn { flex: none; }
  .features { grid-template-columns: repeat(3, 1fr); }
  .stats { grid-template-columns: repeat(4, 1fr); }
  .product { grid-template-columns: 280px 1fr; align-items: start; }
  .product.no-pic { grid-template-columns: 1fr; }
  h1 { font-size: 32px; }
  .hero { padding-top: 56px; }
}
`;

export const JS = `
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-copy]');
  if (!btn) return;
  try {
    await navigator.clipboard.writeText(btn.getAttribute('data-copy'));
    btn.textContent = btn.getAttribute('data-done') || 'Copied!';
  } catch (_) {
    window.prompt('Copy', btn.getAttribute('data-copy'));
  }
});
// Live price checks take a few seconds: show progress on the button.
function busy(el, text) {
  if (!el || el.classList.contains('is-loading')) return;
  el.classList.add('is-loading');
  if (text) el.lastChild ? (el.lastChild.textContent = ' ' + text) : (el.textContent = text);
}
document.addEventListener('submit', (e) => {
  const form = e.target.closest('form[data-loading]');
  if (form) busy(form.querySelector('button'), form.getAttribute('data-loading'));
});
document.addEventListener('click', (e) => {
  const link = e.target.closest('a[data-loading]');
  if (link) busy(link, link.getAttribute('data-loading'));
});
`;

export const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1a73e8"/><stop offset="1" stop-color="#0b8043"/></linearGradient></defs><rect x="4" y="4" width="120" height="120" rx="28" fill="url(#g)"/><path d="M24 40 H48 V58 H70 V74 H92 V90 H104" fill="none" stroke="#fff" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/><circle cx="104" cy="90" r="11" fill="#ffd54f" stroke="#fff" stroke-width="5"/></svg>`;
