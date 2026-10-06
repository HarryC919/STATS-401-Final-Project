/* Batch C browser QA: airport selection, airport detail, and geographic entry points.
   Writes evidence to docs/assets/batch-c/ and reports/site_validation_batch_c.json.
   Never touches docs/assets/interim/ or the Batch B evidence files.
   Usage: NODE_PATH=<playwright modules> node scripts/qa_batch_c.cjs  (SITE_URL, CHROME_PATH optional). */
const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const url = process.env.SITE_URL || 'http://127.0.0.1:8765/';
const siteData = path.join(root, 'site/data');

/* RFC-4180-style CSV parsing: directory and city files quote fields that contain
   commas (e.g. "Chicago, IL"), so a naive split would misalign columns. */
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
    const row = {};
    header.forEach((name, i) => { row[name] = cells[i] === '' ? null : cells[i]; });
    return row;
  });
}
const fmt = number => number.toLocaleString('en-US');
const rateText = (delayed, eligible) => eligible > 0 ? `${(100 * delayed / eligible).toFixed(1)}%` : 'No data';
const CAUSES = ['CarrierDelay', 'WeatherDelay', 'NASDelay', 'SecurityDelay', 'LateAircraftDelay'];
const CAUSE_LABELS = { CarrierDelay: 'Carrier', WeatherDelay: 'Weather', NASDelay: 'NAS',
                       SecurityDelay: 'Security', LateAircraftDelay: 'Late Aircraft' };
/* The five stable category colors as rendered (inline styles beat the .bar CSS). */
const CAUSE_FILLS = ['rgb(59, 125, 216)', 'rgb(217, 83, 79)', 'rgb(240, 173, 78)',
                     'rgb(92, 184, 92)', 'rgb(142, 107, 191)'];

async function readCsv(name) {
  return csvRows(await fs.readFile(path.join(siteData, name), 'utf8'));
}

/* Pooled airport totals under filters, computed from the filter table (independent
   of the app code). */
function poolAirport(rows, { start, end, airline }, code) {
  const totals = {
    scheduled_flights: 0, eligible_arrivals: 0, delayed_arrivals: 0,
    cancelled_flights: 0, diverted_flights: 0,
    cause_observed_flights: 0, cause_partial_flights: 0, delayed_cause_missing: 0,
  };
  for (const cause of CAUSES) {
    totals[`${cause}_minutes`] = 0;
    totals[`${cause}_observations`] = 0;
  }
  for (const row of rows) {
    if (row.Origin !== code) continue;
    const month = Number(row.Month);
    if (month < start || month > end) continue;
    if (airline && row.Reporting_Airline !== airline) continue;
    for (const key of Object.keys(totals)) totals[key] += Number(row[key]) || 0;
  }
  return totals;
}

/* Five busiest outgoing directed routes: pooled scheduled flights, ties broken by
   destination code — the same rule the detail view must implement. */
function topRoutes(rows, { start, end, airline }, limit = 5) {
  const groups = new Map();
  for (const row of rows) {
    const month = Number(row.Month);
    if (month < start || month > end) continue;
    if (airline && row.Reporting_Airline !== airline) continue;
    if (!groups.has(row.Dest)) {
      groups.set(row.Dest, { Dest: row.Dest, scheduled_flights: 0, eligible_arrivals: 0, delayed_arrivals: 0 });
    }
    const group = groups.get(row.Dest);
    group.scheduled_flights += Number(row.scheduled_flights);
    group.eligible_arrivals += Number(row.eligible_arrivals);
    group.delayed_arrivals += Number(row.delayed_arrivals);
  }
  return [...groups.values()]
    .sort((a, b) => b.scheduled_flights - a.scheduled_flights
      || (a.Dest < b.Dest ? -1 : a.Dest > b.Dest ? 1 : 0))
    .slice(0, limit);
}

async function selectAirport(page, code) {
  await page.locator('#airport-search').fill(code);
  await page.locator('#airport-search').dispatchEvent('change');
}

async function assertDetailBars(page, expected, origin) {
  const bars = page.locator('#detailRoutes .bar');
  assert.equal(await bars.count(), expected.length, 'detail route bar count');
  for (let i = 0; i < expected.length; i++) {
    await bars.nth(i).hover();
    await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('#tooltip')).opacity) > 0);
    const lines = (await page.locator('#tooltip').innerText()).split('\n').map(line => line.trim());
    assert.equal(lines[0], `${origin} → ${expected[i].Dest}`, `detail route ${i}: label`);
    assert.equal(lines[1], `Flights: ${fmt(expected[i].scheduled_flights)}`, `detail route ${i}: pooled flights`);
    assert.equal(lines[3], `Delay rate: ${rateText(expected[i].delayed_arrivals, expected[i].eligible_arrivals)}`,
      `detail route ${i}: pooled delay rate`);
    await page.mouse.move(0, 0);
  }
}

function assertHeadline(page, totals, label) {
  return page.waitForFunction(expected => document.querySelector('#detail-status').textContent.includes(expected),
    fmt(totals.scheduled_flights)).then(async () => {
      const text = await page.locator('#detail-status').innerText();
      assert.ok(text.includes(fmt(totals.scheduled_flights)), `${label}: detail scheduled total`);
      assert.ok(text.includes(rateText(totals.delayed_arrivals, totals.eligible_arrivals)), `${label}: detail delay rate`);
      assert.ok(text.includes(rateText(totals.cancelled_flights, totals.scheduled_flights)), `${label}: detail cancellation rate`);
      assert.ok(text.includes(rateText(totals.diverted_flights, totals.scheduled_flights)), `${label}: detail diversion rate`);
    });
}

async function waitSettled(page) {
  await page.waitForFunction(() => {
    const text = document.querySelector('#load-status').textContent;
    return !text.startsWith('Updating') && !text.startsWith('Rendering');
  });
}

(async () => {
  const airlineMonth = await readCsv('airline_month.csv');
  const airportMonth = await readCsv('airport_month_airline.csv');
  const directory = await readCsv('airport_directory.csv');
  const citySummary = await readCsv('city_summary.csv');
  const ordRoutes = await readCsv(path.join('routes', 'ORD.csv'));
  const mdwRoutes = await readCsv(path.join('routes', 'MDW.csv'));
  const mdtRoutes = await readCsv(path.join('routes', 'MDT.csv'));
  const FULL = { start: 1, end: 12, airline: null };
  const JAN_MAR = { start: 1, end: 3, airline: null };
  const JAN_MAR_UA = { start: 1, end: 3, airline: 'UA' };
  const uaJanMar = (() => {
    const totals = { scheduled_flights: 0 };
    for (const row of airlineMonth) {
      if (row.Reporting_Airline !== 'UA' || Number(row.Month) > 3) continue;
      totals.scheduled_flights += Number(row.scheduled_flights);
    }
    return totals;
  })();
  const expectations = {
    ordFull: poolAirport(airportMonth, FULL, 'ORD'),
    ordJanMar: poolAirport(airportMonth, JAN_MAR, 'ORD'),
    mdwJanMar: poolAirport(airportMonth, JAN_MAR, 'MDW'),
    ordJanMarUA: poolAirport(airportMonth, JAN_MAR_UA, 'ORD'),
    ordTop5Full: topRoutes(ordRoutes, FULL),
    ordTop5JanMar: topRoutes(ordRoutes, JAN_MAR),
    ordTop5JanMarUA: topRoutes(ordRoutes, JAN_MAR_UA),
    mdwTop5JanMar: topRoutes(mdwRoutes, JAN_MAR),
    ordAnnualDestinations: new Set(csvRows(await fs.readFile(path.join(siteData, 'routes', 'ORD.csv'), 'utf8')).map(r => r.Dest)).size,
    mdtJuneOO: poolAirport(airportMonth, { start: 6, end: 6, airline: 'OO' }, 'MDT'),
    mdtTop5JuneOO: topRoutes(mdtRoutes, { start: 6, end: 6, airline: 'OO' }),
  };
  // The regression fixture: MDT + June + OO has three routes and ATL has one
  // scheduled flight with zero eligible arrivals.
  assert.deepEqual(
    expectations.mdtTop5JuneOO.map(route => [route.Dest, route.scheduled_flights, route.eligible_arrivals]),
    [['ORD', 34, 33], ['DTW', 13, 13], ['ATL', 1, 0]],
    'MDT/June/OO fixture matches the reviewed case');
  // An origin airport outside the Albers USA projection (a U.S. territory).
  const territory = directory.find(row => ['PR', 'VI', 'GU', 'MP', 'AS'].includes(row.state));
  assert.ok(territory, 'dataset contains a non-projectable origin airport');
  // A projectable city with exactly one airport, for direct city-node selection.
  const singleAirportCity = citySummary.find(city => !String(city.airports).includes(','));

  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  });
  try {
    const assets = path.join(root, 'docs/assets/batch-c');
    await fs.mkdir(assets, { recursive: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    await page.goto(url);
    await page.waitForFunction(() => document.querySelector('#load-status').textContent.startsWith('Verified'));

    // Regression: a map drawn before the first airport selection must update on
    // that first state change and track every later selection change.
    const mapFirst = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const mapFirstErrors = [];
    mapFirst.on('pageerror', error => mapFirstErrors.push(error.message));
    await mapFirst.goto(url);
    await mapFirst.waitForFunction(() => document.querySelector('#load-status').textContent.startsWith('Verified'));
    await mapFirst.locator('[data-tab="tab-network"]').click();
    await mapFirst.waitForFunction(() => document.querySelectorAll('#networkMap .map-route').length === 220);
    assert.equal(await mapFirst.locator('#networkMap .map-airport-selected').count(), 0, 'no selection yet');
    await selectAirport(mapFirst, 'ORD'); // first state change; opens the detail view
    await waitSettled(mapFirst);
    await mapFirst.locator('[data-tab="tab-network"]').click();
    await mapFirst.waitForFunction(() => document.querySelectorAll('#networkMap .map-route').length === 220);
    assert.equal(await mapFirst.locator('#networkMap .map-airport-selected').count(), 1,
      'map reflects the first airport selection');
    assert.equal(await mapFirst.locator('#networkMap .map-outgoing').count(),
      Math.min(20, expectations.ordAnnualDestinations), 'outgoing routes follow the first selection');
    assert.match(await mapFirst.locator('#network-status').innerText(), /ORD/);
    await selectAirport(mapFirst, 'MDW'); // switching airports
    await mapFirst.locator('[data-tab="tab-network"]').click();
    await mapFirst.waitForFunction(() => document.querySelectorAll('#networkMap .map-route').length === 220);
    assert.match(await mapFirst.locator('#network-status').innerText(), /MDW/,
      'map follows a switched selection');
    await mapFirst.locator('#airport-search').fill(''); // clearing the selection
    await mapFirst.locator('#airport-search').dispatchEvent('change');
    await mapFirst.waitForFunction(() => document.querySelectorAll('#networkMap .map-route').length === 220);
    assert.equal(await mapFirst.locator('#networkMap .map-airport-selected').count(), 0,
      'clearing the selection clears the airport layer');
    assert.equal(await mapFirst.locator('#networkMap .map-outgoing').count(), 0);
    await selectAirport(mapFirst, 'ORD');
    await waitSettled(mapFirst);
    await mapFirst.locator('#filter-reset').click(); // Reset clears the selection too
    await mapFirst.waitForFunction(() => document.querySelector('#kpis').textContent.includes('7,001,619'));
    await mapFirst.locator('[data-tab="tab-network"]').click();
    await mapFirst.waitForFunction(() => document.querySelectorAll('#networkMap .map-route').length === 220);
    assert.equal(await mapFirst.locator('#networkMap .map-airport-selected').count(), 0,
      'reset clears the airport layer');
    assert.deepEqual(mapFirstErrors, [], 'no page errors in the map-selection regression');
    await mapFirst.close();

    // Airport search: selecting ORD opens the detail view with full-year statistics.
    await selectAirport(page, 'ORD');
    assert.equal(await page.locator('[data-tab="tab-detail"]').getAttribute('aria-pressed'), 'true',
      'selecting an airport opens the detail view');
    assert.match(await page.locator('#detail-sub').innerText(), /ORD — Chicago O'Hare International/);
    await assertHeadline(page, expectations.ordFull, 'ORD full year');
    assert.match(await page.locator('#filter-summary').innerText(), /detail: ORD/);
    assert.equal(await page.locator('#detailTrend circle').count(), 24, 'detail trend keeps twelve months');
    assert.equal(await page.locator('#detailCauses .bar').count(), 5, 'all five cause categories observed for ORD annually');
    const causeTip = await page.locator('#detailCauses .bar').first().hover().then(() => page.locator('#tooltip').innerText());
    assert.match(causeTip, /min/);
    assert.match(await page.locator('#detailCauses text').last().textContent(), /Attribution observed on/);
    await assertDetailBars(page, expectations.ordTop5Full, 'ORD');
    await page.locator('#tab-detail section').screenshot({ path: path.join(assets, 'detail-ord-full.png') });
    assert.deepEqual(errors, [], 'no page errors after selecting ORD');

    // Airport comparison keeps its context and highlights the selection.
    await page.locator('[data-tab="tab-airport"]').click();
    await waitSettled(page);
    assert.equal(await page.locator('#airportChart .bar-selected').count(), 1, 'ORD is highlighted');

    // Combined filters: ORD, Jan–Mar, then the UA subset; details must reconcile.
    await page.locator('#month-start').selectOption('1');
    await page.locator('#month-end').selectOption('3');
    await page.locator('[data-tab="tab-detail"]').click();
    await waitSettled(page);
    await assertHeadline(page, expectations.ordJanMar, 'ORD Jan–Mar');
    await assertDetailBars(page, expectations.ordTop5JanMar, 'ORD');
    await page.locator('#airline-select').selectOption('UA');
    await waitSettled(page);
    await assertHeadline(page, expectations.ordJanMarUA, 'ORD Jan–Mar UA');
    await assertDetailBars(page, expectations.ordTop5JanMarUA, 'ORD');
    // The trend must label its full-year context, the airline scope, and the shading.
    const trendScope = await page.locator('#detailTrend text.chart-scope').textContent();
    assert.match(trendScope, /Full-year context \(all twelve months\)/, 'trend states the full-year context');
    assert.match(trendScope, /Reporting airline: UA/, 'trend states the airline scope');
    assert.match(trendScope, /Airport: ORD/, 'trend states the airport');
    assert.match(trendScope, /Shaded = selected months/, 'trend explains the shading');
    // Itemized cause assertions: rendered color, pooled minutes, share, and
    // observation counts for every category, plus the exact completeness caption.
    const ordUA = expectations.ordJanMarUA;
    const observedTotal = CAUSES.reduce((sum, cause) =>
      ordUA[`${cause}_observations`] > 0 ? sum + ordUA[`${cause}_minutes`] : sum, 0);
    assert.ok(observedTotal > 0, 'fixture has reported cause minutes');
    const bars = page.locator('#detailCauses .bar');
    assert.equal(await bars.count(), 5, 'five category rows');
    for (let i = 0; i < CAUSES.length; i++) {
      const cause = CAUSES[i];
      const fill = await bars.nth(i).evaluate(el => getComputedStyle(el).fill);
      assert.equal(fill, CAUSE_FILLS[i], `${cause}: rendered category color`);
      if (ordUA[`${cause}_minutes`] === 0) {
        // A zero-minute category renders a zero-width rect that Playwright cannot
        // hover; dispatch the same mousemove event the d3 handler listens for.
        await bars.nth(i).evaluate(el => {
          const rect = el.getBoundingClientRect();
          el.dispatchEvent(new MouseEvent('mousemove',
            { bubbles: true, clientX: rect.left, clientY: rect.top }));
        });
      } else {
        await bars.nth(i).hover();
      }
      await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('#tooltip')).opacity) > 0);
      const lines = (await page.locator('#tooltip').innerText()).split('\n').map(line => line.trim());
      const minutes = ordUA[`${cause}_minutes`];
      const observations = ordUA[`${cause}_observations`];
      assert.equal(lines[0], CAUSE_LABELS[cause], `${cause}: tooltip label`);
      assert.equal(lines[1], `${fmt(Math.round(minutes))} min`, `${cause}: pooled minutes`);
      const renderedShare = Number(lines[2].replace('Share: ', '').replace('%', ''));
      assert.ok(Math.abs(renderedShare - (100 * minutes / observedTotal)) < 0.05,
        `${cause}: pooled share within rounding`);
      assert.equal(lines[3], `Observed on ${fmt(observations)} delayed arrivals`, `${cause}: observation count`);
      await page.mouse.move(0, 0);
    }
    const caption = await page.locator('#detailCauses text').last().textContent();
    assert.equal(caption,
      `Attribution observed on ${fmt(ordUA.cause_observed_flights)} of ${fmt(ordUA.delayed_arrivals)} delayed arrivals · partial ${fmt(ordUA.cause_partial_flights)} · delayed with no attribution ${fmt(ordUA.delayed_cause_missing)}. Missing is not zero.`,
      'cause completeness caption is exact');
    // KPI stays national under the airport selection (never airport-specific):
    // it must equal the UA Jan–Mar total across all airports, not ORD's volume.
    const kpiText = await page.locator('#kpis').innerText();
    assert.ok(kpiText.includes(fmt(uaJanMar.scheduled_flights)),
      'KPI remains the national scope under an airport selection');
    assert.ok(!kpiText.includes(fmt(expectations.ordJanMarUA.scheduled_flights)),
      'KPI does not silently become airport-specific');
    await page.locator('#tab-detail section').screenshot({ path: path.join(assets, 'detail-ord-jan-mar-ua.png') });

    // ORD and MDW are separate Chicago airports with distinct, correct statistics.
    await page.locator('#airline-select').selectOption('');
    await selectAirport(page, 'MDW');
    assert.equal(await page.locator('[data-tab="tab-detail"]').getAttribute('aria-pressed'), 'true');
    assert.match(await page.locator('#detail-sub').innerText(), /MDW — Chicago Midway International/);
    await assertHeadline(page, expectations.mdwJanMar, 'MDW Jan–Mar');
    assert.notEqual(expectations.mdwJanMar.scheduled_flights, expectations.ordJanMar.scheduled_flights,
      'ORD and MDW totals differ');
    await assertDetailBars(page, expectations.mdwTop5JanMar, 'MDW');
    await page.locator('[data-tab="tab-airport"]').click();
    await waitSettled(page);
    // MDW's presence in the busiest 15 depends on its pooled volume rank; outside
    // it, the chart appends the selection so the highlight stays visible.
    const volumes = new Map();
    for (const row of airportMonth) {
      if (Number(row.Month) > 3) continue;
      volumes.set(row.Origin, (volumes.get(row.Origin) ?? 0) + Number(row.scheduled_flights));
    }
    const busiest15 = [...volumes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([code]) => code);
    const expectedBars = busiest15.includes('MDW') ? 15 : 16;
    assert.equal(await page.locator('#airportChart .bar').count(), expectedBars,
      'comparison keeps 15 busiest plus the selected airport when outside');
    const selectedLabel = await page.locator('#airportChart .bar-selected').evaluate(
      el => el.__data__.Origin);
    assert.equal(selectedLabel, 'MDW', 'MDW is the highlighted airport');
    // Click-to-select straight from the comparison chart.
    await page.locator('#airportChart .bar').evaluateAll(bars => {
      const atl = bars.find(bar => bar.__data__.Origin === 'ATL');
      if (atl) atl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    assert.equal(await page.locator('#airport-search').inputValue(), 'ATL', 'clicking a bar selects that airport');
    assert.equal(await page.locator('[data-tab="tab-detail"]').getAttribute('aria-pressed'), 'true',
      'bar click opens the detail view');
    await selectAirport(page, 'MDW');

    // Empty airport/month/airline combination: HA does not serve ORD.
    await selectAirport(page, 'ORD');
    await page.locator('#airline-select').selectOption('HA');
    await waitSettled(page);
    assert.equal(await page.locator('#detail-status').innerText(),
      'No flights match the current filters for ORD.');
    assert.equal(await page.locator('#detailTrend circle').count(), 0, 'empty trend renders no marks');
    assert.match(await page.locator('#detailCauses').textContent(), /No flights match the current filters/);
    assert.match(await page.locator('#detailRoutes').textContent(), /No flights match the current filters/);
    assert.ok(await page.locator('#kpis').innerText().then(text => text.includes('Hawaiian') || text.length > 0),
      'KPI remains visible in the empty-detail state');
    await page.screenshot({ path: path.join(assets, 'detail-ord-ha-empty.png') });
    await page.locator('#airline-select').selectOption('');

    // Map entry points: airport layer + directed outgoing routes (full-year scope).
    await page.locator('[data-tab="tab-network"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#networkMap .map-route').length === 220);
    assert.equal(await page.locator('#networkMap .map-airport-selected').count(), 1, 'selected airport is marked');
    assert.equal(await page.locator('#networkMap .map-outgoing').count(),
      Math.min(20, expectations.ordAnnualDestinations), 'outgoing route layer respects the top-20 cap');
    assert.match(await page.locator('#network-status').innerText(), /ORD.*busiest outgoing routes/);
    await page.locator('#tab-network section').screenshot({ path: path.join(assets, 'network-ord.png') });

    // Multi-airport cities ask which airport is meant instead of pooling.
    await page.locator('#networkMap circle').evaluateAll(circles => {
      const chicago = circles.find(circle => circle.__data__.city === 'Chicago, IL');
      chicago.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    assert.equal(await page.locator('#airport-chooser').isHidden(), false, 'Chicago opens an airport choice');
    const chooserButtons = await page.locator('#airport-chooser button').allInnerTexts();
    assert.ok(chooserButtons.some(text => text.startsWith('ORD')), 'choice lists ORD');
    assert.ok(chooserButtons.some(text => text.startsWith('MDW')), 'choice lists MDW');
    await page.locator('#airport-chooser button', { hasText: 'MDW' }).click();
    assert.equal(await page.locator('#airport-search').inputValue(), 'MDW', 'choosing MDW selects it');
    assert.equal(await page.locator('[data-tab="tab-detail"]').getAttribute('aria-pressed'), 'true');
    assert.match(await page.locator('#detail-sub').innerText(), /MDW/);

    // Single-airport cities select directly from the map.
    await page.locator('[data-tab="tab-network"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#networkMap .map-route').length === 220);
    await page.locator('#networkMap circle').evaluateAll((circles, cityName) => {
      const city = circles.find(circle => circle.__data__.city === cityName);
      city.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }, singleAirportCity.city);
    assert.equal(await page.locator('#airport-search').inputValue(),
      singleAirportCity.airports.trim(), `single-airport city ${singleAirportCity.city} selects directly`);

    // Airports outside the projection stay reachable through the selector; map
    // exclusions never change national or detail totals.
    await page.locator('#month-start').selectOption('1'); // restore the full-year scope
    await page.locator('#month-end').selectOption('12');
    await selectAirport(page, territory.airport);
    assert.match(await page.locator('#detail-sub').innerText(), new RegExp(territory.airport));
    await assertHeadline(page, poolAirport(airportMonth, FULL, territory.airport), `${territory.airport} full year`);
    await page.locator('[data-tab="tab-network"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#networkMap .map-route').length === 220);
    assert.match(await page.locator('#network-status').innerText(), /outside the Albers USA projection/);
    assert.equal(await page.locator('#networkMap .map-airport-selected').count(), 0,
      'no marker for a non-projectable airport');
    await page.locator('#tab-network section').screenshot({ path: path.join(assets, 'network-territory.png') });

    // Regression: a top-five route with zero eligible arrivals keeps its place
    // with a missing rate (MDT + June + OO: ATL has 1 scheduled, 0 eligible).
    await selectAirport(page, 'MDT');
    await page.locator('#month-start').selectOption('6');
    await page.locator('#month-end').selectOption('6');
    await page.locator('#airline-select').selectOption('OO');
    await waitSettled(page);
    await assertHeadline(page, expectations.mdtJuneOO, 'MDT June OO');
    const zeroEligible = expectations.mdtTop5JuneOO.filter(route => route.eligible_arrivals === 0).length;
    assert.equal(await page.locator('#detailRoutes .bar').count(),
      expectations.mdtTop5JuneOO.length - zeroEligible,
      'bars only for routes with measurable rates');
    assert.equal(await page.locator('#detailRoutes .no-rate').count(), zeroEligible,
      'zero-eligible routes stay listed with No data');
    const noRateTip = await page.locator('#detailRoutes .no-rate').first().hover()
      .then(() => page.locator('#tooltip').innerText());
    const noRateLines = noRateTip.split('\n').map(line => line.trim());
    assert.equal(noRateLines[0], 'MDT → ATL', 'zero-eligible route keeps its direction label');
    assert.equal(noRateLines[1], 'Flights: 1', 'zero-eligible route keeps its scheduled count');
    assert.equal(noRateLines[3], 'Delay rate: No data (zero eligible arrivals)',
      'the missing rate is never shown as zero');
    await page.locator('#tab-detail section').screenshot({ path: path.join(assets, 'detail-mdt-june-oo.png') });

    // Reset clears the selection and returns to the national overview.
    await page.locator('#filter-reset').click();
    await page.waitForFunction(() => document.querySelector('#kpis').textContent.includes('7,001,619'));
    assert.equal(await page.locator('#airport-search').inputValue(), '', 'reset clears the airport selection');
    assert.equal(await page.locator('[data-tab="tab-monthly"]').getAttribute('aria-pressed'), 'true',
      'reset returns to the monthly overview');
    await page.locator('[data-tab="tab-detail"]').click();
    assert.match(await page.locator('#detail-status').innerText(), /No airport selected/);
    assert.deepEqual(errors, [], 'no page errors in the Batch C pass');

    const inputs = ['site/index.html', 'site/css/style.css', 'site/js/app.js', 'site/js/charts.js',
      'site/js/state.js', 'site/js/aggregate.js', 'site/js/data.js', 'site/data/manifest.json'];
    const hashes = {};
    for (const file of inputs) hashes[file] = createHash('sha256').update(await fs.readFile(path.join(root, file))).digest('hex');
    const result = {
      batch: 'C — airport detail and geographic entry points',
      browser: await browser.version(), checks: 'passed',
      expectations: {
        ordFullScheduled: expectations.ordFull.scheduled_flights,
        ordJanMarScheduled: expectations.ordJanMar.scheduled_flights,
        mdwJanMarScheduled: expectations.mdwJanMar.scheduled_flights,
        ordJanMarUAScheduled: expectations.ordJanMarUA.scheduled_flights,
        ordTop5Full: expectations.ordTop5Full.map(route => `${route.Dest}:${fmt(route.scheduled_flights)}`),
      },
      checked: ['map tracks first selection, switches, clearing, and Reset',
        'zero-eligible top-five routes keep place, count, and a missing rate',
        'detail trend labels full-year context, airline, airport, and shading',
        'cause composition asserts rendered colors, pooled minutes, shares, and observation counts',
        'airport search opens detail with pooled statistics',
        'detail trend, cause composition, and top-5 routes reconcile with source data',
        'ORD and MDW select separately with distinct correct statistics',
        'airport comparison retains context and highlights the selection; bars are clickable',
        'empty airport/airline combination shows an explicit empty state',
        'map airport layer and top-20 outgoing routes for the selected origin',
        'multi-airport city click opens an explicit choice; single-airport city selects directly',
        'non-projectable airport reachable via selector with map note; totals unaffected',
        'reset clears selection and returns to the monthly overview'],
      notChecked: ['interaction timing performance (Batch E)', 'user study (Batch E)'],
      desktopViewport: [1440, 1100],
      limitations: 'Automated checks and visual inspection are not a user study or an interaction-performance evaluation.',
      source_sha256: hashes,
    };
    await fs.writeFile(path.join(root, 'reports/site_validation_batch_c.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
