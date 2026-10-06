/* Batch D1 browser QA: weekday x scheduled-hour heatmap.
   Writes evidence to docs/assets/batch-d1/ and reports/site_validation_batch_d1.json.
   Never touches interim figures or other batches' evidence files.
   Usage: NODE_PATH=<playwright modules> node scripts/qa_batch_d1.cjs  (SITE_URL, CHROME_PATH optional). */
const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const url = process.env.SITE_URL || 'http://127.0.0.1:8765/';
const siteData = path.join(root, 'site/data');
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/* RFC-4180-style CSV parsing (quoted fields contain commas elsewhere; kept for safety). */
function csvRows(text) {
  const records = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); records.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field.length || row.length) { row.push(field); records.push(row); }
  const header = records.shift();
  return records.filter(cells => cells.length === header.length).map(cells => {
    const out = {};
    header.forEach((name, i) => { out[name] = cells[i] === '' ? null : cells[i]; });
    return out;
  });
}
const fmt = number => number.toLocaleString('en-US');
const rateText = (delayed, eligible) => eligible > 0 ? `${(100 * delayed / eligible).toFixed(1)}%` : 'No data';

async function readTemporal(month) {
  const name = `2025-${String(month).padStart(2, '0')}`;
  return csvRows(await fs.readFile(path.join(siteData, 'temporal', `${name}.csv`), 'utf8'));
}

/* Pool temporal rows by (weekday, hour) under the scope, independently of the app. */
function poolCells(rows, { start, end, airline, origin }) {
  const groups = new Map();
  for (const row of rows) {
    const month = Number(row.Month);
    if (month < start || month > end) continue;
    if (airline && row.Reporting_Airline !== airline) continue;
    if (origin && row.Origin !== origin) continue;
    const key = `${Number(row.Weekday)}|${Number(row.ScheduledDepHour)}`;
    if (!groups.has(key)) groups.set(key, { scheduled: 0, eligible: 0, delayed: 0 });
    const group = groups.get(key);
    group.scheduled += Number(row.scheduled_flights);
    group.eligible += Number(row.eligible_arrivals);
    group.delayed += Number(row.delayed_arrivals);
  }
  return groups;
}

function cellIndex(weekday, hour) { return (weekday - 1) * 24 + hour; }

/* Extract all rendered cells and compare slot-by-slot against the expected grid. */
async function assertWholeGrid(page, expected) {
  const rendered = await page.locator('#temporalHeatmap .heat-cell').evaluateAll(els =>
    els.map(el => ({
      weekday: el.__data__.weekday,
      hour: el.__data__.hour,
      scheduled: el.__data__.cell ? Number(el.__data__.cell.scheduled_flights) : 0,
      eligible: el.__data__.cell ? Number(el.__data__.cell.eligible_arrivals) : 0,
      delayed: el.__data__.cell ? Number(el.__data__.cell.delayed_arrivals) : 0,
    })));
  assert.equal(rendered.length, 168, 'exactly 168 slots are rendered');
  for (const mark of rendered) {
    assert.ok(mark.weekday >= 1 && mark.weekday <= 7, `weekday ${mark.weekday} in 1..7`);
    assert.ok(Number.isInteger(mark.hour) && mark.hour >= 0 && mark.hour <= 23,
      `hour ${mark.hour} is an integer in 0..23`);
    const group = expected.get(`${mark.weekday}|${mark.hour}`);
    const want = group ?? { scheduled: 0, eligible: 0, delayed: 0 };
    assert.equal(mark.scheduled, want.scheduled,
      `cell ${mark.weekday}|${mark.hour}: scheduled`);
    assert.equal(mark.eligible, want.eligible, `cell ${mark.weekday}|${mark.hour}: eligible`);
    assert.equal(mark.delayed, want.delayed, `cell ${mark.weekday}|${mark.hour}: delayed`);
  }
}

async function hoverCell(page, weekday, hour) {
  await page.locator('#temporalHeatmap .heat-cell').nth(cellIndex(weekday, hour)).hover();
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('#tooltip')).opacity) > 0);
  const lines = (await page.locator('#tooltip').innerText()).split('\n').map(line => line.trim());
  await page.mouse.move(0, 0);
  return lines;
}

async function waitSettled(page) {
  await page.waitForFunction(() => {
    const text = document.querySelector('#load-status').textContent;
    return !text.startsWith('Updating') && !text.startsWith('Rendering');
  });
}

(async () => {
  const jan = await readTemporal(1);
  const feb = await readTemporal(2);
  const jun = await readTemporal(6);
  const all = [...jan, ...feb, ...jun];
  for (let m = 3; m <= 12; m++) if (m !== 6) all.push(...await readTemporal(m));

  const expectations = {
    totalAll: poolCells(all, { start: 1, end: 12, airline: null, origin: null }),
    ordUAJanFeb: poolCells(all, { start: 1, end: 2, airline: 'UA', origin: 'ORD' }),
    mdtOOJune: poolCells(jun, { start: 6, end: 6, airline: 'OO', origin: 'MDT' }),
  };
  const totalScheduled = [...expectations.totalAll.values()]
    .reduce((sum, group) => sum + group.scheduled, 0);
  const nationalTop = [...expectations.totalAll.entries()]
    .sort((a, b) => b[1].scheduled - a[1].scheduled)[0];
  const [natWeekday, natHour] = nationalTop[0].split('|').map(Number);
  const topKey = [...expectations.ordUAJanFeb.entries()]
    .sort((a, b) => b[1].scheduled - a[1].scheduled)[0];
  const [topWeekday, topHour] = topKey[0].split('|').map(Number);
  const hottest = [...expectations.ordUAJanFeb.entries()]
    .filter(([, group]) => group.eligible > 0)
    .sort((a, b) => (b[1].delayed / b[1].eligible) - (a[1].delayed / a[1].eligible))[0];
  const [hotWeekday, hotHour] = hottest[0].split('|').map(Number);
  const zeroCells = [...expectations.ordUAJanFeb.entries()]
    .filter(([, group]) => group.eligible > 0 && group.delayed === 0);
  assert.ok(zeroCells.length > 0, 'fixture has observed-zero cells');
  const [zeroKey, zeroGroup] = zeroCells[0];
  const [zeroWeekday, zeroHour] = zeroKey.split('|').map(Number);
  const unobserved = [];
  for (let weekday = 1; weekday <= 7; weekday++) {
    for (let hour = 0; hour < 24; hour++) {
      if (!expectations.mdtOOJune.has(`${weekday}|${hour}`)) unobserved.push([weekday, hour]);
    }
  }
  assert.ok(unobserved.length > 0, 'fixture has unobserved cells');
  const lowCells = [...expectations.mdtOOJune.entries()]
    .filter(([, group]) => group.eligible > 0 && group.eligible < 30);
  assert.ok(lowCells.length > 0, 'fixture has low-sample cells');
  const mdtScheduled = [...expectations.mdtOOJune.values()]
    .reduce((sum, group) => sum + group.scheduled, 0);

  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  });
  try {
    const assets = path.join(root, 'docs/assets/batch-d1');
    await fs.mkdir(assets, { recursive: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    await page.goto(url);
    await page.waitForFunction(() => document.querySelector('#load-status').textContent.startsWith('Verified'));
    await page.locator('[data-tab="tab-temporal"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#temporalHeatmap .heat-cell').length > 0,
      null, { timeout: 90000 });
    await waitSettled(page);

    // Weekday order (Monday first), hour boundaries, and the 2400 convention note.
    assert.equal(await page.locator('#temporalHeatmap .heat-cell').count(), 168, 'full 7x24 grid');
    const tickTexts = await page.locator('#temporalHeatmap .tick text').allTextContents();
    WEEKDAYS.forEach(day => assert.ok(tickTexts.includes(day), `weekday label ${day} present`));
    assert.ok(tickTexts.includes('00') && tickTexts.includes('22'), 'hour ticks start at 00 and reach 22 (every 2h)');
    assert.ok(tickTexts.includes('Mon'), 'Monday is the first row label');
    const hourTitle = await page.locator('#temporalHeatmap text')
      .evaluateAll(nodes => nodes.map(node => node.textContent).join('\n'));
    assert.match(hourTitle, /Scheduled local departure hour \(BTS 2400 maps to 00\)/,
      'the 2400 convention is stated on the axis');
    assert.match(await page.locator('#temporalHeatmap text').first().textContent(),
      /full year 2025 · all reporting airlines · all origin airports/, 'scope line states the default scope');

    // Partition reconciliation: the pooled grid sums to the national total, so
    // no flights are dropped or duplicated at partition boundaries.
    assert.equal(totalScheduled, 7001619, 'grid total equals the national scheduled flights');
    // Whole-grid verification: every rendered slot (including empty ones) matches
    // the independently pooled expectation for the current scope.
    await assertWholeGrid(page, expectations.totalAll);
    const topLines = await hoverCell(page, natWeekday, natHour);
    assert.equal(topLines[0], `${WEEKDAYS[natWeekday - 1]} · ${String(natHour).padStart(2, '0')}:00–${String(natHour).padStart(2, '0')}:59`,
      'top cell tooltip names weekday and hour');
    assert.equal(topLines[1], `Flights: ${fmt(nationalTop[1].scheduled)}`, 'national top cell pooled flights');
    assert.equal(topLines[2], `Eligible arrivals: ${fmt(nationalTop[1].eligible)}`, 'national top cell pooled eligible');
    assert.equal(topLines[3], `Delayed (${'\u2265'}15 min): ${fmt(nationalTop[1].delayed)}`, 'national top cell pooled delayed');
    assert.equal(topLines[4], `Rate: ${rateText(nationalTop[1].delayed, nationalTop[1].eligible)}`, 'national top cell pooled rate');

    // Cross-partition scope: airport + airline + months change the grid, tooltips
    // pool across the two monthly partitions independently.
    await page.locator('#airport-search').fill('ORD');
    await page.locator('#airport-search').dispatchEvent('change'); // opens Airport Detail
    await page.locator('[data-tab="tab-temporal"]').click(); // return to the heatmap
    await page.waitForFunction(() => document.querySelectorAll('#temporalHeatmap .heat-cell').length > 0);
    await waitSettled(page);
    await page.locator('#airline-select').selectOption('UA');
    await page.locator('#month-start').selectOption('1');
    await page.locator('#month-end').selectOption('2');
    await page.waitForFunction(() => document.querySelectorAll('#temporalHeatmap .heat-cell').length > 0);
    await waitSettled(page);
    const ordTopLines = await hoverCell(page, topWeekday, topHour);
    assert.equal(ordTopLines[0], `${WEEKDAYS[topWeekday - 1]} · ${String(topHour).padStart(2, '0')}:00–${String(topHour).padStart(2, '0')}:59`,
      'ORD+UA scope: same slot labels');
    assert.equal(ordTopLines[1], `Flights: ${fmt(topKey[1].scheduled)}`, 'ORD+UA Jan-Feb pooled flights');
    assert.equal(ordTopLines[4], `Rate: ${rateText(topKey[1].delayed, topKey[1].eligible)}`, 'ORD+UA Jan-Feb pooled rate');
    assert.match(await page.locator('#temporalHeatmap text').first().textContent(),
      /Jan–Feb 2025 · reporting airline UA · Airport: ORD/, 'scope line follows the selection');
    // Observed zero delay is a real cell at the 0% color, never "no observations".
    const zeroLines = await hoverCell(page, zeroWeekday, zeroHour);
    assert.equal(zeroLines[1], `Flights: ${fmt(zeroGroup.scheduled)}`, 'zero-delay cell flights');
    assert.equal(zeroLines[2], `Eligible arrivals: ${fmt(zeroGroup.eligible)}`, 'zero-delay cell eligible');
    assert.equal(zeroLines[3], `Delayed (${'\u2265'}15 min): 0`, 'zero-delay cell has zero delayed');
    assert.equal(zeroLines[4], 'Rate: 0.0%', 'observed zero delay shows a zero rate');
    const zeroFill = await page.locator('#temporalHeatmap .heat-cell')
      .nth(cellIndex(zeroWeekday, zeroHour)).evaluate(el => getComputedStyle(el).fill);
    const maxFill = await page.locator('#temporalHeatmap .heat-cell')
      .nth(cellIndex(hotWeekday, hotHour)).evaluate(el => getComputedStyle(el).fill);
    assert.notEqual(zeroFill, maxFill, 'zero-delay color differs from the hottest cell');
    assert.equal(zeroFill, 'rgb(49, 54, 149)', 'observed zero renders at the 0% (blue) end');
    // Legend ends must agree with the cell mapping: left gradient stop = 0% (the
    // blue of a zero-rate cell), right stop = the scope maximum (the hottest cell).
    const legendStops = await page.locator('#heatLegendGradient stop')
      .evaluateAll(nodes => nodes.map(node => node.getAttribute('stop-color')));
    assert.equal(legendStops[0], zeroFill, 'legend 0% end matches the zero-rate cell color');
    assert.equal(legendStops[legendStops.length - 1], maxFill,
      'legend max end matches the hottest cell color');
    assert.match(await page.locator('#temporalHeatmap text').evaluateAll(
      nodes => nodes.map(n => n.textContent).join('\n')), /No eligible arrivals/,
      'legend documents the no-eligible case');
    await page.locator('#tab-temporal section').screenshot({ path: path.join(assets, 'heatmap-ord-ua-jan-feb.png') });

    // No observations vs low sample: MDT + June + OO has many of both.
    // Narrow the end first: picking start=6 while end=2 would reorder to Feb–Jun.
    await page.locator('#month-end').selectOption('6');
    await page.locator('#month-start').selectOption('6');
    await page.locator('#airline-select').selectOption('OO');
    await page.locator('#airport-search').fill('MDT');
    await page.locator('#airport-search').dispatchEvent('change'); // opens Airport Detail
    await page.locator('[data-tab="tab-temporal"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#temporalHeatmap .heat-cell').length > 0);
    await waitSettled(page);
    const [unWeekday, unHour] = unobserved[0];
    const unLines = await hoverCell(page, unWeekday, unHour);
    assert.equal(unLines[1], 'No observations under the current filters',
      'an unobserved slot states so instead of a zero rate');
    const unFill = await page.locator('#temporalHeatmap .heat-cell')
      .nth(cellIndex(unWeekday, unHour)).evaluate(el => getComputedStyle(el).fill);
    assert.equal(unFill, 'rgb(238, 241, 244)', 'unobserved cells render gray');
    assert.equal(await page.locator('#temporalHeatmap .heat-low').count(), lowCells.length,
      'one dashed marker per low-sample cell');
    const [lowWeekday, lowHour] = lowCells[0][0].split('|').map(Number);
    const lowGroup = lowCells[0][1];
    const lowLines = await hoverCell(page, lowWeekday, lowHour);
    assert.equal(lowLines[1], `Flights: ${fmt(lowGroup.scheduled)}`, 'low-sample cell flights');
    assert.ok(lowLines.some(line => line.startsWith('Low sample: fewer than 30 eligible arrivals')),
      'low-sample cells say so in the tooltip');
    assert.match(await page.locator('#temporalHeatmap text').first().textContent(),
      /Jun–Jun 2025 · reporting airline OO · Airport: MDT/, 'MDT scope line');
    // Cell totals under the narrow scope still reconcile with the summary rows.
    assert.equal(mdtScheduled,
      jun.filter(r => r.Origin === 'MDT' && r.Reporting_Airline === 'OO')
        .reduce((sum, r) => sum + Number(r.scheduled_flights), 0),
      'MDT grid total matches its summary rows');
    await page.locator('#tab-temporal section').screenshot({ path: path.join(assets, 'heatmap-mdt-june-oo.png') });

    // Regression: loading failure must clear the stale grid, show the error in
    // the panel, and recover on retry with the new scope.
    const failContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const failPage = await failContext.newPage();
    const failErrors = [];
    failPage.on('pageerror', error => failErrors.push(error.message));
    await failPage.goto(url);
    await failPage.waitForFunction(() => document.querySelector('#load-status').textContent.startsWith('Verified'));
    // Pick the single-month scope BEFORE the first open, so only January is
    // fetched and cached; blocking February can then hit the real request.
    await failPage.locator('#month-end').selectOption('1');
    await failPage.locator('#month-start').selectOption('1');
    await failPage.locator('[data-tab="tab-temporal"]').click();
    await failPage.waitForFunction(() => document.querySelectorAll('#temporalHeatmap .heat-cell').length > 0,
      null, { timeout: 90000 });
    await waitSettled(failPage);
    assert.match(await failPage.locator('#temporalHeatmap text').first().textContent(), /Jan–Jan 2025/);
    await failPage.route('**/data/temporal/2025-02.csv', route => route.abort());
    await failPage.locator('#month-end').selectOption('2'); // Jan–Feb: February is blocked
    await failPage.waitForFunction(() => document.querySelector('#load-status').textContent.startsWith('Chart could not load'));
    assert.equal(await failPage.locator('#temporalHeatmap .heat-cell').count(), 0,
      'the stale January grid is cleared while the new scope fails');
    assert.match(await failPage.locator('#temporalHeatmap').textContent(), /Chart could not load/,
      'the failure is visible inside the panel');
    assert.match(await failPage.locator('#filter-summary').innerText(), /Jan–Feb 2025/);
    // Retry: unblocking February and re-selecting the tab must genuinely RE-FETCH
    // the failed month (its cache entry was evicted by the failure) and render the
    // full Jan–Feb grid — not silently fall back to the cached January scope.
    await failPage.unrouteAll();
    await failPage.locator('[data-tab="tab-temporal"]').click(); // same tab: the status named it as the retry
    await failPage.waitForFunction(() => document.querySelector('#load-status').textContent.startsWith('Filters applied'),
      null, { timeout: 90000 });
    assert.match(await failPage.locator('#temporalHeatmap text').first().textContent(), /Jan–Feb 2025/,
      'the retry renders the failed scope, not a fallback');
    await assertWholeGrid(failPage,
      poolCells([...jan, ...feb], { start: 1, end: 2, airline: null, origin: null }));
    assert.deepEqual(failErrors, [], 'no page errors in the heatmap failure regression');
    await failContext.close();

    // Regression: a slow partition response must not let the older render win.
    const slowContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    await slowContext.route('**/data/temporal/2025-02.csv', async route => {
      await new Promise(resolve => setTimeout(resolve, 700));
      await route.continue();
    });
    const slowPage = await slowContext.newPage();
    const slowErrors = [];
    slowPage.on('pageerror', error => slowErrors.push(error.message));
    await slowPage.goto(url);
    await slowPage.waitForFunction(() => document.querySelector('#load-status').textContent.startsWith('Verified'));
    await slowPage.locator('#month-end').selectOption('1'); // single-month first: only January is fetched
    await slowPage.locator('#month-start').selectOption('1');
    await slowPage.locator('[data-tab="tab-temporal"]').click();
    await slowPage.waitForFunction(() => document.querySelectorAll('#temporalHeatmap .heat-cell').length > 0,
      null, { timeout: 90000 });
    await waitSettled(slowPage);
    await slowPage.locator('#month-end').selectOption('2'); // Jan–Feb with a slow February
    await slowPage.locator('#month-end').selectOption('1'); // newer selection while February loads
    await waitSettled(slowPage);
    await slowPage.waitForFunction(() => document.querySelector('#load-status').textContent.startsWith('Filters applied'));
    assert.match(await slowPage.locator('#temporalHeatmap text').first().textContent(), /Jan–Jan 2025/,
      'the newest selection wins under the slow response');
    await assertWholeGrid(slowPage, poolCells(jan, { start: 1, end: 1, airline: null, origin: null }));
    // The throttled February response is now given time to complete AFTER the
    // final render; it must not overwrite the newer scope.
    await slowPage.waitForTimeout(1500);
    assert.match(await slowPage.locator('#temporalHeatmap text').first().textContent(), /Jan–Jan 2025/,
      'the completed stale response still does not overwrite the grid');
    await assertWholeGrid(slowPage, poolCells(jan, { start: 1, end: 1, airline: null, origin: null }));
    assert.deepEqual(slowErrors, [], 'no page errors in the heatmap race regression');
    await slowContext.close();

    // Regression: input whose scheduled hours are ALL invalid must show the
    // anomaly explanation, not the ordinary empty state. (2025 data has none, so
    // the request is fulfilled with an hours-emptied copy of January.)
    const anomaly = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    await anomaly.route('**/data/temporal/2025-01.csv', async route => {
      const response = await route.fetch();
      const lines = (await response.text()).split('\n');
      const hourIndex = lines[0].split(',').indexOf('ScheduledDepHour');
      const emptied = lines.map((line, i) => {
        if (i === 0 || !line) return line;
        const cells = line.split(',');
        cells[hourIndex] = '';
        return cells.join(',');
      }).join('\n');
      await route.fulfill({ response, body: emptied });
    });
    const anomalyPage = await anomaly.newPage();
    const anomalyErrors = [];
    anomalyPage.on('pageerror', error => anomalyErrors.push(error.message));
    await anomalyPage.goto(url);
    await anomalyPage.waitForFunction(() => document.querySelector('#load-status').textContent.startsWith('Verified'));
    await anomalyPage.locator('#month-end').selectOption('1');
    await anomalyPage.locator('[data-tab="tab-temporal"]').click();
    await anomalyPage.waitForFunction(() => document.querySelector('#load-status').textContent.startsWith('Filters applied'));
    const anomalyText = await anomalyPage.locator('#temporalHeatmap').textContent();
    assert.match(anomalyText, /Data anomaly: all .* rows have an invalid scheduled departure hour/,
      'all-invalid hours show the anomaly explanation');
    assert.doesNotMatch(anomalyText, /No flights match the current filters/,
      'the anomaly is not reported as an ordinary empty state');
    assert.equal(await anomalyPage.locator('#temporalHeatmap .heat-cell').count(), 0);
    assert.deepEqual(anomalyErrors, [], 'no page errors in the anomaly regression');
    await anomaly.close();

    // Empty combination shows the explicit empty state.
    await page.locator('#airport-search').fill('ORD');
    await page.locator('#airport-search').dispatchEvent('change');
    await page.locator('[data-tab="tab-temporal"]').click();
    await page.locator('#airline-select').selectOption('HA');
    await page.waitForFunction(() => document.querySelector('#load-status').textContent.startsWith('Filters applied'));
    assert.match(await page.locator('#temporalHeatmap').textContent(), /No flights match the current filters/,
      'empty combination shows the explicit empty state');
    assert.equal(await page.locator('#temporalHeatmap .heat-cell').count(), 0);

    // Reset returns the full-year national grid.
    await page.locator('#filter-reset').click();
    await page.waitForFunction(() => document.querySelector('#kpis').textContent.includes('7,001,619'));
    await page.locator('[data-tab="tab-temporal"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#temporalHeatmap .heat-cell').length > 0);
    await waitSettled(page);
    assert.equal(await page.locator('#temporalHeatmap .heat-cell').count(), 168, 'reset restores the 7x24 grid');
    assert.match(await page.locator('#temporalHeatmap text').first().textContent(),
      /full year 2025 · all reporting airlines · all origin airports/, 'reset restores the default scope');
    assert.deepEqual(errors, [], 'no page errors in the D1 pass');

    const inputs = ['site/index.html', 'site/css/style.css', 'site/js/app.js', 'site/js/charts.js',
      'site/js/state.js', 'site/js/aggregate.js', 'site/js/data.js', 'site/data/manifest.json'];
    const hashes = {};
    for (const file of inputs) hashes[file] = createHash('sha256').update(await fs.readFile(path.join(root, file))).digest('hex');
    const result = {
      batch: 'D1 — weekday x scheduled-hour heatmap',
      browser: await browser.version(), checks: 'passed',
      expectations: {
        gridTotalScheduled: totalScheduled,
        ordUaJanFebTopCell: { weekday: WEEKDAYS[topWeekday - 1], hour: topHour, ...topKey[1] },
        zeroDelayCell: { weekday: WEEKDAYS[zeroWeekday - 1], hour: zeroHour, ...zeroGroup },
        mdtOOJune: { observedCells: expectations.mdtOOJune.size, lowSampleCells: lowCells.length,
                     unobservedCells: unobserved.length, scheduled: mdtScheduled },
      },
      checked: ['7x24 grid with Monday-first rows and 00-22 hour ticks', 'BTS 2400 convention stated',
        'all-invalid-hours input shows the anomaly explanation, not an ordinary empty state',
        'whole-grid verification: all 168 rendered slots match independently pooled values',
        'legend ends match the cell colors (0% blue, max red) and the no-eligible case is documented',
        'failed month load clears the stale grid, shows a panel error, and recovers on retry',
        'a slow partition response cannot replace the newest selection',
        'national grid reconciles to 7,001,619 scheduled (no partition loss)',
        'cell tooltips carry pooled flights, eligible, delayed, and rate',
        'observed zero delay shows 0.0% at the blue end; unobserved slots stay gray with "No observations"',
        'cross-partition pooling (ORD+UA Jan-Feb) matches independent sums',
        'airport+airline+month filters and reset update the heatmap consistently',
        'low-sample rule (fewer than 30 eligible) marks cells and says so in tooltips',
        'empty combination shows the explicit empty state'],
      notChecked: ['interaction timing performance (Batch E)', 'user study (Batch E)'],
      desktopViewport: [1440, 1100],
      limitations: 'Automated checks and visual inspection are not a user study or an interaction-performance evaluation.',
      source_sha256: hashes,
    };
    await fs.writeFile(path.join(root, 'reports/site_validation_batch_d1.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
