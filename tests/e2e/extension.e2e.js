/*
 * End-to-end check: loads the unpacked extension in Chromium and serves the
 * HTML fixtures on the real shop URLs (no network needed), then checks the
 * panel, tracking, popup, background re-check, alerts and outbound links.
 *
 * Needs Playwright + Chromium:  npm i -D playwright && npx playwright install chromium
 * Run:                          npm run test:e2e
 * Set SCREENSHOT_DIR=<dir> to save screenshots of the panel and popup.
 */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EXT = path.resolve(__dirname, '..', '..', 'extension');
const fixture = (name) => fs.readFileSync(path.join(__dirname, '..', 'fixtures', name), 'utf8');
const shots = process.env.SCREENSHOT_DIR;

const AMAZON_URL = 'https://www.amazon.in/boAt-Rockerz/dp/B0TEST1234?ref=sr_1_1';
const FLIPKART_URL = 'https://www.flipkart.com/samsung-galaxy-m35/p/itm123abc?pid=MOBGZ12345';
const MYNTRA_URL = 'https://www.myntra.com/tshirts/roadster/x/1234567/buy';

async function step(name, fn) {
  process.stdout.write(`- ${name} ... `);
  await fn();
  console.log('ok');
}

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-e2e-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });

  const pages = { amazon: fixture('amazon.html'), flipkart: fixture('flipkart.html'), myntra: fixture('myntra.html') };
  const serve = (key) => (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: pages[key] });
  // Routes run newest-first: block everything else (images, trackers) first.
  await context.route(/.*/, (route) => (route.request().url().startsWith('chrome-extension://') ? route.continue() : route.abort()));
  await context.route('https://network.example/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>affiliate redirect</p>' }));
  await context.route('https://www.amazon.in/**', serve('amazon'));
  await context.route('https://www.flipkart.com/**', serve('flipkart'));
  await context.route('https://www.myntra.com/**', serve('myntra'));

  let failed = false;
  try {
    const sw = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
    const extId = new URL(sw.url()).host;
    const storage = (key) => sw.evaluate((k) => chrome.storage.local.get(k).then((r) => r[k]), key);

    const page = await context.newPage();
    const panel = page.locator('#pt-price-panel-host .card');

    await step('Amazon: panel shows the price and MRP discount', async () => {
      await page.goto(AMAZON_URL);
      await panel.waitFor({ timeout: 15000 });
      const text = await panel.innerText();
      assert.match(text, /₹1,299/);
      assert.match(text, /67% off MRP/);
      assert.match(text, /Abhi data kam hai/);
      const rec = await storage('p:amazon:B0TEST1234');
      assert.equal(rec.history.length, 1);
      assert.equal(rec.title, 'boAt Rockerz 450 Bluetooth On Ear Headphones');
    });

    await step('Amazon: track with a target price', async () => {
      await panel.locator('input').fill('1,100');
      await panel.getByRole('button', { name: 'Price track karo' }).click();
      await panel.getByText('Track ho raha hai').waitFor();
      const rec = await storage('p:amazon:B0TEST1234');
      assert.deepEqual([rec.track.priceAtAdd, rec.track.targetPrice], [1299, 1100]);
    });

    await step('background check: fetch, parse offscreen, alert on target', async () => {
      // Seed older history so the panel has a chart afterwards.
      await sw.evaluate(async () => {
        const k = 'p:amazon:B0TEST1234';
        const rec = (await chrome.storage.local.get(k))[k];
        const day = 864e5;
        rec.history = [[Date.now() - 20 * day, 1499], [Date.now() - 12 * day, 1399], ...rec.history];
        await chrome.storage.local.set({ [k]: rec });
        self.__notified = [];
        const create = chrome.notifications.create.bind(chrome.notifications);
        chrome.notifications.create = (id, opts) => {
          self.__notified.push({ id, opts });
          return create(id, opts);
        };
      });
      pages.amazon = fixture('amazon.html').replaceAll('₹1,299.00', '₹1,049.00');
      const results = await sw.evaluate(() => checkAll());
      assert.deepEqual(results.map((r) => [r.key, r.ok, r.price, r.alerted]), [['amazon:B0TEST1234', true, 1049, true]]);
      const notified = await sw.evaluate(() => self.__notified);
      assert.equal(notified.length, 1);
      assert.match(notified[0].opts.message, /₹1,049/);
      const rec = await storage('p:amazon:B0TEST1234');
      assert.equal(rec.track.lastNotifiedPrice, 1049);
      const again = await sw.evaluate(() => checkAll());
      assert.equal(again[0].alerted, false, 'same price is not announced twice');
    });

    await step('Amazon: panel verdict and chart after the drop', async () => {
      await page.reload();
      await panel.getByText('Ab tak ka sabse kam daam!').waitFor({ timeout: 15000 });
      assert.equal(await panel.locator('svg path').count(), 2);
      if (shots) await page.locator('#pt-price-panel-host').screenshot({ path: path.join(shots, 'panel-amazon.png') });
    });

    await step('Amazon: opening from an alert never adds an affiliate tag', async () => {
      await sw.evaluate(() =>
        chrome.storage.local.set({ settings: { affiliate: { enabled: true, templates: { flipkart: 'https://network.example/r?url={url}', myntra: '' } } } })
      );
      const out = await sw.evaluate(() => openProduct('amazon:B0TEST1234', { fromAlert: true }));
      assert.deepEqual(out, { href: 'https://www.amazon.in/dp/B0TEST1234', affiliate: false, reason: 'store-excluded' });
    });

    await step('Flipkart: panel, track, deal opens via the affiliate template', async () => {
      await page.goto(FLIPKART_URL);
      await panel.locator('.price', { hasText: '₹13,999' }).waitFor({ timeout: 15000 });
      await panel.getByRole('button', { name: 'Price track karo' }).click();
      await panel.getByText('Track ho raha hai').waitFor();
      const notDeal = await sw.evaluate(() => openProduct('flipkart:MOBGZ12345'));
      assert.equal(notDeal.reason, 'no-direct-benefit', 'no price drop yet, so no affiliate link');
      pages.flipkart = fixture('flipkart.html').replace('"price":13999', '"price":12499');
      await sw.evaluate(() => checkAll());
      const deal = await sw.evaluate(() => openProduct('flipkart:MOBGZ12345'));
      assert.equal(deal.affiliate, true);
      assert.equal(deal.href, 'https://network.example/r?url=' + encodeURIComponent(FLIPKART_URL));
    });

    await step('Myntra: reads the page, then follows in-app navigation', async () => {
      await page.goto(MYNTRA_URL);
      await panel.locator('.price', { hasText: '₹449' }).waitFor({ timeout: 15000 });
      await page.evaluate(() => {
        document.querySelector('.pdp-title').textContent = 'HRX by Hrithik Roshan';
        document.querySelector('.pdp-name').textContent = 'Men Running Shorts';
        document.querySelector('.pdp-price strong').textContent = '₹699';
        document.querySelector('.pdp-mrp s').textContent = '₹1,399';
        history.pushState({}, '', '/shorts/hrx/y/7654321/buy');
      });
      await panel.locator('.price', { hasText: '₹699' }).waitFor({ timeout: 15000 });
      const rec = await storage('p:myntra:7654321');
      assert.equal(rec.title, 'HRX by Hrithik Roshan Men Running Shorts');
      assert.deepEqual(rec.history.map((p) => p[1]), [699]);
    });

    await step('popup lists tracked products with their change', async () => {
      const popup = await context.newPage();
      await popup.setViewportSize({ width: 360, height: 420 });
      await popup.goto(`chrome-extension://${extId}/src/popup/popup.html`);
      await popup.locator('.item').first().waitFor();
      assert.equal(await popup.locator('.item').count(), 2);
      const text = await popup.locator('#list').innerText();
      assert.match(text, /boAt Rockerz 450/);
      assert.match(text, /▼ 19%/);
      assert.match(text, /▼ 11%/);
      assert.match(await popup.locator('footer').innerText(), /Affiliate disclosure/);
      if (shots) await popup.screenshot({ path: path.join(shots, 'popup.png') });
      await popup.close();
    });

    await step('options page rejects a non-https template and saves language', async () => {
      const opt = await context.newPage();
      await opt.goto(`chrome-extension://${extId}/src/options/options.html`);
      await opt.locator('input[name="tplMyntra"]').fill('http://insecure.example/?u={url}');
      await opt.getByRole('button', { name: 'Save' }).click();
      await opt.getByText(/myntra template must be an https/).waitFor();
      await opt.locator('input[name="tplMyntra"]').fill('');
      await opt.locator('select[name="lang"]').selectOption('en');
      await opt.getByRole('button', { name: 'Save' }).click();
      await opt.getByText('Saved.').waitFor();
      const settings = await storage('settings');
      assert.equal(settings.lang, 'en');
      assert.equal(settings.affiliate.templates.flipkart, 'https://network.example/r?url={url}', 'other settings kept');
      await opt.close();
      // The open shop tab switches language live.
      await panel.getByRole('button', { name: 'Track price' }).waitFor({ timeout: 15000 });
    });

    console.log('\nAll e2e checks passed.');
  } catch (err) {
    failed = true;
    console.log('FAILED');
    console.error(err);
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
  process.exit(failed ? 1 : 0);
})();
