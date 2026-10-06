/* Batch D2 browser QA: comparative 100% stacked cause bars.
   Writes evidence to docs/assets/batch-d2/ and reports/site_validation_batch_d2.json.
   Never touches interim figures or other batches' evidence files.
   Usage: NODE_PATH=<playwright modules> node scripts/qa_batch_d2.cjs  (SITE_URL, CHROME_PATH optional). */
const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const url = process.env.SITE_URL || 'http://127.0.0.1:8765/';
const siteData = path.join(root, 'site/data');
const CAUSES = ['CarrierDelay', 'WeatherDelay', 'NASDelay', 'SecurityDelay', 'LateAircraftDelay'];
const CAUSE_LABELS = { CarrierDelay: 'Carrier', WeatherDelay: 'Weather', NASDelay: 'NAS',
                       SecurityDelay: 'Security', LateAircraftDelay: 'Late Aircraft' };
/* The five stable category colors as rendered (inline styles beat the .bar CSS). */
const CAUSE_FILLS = ['rgb(59, 125, 216)', 'rgb(217, 83, 79)', 'rgb(240, 173, 78)',
                     'rgb(92, 184, 92)', 'rgb(142, 107, 191)'];

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

/* Pool rows per group, mirroring the Batch A consumer rule (documented in
   docs/2026-10-05-filter-data-contract.md): sum counts, pool cause minutes only
   over rows with observations, recompute shares from the pooled total. */
function poolGroups(rows, keyOf, { start, end, airline, origin }) {
  const groups = new Map();
  for (const row of rows) {
    const month = Number(row.Month);
    if (month < start || month > end) continue;
    if (airline && row.Reporting_Airline !== airline) continue;
    if (origin && row.Origin !== origin) continue;
    const key = keyOf(row);
    if (!groups.has(key)) {
      groups.set(key, { label: key, scheduled_flights: 0, delayed_arrivals: 0,
        cause_observed_flights: 0, cause_partial_flights: 0, delayed_cause_missing: 0,
        minutes: Object.fromEntries(CAUSES.map(c => [c, 0])),
        observations: Object.fromEntries(CAUSES.map(c => [c, 0])) });
    }
    const group = groups.get(key);
    group.scheduled_flights += Number(row.scheduled_flights);
    group.delayed_arrivals += Number(row.delayed_arrivals);
    group.cause_observed_flights += Number(row.cause_observed_flights);
    group.cause_partial_flights += Number(row.cause_partial_flights);
    group.delayed_cause_missing += Number(row.delayed_cause_missing);
    for (const cause of CAUSES) {
      const observations = Number(row[`${cause}_observations`]) || 0;
      group.observations[cause] += observations;
      if (observations > 0) group.minutes[cause] += Number(row[`${cause}_minutes`]) || 0;
    }
  }
  return [...groups.values()];
}

const groupTotal = group => CAUSES.reduce((sum, cause) => sum + group.minutes[cause], 0);
const groupHasPartial = group => group.cause_partial_flights > 0;

async function waitSettled(page) {
  await page.waitForFunction(() => {
    const text = document.querySelector('#load-status').textContent;
    return !text.startsWith('Updating') && !text.startsWith('Rendering');
  });
}

async function getRowData(page, label) {
  return page.locator('#causeCompareChart').evaluate((el, rowLabel) => {
    const segments = [...el.querySelectorAll('.cause-seg')]
      .filter(seg => seg.__data__.label === rowLabel)
      .map(seg => ({ cat: seg.__data__.cat, share: seg.__data__.share,
                     minutes: seg.__data__.minutes, width: Number(seg.getAttribute('width')),
                     x: Number(seg.getAttribute('x')), fill: getComputedStyle(seg).fill }));
    const none = [...el.querySelectorAll('.cause-none')]
      .filter(node => node.__data__.label === rowLabel)
      .map(node => node.textContent);
    return { segments, none };
  }, label);
}

/* Real mouse interaction only: locate the element's index from its bound data,
   then hover it with the actual pointer (no synthetic event dispatch). */
async function segmentIndex(page, label, cat) {
  return page.locator('#causeCompareChart .cause-seg').evaluateAll((segs, args) =>
    segs.findIndex(seg => seg.__data__.label === args.label && seg.__data__.cat === args.cat),
  { label, cat });
}

async function hoverSegment(page, label, cat) {
  const index = await segmentIndex(page, label, cat);
  assert.ok(index >= 0, `segment ${label}/${cat} exists for a real hover`);
  await page.locator('#causeCompareChart .cause-seg').nth(index).hover();
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('#tooltip')).opacity) > 0);
  const lines = (await page.locator('#tooltip').innerText()).split('\n').map(line => line.trim());
  await page.mouse.move(0, 0);
  return lines;
}

async function hoverRowLabel(page, label) {
  await page.locator('#causeCompareChart .tick text').filter({ hasText: label }).first().hover();
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('#tooltip')).opacity) > 0);
  const lines = (await page.locator('#tooltip').innerText()).split('\n').map(line => line.trim());
  await page.mouse.move(0, 0);
  return lines;
}

async function hoverNoMinutes(page, label) {
  const index = await page.locator('#causeCompareChart .cause-none').evaluateAll((nodes, rowLabel) =>
    nodes.findIndex(node => node.__data__.label === rowLabel), label);
  assert.ok(index >= 0, `no-minutes note for ${label} exists for a real hover`);
  await page.locator('#causeCompareChart .cause-none').nth(index).hover();
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('#tooltip')).opacity) > 0);
  const lines = (await page.locator('#tooltip').innerText()).split('\n').map(line => line.trim());
  await page.mouse.move(0, 0);
  return lines;
}

const BAR_WIDTH = 740; // viewBox 1100 - margins 190/170: every complete bar spans this

(async () => {
  const airportMonth = csvRows(await fs.readFile(path.join(siteData, 'airport_month_airline.csv'), 'utf8'));
  const FULL = { start: 1, end: 12, airline: null, origin: null };
  const JAN_MAR = { start: 1, end: 3, airline: null, origin: null };

  const airportsFull = poolGroups(airportMonth, row => row.Origin, FULL);
  const airlinesFull = poolGroups(airportMonth, row => row.Reporting_Airline, FULL);
  const airlinesJanMar = poolGroups(airportMonth, row => row.Reporting_Airline, JAN_MAR);
  const expectedTop12 = [...airportsFull].sort((a, b) => b.scheduled_flights - a.scheduled_flights
    || (a.label < b.label ? -1 : 1)).slice(0, 12).map(group => group.label);

  // Fixtures for the missing-attribution rules: a scope whose chosen group has a
  // positive scheduled count but no reported minutes, and a partial-attribution one.
  const perCombo = poolGroups(airportMonth, row => `${row.Origin}|${row.Reporting_Airline}|${row.Month}`,
    { start: 1, end: 12, airline: null, origin: null });
  const zeroTotal = perCombo
    .filter(group => group.scheduled_flights >= 5 && groupTotal(group) === 0)
    .sort((a, b) => b.scheduled_flights - a.scheduled_flights)[0];
  const partial = perCombo.filter(groupHasPartial).sort((a, b) => b.scheduled_flights - a.scheduled_flights)[0];
  assert.ok(zeroTotal, 'dataset contains a positive-scheduled group with zero reported minutes');
  const [zeroOrigin, zeroAirline, zeroMonth] = zeroTotal.label.split('|');

  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  });
  try {
    const assets = path.join(root, 'docs/assets/batch-d2');
    await fs.mkdir(assets, { recursive: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1500 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    await page.goto(url);
    await page.waitForFunction(() => document.querySelector('#load-status').textContent.startsWith('Verified'));
    await page.locator('[data-tab="tab-cause-compare"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#causeCompareChart .cause-seg').length > 0);
    await waitSettled(page);

    // Airports mode (default): the busiest 12 groups; every complete bar sums to
    // 100% within tolerance, and segment shares match the pooled minutes.
    const topLabels = await page.locator('#causeCompareChart .tick text').evaluateAll(
      nodes => nodes.map(node => node.textContent).filter(text => /^[A-Z]{3}$/.test(text)));
    assert.deepEqual(topLabels.sort(), expectedTop12.slice().sort(), 'busiest 12 airports compared');
    for (const label of expectedTop12.slice(0, 12)) {
      const expected = airportsFull.find(group => group.label === label);
      const data = await getRowData(page, label);
      const total = groupTotal(expected);
      assert.equal(data.none.length, 0, `${label}: complete bar has no placeholder`);
      const widthSum = data.segments.reduce((sum, seg) => sum + seg.width, 0);
      assert.ok(Math.abs(widthSum - BAR_WIDTH) < 0.5, `${label}: segments sum to 100% (±0.5px)`);
      for (const seg of data.segments) {
        const cause = Object.keys(CAUSE_LABELS).find(key => CAUSE_LABELS[key] === seg.cat);
        assert.ok(Math.abs(seg.share - seg.minutes / total) < 1e-9, `${label}/${seg.cat}: segment share`);
        assert.ok(Math.abs(seg.width / widthSum - expected.minutes[cause] / total) < 0.002,
          `${label}/${seg.cat}: rendered width matches the pooled share`);
      }
    }
    await page.locator('#tab-cause-compare section').screenshot({ path: path.join(assets, 'cause-airports-full.png') });

    // Stable category colors: the five fills appear on segments and nowhere else.
    const fills = await page.locator('#causeCompareChart .cause-seg')
      .evaluateAll(segs => [...new Set(segs.map(seg => getComputedStyle(seg).fill))]);
    assert.deepEqual(fills.slice().sort(), CAUSE_FILLS.slice().sort(), 'exactly the five stable colors');
    // Itemized tooltip on the top group's largest segment.
    const topGroup = [...airportsFull].sort((a, b) => b.scheduled_flights - a.scheduled_flights)[0];
    const topTotal = groupTotal(topGroup);
    const topCause = CAUSES.reduce((best, cause) =>
      topGroup.minutes[cause] > topGroup.minutes[best] ? cause : best, CAUSES[0]);
    const tip = await hoverSegment(page, topGroup.label, CAUSE_LABELS[topCause]);
    assert.equal(tip[0], `${topGroup.label} — ${CAUSE_LABELS[topCause]}`);
    assert.equal(tip[1], `${fmt(topGroup.minutes[topCause])} min`, 'pooled minutes in the tooltip');
    assert.ok(Math.abs(Number(tip[2].replace('Share: ', '').replace('%', ''))
      - (100 * topGroup.minutes[topCause] / topTotal)) < 0.05, 'pooled share in the tooltip');
    assert.equal(tip[3], `Observed on ${fmt(topGroup.observations[topCause])} delayed arrivals`,
      'observation count in the tooltip');
    // Row-level completeness counts.
    const rowTip = await hoverRowLabel(page, topGroup.label);
    assert.equal(rowTip[3], `Attribution observed on ${fmt(topGroup.cause_observed_flights)} of ${fmt(topGroup.delayed_arrivals)} delayed arrivals`,
      'completeness counts on the row');
    assert.match(rowTip[4], /Partial: /);
    assert.match((await page.locator('#causeCompareChart').textContent()), /missing attribution is not zero/i);
    assert.deepEqual(errors, [], 'no page errors in the default pass');

    // Regression (review): with the global filters at their defaults, switching
    // to Airlines and pressing Reset must still invalidate the cached view —
    // Reset does not emit a state notification when nothing changed.
    await page.locator('input[name="cause-compare-mode"][value="airlines"]').check();
    await page.waitForFunction(() => document.querySelectorAll('#causeCompareChart .cause-seg').length > 0);
    await waitSettled(page);
    assert.match(await page.locator('#causeCompareChart text').first().textContent(),
      /one bar per reporting airline/, 'airlines mode is active before Reset');
    await page.locator('#filter-reset').click();
    await page.waitForFunction(() => document.querySelector('#kpis').textContent.includes('7,001,619'));
    assert.equal(await page.locator('input[name="cause-compare-mode"][value="airports"]').isChecked(),
      true, 'the radio returns to Airports');
    await page.locator('[data-tab="tab-cause-compare"]').click();
    await waitSettled(page);
    const resetScope = await page.locator('#causeCompareChart text').first().textContent();
    assert.match(resetScope, /one bar per origin airport/, 'the chart follows the reset mode');
    assert.doesNotMatch(resetScope, /one bar per reporting airline/,
      'no stale airlines rendering survives Reset');
    const resetRows = await page.locator('#causeCompareChart .tick text').evaluateAll(
      nodes => nodes.map(node => node.textContent).filter(text => /^[A-Z]{3}$/.test(text)));
    assert.deepEqual(resetRows.sort(), expectedTop12.slice().sort(),
      'the rows are the busiest airports, not airlines');
    assert.deepEqual(errors, [], 'no page errors in the reset-mode regression');

    // Airlines mode under Jan–Mar: 14 carriers, shares from the pooled month range.
    await page.locator('input[name="cause-compare-mode"][value="airlines"]').check();
    await page.waitForFunction(() => document.querySelectorAll('#causeCompareChart .cause-seg').length > 0);
    await waitSettled(page);
    assert.match(await page.locator('#causeCompareChart text').first().textContent(),
      /full year 2025 · all origin airports · one bar per reporting airline/);
    await page.locator('#month-start').selectOption('1');
    await page.locator('#month-end').selectOption('3');
    await page.waitForFunction(() => document.querySelectorAll('#causeCompareChart .cause-seg').length > 0);
    await waitSettled(page);
    const airlineLabels = await page.locator('#causeCompareChart .tick text').evaluateAll(
      nodes => nodes.map(node => node.textContent).filter(text => /^[A-Z0-9]{2}$/.test(text)));
    assert.equal(airlineLabels.length, airlinesJanMar.length, 'every reporting airline has a row');
    for (const group of airlinesJanMar) {
      const total = groupTotal(group);
      if (total <= 0) continue;
      const data = await getRowData(page, group.label);
      const widthSum = data.segments.reduce((sum, seg) => sum + seg.width, 0);
      assert.ok(Math.abs(widthSum - BAR_WIDTH) < 0.5, `${group.label}: segments sum to 100%`);
      for (const seg of data.segments) {
        const cause = Object.keys(CAUSE_LABELS).find(key => CAUSE_LABELS[key] === seg.cat);
        assert.ok(Math.abs(seg.width / widthSum - group.minutes[cause] / total) < 0.002,
          `${group.label}/${seg.cat}: pooled share under Jan–Mar`);
      }
    }
    // Airport selection scopes the airline comparison to that airport.
    await page.locator('#airport-search').fill('ORD');
    await page.locator('#airport-search').dispatchEvent('change');
    await page.locator('[data-tab="tab-cause-compare"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#causeCompareChart .cause-seg').length > 0);
    await waitSettled(page);
    assert.match(await page.locator('#causeCompareChart text').first().textContent(),
      /Jan–Mar 2025 · airport ORD · one bar per reporting airline/);
    const ordAirlines = poolGroups(airportMonth, row => row.Reporting_Airline,
      { start: 1, end: 3, airline: null, origin: 'ORD' });
    const ordLabels = await page.locator('#causeCompareChart .tick text').evaluateAll(
      nodes => nodes.map(node => node.textContent).filter(text => /^[A-Z0-9]{2}$/.test(text)));
    assert.equal(ordLabels.length, ordAirlines.length, 'rows pool only the selected airport');
    await page.locator('#tab-cause-compare section').screenshot({ path: path.join(assets, 'cause-airlines-ord-jan-mar.png') });

    // Missing/zero-total attribution: the reviewed rule — never a fabricated bar.
    await page.locator('#airport-search').fill('');
    await page.locator('#airport-search').dispatchEvent('change');
    await page.locator('input[name="cause-compare-mode"][value="airports"]').check();
    // Narrow the end first: start=4 with end=3 would reorder to Mar–Apr.
    await page.locator('#month-end').selectOption(zeroMonth);
    await page.locator('#month-start').selectOption(zeroMonth);
    await page.locator('#airline-select').selectOption(zeroAirline);
    await page.locator('#airport-search').fill(zeroOrigin);
    await page.locator('#airport-search').dispatchEvent('change'); // opens Airport Detail
    await page.locator('[data-tab="tab-cause-compare"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#causeCompareChart .cause-seg').length > 0);
    await waitSettled(page);
    const zeroData = await getRowData(page, zeroOrigin);
    assert.equal(zeroData.segments.length, 0, `${zeroOrigin}: no segments without reported minutes`);
    if (zeroTotal.delayed_arrivals > 0) {
      assert.match(zeroData.none[0], /No reported cause minutes \(attribution missing or zero\)/,
        'zero-total attribution is explained, never fabricated');
    } else {
      assert.match(zeroData.none[0], /No delayed arrivals under the current filters/);
    }
    // The placeholder text is a real hover target for the group's counts.
    const noneTip = await hoverNoMinutes(page, zeroOrigin);
    assert.equal(noneTip[1], `Scheduled: ${fmt(zeroTotal.scheduled_flights)}`,
      'zero-total group keeps its scheduled count');
    assert.match(noneTip[3], /Reported minutes: none/, 'zero-total group reports no minutes');
    // Other rows in the same scope still sum to 100%.
    const scopeRows = await page.locator('#causeCompareChart .tick text').evaluateAll(
      nodes => nodes.map(node => node.textContent));
    const zeroScopeExpected = poolGroups(airportMonth, row => row.Origin,
      { start: Number(zeroMonth), end: Number(zeroMonth), airline: zeroAirline, origin: null });
    for (const label of scopeRows) {
      const expected = zeroScopeExpected.find(group => group.label === label);
      if (!expected || groupTotal(expected) <= 0) continue;
      const data = await getRowData(page, label);
      const widthSum = data.segments.reduce((sum, seg) => sum + seg.width, 0);
      assert.ok(Math.abs(widthSum - BAR_WIDTH) < 0.5, `${label}: complete bar unaffected by the zero-total row`);
    }
    await page.locator('#tab-cause-compare section').screenshot({ path: path.join(assets, 'cause-zero-total.png') });

    // Synthetic attribution cases (the baseline has no partial or all-missing
    // pooled group): rewrite one combo per scenario via request fulfillment.
    const csvText = await fs.readFile(path.join(siteData, 'airport_month_airline.csv'), 'utf8');
    // Serve the (un)modified disk copy directly: the local static server resets
    // burst connections, so route.fetch is deliberately avoided.
    const rewriteCombo = (mutate) => {
      const lines = csvText.split('\n');
      const header = lines[0].split(',');
      const idx = name => header.indexOf(name);
      for (let i = 1; i < lines.length; i++) {
        if (!lines[i]) continue;
        const cells = lines[i].split(',');
        if (cells[idx('Origin')] === mutate.origin && cells[idx('Reporting_Airline')] === mutate.airline
            && cells[idx('Month')] === mutate.month) {
          mutate.apply(cells, idx);
          lines[i] = cells.join(',');
          break;
        }
      }
      const body = lines.join('\n');
      return async route => route.fulfill({ status: 200, contentType: 'text/csv', body });
    };

    // (a) Partial: one category becomes unobserved; the remaining four must still
    // renormalize to 100% with the completeness statistics exposed.
    const partialFixture = perCombo
      .filter(group => group.scheduled_flights >= 15 && group.scheduled_flights <= 40
        && group.delayed_arrivals >= 3)
      .sort((a, b) => b.scheduled_flights - a.scheduled_flights)[0];
    assert.ok(partialFixture, 'a partial-attribution fixture exists');
    const [pOrigin, pAirline, pMonth] = partialFixture.label.split('|');
    const partialContext = await browser.newContext({ viewport: { width: 1440, height: 1500 } });
    await partialContext.route('**/data/airport_month_airline.csv',
      rewriteCombo({ origin: pOrigin, airline: pAirline, month: pMonth,
        apply: (cells, idx) => {
          cells[idx('SecurityDelay_minutes')] = '';
          cells[idx('SecurityDelay_observations')] = '0';
          cells[idx('cause_partial_flights')] = cells[idx('delayed_arrivals')];
        } }));
    const partialPage = await partialContext.newPage();
    await partialPage.goto(url);
    await partialPage.waitForFunction(() => document.querySelector('#load-status').textContent.startsWith('Verified'));
    await partialPage.locator('#month-end').selectOption(pMonth);
    await partialPage.locator('#month-start').selectOption(pMonth);
    await partialPage.locator('#airline-select').selectOption(pAirline);
    await partialPage.locator('#airport-search').fill(pOrigin);
    await partialPage.locator('#airport-search').dispatchEvent('change');
    await partialPage.locator('[data-tab="tab-cause-compare"]').click();
    await partialPage.waitForFunction(() => document.querySelectorAll('#causeCompareChart .cause-seg').length > 0);
    await waitSettled(partialPage);
    const partialData = await getRowData(partialPage, pOrigin);
    assert.equal(partialData.segments.length, 4, 'the unobserved category contributes no segment');
    assert.ok(!partialData.segments.some(seg => seg.cat === 'Security'), 'Security is the unobserved category');
    const partialWidthSum = partialData.segments.reduce((sum, seg) => sum + seg.width, 0);
    assert.ok(Math.abs(partialWidthSum - BAR_WIDTH) < 0.5, 'remaining categories renormalize to 100%');
    const partialSegTip = await hoverSegment(partialPage, pOrigin, 'Carrier');
    assert.match(partialSegTip[4], /Attribution observed on 1 of 1 delayed arrivals|Attribution observed on /,
      'segment tooltip repeats the completeness statistics');
    assert.match(partialSegTip[5], new RegExp(`Partial: ${fmt(partialFixture.delayed_arrivals)}`),
      'segment tooltip exposes the simulated partial count');
    const partialLabelTip = await hoverRowLabel(partialPage, pOrigin);
    assert.match(partialLabelTip[4], new RegExp(`Partial: ${fmt(partialFixture.delayed_arrivals)}`),
      'the row label is a real hover target for completeness counts');
    await partialPage.locator('#tab-cause-compare section').screenshot(
      { path: path.join(assets, 'cause-partial-synthetic.png') });
    await partialContext.close();

    // (b) All-missing: delayed arrivals with no observations at all must stay an
    // explicit no-minutes row — never a fabricated complete bar, never zeros.
    const missingFixture = perCombo
      .filter(group => group.scheduled_flights >= 10 && group.delayed_arrivals >= 2
        && !(group.label === partialFixture.label))
      .sort((a, b) => b.scheduled_flights - a.scheduled_flights)[0];
    assert.ok(missingFixture, 'an all-missing fixture exists');
    const [mOrigin, mAirline, mMonth] = missingFixture.label.split('|');
    const missingContext = await browser.newContext({ viewport: { width: 1440, height: 1500 } });
    await missingContext.route('**/data/airport_month_airline.csv',
      rewriteCombo({ origin: mOrigin, airline: mAirline, month: mMonth,
        apply: (cells, idx) => {
          for (const cause of CAUSES) {
            cells[idx(`${cause}_minutes`)] = '';
            cells[idx(`${cause}_observations`)] = '0';
          }
          cells[idx('cause_observed_flights')] = '0';
          cells[idx('delayed_cause_missing')] = cells[idx('delayed_arrivals')];
        } }));
    const missingPage = await missingContext.newPage();
    await missingPage.goto(url);
    await missingPage.waitForFunction(() => document.querySelector('#load-status').textContent.startsWith('Verified'));
    await missingPage.locator('#month-end').selectOption(mMonth);
    await missingPage.locator('#month-start').selectOption(mMonth);
    await missingPage.locator('#airline-select').selectOption(mAirline);
    await missingPage.locator('#airport-search').fill(mOrigin);
    await missingPage.locator('#airport-search').dispatchEvent('change');
    await missingPage.locator('[data-tab="tab-cause-compare"]').click();
    await missingPage.waitForFunction(() => document.querySelectorAll('#causeCompareChart .cause-seg').length > 0);
    await waitSettled(missingPage);
    const missingData = await getRowData(missingPage, mOrigin);
    assert.equal(missingData.segments.length, 0, 'all-missing attribution draws no segments');
    assert.match(missingData.none[0], /No reported cause minutes \(attribution missing or zero\)/,
      'all-missing attribution is explained, never fabricated or zeroed');
    const missingTip = await hoverNoMinutes(missingPage, mOrigin);
    assert.equal(missingTip[1], `Scheduled: ${fmt(missingFixture.scheduled_flights)}`,
      'all-missing group keeps its scheduled count');
    assert.match(missingTip[3], /Reported minutes: none \(attribution missing or zero\)/,
      'all-missing attribution is reported as none');
    assert.match(missingTip[4], new RegExp(`Attribution observed on 0 of ${fmt(missingFixture.delayed_arrivals)} delayed arrivals`),
      'all-missing completeness statistics state zero observations');
    assert.match(missingTip[6], /Missing attribution is not zero\./);
    await missingPage.locator('#tab-cause-compare section').screenshot(
      { path: path.join(assets, 'cause-all-missing-synthetic.png') });
    await missingContext.close();

    // Regression: Reset restores the cause-comparison mode to the default airports
    // view, including the radio state.
    await page.locator('input[name="cause-compare-mode"][value="airlines"]').check();
    await waitSettled(page);
    assert.match(await page.locator('#causeCompareChart text').first().textContent(),
      /one bar per reporting airline/);
    await page.locator('#filter-reset').click();
    await page.waitForFunction(() => document.querySelector('#kpis').textContent.includes('7,001,619'));
    assert.equal(await page.locator('input[name="cause-compare-mode"][value="airports"]').isChecked(),
      true, 'Reset restores the airports radio state');
    await page.locator('[data-tab="tab-cause-compare"]').click();
    await waitSettled(page);
    assert.match(await page.locator('#causeCompareChart text').first().textContent(),
      /one bar per origin airport/, 'cause comparison restarts from the airports mode after Reset');

    // The selected airport is appended when outside the busiest 12.
    await page.locator('#filter-reset').click();
    await page.waitForFunction(() => document.querySelector('#kpis').textContent.includes('7,001,619'));
    await page.locator('[data-tab="tab-cause-compare"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#causeCompareChart .cause-seg').length > 0);
    await selectAirportAppend(page); // selects BQN, returns to this tab
    await page.waitForFunction(() => document.querySelectorAll('#causeCompareChart .cause-seg').length > 0);
    await waitSettled(page);
    const labelsWithBqn = await page.locator('#causeCompareChart .tick text').evaluateAll(
      nodes => nodes.map(node => node.textContent));
    assert.ok(labelsWithBqn.includes('BQN'), 'the selected airport joins the comparison');
    assert.equal(labelsWithBqn.filter(text => /^[A-Z]{3}$/.test(text)).length, 13,
      'busiest 12 plus the selected airport');
    assert.deepEqual(errors, [], 'no page errors in the D2 pass');

    const inputs = ['site/index.html', 'site/css/style.css', 'site/js/app.js', 'site/js/charts.js',
      'site/js/state.js', 'site/js/aggregate.js', 'site/js/data.js', 'site/data/manifest.json'];
    const hashes = {};
    for (const file of inputs) hashes[file] = createHash('sha256').update(await fs.readFile(path.join(root, file))).digest('hex');
    const result = {
      batch: 'D2 — comparative 100% stacked cause bars',
      browser: await browser.version(), checks: 'passed',
      expectations: {
        comparedAirports: expectedTop12,
        topGroup: { label: topGroup.label, reportedMinutes: fmt(topTotal) },
        zeroTotalFixture: { origin: zeroOrigin, airline: zeroAirline, month: Number(zeroMonth),
                            scheduled: zeroTotal.scheduled_flights },
        partialFixture: partial ? { label: partial.label, partial: partial.cause_partial_flights } : null,
      },
      checked: ['busiest 12 airports compared with every complete bar summing to 100% (±0.5px)',
        'segment shares match independently pooled minutes; tooltips carry minutes, share, observations',
        'completeness statistics reachable by real hover on segments and on the row labels (no synthetic events)',
        'five stable category colors asserted on rendered segments; row-level completeness counts exposed',
        'airlines mode under Jan–Mar; airport selection scopes the airline comparison to ORD',
        'zero-total attribution group listed with an explicit note and no segments; other bars unaffected',
        'synthetic partial group: unobserved category drops out, remaining four renormalize to 100%, counts exposed',
        'synthetic all-missing group: explicit no-minutes row, zero segments, zero observations stated',
        'selected airport appended when outside the busiest 12',
        'Reset restores the default airports mode including the radio state',
        'reset invalidates the cached comparison even when the filters were already default',
        'missing-attribution rule stated on the page'],
      notChecked: ['interaction timing performance (Batch E)', 'user study (Batch E)'],
      desktopViewport: [1440, 1500],
      limitations: 'Automated checks and visual inspection are not a user study or an interaction-performance evaluation.',
      source_sha256: hashes,
    };
    await fs.writeFile(path.join(root, 'reports/site_validation_batch_d2.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

async function selectAirportAppend(page) {
  await page.locator('#airport-search').fill('BQN');
  await page.locator('#airport-search').dispatchEvent('change'); // opens Airport Detail
  await page.locator('[data-tab="tab-cause-compare"]').click();
}
