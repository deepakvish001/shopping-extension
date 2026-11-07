/* Options page: settings, data export and reset. */
(() => {
  'use strict';
  const form = document.getElementById('form');
  const saved = document.getElementById('saved');
  // Look fields up by name explicitly: some names (e.g. "lang") are also form properties.
  const field = (name) => form.elements.namedItem(name);
  document.getElementById('app-name').textContent = chrome.i18n.getMessage('appShortName') || 'DaamDekho';

  async function load() {
    const { settings } = await chrome.storage.local.get('settings');
    const s = PTSettings.normalize(settings);
    field('lang').value = s.lang;
    field('showPanel').checked = s.showPanel;
    field('notifications').checked = s.notifications;
    field('checkIntervalHours').value = String(s.checkIntervalHours);
    field('dropThresholdPct').value = String(s.dropThresholdPct);
    field('affiliateEnabled').checked = s.affiliate.enabled;
    field('tplFlipkart').value = s.affiliate.templates.flipkart;
    field('tplMyntra').value = s.affiliate.templates.myntra;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const templates = { flipkart: field('tplFlipkart').value.trim(), myntra: field('tplMyntra').value.trim() };
    for (const [store, tpl] of Object.entries(templates)) {
      if (tpl && !PTAffiliate.isValidTemplate(tpl)) {
        saved.textContent = `The ${store} template must be an https:// link containing {url}.`;
        return;
      }
    }
    const { settings: current } = await chrome.storage.local.get('settings');
    const next = PTSettings.normalize({
      ...PTSettings.normalize(current),
      lang: field('lang').value,
      showPanel: field('showPanel').checked,
      notifications: field('notifications').checked,
      checkIntervalHours: Number(field('checkIntervalHours').value),
      dropThresholdPct: Number(field('dropThresholdPct').value),
      affiliate: { enabled: field('affiliateEnabled').checked, templates },
    });
    await chrome.storage.local.set({ settings: next });
    saved.textContent = 'Saved.';
    setTimeout(() => (saved.textContent = ''), 2500);
  });

  document.getElementById('export').addEventListener('click', async () => {
    const data = await chrome.storage.local.get(null);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `price-history-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  document.getElementById('clear').addEventListener('click', async () => {
    if (!confirm('Delete all price history, tracked products and settings from this browser?')) return;
    await chrome.storage.local.clear();
    await load();
    saved.textContent = 'All data deleted.';
  });

  load();
})();
