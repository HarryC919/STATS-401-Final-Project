/* Optional browser QA/export tool: NODE_PATH points to a temporary Playwright install. */
const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const url = process.env.SITE_URL || 'http://127.0.0.1:8765/';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    await page.goto(url);
    await page.waitForFunction(() => document.querySelector('#load-status').textContent.startsWith('Verified'));
    assert.equal(await page.locator('.kpi').count(), 4);
    assert.match(await page.locator('#kpis').innerText(), /7,001,619/);
    const assets = path.join(root, 'docs/assets/interim');
    await fs.mkdir(assets, {recursive: true});
    const specs = [
      ['monthly', 'monthlyChart', 'circle', 24],
      ['airline', 'airlineChart', '.bar', 14],
      ['airport', 'airportChart', '.bar', 15],
      ['route', 'routeChart', '.bar', 15],
      ['cause', 'causeChart', '.pie-legend rect', 5],
      ['network', 'networkMap', '.map-route', 220],
    ];
    const charts = [];
    for (const [name, id, selector, count] of specs) {
      await page.locator(`[data-tab="tab-${name}"]`).click();
      await page.waitForFunction(() => document.querySelector('#load-status').textContent.startsWith('Verified'));
      const svg = page.locator(`#${id}`);
      assert.equal(await svg.locator(selector).count(), count, `${name}: mark count`);
      const malformed = await svg.evaluate(el => [...el.querySelectorAll('*')].filter(node =>
        ['d','cx','cy','width','height','transform'].some(attr => /NaN|Infinity/.test(node.getAttribute(attr) || ''))).length);
      assert.equal(malformed, 0, `${name}: invalid SVG geometry`);
      if (name === 'airline') {
        assert.match(await svg.textContent(), /National avg 22\.3%/);
        const metrics = await page.evaluate(async () => {
          const { nationalRate, hasNumber, causeTotals } = await import('./js/metrics.js');
          return { rate: nationalRate({delayed_arrivals:14, eligible_arrivals:100}),
            empty: nationalRate({delayed_arrivals:0, eligible_arrivals:0}),
            missing: hasNumber(null), zero: hasNumber(0),
            causes: causeTotals([{X_minutes:null, X_observations:0}], [{key:'X_minutes',label:'X'}]) };
        });
        assert.deepEqual(metrics, {rate:.14, empty:null, missing:false, zero:true, causes:[{label:'X',value:null}]});
      }
      if (name !== 'network') {
        const mark = name === 'cause' ? svg.locator('path').first() : svg.locator(name === 'monthly' ? 'circle' : '.bar').first();
        await mark.hover();
        await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('#tooltip')).opacity) > 0);
        assert.ok((await page.locator('#tooltip').innerText()).length > 5);
        await page.mouse.move(0, 0);
      }
      await page.locator(`#tab-${name} section`).screenshot({path:path.join(assets, `${name}.png`)});
      charts.push({chart:name, marks:count, screenshot:`docs/assets/interim/${name}.png`});
    }
    const mapCoverage = await page.locator('#network-status').innerText();
    await page.setViewportSize({width:390,height:844});
    await page.locator('[data-tab="tab-monthly"]').click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile page overflow');
    await page.screenshot({path:'/tmp/stats401-mobile.png', fullPage:true});
    await page.locator('[data-tab="tab-airline"]').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('[data-tab="tab-airline"]').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(errors, []);
    // Exercise failed initial fetch and a retryable map fetch in separate pages.
    const failed = await browser.newPage();
    await failed.route('**/data/monthly.csv', route => route.abort());
    await failed.goto(url);
    await failed.locator('#load-status[role="alert"]').waitFor();
    assert.match(await failed.locator('#load-status').innerText(), /Data could not load/);
    await failed.close();
    const retry = await browser.newPage();
    await retry.route('**/data/city_routes.csv', route => route.abort());
    await retry.goto(url);
    await retry.waitForFunction(() => document.querySelector('#load-status').textContent.startsWith('Verified'));
    await retry.locator('[data-tab="tab-network"]').click();
    await retry.waitForFunction(() => document.querySelector('#load-status').textContent.startsWith('Chart could not load'));
    await retry.unroute('**/data/city_routes.csv');
    await retry.locator('[data-tab="tab-network"]').click();
    await retry.waitForFunction(() => document.querySelectorAll('.map-route').length === 220);
    await retry.close();
    const inputs = ['site/index.html','site/css/style.css','site/js/app.js','site/js/charts.js','site/js/metrics.js','site/data/manifest.json'];
    const hashes = {};
    for (const file of inputs) hashes[file] = createHash('sha256').update(await fs.readFile(path.join(root,file))).digest('hex');
    const result = { browser:await browser.version(), checks:'passed', charts, mapCoverage,
      desktopViewport:[1440,1100], mobileViewport:[390,844],
      checked:['data loading','six rendered charts','national baseline','missing values','tooltips','tab switching','keyboard activation','mobile page overflow','initial load failure','map retry'],
      limitations:'Automated checks and visual inspection are not a user study or an interaction-performance evaluation.',
      source_sha256:hashes };
    await fs.writeFile(path.join(root,'reports/site_validation.json'),JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify(result,null,2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
