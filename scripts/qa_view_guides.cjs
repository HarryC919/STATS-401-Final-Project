/* Browser regression for view guides and airline reference-label placement.
   Serve the site, then run with NODE_PATH, CHROME_PATH, and SITE_URL as in README.
   Outputs are separate from historical interim and batch evidence. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const url = process.env.SITE_URL || 'http://127.0.0.1:8765/';

async function settled(page) {
  await page.waitForFunction(() => /^(Verified|Filters applied|Airport .* selected)/
    .test(document.querySelector('#load-status').textContent));
}

async function checkReference(page) {
  const geometry = await page.locator('#airlineChart').evaluate(svg => {
    const note = [...svg.querySelectorAll('text')].find(el => el.textContent.startsWith('National avg'));
    const box = el => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    };
    const reference = box(note);
    const bars = [...svg.querySelectorAll('.bar')].map(box);
    return { reference, svg: box(svg), overlapCount: bars.filter(bar =>
      reference.left < bar.right && reference.right > bar.left
      && reference.top < bar.bottom && reference.bottom > bar.top).length,
    firstBarTop: Math.min(...bars.map(bar => bar.top)) };
  });
  assert.equal(geometry.overlapCount, 0, 'national reference text must not overlap any airline bar');
  assert.ok(geometry.reference.bottom < geometry.firstBarTop, 'reference occupies a separate band above all bars');
  assert.ok(geometry.reference.left >= geometry.svg.left && geometry.reference.right <= geometry.svg.right,
    'reference text remains within the SVG bounds');
  return geometry;
}

(async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const assets = path.join(root, 'docs/assets/view-guides');
    await fs.mkdir(assets, { recursive: true });
    await page.goto(url);
    await settled(page);
    await page.locator('[data-tab="tab-airline"]').click();
    await settled(page);
    const geometry = [{ scope: 'annual, all airlines', viewport: 1440, ...await checkReference(page) }];
    const tabs = await page.locator('.tab-btn').evaluateAll(buttons => buttons.map(button => button.dataset.tab));
    const guides = [];
    for (const tab of tabs) {
      await page.locator(`[data-tab="${tab}"]`).click();
      await settled(page);
      const panel = page.locator(`#${tab}`);
      const guide = panel.locator('details.chart-guide');
      assert.equal(await guide.count(), 1, `${tab}: an expandable guide is reachable`);
      const summary = guide.locator('summary');
      await summary.focus();
      await summary.press('Enter');
      assert.notEqual(await guide.getAttribute('open'), null, `${tab}: keyboard opens the guide`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${tab}: no page overflow`);
      await panel.screenshot({ path: path.join(assets, `${tab.slice(4)}.png`) });
      await summary.press('Enter');
      assert.equal(await guide.getAttribute('open'), null, `${tab}: keyboard closes the guide`);
      guides.push({ tab, keyboardOpenClose: 'passed', screenshot: `docs/assets/view-guides/${tab.slice(4)}.png` });
    }
    await page.locator('[data-tab="tab-airline"]').click();
    await page.locator('#month-end').selectOption('3');
    await page.locator('#airline-select').selectOption('UA');
    await settled(page);
    geometry.push({ scope: 'January–March, UA highlighted', viewport: 1440, ...await checkReference(page) });
    await page.setViewportSize({ width: 390, height: 844 });
    for (const tab of tabs) {
      await page.locator(`[data-tab="${tab}"]`).click();
      await settled(page);
      const guide = page.locator(`#${tab} details.chart-guide`);
      await guide.locator('summary').click();
      assert.notEqual(await guide.getAttribute('open'), null);
      const bounds = await guide.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390, `${tab}: guide stays within narrow-screen bounds`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${tab}: no narrow-screen page overflow`);
      if (tab === 'tab-airline') {
        geometry.push({ scope: 'January–March, UA highlighted', viewport: 390, ...await checkReference(page) });
        await page.screenshot({ path: path.join(assets, 'airline-mobile.png'), fullPage: true });
      }
      await guide.locator('summary').click();
    }
    assert.deepEqual(errors, []);
    const hashes = {};
    for (const name of ['site/index.html', 'site/css/style.css', 'site/js/charts.js', 'site/js/app.js',
      'site/js/aggregate.js', 'site/js/metrics.js', 'site/js/state.js', 'site/js/data.js', 'site/data/manifest.json']) {
      hashes[name] = createHash('sha256').update(await fs.readFile(path.join(root, name))).digest('hex');
    }
    const result = { checks: 'passed', browser: browser.version(), guides,
      airlineReferenceGeometry: geometry,
      checked: ['all ten view guides open and close with the keyboard', 'guide bounds and page overflow at 1440px and 390px',
        'airline national reference does not overlap bars and remains inside the SVG in annual and filtered scopes'],
      notChecked: ['performance timing', 'participant study', 'live deployment'], source_sha256: hashes };
    await fs.writeFile(path.join(root, 'reports/site_validation_view_guides.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ checks: result.checks, guides: guides.length, geometryChecks: geometry.length }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
