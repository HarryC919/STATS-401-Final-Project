/* Reconcile rendered map route colors with pooled counts and the shared legend.
   Use NODE_PATH, CHROME_PATH, and SITE_URL as documented in README. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const url = process.env.SITE_URL || 'http://127.0.0.1:8765/';
async function settled(page) {
  await page.waitForFunction(() => /^(Verified|Filters applied|Airport .* selected)/.test(document.querySelector('#load-status').textContent));
}
async function verifyRoutes(page, selector) {
  const result = await page.evaluate(async selector => {
    const [cities, national] = await Promise.all([d3.csv('data/city_summary.csv', d3.autoType), d3.csv('data/national.csv', d3.autoType)]);
    const projection = d3.geoAlbersUsa().translate([1100 * .37, 650 * .51]).scale(950);
    const values = cities.filter(row => projection([row.longitude, row.latitude]) && row.scheduled_flights >= 10000
      && row.arrival_delay_rate != null).map(row => row.arrival_delay_rate).sort(d3.ascending);
    const low = d3.quantile(values, .05), high = d3.quantile(values, .95);
    const reference = national[0].delayed_arrivals / national[0].eligible_arrivals;
    const color = d3.scaleLinear().domain([low, reference, high])
      .range(['#2166ac', '#8064a2', '#d7191c']).interpolate(d3.interpolateLab).clamp(true);
    const background = d3.color(getComputedStyle(document.querySelector('.map-state')).fill);
    const luminance = rgb => [.2126, .7152, .0722].reduce((sum, weight, i) => {
      const channel = rgb[i] / 255;
      return sum + weight * (channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
    }, 0);
    const backgroundLuminance = luminance([background.r, background.g, background.b]);
    const rows = [...document.querySelectorAll(selector)].map(mark => {
      const row = mark.__data__;
      const rate = row.eligible_arrivals > 0 && row.delayed_arrivals != null ? row.delayed_arrivals / row.eligible_arrivals : null;
      const style = getComputedStyle(mark), stroke = d3.color(style.stroke);
      const alpha = Number(style.strokeOpacity) * Number(style.opacity);
      const composite = ['r', 'g', 'b'].map(channel => stroke[channel] * alpha + background[channel] * (1 - alpha));
      const lineLuminance = luminance(composite);
      return { label: row.Dest || `${row.city_a} ↔ ${row.city_b}`, rate,
        actual: style.stroke, expected: d3.color(rate == null ? '#777' : color(rate)).formatRgb(),
        contrast: (Math.max(backgroundLuminance, lineLuminance) + .05) / (Math.min(backgroundLuminance, lineLuminance) + .05),
        dashed: getComputedStyle(mark).strokeDasharray !== 'none', width: Number(mark.getAttribute('stroke-width')) };
    });
    return { rows, domain: [low, reference, high] };
  }, selector);
  assert.ok(result.rows.length > 0);
  for (const row of result.rows) {
    assert.equal(row.actual, row.expected, `${selector} ${row.label}: rendered stroke matches its pooled delay rate`);
    assert.equal(row.dashed, row.rate == null, `${row.label}: missing rates are distinguishable`);
    assert.ok(row.width > 0);
  }
  assert.ok(new Set(result.rows.filter(row => row.rate != null).map(row => row.actual)).size > 1,
    `${selector}: observed rates produce different route colors`);
  return result;
}
(async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    await page.goto(url); await settled(page);
    const city = await verifyRoutes(page, '#networkMap .map-route');
    await page.locator('#airport-search').fill('ORD'); await page.locator('#airport-search').press('Tab'); await settled(page);
    const airport = await verifyRoutes(page, '#networkMap .map-outgoing');
    await page.locator('#month-end').selectOption('3'); await page.locator('#airline-select').selectOption('UA'); await settled(page);
    const fixed = await verifyRoutes(page, '#networkMap .map-outgoing');
    assert.deepEqual(fixed.rows, airport.rows, 'map route colors retain their stated full-year, all-airline scope');
    const assets = path.join(root, 'docs/assets/map-colors'); await fs.mkdir(assets, { recursive: true });
    await page.locator('#tab-network').screenshot({ path: path.join(assets, 'ord-routes.png') });
    // Alter only browser-served data to distinguish observed zero from missing.
    const fixture = await browser.newPage();
    await fixture.route('**/data/routes/ORD.csv', async route => {
      const source = await fs.readFile(path.join(root, 'site/data/routes/ORD.csv'), 'utf8');
      const lines = source.trimEnd().split('\n'); const header = lines[0].split(',');
      const dest = header.indexOf('Dest'); const eligible = header.indexOf('eligible_arrivals');
      const delayed = header.indexOf('delayed_arrivals');
      const body = lines.map((line, i) => {
        if (!i) return line;
        const cells = line.split(',');
        if (cells[dest] === 'LGA') { cells[eligible] = '0'; cells[delayed] = '0'; }
        if (cells[dest] === 'LAX') cells[delayed] = '0';
        return cells.join(',');
      }).join('\n') + '\n';
      await route.fulfill({ status: 200, contentType: 'text/csv', body });
    });
    await fixture.goto(url); await settled(fixture);
    await fixture.locator('#airport-search').fill('ORD'); await fixture.locator('#airport-search').press('Tab'); await settled(fixture);
    const synthetic = await verifyRoutes(fixture, '#networkMap .map-outgoing');
    assert.equal(synthetic.rows.find(row => row.label === 'LGA').rate, null);
    assert.equal(synthetic.rows.find(row => row.label === 'LAX').rate, 0);
    assert.notEqual(synthetic.rows.find(row => row.label === 'LGA').actual, synthetic.rows.find(row => row.label === 'LAX').actual);
    const missingIndex = await fixture.locator('#networkMap .map-outgoing').evaluateAll(paths => paths.findIndex(p => p.__data__.Dest === 'LGA'));
    await fixture.locator('#networkMap').scrollIntoViewIfNeeded();
    // Find an exposed point on the curve and use the real pointer for its tooltip.
    const point = await fixture.locator('#networkMap .map-outgoing').nth(missingIndex).evaluate(mark => {
      for (let f = .15; f < .9; f += .05) {
        const p = mark.getPointAtLength(mark.getTotalLength() * f);
        const q = new DOMPoint(p.x, p.y).matrixTransform(mark.getScreenCTM());
        if (document.elementFromPoint(q.x, q.y) === mark) return { x:q.x, y:q.y };
      }
      return null;
    });
    assert.ok(point, 'a real pointer can reach the missing-rate route');
    await fixture.mouse.move(point.x, point.y);
    assert.match(await fixture.locator('#tooltip').innerText(), /Delay rate: No data/);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(assets, 'map-mobile.png'), fullPage: true });
    const hashes = {};
    for (const name of ['site/js/charts.js','site/js/app.js','site/css/style.css','site/index.html','site/data/manifest.json'])
      hashes[name] = createHash('sha256').update(await fs.readFile(path.join(root, name))).digest('hex');
    await fs.writeFile(path.join(root, 'reports/site_validation_map_colors.json'), JSON.stringify({ checks:'passed', browser:browser.version(),
      cityRouteCount:city.rows.length, outgoingRouteCount:airport.rows.length, colorDomain:city.domain,
      palette: { belowNational:'#2166ac', national:'#8064a2', aboveNational:'#d7191c', interpolation:'piecewise Lab' },
      minimumRouteContrast: { city:Math.min(...city.rows.map(row => row.contrast)), outgoing:Math.min(...airport.rows.map(row => row.contrast)),
        background:'map land fill; alpha-composited stroke; intersections excluded; descriptive measurement only' },
      checked:['computed strokes reconcile with pooled route counts','shared city and route legend scale','fixed scope under filters',
        'observed zero versus missing synthetic routes','real-pointer missing-rate tooltip','390px layout'],
      notChecked:['performance timing','participant study','live deployment'], source_sha256:hashes },null,2)+'\n');
    console.log(JSON.stringify({ checks:'passed', cityRoutes:city.rows.length, outgoingRoutes:airport.rows.length }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
