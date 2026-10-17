/* Reproduce the comparison refinement checks with the site served over HTTP.
   NODE_PATH=<Playwright modules> CHROME_PATH=<Chrome> node scripts/qa_comparisons.cjs
   Outputs are separate from historical batch and interim evidence. */
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const url = process.env.SITE_URL || 'http://127.0.0.1:8765/';

// Independently pool publication counts with Python's CSV reader. In particular,
// annual route expectations come from monthly partitions, not route_annual.csv.
const source = JSON.parse(execFileSync('uv', ['run', '--locked', 'python', '-c', `
import csv, json
from pathlib import Path
counts = ['scheduled_flights','eligible_arrivals','delayed_arrivals','cancelled_flights','diverted_flights']
def read(p):
    with p.open(newline='') as f:
        return list(csv.DictReader(f))
base = Path('site/data')
airports = read(base/'airport_month_airline.csv')
routes = [dict(r, route_label=p.stem+' → '+r['Dest']) for p in sorted((base/'routes').glob('*.csv')) for r in read(p)]
national = read(base/'airline_month.csv')
result = {}
for name, end, airline in [('annual',12,None),('uaJanMar',3,'UA')]:
    scope = {}
    for kind, rows in [('airport',airports),('route',routes)]:
        groups = {}
        for r in rows:
            if int(r['Month']) > end or (airline and r['Reporting_Airline'] != airline): continue
            # Route identity comes from the origin filename and directed destination.
            label = r['Origin'] if kind == 'airport' else r['route_label']
            g = groups.setdefault(label, dict(label=label, **{c:0 for c in counts}))
            for c in counts: g[c] += int(r[c])
        scope[kind] = list(groups.values())
    scope['reference'] = {c:sum(int(r[c]) for r in national if int(r['Month']) <= end) for c in counts}
    result[name] = scope
print(json.dumps(result))
`],
{ cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  env: { ...process.env, UV_CACHE_DIR: process.env.UV_CACHE_DIR || '/tmp/stats401-uv-cache' } }));

const fmt = value => Number(value).toLocaleString('en-US');
const labelOrder = (a, b) => a.label.localeCompare(b.label, 'en');
function expected(scope, kind, metric, ranking, min) {
  const numerator = metric === 'delay' ? 'delayed_arrivals' : 'cancelled_flights';
  const denominator = metric === 'delay' ? 'eligible_arrivals' : 'scheduled_flights';
  const valid = source[scope][kind].filter(r => r[denominator] > 0);
  const qualified = valid.filter(r => r[denominator] >= min).map(r => ({ ...r, rate: r[numerator] / r[denominator] }));
  const volume = (a, b) => b.scheduled_flights - a.scheduled_flights || labelOrder(a, b);
  const rateOrder = (a, b) => (ranking === 'lowest' ? 1 : -1) * (a.rate - b.rate) || volume(a, b);
  qualified.sort(ranking === 'busiest' ? volume : rateOrder);
  return { rows: qualified.slice(0, 15).sort(rateOrder), numerator, denominator,
    below: valid.length - qualified.length,
    missing: source[scope][kind].length - valid.length,
    reference: source[scope].reference[numerator] / source[scope].reference[denominator] };
}

async function settled(page) {
  await page.waitForFunction(() => /^(Verified|Filters applied|Airport .* selected)/.test(document.querySelector('#load-status').textContent));
}
async function controls(page, kind, metric, ranking, min) {
  await page.locator(`[data-tab="tab-${kind}"]`).click();
  await settled(page);
  await page.locator(`#${kind}-metric`).selectOption(metric);
  await page.locator(`#${kind}-ranking`).selectOption(ranking);
  await page.locator(`#${kind}-min-sample`).fill(String(min));
  await page.locator(`#${kind}-min-sample`).press('Tab');
  await settled(page);
}
async function assertChart(page, scope, kind, metric, ranking, min) {
  const want = expected(scope, kind, metric, ranking, min);
  const selector = `#${kind}Chart`;
  const actual = await page.locator(`${selector} .bar`).evaluateAll(marks => marks.map(mark => ({
    label: mark.__data__.route || mark.__data__.Origin,
    rate: mark.__data__.comparison_rate,
    scheduled: mark.__data__.scheduled_flights,
    width: Number(mark.getAttribute('width')),
    red: mark.classList.contains('highlight'),
  })));
  assert.deepEqual(actual.map(r => r.label), want.rows.map(r => r.label), `${kind} ${metric} ${ranking}: independent ranking`);
  for (let i = 0; i < actual.length; i++) {
    assert.ok(Math.abs(actual[i].rate - want.rows[i].rate) < 1e-12);
    assert.equal(actual[i].scheduled, want.rows[i].scheduled_flights);
    assert.equal(actual[i].red, want.rows[i].rate > want.reference);
    assert.ok(Number.isFinite(actual[i].width) && actual[i].width >= 0);
  }
  const note = await page.locator(`#${kind}-comparison-note`).innerText();
  assert.ok(note.includes(`Excluded: ${want.missing} with missing data or zero denominator; ${want.below} below ${fmt(min)}`));
  const reference = await page.locator(`${selector} .chart-scope`).first().textContent();
  assert.ok(reference.includes(`${(100 * want.reference).toFixed(1)}%`));
  const ticks = await page.locator(`${selector} .axis`).first().locator('.tick text').allTextContents();
  assert.equal(new Set(ticks).size, ticks.length, 'distinct percent ticks stay readable at small rates');
  if (actual.length) {
    const index = Math.max(0, actual.findIndex(r => r.rate === 0));
    const row = want.rows[index];
    const target = row.rate === 0 ? page.locator(`${selector} .comparison-hit`).nth(index)
      : page.locator(`${selector} .bar`).nth(index);
    await target.hover();
    const tip = await page.locator('#tooltip').innerText();
    assert.ok(tip.includes(row.label));
    assert.ok(tip.includes(`Denominator: ${fmt(row[want.denominator])}`));
    assert.ok(tip.includes(metric === 'delay' ? `Delayed arrivals: ${fmt(row.delayed_arrivals)}`
      : `Cancelled flights: ${fmt(row.cancelled_flights)}`));
    await page.mouse.move(0, 0);
  }
  return { scope, kind, metric, ranking, minSample: min, groupsShown: actual.length,
    first: want.rows[0] || null, referenceNumerator: source[scope].reference[want.numerator],
    referenceDenominator: source[scope].reference[want.denominator] };
}

(async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const assets = path.join(root, 'docs/assets/comparison-refinement');
    await fs.mkdir(assets, { recursive: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await settled(page);
    const cases = [];
    for (const kind of ['airport', 'route']) {
      for (const metric of ['delay', 'cancellation']) {
        for (const ranking of ['busiest', 'highest', 'lowest']) {
          await controls(page, kind, metric, ranking, 100);
          cases.push(await assertChart(page, 'annual', kind, metric, ranking, 100));
        }
      }
      await controls(page, kind, 'cancellation', 'lowest', 0);
      cases.push(await assertChart(page, 'annual', kind, 'cancellation', 'lowest', 0));
      await page.locator(`#tab-${kind} section`).screenshot({ path: path.join(assets, `${kind}-lowest-cancellation.png`) });
      await controls(page, kind, 'delay', 'highest', 999999999);
      assert.equal(await page.locator(`#${kind}Chart .bar`).count(), 0);
      assert.match(await page.locator(`#${kind}Chart`).textContent(), /No .* selected minimum sample/);
    }
    // Reset must invalidate local controls even when global filters are default.
    await page.locator('#filter-reset').click();
    await settled(page);
    for (const kind of ['airport', 'route']) {
      assert.equal(await page.locator(`#${kind}-metric`).inputValue(), 'delay');
      assert.equal(await page.locator(`#${kind}-ranking`).inputValue(), 'busiest');
      assert.equal(await page.locator(`#${kind}-min-sample`).inputValue(), '0');
      await controls(page, kind, 'delay', 'busiest', 0);
      cases.push(await assertChart(page, 'annual', kind, 'delay', 'busiest', 0));
    }
    await page.locator('#month-end').selectOption('3');
    await page.locator('#airline-select').selectOption('UA');
    for (const kind of ['airport', 'route']) {
      await controls(page, kind, 'cancellation', 'highest', 500);
      cases.push(await assertChart(page, 'uaJanMar', kind, 'cancellation', 'highest', 500));
    }
    // A selected airport below the sample threshold must not bypass that rule.
    await page.locator('#airport-search').fill('MDW');
    await page.locator('#airport-search').press('Enter');
    await page.locator('#airport-search').press('Tab');
    await settled(page);
    await controls(page, 'airport', 'delay', 'highest', 999999999);
    assert.equal(await page.locator('#airportChart .bar').count(), 0);
    assert.match(await page.locator('#airport-comparison-note').innerText(), /Selected airport has no qualifying rate/);
    await page.locator('#filter-reset').click();
    await settled(page);
    await controls(page, 'airport', 'cancellation', 'lowest', 0);
    const zeroIndex = await page.locator('#airportChart .bar').evaluateAll(bars => bars.findIndex(bar => bar.__data__.comparison_rate === 0));
    assert.ok(zeroIndex >= 0);
    await page.locator('#airportChart .comparison-hit').nth(zeroIndex).click();
    await settled(page);
    assert.equal(await page.locator('[data-tab="tab-detail"]').getAttribute('aria-pressed'), 'true');
    assert.ok(await page.locator('#airport-search').inputValue());
    await page.locator('[data-tab="tab-cause"]').click();
    await page.locator('#open-cause-comparison').click();
    await settled(page);
    assert.equal(await page.locator('[data-tab="tab-cause-compare"]').getAttribute('aria-pressed'), 'true');
    // Narrow-screen controls wrap; chart scrolling stays inside its section.
    await page.setViewportSize({ width: 390, height: 844 });
    for (const kind of ['airport', 'route']) {
      await controls(page, kind, 'cancellation', 'highest', 100);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const box = await page.locator(`#tab-${kind} .comparison-controls`).boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= 390);
    }
    await page.screenshot({ path: path.join(assets, 'mobile-route-controls.png'), fullPage: true });
    assert.deepEqual(errors, []);
    const hashes = {};
    for (const name of ['site/index.html', 'site/css/style.css', 'site/js/app.js', 'site/js/charts.js',
      'site/js/aggregate.js', 'site/js/metrics.js', 'site/js/state.js', 'site/js/data.js', 'site/data/manifest.json']) {
      hashes[name] = createHash('sha256').update(await fs.readFile(path.join(root, name))).digest('hex');
    }
    const result = { checks: 'passed', browser: browser.version(), cases,
      checked: ['independent pooled counts and all ranking/metric combinations', 'metric-specific denominators and exclusions',
        'reference rate remains national under airline and sample filters', 'default-scope Reset',
        'all-excluded state and selected-airport sample enforcement', 'zero-rate real hover and airport selection',
        'distinct percent ticks for small/all-zero rates', 'cause comparison navigation', '390px layout'],
      notChecked: ['performance timing', 'participant study', 'live deployment'], source_sha256: hashes };
    await fs.writeFile(path.join(root, 'reports/site_validation_comparisons.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ checks: result.checks, cases: cases.length, browser: result.browser }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
