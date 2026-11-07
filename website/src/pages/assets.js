// Static assets served by the Worker itself (no build step).

export const CSS = `
:root {
  --bg: #f5f6f8; --card: #ffffff; --fg: #1f2328; --muted: #5f6368; --line: #e3e6ea;
  --accent: #1a73e8; --accent-fg: #ffffff; --good: #0b8043; --bad: #c5221f; --amber: #b06000;
  --warn-bg: #fef7e0; --warn-fg: #7a4f01; --soft: #eef3fd; --shadow: 0 1px 3px rgba(0,0,0,.08);
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #121417; --card: #1c1f24; --fg: #e8eaed; --muted: #9aa0a6; --line: #30343a;
    --accent: #8ab4f8; --accent-fg: #0b1a33; --good: #81c995; --bad: #f28b82; --amber: #fdd663;
    --warn-bg: #3a2f10; --warn-fg: #fde293; --soft: #1d2a3f; --shadow: none;
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif; }
a { color: var(--accent); }
img { max-width: 100%; }
.wrap { max-width: 960px; margin: 0 auto; padding: 0 16px; }
.top { background: var(--card); border-bottom: 1px solid var(--line); }
.top .wrap { display: flex; align-items: center; gap: 16px; min-height: 56px; flex-wrap: wrap; }
.logo { display: flex; align-items: center; gap: 8px; font-weight: 800; font-size: 19px; color: var(--fg); text-decoration: none; }
.logo img { width: 28px; height: 28px; }
.top nav { display: flex; gap: 14px; margin-left: auto; font-size: 15px; }
.top nav a { color: var(--muted); text-decoration: none; }
.top nav a:hover { color: var(--accent); }
main { padding: 20px 0 40px; }
h1 { font-size: 26px; line-height: 1.25; margin: 0 0 8px; }
h2 { font-size: 20px; margin: 28px 0 12px; }
.lead { color: var(--muted); margin: 0 0 16px; font-size: 17px; }
.hero { padding: 24px 0 8px; }
.lookup { display: flex; flex-direction: column; gap: 10px; margin: 8px 0 6px; }
.lookup input { width: 100%; font: inherit; padding: 13px 14px; border-radius: 10px; border: 1px solid var(--line); background: var(--card); color: var(--fg); }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; font: inherit; font-weight: 700; padding: 12px 18px;
       border-radius: 10px; border: 1px solid var(--line); background: var(--card); color: var(--fg); text-decoration: none; cursor: pointer; }
.btn-primary { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }
.btn-buy { background: #fb641b; border-color: #fb641b; color: #fff; }
.hint { color: var(--muted); font-size: 14px; margin: 4px 0; }
.notice { background: var(--warn-bg); color: var(--warn-fg); padding: 10px 12px; border-radius: 8px; margin: 12px 0; }
.cta-row { display: flex; gap: 10px; flex-wrap: wrap; margin: 14px 0; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; }
.deal { display: flex; flex-direction: column; background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 10px;
        text-decoration: none; color: var(--fg); box-shadow: var(--shadow); }
.deal img, .deal .noimg { width: 100%; aspect-ratio: 1; object-fit: contain; background: #fff; border-radius: 8px; }
.deal .noimg { display: flex; align-items: center; justify-content: center; background: var(--bg); aspect-ratio: 2; }
.deal .noimg::after { content: '🛒'; font-size: 28px; opacity: .5; }
.deal .t { font-size: 14px; margin: 8px 0 4px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.deal .p { font-weight: 800; }
.deal .was { color: var(--muted); font-size: 13px; }
.drop { color: var(--good); font-weight: 700; font-size: 13px; }
.store { display: inline-block; font-size: 12px; color: var(--muted); }
.panel { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 16px; box-shadow: var(--shadow); margin: 0 0 16px; }
.product { display: grid; gap: 16px; }
.product .pic { background: #fff; border-radius: 12px; border: 1px solid var(--line); display: flex; align-items: center; justify-content: center; padding: 8px; }
.product .pic img { max-height: 260px; object-fit: contain; }
.price { font-size: 32px; font-weight: 800; }
.mrp { color: var(--muted); text-decoration: line-through; margin-left: 8px; }
.off { color: var(--good); font-weight: 700; margin-left: 8px; }
.updated { color: var(--muted); font-size: 13px; }
.verdict { font-weight: 700; padding: 10px 12px; border-radius: 8px; border-left: 4px solid currentColor; background: var(--soft); margin: 12px 0; }
.v-lowest, .v-good { color: var(--good); } .v-high { color: var(--bad); } .v-normal { color: var(--amber); } .v-new { color: var(--muted); }
.warn { background: var(--warn-bg); color: var(--warn-fg); padding: 10px 12px; border-radius: 8px; margin: 10px 0; }
.chart svg { display: block; width: 100%; height: auto; }
.axis { display: flex; justify-content: space-between; color: var(--muted); font-size: 12px; margin-top: 4px; }
.stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin: 14px 0 0; }
.stats div { background: var(--bg); border-radius: 10px; padding: 10px; }
.stats dt { color: var(--muted); font-size: 13px; }
.stats dd { margin: 2px 0 0; font-weight: 800; font-size: 18px; }
.stats small { color: var(--muted); font-size: 12px; }
.share { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.chip { display: inline-flex; align-items: center; border-radius: 999px; padding: 8px 14px; font-weight: 700; font-size: 14px; text-decoration: none;
        border: 1px solid var(--line); background: var(--card); color: var(--fg); cursor: pointer; font-family: inherit; }
.chip.wa { border-color: #25d366; color: #128c4b; } .chip.tg { border-color: #2aabee; color: #1c7cb5; }
@media (prefers-color-scheme: dark) { .chip.wa { color: #4ade80; } .chip.tg { color: #7dd3fc; } }
.disclosure { color: var(--muted); font-size: 13px; margin: 8px 0 0; }
.steps { display: grid; gap: 12px; padding: 0; list-style: none; counter-reset: s; }
.steps li { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px 14px 14px 52px; position: relative; }
.steps li::before { counter-increment: s; content: counter(s); position: absolute; left: 14px; top: 14px; width: 26px; height: 26px; border-radius: 50%;
                    background: var(--accent); color: var(--accent-fg); display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 14px; }
.empty { color: var(--muted); background: var(--card); border: 1px dashed var(--line); border-radius: 12px; padding: 18px; }
.crumbs { font-size: 14px; color: var(--muted); margin-bottom: 8px; }
.crumbs a { color: var(--muted); }
footer { border-top: 1px solid var(--line); color: var(--muted); font-size: 14px; padding: 20px 0 32px; }
footer a { color: var(--muted); margin-right: 14px; }
.prose { max-width: 720px; }
@media (min-width: 640px) {
  .lookup { flex-direction: row; }
  .lookup .btn { flex: none; }
  .stats { grid-template-columns: repeat(4, 1fr); }
  .product { grid-template-columns: 260px 1fr; align-items: start; }
  .product.no-pic { grid-template-columns: 1fr; }
  h1 { font-size: 30px; }
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
`;

export const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1a73e8"/><stop offset="1" stop-color="#0b8043"/></linearGradient></defs><rect x="4" y="4" width="120" height="120" rx="28" fill="url(#g)"/><path d="M24 40 H48 V58 H70 V74 H92 V90 H104" fill="none" stroke="#fff" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/><circle cx="104" cy="90" r="11" fill="#ffd54f" stroke="#fff" stroke-width="5"/></svg>`;
