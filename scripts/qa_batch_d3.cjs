/* Batch D3 browser QA: volume-reliability scatterplot.
   Writes evidence to docs/assets/batch-d3/ and reports/site_validation_batch_d3.json.
   Never touches interim figures or other batches' evidence files.
   Usage: NODE_PATH=<playwright modules> node scripts/qa_batch_d3.cjs  (SITE_URL, CHROME_PATH optional). */
const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const url = process.env.SITE_URL || 'http://127.0.0.1:8765/';
const siteData = path.join(root, 'site/data');

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

async function readCsv(name) {
  return csvRows(await fs.readFile(path.join(siteData, name), 'utf8'));
}

/* Pool per group under a scope, mirroring the documented consumer rule. */
function poolGroups(rows, keyOf, { start, end, airline, origin }) {
  const groups = new Map();
  for (const row of rows) {
    const month = Number(row.Month);
    if (month < start || month > end) continue;
    if (airline && row.Reporting_Airline !== airline) continue;
    if (origin && row.Origin !== origin) continue;
    const key = keyOf(row);
    if (!groups.has(key)) {
      groups.set(key, { label: key, id: null, scheduled_flights: 0, eligible_arrivals: 0,
                        delayed_arrivals: 0 });
    }
    const group = groups.get(key);
    group.scheduled_flights += Number(row.scheduled_flights);
    group.eligible_arrivals += Number(row.eligible_arrivals);
    group.delayed_arrivals += Number(row.delayed_arrivals);
  }
  return [...groups.values()];
}

async function waitSettled(page) {
  await page.waitForFunction(() => {
    const text = document.querySelector('#load-status').textContent;
    return !text.startsWith('Updating') && !text.startsWith('Rendering');
  });
}

/* All rendered points with their bound data and geometry (viewBox units). */
async function renderedPoints(page) {
  return page.locator('#scatterChart .scatter-point').evaluateAll(els => els.map(el => ({
    label: el.__data__.label,
    id: el.__data__.id != null ? String(el.__data__.id) : null,
    scheduled: Number(el.__data__.scheduled_flights),
    eligible: Number(el.__data__.eligible_arrivals),
    delayed: Number(el.__data__.delayed_arrivals),
    rate: el.__data__.arrival_delay_rate,
    cx: Number(el.getAttribute('cx')),
    cy: Number(el.getAttribute('cy')),
  })));
}

function assertMatchesExpected(rendered, expected) {
  const byLabel = new Map(expected.map(group => [group.label, group]));
  for (const point of rendered) {
    const group = byLabel.get(point.label);
    assert.ok(group, `unexpected plotted group ${point.label}`);
    assert.equal(point.scheduled, group.scheduled_flights, `${point.label}: volume`);
    assert.equal(point.eligible, group.eligible_arrivals, `${point.label}: eligible`);
    assert.equal(point.delayed, group.delayed_arrivals, `${point.label}: delayed`);
    if (group.eligible_arrivals > 0) {
      assert.equal(point.rate, group.delayed_arrivals / group.eligible_arrivals,
        `${point.label}: rate is the pooled ratio, never zero-for-missing`);
    }
  }
}

/* Parse "~s" / percent tick labels back into numbers. */
function parseTick(text) {
  const match = text.match(/^([\d.]+)(k?m?)(%?)$/);
  if (!match) return null;
  let value = Number(match[1]);
  if (match[2] === 'k') value *= 1000;
  if (match[3] === '%') value /= 100;
  return value;
}

function parseTransform(transform) {
  if (!transform) return [0, 0];
  const match = transform.match(/translate\(([-\d.]+)[, ]([-\d.]+)\)/);
  return match ? [Number(match[1]), Number(match[2])] : [0, 0];
}

/* Verify cx/cy of every rendered point against the axis-derived scales:
   the bottom axis gives the log-volume mapping, the left axis the linear rate
   mapping; both are reconstructed from two reference ticks. */
async function assertPointPositions(page, rendered) {
  // cx/cy live in the plot group's coordinate system, so the ticks are compared in
  // that same system (axis translate + tick offset, without the outer translate).
  const axes = await page.locator('#scatterChart g.axis').evaluateAll(nodes =>
    nodes.map(node => ({
      transform: node.getAttribute('transform'), // may be absent for the y axis
      ticks: [...node.querySelectorAll('g.tick')].map(tick => ({
        offset: tick.getAttribute('transform'), // parsed on the Node side
        text: tick.querySelector('text')?.textContent ?? '',
      })),
    })));
  const [bottom] = axes.filter(axis => axis.ticks.some(t => /\d/.test(t.text) && !t.text.includes('%')));
  const [left] = axes.filter(axis => axis.ticks.some(t => t.text.includes('%')));
  assert.ok(bottom && left, 'both axes are rendered');
  const bottomTicks = bottom.ticks
    .map(tick => ({ value: parseTick(tick.text),
                    x: parseTransform(tick.offset)[0] })) // may carry a 0.5px crisp shift
    .filter(tick => tick.value != null)
    .sort((a, b) => a.value - b.value);
  assert.ok(bottomTicks.length >= 2, 'at least two x ticks anchor the scale');
  const leftTicks = left.ticks
    .map(tick => ({ value: parseTick(tick.text),
                    y: parseTransform(tick.offset)[1] })) // may carry a 0.5px crisp shift
    .filter(tick => tick.value != null)
    .sort((a, b) => a.value - b.value);
  assert.ok(leftTicks.length >= 2, 'at least two y ticks anchor the scale');

  // Slopes come from tick SPACING (sub-pixel crisp shifts cancel); anchors come
  // from the scale definitions: x(1) = 0 for the log axis and y(0) = the plot
  // height for the linear axis (the bottom axis translate exposes that height).
  const plotHeight = parseTransform(bottom.transform)[1];
  const slopeX = (bottomTicks[bottomTicks.length - 1].x - bottomTicks[0].x)
    / (Math.log10(bottomTicks[bottomTicks.length - 1].value) - Math.log10(bottomTicks[0].value));
  const slopeY = (leftTicks[leftTicks.length - 1].y - leftTicks[0].y)
    / (leftTicks[leftTicks.length - 1].value - leftTicks[0].value);

  for (const point of rendered) {
    const expectedX = Math.log10(point.scheduled) * slopeX; // domain minimum 1 sits at x = 0
    const expectedY = plotHeight + point.rate * slopeY;     // rate 0 sits at the plot bottom
    assert.ok(Math.abs(point.cx - expectedX) < 0.5,
      `${point.label}: cx ${point.cx.toFixed(2)} vs log-axis position ${expectedX.toFixed(2)}`);
    assert.ok(Math.abs(point.cy - expectedY) < 0.5,
      `${point.label}: cy ${point.cy.toFixed(2)} vs rate-axis position ${expectedY.toFixed(2)}`);
  }
  // Ticks stay within the plotted volume range (no crowding past the maximum).
  const maxScheduled = Math.max(...rendered.map(point => point.scheduled));
  for (const tick of bottomTicks) {
    assert.ok(tick.value <= maxScheduled * 1.01, `x tick ${tick.value} sits within the data range`);
  }
  return bottomTicks.length;
}

/* Index of a point that is the topmost element at its own center (safe to click). */
async function clickablePoint(page) {
  return page.locator('#scatterChart .scatter-point').evaluateAll(els => {
    for (const [i, el] of els.entries()) {
      const rect = el.getBoundingClientRect();
      const cx = rect.x + rect.width / 2;
      const cy = rect.y + rect.height / 2;
      if (document.elementFromPoint(cx, cy) === el) return { index: i, label: el.__data__.label };
    }
    return { index: -1, label: null };
  });
}

(async () => {
  const airportMonth = await readCsv('airport_month_airline.csv');
  const FULL = { start: 1, end: 12, airline: null, origin: null };
  const JAN_MAR = { start: 1, end: 3, airline: null, origin: null };
  const expectations = {
    airportsFull: poolGroups(airportMonth, row => row.Origin, FULL),
    airlinesFull: poolGroups(airportMonth, row => row.Reporting_Airline, FULL),
    airportsJanMar: poolGroups(airportMonth, row => row.Origin, JAN_MAR),
  };
  const plottedFull = expectations.airportsFull.filter(group => group.eligible_arrivals > 0);
  const notPlottedFull = expectations.airportsFull.length - plottedFull.length;
  const topVolume = [...plottedFull].sort((a, b) => b.scheduled_flights - a.scheduled_flights)[0];
  const plottedJanMar = expectations.airportsJanMar.filter(group => group.eligible_arrivals > 0);

  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  });
  try {
    const assets = path.join(root, 'docs/assets/batch-d3');
    await fs.mkdir(assets, { recursive: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1500 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    await page.goto(url);
    await page.waitForFunction(() => document.querySelector('#load-status').textContent.startsWith('Verified'));
    await page.locator('[data-tab="tab-scatter"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#scatterChart .scatter-point').length > 0);
    await waitSettled(page);

    // Coordinates: every rendered point matches its independently pooled group.
    const rendered = await renderedPoints(page);
    assert.equal(rendered.length, plottedFull.length,
      'plotted points = groups with eligible arrivals (missing rates are excluded, not zero)');
    assertMatchesExpected(rendered, expectations.airportsFull);
    assert.match(await page.locator('#scatterChart text').first().textContent(),
      /full year 2025 · all reporting airlines · one point per origin airport · minimum volume 0/);
    // Rendered positions: cx/cy must match independent log/linear axis mappings.
    const tickCount = await assertPointPositions(page, rendered);
    assert.ok(tickCount <= 7, `decade-only ticks stay uncluttered (${tickCount} ticks)`);

    // Tooltip via real hover on the top-volume point.
    const topIndex = rendered.findIndex(point => point.label === topVolume.label);
    await page.locator('#scatterChart .scatter-point').nth(topIndex).hover();
    await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('#tooltip')).opacity) > 0);
    const topTip = (await page.locator('#tooltip').innerText()).split('\n').map(line => line.trim());
    assert.equal(topTip[0], topVolume.label);
    assert.equal(topTip[1], `Scheduled: ${fmt(topVolume.scheduled_flights)}`);
    assert.equal(topTip[2], `Eligible arrivals: ${fmt(topVolume.eligible_arrivals)}`);
    assert.equal(topTip[3], `Delayed (${'\u2265'}15 min): ${fmt(topVolume.delayed_arrivals)}`);
    assert.equal(topTip[4], `Rate: ${rateText(topVolume.delayed_arrivals, topVolume.eligible_arrivals)}`);
    await page.mouse.move(0, 0);

    // Regression: with the filters already default, mode + threshold changes then
    // Reset must still invalidate the cached scatter (no state notification fires).
    await page.locator('input[name="scatter-mode"][value="airlines"]').check();
    await waitSettled(page);
    await page.locator('#scatter-min-volume').fill('10000');
    await page.locator('#scatter-min-volume').dispatchEvent('input');
    await waitSettled(page);
    await page.locator('#filter-reset').click();
    await page.waitForFunction(() => document.querySelector('#kpis').textContent.includes('7,001,619'));
    assert.equal(await page.locator('input[name="scatter-mode"][value="airports"]').isChecked(), true,
      'the radio returns to Airports');
    assert.equal(await page.locator('#scatter-min-volume').inputValue(), '0', 'the slider returns to 0');
    assert.equal(await page.locator('#scatter-min-volume-out').innerText(), '0',
      'the threshold text is synced with the reset value');
    await page.locator('[data-tab="tab-scatter"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#scatterChart .scatter-point').length > 0);
    await waitSettled(page);
    assert.match(await page.locator('#scatterChart text').first().textContent(),
      /one point per origin airport · minimum volume 0/, 'the chart follows the reset mode and threshold');
    assert.equal((await renderedPoints(page)).length, plottedFull.length,
      'the reset view plots the full airport set, not airlines');

    // Minimum-volume filter: points below the threshold are removed predictably.
    await page.locator('#scatter-min-volume').fill('10000');
    await page.locator('#scatter-min-volume').dispatchEvent('input');
    await page.waitForFunction(() => document.querySelectorAll('#scatterChart .scatter-point').length > 0);
    await waitSettled(page);
    const filtered = await renderedPoints(page);
    const expectedFiltered = plottedFull.filter(group => group.scheduled_flights >= 10000);
    assert.equal(filtered.length, expectedFiltered.length, 'minimum-volume filter count');
    assertMatchesExpected(filtered, expectations.airportsFull);
    assert.match(await page.locator('#scatterChart text').first().textContent(), /minimum volume 10,000/);
    await page.locator('#scatter-min-volume').fill('0');
    await page.locator('#scatter-min-volume').dispatchEvent('input');
    await page.waitForFunction(() => document.querySelectorAll('#scatterChart .scatter-point').length > 0);
    await waitSettled(page);

    // Missing rates: the TLH + OO + November group has eligible = 0 (one
    // cancelled/diverted flight) and must not be plotted; the scope line reports
    // the exclusion.
    await page.locator('#month-end').selectOption('11');
    await page.locator('#month-start').selectOption('11');
    await page.locator('#airline-select').selectOption('OO');
    await page.waitForFunction(() => document.querySelectorAll('#scatterChart .scatter-point').length > 0);
    await waitSettled(page);
    const novScope = { start: 11, end: 11, airline: 'OO', origin: null };
    const novPooled = poolGroups(airportMonth, row => row.Origin, novScope);
    const novExpected = novPooled.filter(group => group.eligible_arrivals > 0);
    const novExcluded = novPooled.length - novExpected.length;
    const novRendered = await renderedPoints(page);
    assert.equal(novRendered.length, novExpected.length, 'November+OO plotted count');
    assertMatchesExpected(novRendered, novPooled);
    assert.ok(!novRendered.some(point => point.label === 'TLH'),
      'the zero-eligible group is not plotted');
    assert.equal(novExcluded, 2, 'TLH and SPI both lack eligible arrivals in November+OO');
    assert.match(await page.locator('#scatterChart text').first().textContent(),
      new RegExp(`${novExcluded} group\\(s\\) without eligible arrivals are not plotted`),
      'the exclusion is reported');
    await page.locator('#tab-scatter section').screenshot({ path: path.join(assets, 'scatter-oo-november.png') });

    // Brush: a real drag defines a highlight set without changing denominators.
    await page.locator('#filter-reset').click();
    await page.waitForFunction(() => document.querySelector('#kpis').textContent.includes('7,001,619'));
    await page.locator('[data-tab="tab-scatter"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#scatterChart .scatter-point').length > 0);
    await waitSettled(page);
    const plot = await page.locator('#scatterChart').boundingBox();
    const scale = plot.width / 1100;
    const bx = plot.x + 90 * scale + 120 * scale;
    const by = plot.y + 46 * scale + 120 * scale;
    await page.mouse.move(bx, by);
    await page.mouse.down();
    await page.mouse.move(bx + 300 * scale, by + 250 * scale, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const brushNote = await page.locator('#scatter-brush-count').innerText();
    assert.match(brushNote, /Brushed: \d+ group\(s\) as a highlight set only — filters and denominators unchanged\./,
      'the brush reports a highlight-only set');
    const brushedCount = Number(brushNote.match(/Brushed: (\d+)/)[1]);
    const stroked = await page.locator('#scatterChart .scatter-point')
      .evaluateAll(els => els.filter(el => getComputedStyle(el).stroke === 'rgb(217, 83, 79)').length);
    assert.equal(stroked, brushedCount, 'brushed points carry the highlight stroke');
    assert.ok((await page.locator('#kpis').textContent()).includes('7,001,619'),
      'brushing never changes the national denominator');
    await page.locator('#scatter-clear-brush').click();
    assert.match(await page.locator('#scatter-brush-count').innerText(), /Brush cleared/);
    const cleared = await page.locator('#scatterChart .scatter-point')
      .evaluateAll(els => els.filter(el => getComputedStyle(el).stroke === 'rgb(217, 83, 79)').length);
    assert.equal(cleared, 0, 'clearing the brush removes the highlight');
    const selectionLeft = await page.locator('#scatterChart .scatter-brush .selection')
      .evaluateAll(boxes => boxes.filter(box => Number(box.getAttribute('width')) > 1).length);
    assert.equal(selectionLeft, 0, 'clearing the brush also clears the selection box and handles');

    // A scope change clears the brush set, the selection box, and the note.
    await page.mouse.move(bx, by);
    await page.mouse.down();
    await page.mouse.move(bx + 300 * scale, by + 250 * scale, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    assert.match(await page.locator('#scatter-brush-count').innerText(), /Brushed: \d+/,
      'a brush set exists before the scope change');
    await page.locator('#scatter-min-volume').fill('10000');
    await page.locator('#scatter-min-volume').dispatchEvent('input');
    await page.waitForFunction(() => document.querySelectorAll('#scatterChart .scatter-point').length > 0);
    await waitSettled(page);
    const selectionAfterScope = await page.locator('#scatterChart .scatter-brush .selection')
      .evaluateAll(boxes => boxes.filter(box => Number(box.getAttribute('width')) > 1).length);
    assert.equal(selectionAfterScope, 0, 'a threshold change clears the selection box');
    assert.match(await page.locator('#scatter-brush-count').innerText(), /Brush cleared/,
      'a threshold change resets the brush note');
    await page.locator('#scatter-min-volume').fill('0');
    await page.locator('#scatter-min-volume').dispatchEvent('input');
    await page.waitForFunction(() => document.querySelectorAll('#scatterChart .scatter-point').length > 0);
    await waitSettled(page);
    await page.locator('#tab-scatter section').screenshot({ path: path.join(assets, 'scatter-brushed.png') });

    // Regression: after brushing, a global month change must clear the set, the
    // note, the strokes, and the scope line's brushed count.
    await page.mouse.move(bx, by);
    await page.mouse.down();
    await page.mouse.move(bx + 300 * scale, by + 250 * scale, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    assert.match(await page.locator('#scatter-brush-count').innerText(), /Brushed: \d+/,
      'a brush set exists before the filter change');
    await page.locator('#month-end').selectOption('3');
    await page.locator('#month-start').selectOption('1');
    await page.waitForFunction(() => document.querySelectorAll('#scatterChart .scatter-point').length > 0);
    await waitSettled(page);
    assert.match(await page.locator('#scatter-brush-count').innerText(), /Brush cleared/,
      'the month change clears the brush note');
    const scopeAfterFilter = await page.locator('#scatterChart text').first().textContent();
    assert.match(scopeAfterFilter, /0 currently brushed/, 'the scope line count resets with the set');
    assert.doesNotMatch(scopeAfterFilter, /[1-9]\d* currently brushed/,
      'no stale brushed count survives the filter change');
    const strokesAfterFilter = await page.locator('#scatterChart .scatter-point')
      .evaluateAll(els => els.filter(el => getComputedStyle(el).stroke === 'rgb(217, 83, 79)').length);
    assert.equal(strokesAfterFilter, 0, 'no highlight strokes survive the filter change');
    const boxAfterFilter = await page.locator('#scatterChart .scatter-brush .selection')
      .evaluateAll(boxes => boxes.filter(box => Number(box.getAttribute('width')) > 1).length);
    assert.equal(boxAfterFilter, 0, 'no selection box survives the filter change');
    await page.locator('#filter-reset').click();
    await page.waitForFunction(() => document.querySelector('#kpis').textContent.includes('7,001,619'));
    await page.locator('[data-tab="tab-scatter"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#scatterChart .scatter-point').length > 0);
    await waitSettled(page);

    // Airlines mode: one point per reporting airline, pooled coordinates; a
    // selected airline is highlighted without dropping the comparison context.
    await page.locator('input[name="scatter-mode"][value="airlines"]').check();
    await page.waitForFunction(() => document.querySelectorAll('#scatterChart .scatter-point').length > 0);
    await waitSettled(page);
    let airlineRendered = await renderedPoints(page);
    assert.equal(airlineRendered.length, expectations.airlinesFull.length, 'airline point count');
    assertMatchesExpected(airlineRendered, expectations.airlinesFull);
    assert.match(await page.locator('#scatterChart text').first().textContent(),
      /one point per reporting airline/);
    await page.locator('#airline-select').selectOption('UA');
    await page.waitForFunction(() => document.querySelectorAll('#scatterChart .scatter-point').length > 0);
    await waitSettled(page);
    airlineRendered = await renderedPoints(page);
    assert.equal(airlineRendered.length, 14, 'the selected airline stays in the full comparison');
    const uaScope = await page.locator('#scatterChart text').first().textContent();
    assert.match(uaScope, /all reporting airlines/, 'the scope keeps the full comparison wording');
    assert.match(uaScope, /UA highlighted/, 'the scope line names the highlighted airline');
    assert.doesNotMatch(uaScope, /reporting airline UA/, 'the selection is not described as a filter');
    const uaStroke = await page.locator('#scatterChart .scatter-point')
      .evaluateAll(els => {
        const ua = els.find(el => el.__data__.label === 'UA');
        return ua ? getComputedStyle(ua).stroke : null;
      });
    assert.equal(uaStroke, 'rgb(20, 48, 77)', 'the UA point carries the selection stroke');
    await page.locator('#airline-select').selectOption('');
    await page.locator('#tab-scatter section').screenshot({ path: path.join(assets, 'scatter-airlines.png') });

    // Clicking an airport point opens its detail with matching statistics.
    await page.locator('input[name="scatter-mode"][value="airports"]').check();
    await page.waitForFunction(() => document.querySelectorAll('#scatterChart .scatter-point').length > 0);
    await waitSettled(page);
    const clickable = await clickablePoint(page);
    assert.ok(clickable.index >= 0, 'a clickable (unoccluded) point exists');
    await page.locator('#scatterChart .scatter-point').nth(clickable.index).click();
    await waitSettled(page);
    assert.equal(await page.locator('[data-tab="tab-detail"]').getAttribute('aria-pressed'), 'true',
      'clicking a point opens Airport Detail');
    assert.match(await page.locator('#detail-sub').innerText(), new RegExp(clickable.label),
      'the detail shows the clicked airport');
    const clickedExpected = poolGroups(airportMonth, row => row.Origin, FULL)
      .find(group => group.label === clickable.label);
    await page.waitForFunction(expected => document.querySelector('#detail-status').textContent.includes(expected),
      fmt(clickedExpected.scheduled_flights));

    // Reset restores the scatter defaults from a modified state.
    await page.locator('[data-tab="tab-scatter"]').click();
    await waitSettled(page);
    await page.locator('#scatter-min-volume').fill('5000');
    await page.locator('#scatter-min-volume').dispatchEvent('input');
    await waitSettled(page);
    await page.locator('#filter-reset').click();
    await page.waitForFunction(() => document.querySelector('#kpis').textContent.includes('7,001,619'));
    assert.equal(await page.locator('#scatter-min-volume').inputValue(), '0', 'reset restores the volume filter');
    assert.equal(await page.locator('input[name="scatter-mode"][value="airports"]').isChecked(), true,
      'reset restores the airports mode');
    await page.locator('[data-tab="tab-scatter"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#scatterChart .scatter-point').length > 0);
    await waitSettled(page);
    assert.equal(await renderedPoints(page).then(points => points.length), plottedFull.length,
      'reset restores the full plotted set');
    assert.deepEqual(errors, [], 'no page errors in the D3 pass');

    const inputs = ['site/index.html', 'site/css/style.css', 'site/js/app.js', 'site/js/charts.js',
      'site/js/state.js', 'site/js/aggregate.js', 'site/js/data.js', 'site/data/manifest.json'];
    const hashes = {};
    for (const file of inputs) hashes[file] = createHash('sha256').update(await fs.readFile(path.join(root, file))).digest('hex');
    const result = {
      batch: 'D3 — volume-reliability scatterplot',
      browser: await browser.version(), checks: 'passed',
      expectations: {
        plottedAirportsFull: plottedFull.length,
        excludedNoEligibleFull: notPlottedFull,
        topVolume: { label: topVolume.label, scheduled: topVolume.scheduled_flights,
                     rate: rateText(topVolume.delayed_arrivals, topVolume.eligible_arrivals) },
        airlines: expectations.airlinesFull.length,
      },
      checked: ['point coordinates match independently pooled values (all rendered points)',
        'rendered cx/cy match axis-derived log/linear positions within ±0.5px; x ticks stay in range',
        'reset with default filters still invalidates mode + threshold (radio, slider, output, points)',
        'clearing the brush removes the selection box and handles; scope changes clear brush state too',
        'a global month change after brushing clears the set, note, strokes, box, and the scope count',
        'airlines-mode selection highlights the chosen carrier without dropping context',
        'missing rates excluded and reported, never plotted as zero',
        'minimum-volume filter behaves predictably and updates the scope line',
        'tooltips carry scheduled, eligible, delayed, and rate via real hover',
        'brush defines a highlight-only set; denominators unchanged; clear works',
        'airlines mode coordinates match; airports points open Airport Detail',
        'reset restores mode, volume filter, and the full plotted set'],
      notChecked: ['interaction timing performance (Batch E)', 'user study (Batch E)'],
      desktopViewport: [1440, 1500],
      limitations: 'Automated checks and visual inspection are not a user study or an interaction-performance evaluation.',
      source_sha256: hashes,
    };
    await fs.writeFile(path.join(root, 'reports/site_validation_batch_d3.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
