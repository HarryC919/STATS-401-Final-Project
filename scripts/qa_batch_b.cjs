/* Batch B browser QA: shared month/airline filters over the six existing views.
   Writes evidence to docs/assets/batch-b/ and reports/site_validation_batch_b.json.
   Unlike scripts/render_site.cjs it never touches docs/assets/interim/.
   Usage: NODE_PATH=<playwright modules> node scripts/qa_batch_b.cjs  (SITE_URL, CHROME_PATH optional). */
const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const url = process.env.SITE_URL || 'http://127.0.0.1:8765/';
const siteData = path.join(root, 'site/data');

/* Minimal CSV parsing: Batch A publication files contain no quoted separators. */
function csvRows(text) {
  const lines = text.trim().split('\n');
  const header = lines[0].split(',');
  return lines.slice(1).filter(line => line.length).map(line => {
    const cells = line.split(',');
    const row = {};
    header.forEach((name, i) => { row[name] = cells[i] === '' ? null : cells[i]; });
    return row;
  });
}
const fmt = number => number.toLocaleString('en-US');
const rateText = (delayed, eligible) => eligible > 0 ? `${(100 * delayed / eligible).toFixed(1)}%` : 'No data';
const COUNT_KEYS = ['scheduled_flights', 'eligible_arrivals', 'delayed_arrivals', 'cancelled_flights', 'diverted_flights'];

function sumRows(rows, { start, end, airline }) {
  const totals = Object.fromEntries(COUNT_KEYS.map(key => [key, 0]));
  for (const row of rows) {
    const month = Number(row.Month);
    if (month < start || month > end) continue;
    if (airline && row.Reporting_Airline !== airline) continue;
    for (const key of COUNT_KEYS) totals[key] += Number(row[key]);
  }
  return totals;
}

function groupRows(rows, keys, { start, end, airline }) {
  const groups = new Map();
  for (const row of rows) {
    const month = Number(row.Month);
    if (month < start || month > end) continue;
    if (airline && row.Reporting_Airline !== airline) continue;
    const key = keys.map(name => row[name]).join('|');
    if (!groups.has(key)) groups.set(key, { label: keys.map(name => row[name]).join(' → '), scheduled: 0, eligible: 0, delayed: 0 });
    const group = groups.get(key);
    group.scheduled += Number(row.scheduled_flights);
    group.eligible += Number(row.eligible_arrivals);
    group.delayed += Number(row.delayed_arrivals);
  }
  return [...groups.values()]
    .filter(group => group.eligible > 0)
    .sort((a, b) => b.scheduled - a.scheduled).slice(0, 15)
    .sort((a, b) => (b.delayed / b.eligible) - (a.delayed / a.eligible));
}

async function readCsv(name) {
  return csvRows(await fs.readFile(path.join(siteData, name), 'utf8'));
}

async function assertBars(page, chartId, expected, tooltipLabelCount) {
  const bars = page.locator(`#${chartId} .bar`);
  assert.equal(await bars.count(), expected.length, `${chartId}: bar count`);
  for (let i = 0; i < Math.min(expected.length, tooltipLabelCount); i++) {
    await bars.nth(i).hover();
    await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('#tooltip')).opacity) > 0);
    const text = await page.locator('#tooltip').innerText();
    const lines = text.split('\n').map(line => line.trim());
    assert.equal(lines[0], expected[i].label, `${chartId} bar ${i}: label`);
    assert.equal(lines[1], `Flights: ${fmt(expected[i].scheduled)}`, `${chartId} bar ${i}: pooled flights`);
    assert.equal(lines[2], `Delay rate: ${rateText(expected[i].delayed, expected[i].eligible)}`,
      `${chartId} bar ${i}: pooled delay rate`);
    await page.mouse.move(0, 0);
  }
}

async function assertKpi(page, totals, label) {
  const text = await page.locator('#kpis').innerText();
  assert.ok(text.includes(fmt(totals.scheduled_flights)), `${label}: KPI flight total`);
  assert.ok(text.includes(rateText(totals.delayed_arrivals, totals.eligible_arrivals)),
    `${label}: KPI arrival delay rate`);
  assert.ok(text.includes(rateText(totals.cancelled_flights, totals.scheduled_flights)),
    `${label}: KPI cancellation rate`);
  assert.ok(text.includes(rateText(totals.diverted_flights, totals.scheduled_flights)),
    `${label}: KPI diversion rate`);
}

(async () => {
  const airlineMonth = await readCsv('airline_month.csv');
  const airportMonth = await readCsv('airport_month_airline.csv');
  const routeRows = [];
  for (const file of await fs.readdir(path.join(siteData, 'routes'))) {
    const origin = file.replace('.csv', '');
    for (const row of await readCsv(path.join('routes', file))) {
      routeRows.push({ ...row, Origin: origin });
    }
  }
  const JAN_MAR = { start: 1, end: 3, airline: null };
  const JAN_FEB = { start: 1, end: 2, airline: null };
  const JAN_MAR_UA = { start: 1, end: 3, airline: 'UA' };
  const JAN_FEB_UA = { start: 1, end: 2, airline: 'UA' };
  const expectations = {
    fullYear: sumRows(airlineMonth, { start: 1, end: 12, airline: null }),
    janMarAll: sumRows(airlineMonth, JAN_MAR),
    janMarUA: sumRows(airlineMonth, JAN_MAR_UA),
    janFebUA: sumRows(airlineMonth, JAN_FEB_UA),
    airportsJanMar: groupRows(airportMonth, ['Origin'], JAN_MAR),
    airportsJanMarUA: groupRows(airportMonth, ['Origin'], JAN_MAR_UA),
    routesJanMar: groupRows(routeRows, ['Origin', 'Dest'], JAN_MAR),
    routesJanFeb: groupRows(routeRows, ['Origin', 'Dest'], JAN_FEB),
    routesJanMarUA: groupRows(routeRows, ['Origin', 'Dest'], JAN_MAR_UA),
    routesJanFebUA: groupRows(routeRows, ['Origin', 'Dest'], JAN_FEB_UA),
  };
  const referenceJanMar = expectations.janMarAll;
  const referencePct = (100 * referenceJanMar.delayed_arrivals / referenceJanMar.eligible_arrivals).toFixed(1) + '%';

  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  });
  try {
    const assets = path.join(root, 'docs/assets/batch-b');
    await fs.mkdir(assets, { recursive: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    await page.goto(url);
    await page.waitForFunction(() => document.querySelector('#load-status').textContent.startsWith('Verified'));

    // Default state = the accepted static dashboard behavior plus the filter bar.
    assert.equal(await page.locator('.kpi').count(), 4);
    await assertKpi(page, expectations.fullYear, 'default state');
    assert.equal(await page.locator('#filter-summary').innerText(),
      'Showing: full year 2025 · all reporting airlines · all origin airports');
    assert.equal(await page.locator('#month-start option').count(), 12);
    assert.equal(await page.locator('#airline-select option').count(), 15); // All airlines + 14 carriers

    const specs = [
      ['monthly', 'monthlyChart', 'circle', 24],
      ['airline', 'airlineChart', '.bar', 14],
      ['airport', 'airportChart', '.bar', 15],
      ['route', 'routeChart', '.bar', 15],
      ['cause', 'causeChart', '.pie-legend rect', 5],
      ['network', 'networkMap', '.map-route', 220],
    ];
    const charts = [];
    let expectedMapNodes = 0;
    for (const [name, id, selector, count] of specs) {
      await page.locator(`[data-tab="tab-${name}"]`).click();
      await page.waitForFunction(() => document.querySelector('#load-status').textContent.startsWith('Verified'));
      const svg = page.locator(`#${id}`);
      assert.equal(await svg.locator(selector).count(), count, `${name}: mark count`);
      const malformed = await svg.evaluate(el => [...el.querySelectorAll('*')].filter(node =>
        ['d', 'cx', 'cy', 'width', 'height', 'transform'].some(attr => /NaN|Infinity/.test(node.getAttribute(attr) || ''))).length);
      assert.equal(malformed, 0, `${name}: invalid SVG geometry`);
      if (name !== 'network') {
        const mark = name === 'cause' ? svg.locator('path').first() : svg.locator(name === 'monthly' ? 'circle' : '.bar').first();
        await mark.hover();
        await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('#tooltip')).opacity) > 0);
        assert.ok((await page.locator('#tooltip').innerText()).length > 5);
        await page.mouse.move(0, 0);
      }
      await page.locator(`#tab-${name} section`).screenshot({ path: path.join(assets, `${name}-default.png`) });
      charts.push({ chart: name, marks: count, screenshot: `docs/assets/batch-b/${name}-default.png` });
      if (name === 'network') expectedMapNodes = await page.locator('#networkMap .map-node').count();
    }
    assert.match(await page.locator('#airlineChart').textContent(), /National avg 22\.3% \(selected months, all airlines, all airports\)/);
    assert.deepEqual(errors, [], 'no page errors in the default pass');

    // Month range only: KPI, summary, monthly band, reference scope.
    // Hidden tabs re-render lazily on activation, so visit monthly first.
    await page.locator('#month-start').selectOption('1');
    await page.locator('#month-end').selectOption('3');
    await page.waitForFunction(expected => document.querySelector('#kpis').textContent.includes(expected),
      fmt(expectations.janMarAll.scheduled_flights));
    await assertKpi(page, expectations.janMarAll, 'Jan–Mar all airlines');
    assert.equal(await page.locator('#filter-summary').innerText(),
      'Showing: Jan–Mar 2025 · all reporting airlines · all origin airports');
    await page.locator('[data-tab="tab-monthly"]').click();
    await page.waitForFunction(() => document.querySelector('#load-status').textContent.startsWith('Filters applied'));
    assert.equal(await page.locator('#monthlyChart .range-band').count(), 1, 'selected months are shaded');
    assert.equal(await page.locator('#monthlyChart circle').count(), 24, 'all twelve months stay visible');
    await page.locator('#tab-monthly section').screenshot({ path: path.join(assets, 'monthly-jan-mar.png') });
    await page.locator('[data-tab="tab-airline"]').click();
    await page.waitForFunction(() => document.querySelector('#load-status').textContent.startsWith('Filters applied'));
    assert.match(await page.locator('#airlineChart').textContent(), new RegExp(`National avg ${referencePct.replace('.', '\\.')} \\(selected months, all airlines, all airports\\)`));
    assert.equal(await page.locator('#airlineChart .bar').count(), 14, 'airline context retained');
    await page.locator('[data-tab="tab-airport"]').click();
    await page.waitForFunction(() => document.querySelector('#load-status').textContent.startsWith('Filters applied'));
    await assertBars(page, 'airportChart', expectations.airportsJanMar, 15);

    // Airline selection: context retained, chosen airline highlighted, values pooled.
    await page.locator('#airline-select').selectOption('UA');
    await page.waitForFunction(expected => document.querySelector('#kpis').textContent.includes(expected),
      fmt(expectations.janMarUA.scheduled_flights));
    await assertKpi(page, expectations.janMarUA, 'Jan–Mar UA');
    assert.equal(await page.locator('#filter-summary').innerText(),
      'Showing: Jan–Mar 2025 · reporting airline UA · all origin airports');
    await page.locator('[data-tab="tab-airline"]').click();
    await page.waitForFunction(() => document.querySelector('#load-status').textContent.startsWith('Filters applied'));
    assert.equal(await page.locator('#airlineChart .bar').count(), 14, 'airline comparison keeps all carriers');
    assert.equal(await page.locator('#airlineChart .bar-selected').count(), 1, 'only UA is outlined');
    await page.locator('#tab-airline section').screenshot({ path: path.join(assets, 'airline-jan-mar-ua.png') });
    await page.locator('[data-tab="tab-airport"]').click();
    await page.waitForFunction(() => document.querySelector('#load-status').textContent.startsWith('Filters applied'));
    await assertBars(page, 'airportChart', expectations.airportsJanMarUA, 15);
    await page.locator('#tab-airport section').screenshot({ path: path.join(assets, 'airport-jan-mar-ua.png') });

    // Filtered route tab loads the directed partitions on demand and pools them.
    await page.locator('[data-tab="tab-route"]').click();
    await page.waitForFunction(() => document.querySelector('#load-status').textContent.startsWith('Filters applied'));
    await assertBars(page, 'routeChart', expectations.routesJanMarUA, 15);
    await page.locator('#tab-route section').screenshot({ path: path.join(assets, 'route-jan-mar-ua.png') });

    // Reset restores the initial annual, all-airline view everywhere.
    await page.locator('#filter-reset').click();
    await page.waitForFunction(() => document.querySelector('#kpis').textContent.includes('7,001,619'));
    await assertKpi(page, expectations.fullYear, 'after reset');
    assert.equal(await page.locator('#filter-summary').innerText(),
      'Showing: full year 2025 · all reporting airlines · all origin airports');
    assert.equal(await page.locator('#airline-select').inputValue(), '');
    await page.locator('[data-tab="tab-route"]').click();
    await page.waitForFunction(() => document.querySelector('#load-status').textContent.startsWith('Verified'));
    assert.equal(await page.locator('#routeChart .bar').count(), 15);
    assert.deepEqual(errors, [], 'no page errors after filtering and reset');
    await page.close();

    // Rapid selection changes settle on the most recent state while the route
    // partitions are still loading (responses throttled to force the race).
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    await context.route('**/data/routes/*.csv', async route => {
      await new Promise(resolve => setTimeout(resolve, 40));
      await route.continue();
    });
    const slow = await context.newPage();
    const slowErrors = [];
    slow.on('pageerror', error => slowErrors.push(error.message));
    await slow.goto(url);
    await slow.waitForFunction(() => document.querySelector('#load-status').textContent.startsWith('Verified'));
    await slow.locator('#month-start').selectOption('1');
    await slow.locator('#month-end').selectOption('3');
    await slow.locator('#airline-select').selectOption('UA');
    await slow.locator('[data-tab="tab-route"]').click();
    await slow.locator('#month-end').selectOption('2'); // newer selection while partitions are in flight
    await slow.waitForFunction(() => document.querySelector('#load-status').textContent.startsWith('Filters applied'));
    assert.match(await slow.locator('#filter-summary').innerText(), /Jan–Feb 2025/);
    await assertBars(slow, 'routeChart', expectations.routesJanFebUA, 15);
    assert.deepEqual(slowErrors, [], 'no page errors in the stale-response race');
    await context.close();

    // Keyboard operation: Tab reaches every control, type-ahead drives the
    // selects (arrow keys open the native macOS picker and are not automatable
    // headlessly), Enter drives Reset.
    const keys = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    await keys.goto(url);
    await keys.waitForFunction(() => document.querySelector('#load-status').textContent.startsWith('Verified'));
    await keys.locator('#month-start').focus();
    for (const id of ['month-end', 'airline-select', 'airport-search', 'filter-reset']) {
      await keys.keyboard.press('Tab');
      assert.equal(await keys.evaluate(() => document.activeElement?.id), id, `Tab order reaches ${id}`);
    }
    const mayDec = sumRows(airlineMonth, { start: 5, end: 12, airline: null });
    await keys.locator('#month-start').focus();
    for (const key of ['m', '5']) await keys.keyboard.press(key); // type-ahead -> M5
    await keys.waitForFunction(expected => document.querySelector('#kpis').textContent.includes(expected),
      fmt(mayDec.scheduled_flights));
    await assertKpi(keys, mayDec, 'keyboard May–Dec');
    assert.match(await keys.locator('#filter-summary').innerText(), /May–Dec 2025/);
    // 'u' is the only carrier code starting with u, so type-ahead is deterministic.
    const carrierTotal = sumRows(airlineMonth, { start: 5, end: 12, airline: 'UA' });
    await keys.locator('#airline-select').focus();
    await keys.keyboard.press('u'); // type-ahead -> UA
    await keys.waitForFunction(() => document.querySelector('#airline-select').value === 'UA');
    await keys.waitForFunction(expected => document.querySelector('#kpis').textContent.includes(expected),
      fmt(carrierTotal.scheduled_flights));
    await assertKpi(keys, carrierTotal, 'keyboard May–Dec UA');
    assert.match(await keys.locator('#filter-summary').innerText(), /reporting airline UA/);
    await keys.locator('#filter-reset').focus();
    await keys.keyboard.press('Enter');
    await keys.waitForFunction(() => document.querySelector('#kpis').textContent.includes('7,001,619'));
    assert.equal(await keys.locator('#filter-summary').innerText(),
      'Showing: full year 2025 · all reporting airlines · all origin airports');
    await keys.close();

    // Narrow viewport: the filter bar wraps without horizontal page overflow.
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await mobile.goto(url);
    await mobile.waitForFunction(() => document.querySelector('#load-status').textContent.startsWith('Verified'));
    assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile page overflow');
    await mobile.close();

    // Regression: changing filters during the map's first load must not stack a
    // second overlapping render (the reported bug showed 440 routes, not 220).
    const mapContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    await mapContext.route('**/vendor/states-10m.json', async route => {
      await new Promise(resolve => setTimeout(resolve, 600));
      await route.continue();
    });
    const mapPage = await mapContext.newPage();
    const mapErrors = [];
    mapPage.on('pageerror', error => mapErrors.push(error.message));
    await mapPage.goto(url);
    await mapPage.waitForFunction(() => document.querySelector('#load-status').textContent.startsWith('Verified'));
    await mapPage.locator('[data-tab="tab-network"]').click();
    await mapPage.locator('#month-start').selectOption('1'); // filter changes mid-load
    await mapPage.locator('#month-end').selectOption('3');
    await mapPage.waitForFunction(() => document.querySelectorAll('#networkMap .map-route').length > 0);
    await mapPage.waitForFunction(() => !document.querySelector('#load-status').textContent.startsWith('Rendering'));
    assert.equal(await mapPage.locator('#networkMap .map-route').count(), 220, 'map draws 220 routes, not 440');
    assert.equal(await mapPage.locator('#networkMap .map-node').count(), expectedMapNodes, 'map nodes are not duplicated');
    assert.deepEqual(mapErrors, [], 'no page errors during the map overlap regression');
    await mapContext.close();

    // Initial-load failure states name the problem and stay retryable.
    const failed = await browser.newPage();
    await failed.route('**/data/airline_month.csv', route => route.abort());
    await failed.goto(url);
    await failed.locator('#load-status[role="alert"]').waitFor();
    assert.match(await failed.locator('#load-status').innerText(), /Data could not load/);
    await failed.close();

    // Regression: a failed filtered render must clear the stale marks from the
    // previous scope, and returning to a rendered tab must clear the error text.
    const stale = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const staleErrors = [];
    stale.on('pageerror', error => staleErrors.push(error.message));
    await stale.route('**/data/manifest.json', route => route.abort());
    await stale.goto(url);
    await stale.waitForFunction(() => document.querySelector('#load-status').textContent.startsWith('Verified'));
    await stale.locator('[data-tab="tab-network"]').click(); // cache the fixed-scope map first
    await stale.waitForFunction(() => document.querySelectorAll('#networkMap .map-route').length === 220);
    await stale.locator('[data-tab="tab-route"]').click(); // default scope: annual snapshot, no manifest needed
    await stale.waitForFunction(() => document.querySelector('#load-status').textContent.startsWith('Verified'));
    assert.equal(await stale.locator('#routeChart .bar').count(), 15);
    await stale.locator('#month-start').selectOption('1');
    await stale.locator('#month-end').selectOption('3'); // the filtered render needs the partitions -> fails
    await stale.waitForFunction(() => document.querySelector('#load-status').textContent.startsWith('Chart could not load'));
    assert.equal(await stale.locator('#routeChart .bar').count(), 0, 'stale annual bars are cleared on failure');
    assert.ok(await stale.locator('#routeChart text').count() >= 1, 'the failure is visible inside the panel');
    assert.match(await stale.locator('#filter-summary').innerText(), /Jan–Mar 2025/);
    // Returning to a truly cached (drawn) tab clears the error without re-rendering.
    await stale.locator('[data-tab="tab-network"]').click();
    const networkStatus = await stale.locator('#load-status').innerText();
    assert.ok(!networkStatus.includes('could not load'), 'cached-tab return clears the error status');
    assert.match(networkStatus, /^Filters applied/);
    assert.equal(await stale.locator('#networkMap .map-route').count(), 220, 'cached map was not re-rendered');
    // A filter change on the cached fixed-scope tab refreshes the scope text in place.
    await stale.locator('#month-end').selectOption('2');
    assert.match(await stale.locator('#load-status').innerText(), /Jan–Feb 2025/,
      'cached-tab status text follows the current selection');
    assert.equal(await stale.locator('#networkMap .map-route').count(), 220, 'cached map survives month changes');
    await stale.locator('[data-tab="tab-monthly"]').click(); // monthly re-renders for the new scope
    const monthlyStatus = await stale.locator('#load-status').innerText();
    assert.ok(!monthlyStatus.includes('could not load'), 'returning to a rendered tab clears the error status');
    assert.match(monthlyStatus, /^Filters applied/);
    await stale.unroute('**/data/manifest.json');
    await stale.locator('[data-tab="tab-route"]').click(); // retry the filtered render
    await stale.waitForFunction(() => document.querySelector('#load-status').textContent.startsWith('Filters applied'));
    await assertBars(stale, 'routeChart', expectations.routesJanFeb, 15);
    assert.deepEqual(staleErrors, [], 'no page errors in the stale-render regression');
    await stale.close();

    const inputs = ['site/index.html', 'site/css/style.css', 'site/js/app.js', 'site/js/charts.js',
      'site/js/state.js', 'site/js/aggregate.js', 'site/js/data.js', 'site/data/manifest.json'];
    const hashes = {};
    for (const file of inputs) hashes[file] = createHash('sha256').update(await fs.readFile(path.join(root, file))).digest('hex');
    const result = {
      batch: 'B — shared month/airline filtering',
      browser: await browser.version(), checks: 'passed', charts,
      expectations: {
        fullYearScheduled: expectations.fullYear.scheduled_flights,
        janMarAllScheduled: expectations.janMarAll.scheduled_flights,
        janMarUAScheduled: expectations.janMarUA.scheduled_flights,
        janFebUAScheduled: expectations.janFebUA.scheduled_flights,
        referenceJanMar: `${referenceJanMar.delayed_arrivals}/${referenceJanMar.eligible_arrivals} = ${referencePct}`,
      },
      checked: ['six charts render in default state', 'filter bar default summary',
        'KPI flight total and arrival delay rate in every scope', 'tooltip label, pooled flights, and pooled delay rate',
        'month range updates KPI/summary/monthly band/reference label', 'airline context retained with UA outlined',
        'airport and route bars match independently pooled expectations', 'filtered routes load partitions on demand',
        'reset restores annual all-airline view', 'rapid changes settle on the newest selection under throttled responses',
        'map mid-load filter change does not duplicate routes or nodes',
        'failed filtered render clears stale marks and shows the error in the panel',
        'returning to a truly cached tab clears the error without re-rendering it',
        'filter changes on a cached fixed-scope tab refresh the status text in place',
        'KPI cancellation and diversion rates in every scope',
        'returning to a rendered tab clears leftover error/loading status',
        'keyboard operation of selects and Reset', 'mobile overflow', 'initial load failure', 'filtered render retry'],
      notChecked: ['empty-selection browser state (no filter combination yields zero rows in this dataset; covered by unit tests)',
        'cause and network views stay fixed-scope by design and were only checked to render'],
      desktopViewport: [1440, 1100], mobileViewport: [390, 844],
      limitations: 'Automated checks and visual inspection are not a user study or an interaction-performance evaluation.',
      source_sha256: hashes,
    };
    await fs.writeFile(path.join(root, 'reports/site_validation_batch_b.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
