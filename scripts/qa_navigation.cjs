/* Validate map-first navigation, stable airport selection, and readable code labels.
   Use NODE_PATH, CHROME_PATH, and SITE_URL as documented in README. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
async function settled(page) {
  await page.waitForFunction(() => /^(Verified|Filters applied|Airport .* selected)/.test(document.querySelector('#load-status').textContent));
}
(async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.SITE_URL || 'http://127.0.0.1:8765/');
    await settled(page);
    assert.equal(await page.locator('.tab-btn').first().getAttribute('data-tab'), 'tab-network');
    assert.equal(await page.locator('.tab-panel.active').getAttribute('id'), 'tab-network');
    assert.ok(await page.locator('#networkMap .map-node').count() > 0);
    const tabs = await page.locator('.tab-btn').evaluateAll(buttons => buttons.map(b => b.dataset.tab));
    const cases = [];
    for (const [i, tab] of tabs.entries()) {
      await page.locator(`[data-tab="${tab}"]`).click(); await settled(page);
      const code = i % 2 ? 'MDW' : 'ORD';
      await page.locator('#airport-search').fill(code); await page.locator('#airport-search').press('Tab');
      await settled(page);
      assert.equal(await page.locator('.tab-panel.active').getAttribute('id'), tab, `${tab}: selection stays on the current view`);
      assert.match(await page.locator('#airport-search').inputValue(), new RegExp(`^${code} — .+`));
      assert.ok((await page.locator('#kpis').innerText()).includes('7,001,619'));
      if (tab === 'tab-network') assert.equal(await page.locator('#networkMap .map-airport-selected').count(), 1);
      if (tab === 'tab-detail') assert.ok((await page.locator('#detail-sub').innerText()).startsWith(code));
      cases.push(tab);
    }
    await page.locator('[data-tab="tab-airline"]').click(); await settled(page);
    assert.match(await page.locator('#airline-select option[value="UA"]').innerText(), /^UA — United Air Lines Inc\./);
    const ua = await page.locator('#airlineChart .bar').evaluateAll(bars => bars.findIndex(b => b.__data__.Reporting_Airline === 'UA'));
    await page.locator('#airlineChart .bar').nth(ua).hover();
    assert.match(await page.locator('#tooltip').innerText(), /UA — United Air Lines Inc\./);
    await page.locator('[data-tab="tab-airport"]').click(); await settled(page);
    const ord = await page.locator('#airportChart .bar').evaluateAll(bars => bars.findIndex(b => b.__data__.Origin === 'ORD'));
    await page.locator('#airportChart .bar').nth(ord).hover();
    assert.match(await page.locator('#tooltip').innerText(), /ORD — Chicago O'Hare International/);
    await page.locator('#airportChart .bar').nth(ord).click(); await settled(page);
    assert.equal(await page.locator('.tab-panel.active').getAttribute('id'), 'tab-airport');
    await page.locator('#filter-reset').click(); await settled(page);
    assert.equal(await page.locator('.tab-panel.active').getAttribute('id'), 'tab-network');
    assert.equal(await page.locator('#airport-search').inputValue(), '');
    const assets = path.join(root, 'docs/assets/navigation'); await fs.mkdir(assets, { recursive: true });
    await page.locator('#tab-network').screenshot({ path: path.join(assets, 'map-home.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#airport-search').fill('ORD'); await page.locator('#airport-search').press('Tab'); await settled(page);
    await page.locator('#airline-select').selectOption('UA'); await settled(page);
    assert.equal(await page.locator('.tab-panel.active').getAttribute('id'), 'tab-network');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(assets, 'map-mobile.png'), fullPage: true });
    assert.deepEqual(errors, []);
    const hashes = {};
    for (const file of ['site/index.html','site/css/style.css','site/js/app.js','site/js/charts.js','site/js/names.js','site/data/airline_names.json','site/data/manifest.json']) {
      hashes[file] = createHash('sha256').update(await fs.readFile(path.join(root,file))).digest('hex');
    }
    await fs.writeFile(path.join(root,'reports/site_validation_navigation.json'), JSON.stringify({ checks:'passed', browser:browser.version(),
      airportSelectionPreservesView:cases, checked:['map is the first/default/reset view','airport control and bar selections do not navigate','airport and airline names appear in controls and tooltips','390px layout'],
      notChecked:['performance timing','participant study','live deployment'], source_sha256:hashes },null,2)+'\n');
    console.log(JSON.stringify({ checks:'passed', views:cases.length }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
