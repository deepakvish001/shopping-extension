/*
 * Render assets/icon.svg to the PNG sizes Chrome needs (extension/icons/).
 * Dev-only: needs Playwright with Chromium (`npx playwright install chromium`).
 * Usage: node scripts/make-icons.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const svg = fs.readFileSync(path.join(__dirname, '..', 'assets', 'icon.svg'), 'utf8');
  const outDir = path.join(__dirname, '..', 'extension', 'icons');
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const size of [16, 32, 48, 128]) {
      const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
      await page.setContent(
        `<html><body style="margin:0;background:transparent">${svg.replace('width="128" height="128"', `width="${size}" height="${size}"`)}</body></html>`
      );
      await page.locator('svg').screenshot({ path: path.join(outDir, `icon${size}.png`), omitBackground: true });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  console.log('Icons written to', outDir);
})();
