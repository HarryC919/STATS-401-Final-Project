import { drawKPIs, drawMonthly, drawAirline, drawAirport, drawRoute, drawCauses, drawNetworkMap,
         drawDetailCauses, drawDetailRoutes, drawHeatmap, drawCauseComparison, drawScatter,
         WEEKDAY_NAMES, LOW_SAMPLE_THRESHOLD, clearChart, chartError } from './charts.js';
import { createFilterState } from './state.js';
import { loadCsv, loadRoutePartition, loadRoutePartitions, loadTemporalPartitions } from './data.js';
import { filterRows, poolAll, poolBy, poolByMonth } from './aggregate.js';

const status = document.querySelector('#load-status');
const buttons = [...document.querySelectorAll('.tab-btn')];
buttons.forEach(button => { button.disabled = true; });

const AIRPORT_KEYS = ['OriginAirportID', 'Origin'];
const ROUTE_KEYS = ['OriginAirportID', 'Origin', 'DestAirportID', 'Dest'];
// Views without shared-filter support yet; they state their fixed scope in the page.
const FIXED_SCOPE_TABS = new Set(['tab-cause']);
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = number => number.toLocaleString('en-US');
const ratePct = (numerator, denominator) =>
  Number(denominator) > 0 ? `${(100 * numerator / denominator).toFixed(1)}%` : 'No data';
const hasNumberJs = value => value != null && Number.isFinite(Number(value));

async function start() {
  status.textContent = 'Loading the verified data snapshot…';
  const [national, monthly, airlineAnnual, airportAnnual, routeAnnual, airlineMonth, airportMonth,
         airportDirectory] = await Promise.all([
    loadCsv('national', 'data/national.csv'),
    loadCsv('monthly', 'data/monthly.csv'),
    loadCsv('airline_annual', 'data/airline_annual.csv'),
    loadCsv('airport_annual', 'data/airport_annual.csv'),
    loadCsv('route_annual', 'data/route_annual.csv'),
    loadCsv('airline_month', 'data/airline_month.csv'),
    loadCsv('airport_month_airline', 'data/airport_month_airline.csv'),
    loadCsv('airport_directory', 'data/airport_directory.csv'),
  ]);
  if (national.length !== 1 || monthly.length !== 12) throw new Error('Expected a complete 2025 snapshot.');
  const baseline = national[0];
  const state = createFilterState();
  const airportById = new Map(airportDirectory.map(row => [Number(row.airport_id), row]));
  const codeByAirportId = new Map(airportDirectory.map(row => [Number(row.airport_id), row.airport]));
  // Annual all-airline departures per airport, used by the city-choice dialog.
  const airportVolumes = new Map(
    poolBy(airportMonth, ['OriginAirportID']).map(row => [Number(row.OriginAirportID), Number(row.scheduled_flights)]));

  // D2 view-local mode; Reset restores it together with the shared filters.
  let causeCompareMode = 'airports';
  // D3 view-local state: mode, minimum-volume filter, and the transient brush
  // highlight set. Every change explicitly invalidates the cached view, and Reset
  // restores all of them together with the shared filters.
  let scatterMode = 'airports';
  let scatterMinVolume = 0;
  let scatterBrushLabels = new Set();
  let scatterClearBrush = null;

  // Shared filter controls: one month range and one airline for every filterable view.
  const monthStart = document.querySelector('#month-start');
  const monthEnd = document.querySelector('#month-end');
  const airlineSelect = document.querySelector('#airline-select');
  const airportInput = document.querySelector('#airport-search');
  const summary = document.querySelector('#filter-summary');
  for (let month = 1; month <= 12; month++) {
    monthStart.add(new Option(`M${month}`, month));
    monthEnd.add(new Option(`M${month}`, month));
  }
  for (const code of airlineAnnual.map(row => row.Reporting_Airline).sort()) {
    airlineSelect.add(new Option(code, code));
  }
  for (const airport of [...airportDirectory].sort((a, b) => a.airport.localeCompare(b.airport))) {
    document.querySelector('#airport-options')
      .append(new Option(`${airport.airport} — ${airport.name}`, airport.airport));
  }
  monthStart.addEventListener('change', () => state.setRange(Number(monthStart.value), Number(monthEnd.value)));
  monthEnd.addEventListener('change', () => state.setRange(Number(monthStart.value), Number(monthEnd.value)));
  airlineSelect.addEventListener('change', () => state.setAirline(airlineSelect.value));
  airportInput.addEventListener('change', () => {
    const value = airportInput.value.trim().toUpperCase();
    if (!value) { state.setAirport(null); return; }
    const match = airportDirectory.find(airport => airport.airport === value);
    if (match) selectAirport(Number(match.airport_id));
    else syncControls(state.snapshot()); // unknown code: fall back to the current selection
  });
  // Every mode change explicitly invalidates the cached comparison view — even
  // when the global state is already at its default and state.reset() will not
  // emit a notification.
  function setCauseCompareMode(mode) {
    if (causeCompareMode === mode) return;
    causeCompareMode = mode;
    drawn.delete('tab-cause-compare');
    document.querySelectorAll('input[name="cause-compare-mode"]')
      .forEach(input => { input.checked = input.value === mode; });
  }

  function setScatterMode(mode) {
    if (scatterMode === mode) return;
    scatterMode = mode;
    scatterBrushLabels = new Set();
    drawn.delete('tab-scatter'); // explicit: mode changes invalidate even at defaults
    document.querySelectorAll('input[name="scatter-mode"]')
      .forEach(input => { input.checked = input.value === mode; });
  }

  function setScatterMinVolume(value) {
    const next = Math.max(0, Number(value) || 0);
    if (scatterMinVolume === next) return;
    scatterMinVolume = next;
    scatterBrushLabels = new Set();
    drawn.delete('tab-scatter'); // explicit: threshold changes invalidate even at defaults
    const input = document.querySelector('#scatter-min-volume');
    const output = document.querySelector('#scatter-min-volume-out');
    if (input) input.value = String(next);
    if (output) output.textContent = fmt(next);
  }

  document.querySelector('#filter-reset').addEventListener('click', () => {
    setCauseCompareMode('airports'); // Reset restores every view's default scope
    setScatterMode('airports');
    setScatterMinVolume(0);
    scatterBrushLabels = new Set();
    if (scatterClearBrush) scatterClearBrush(); // clears the selection box + handles
    document.querySelector('#scatter-brush-count').textContent =
      'Brush cleared — no groups are highlighted.';
    state.reset();
    activate(buttons[0]); // Reset returns to the national overview
  });

  function scopeText(snapshot) {
    const months = snapshot.start === 1 && snapshot.end === 12
      ? 'full year 2025'
      : `${MONTH_NAMES[snapshot.start - 1]}–${MONTH_NAMES[snapshot.end - 1]} 2025`;
    const carrier = snapshot.airline ? `reporting airline ${snapshot.airline}` : 'all reporting airlines';
    return { months, carrier };
  }

  function updateSummary() {
    const snapshot = state.snapshot();
    const { months, carrier } = scopeText(snapshot);
    const detail = snapshot.airport == null ? '' : ` · detail: ${codeByAirportId.get(snapshot.airport)}`;
    summary.textContent = `Showing: ${months} · ${carrier} · all origin airports${detail}`;
  }

  function syncControls(snapshot) {
    monthStart.value = String(snapshot.start);
    monthEnd.value = String(snapshot.end);
    airlineSelect.value = snapshot.airline ?? '';
    airportInput.value = snapshot.airport == null ? '' : codeByAirportId.get(snapshot.airport) ?? '';
  }

  // Airport selection opens the detail view; it never changes national scopes.
  function selectAirport(id) {
    state.setAirport(id);
    if (id != null) activate(buttons.find(button => button.dataset.tab === 'tab-detail'));
  }

  // City nodes with several airports must ask which one is meant instead of
  // silently pooling them; single-airport cities select directly.
  function showAirportChooser(city, event) {
    const codes = String(city.airports).split(',').map(code => code.trim()).filter(Boolean);
    const chooser = document.querySelector('#airport-chooser');
    if (codes.length === 1) {
      const airport = airportDirectory.find(row => row.airport === codes[0]);
      hideChooser();
      selectAirport(Number(airport.airport_id));
      return;
    }
    chooser.textContent = '';
    const title = document.createElement('p');
    title.textContent = `${city.city} has ${codes.length} airports — choose one:`;
    chooser.append(title);
    for (const code of codes) {
      const airport = airportDirectory.find(row => row.airport === code);
      if (!airport) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `${code} — ${airport.name} (${fmt(airportVolumes.get(Number(airport.airport_id)) ?? 0)} departures)`;
      button.addEventListener('click', () => { hideChooser(); selectAirport(Number(airport.airport_id)); });
      chooser.append(button);
    }
    chooser.hidden = false;
    const x = Math.min(event.clientX + 8, window.innerWidth - 340);
    const y = Math.min(event.clientY + 8, window.innerHeight - 200);
    chooser.style.left = `${Math.max(8, x)}px`;
    chooser.style.top = `${Math.max(8, y)}px`;
    chooser.querySelector('button')?.focus();
  }
  function hideChooser() {
    const chooser = document.querySelector('#airport-chooser');
    chooser.hidden = true;
  }
  document.addEventListener('click', event => {
    if (!event.target.closest('#airport-chooser') && !event.target.closest('.map-node')) hideChooser();
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hideChooser(); });

  // National reference: selected months across all airlines and all origin airports,
  // recomputed from pooled counts (never airport-specific).
  const nationalReference = () => poolAll(filterRows(airlineMonth, { ...state.snapshot(), airline: null }));

  const renderers = {
    // Monthly trends keep all twelve months, apply only the airline selection,
    // and highlight (not crop to) the chosen month range.
    'tab-monthly': () => drawMonthly(
      poolByMonth(filterRows(airlineMonth, { start: 1, end: 12, airline: state.snapshot().airline })),
      { range: state.snapshot(), airline: state.snapshot().airline }),
    // Airline comparison applies the month selection but keeps every carrier for
    // context; the chosen airline is highlighted, never isolated.
    'tab-airline': () => drawAirline(
      poolBy(filterRows(airlineMonth, { ...state.snapshot(), airline: null }), ['Reporting_Airline']),
      nationalReference(), { selectedAirline: state.snapshot().airline }),
    'tab-airport': () => drawAirport(
      poolBy(filterRows(airportMonth, state.snapshot()), AIRPORT_KEYS),
      nationalReference(), { selectedId: state.snapshot().airport, onSelect: selectAirport }),
    'tab-route': async isLatest => {
      // Airport selection does not change this comparison; it lives in the detail
      // view. Default month/airline scope reuses the annual snapshot.
      const rows = state.isFilterDefault() ? routeAnnual : await loadRoutePartitions();
      if (!isLatest()) return; // a newer selection superseded this render
      drawRoute(poolBy(filterRows(rows, state.snapshot()), ROUTE_KEYS), nationalReference());
    },
    'tab-detail': async isLatest => {
      const snapshot = state.snapshot();
      const airport = snapshot.airport == null ? null : airportById.get(snapshot.airport);
      const sub = document.querySelector('#detail-sub');
      const note = document.querySelector('#detail-status');
      ['#detailTrend', '#detailCauses', '#detailRoutes'].forEach(
        target => d3.select(target).selectAll('*').remove());
      if (!airport) {
        sub.textContent = 'Select an airport to inspect its filtered reliability.';
        note.textContent = 'No airport selected. Use the Airport box above, click a bar in the airport comparison, or click a city on the map — cities with several airports (e.g. Chicago) ask you to choose one.';
        return;
      }
      sub.textContent = `${airport.airport} — ${airport.name} · ${airport.city}`;
      const { months, carrier } = scopeText(snapshot);
      // The airport table carries OriginAirportID, so the selection filters it.
      const pooled = poolAll(filterRows(airportMonth, { ...snapshot, airportId: snapshot.airport }));
      note.textContent = pooled
        ? `${months} · ${carrier}: scheduled ${fmt(pooled.scheduled_flights)} · eligible arrivals ${fmt(pooled.eligible_arrivals)} · delayed ${fmt(pooled.delayed_arrivals)} (${ratePct(pooled.delayed_arrivals, pooled.eligible_arrivals)}) · cancelled ${fmt(pooled.cancelled_flights)} (${ratePct(pooled.cancelled_flights, pooled.scheduled_flights)}) · diverted ${fmt(pooled.diverted_flights)} (${ratePct(pooled.diverted_flights, pooled.scheduled_flights)})`
        : `No flights match the current filters for ${airport.airport}.`;
      drawMonthly(
        poolByMonth(filterRows(airportMonth, { start: 1, end: 12, airline: snapshot.airline, airportId: snapshot.airport })),
        { target: '#detailTrend', range: snapshot, airline: snapshot.airline, airport: airport.airport,
          fullYearContext: true });
      drawDetailCauses('#detailCauses', pooled);
      if (!pooled) {
        drawDetailRoutes('#detailRoutes', [], airport.airport, nationalReference());
        return;
      }
      const rows = await loadRoutePartition(airport.airport);
      if (!isLatest()) return; // a newer selection superseded this render
      // Five busiest outgoing directed routes: pooled scheduled flights, ties
      // broken deterministically by destination code.
      const top5 = poolBy(filterRows(rows, snapshot), ['DestAirportID', 'Dest'])
        .sort((a, b) => b.scheduled_flights - a.scheduled_flights
          || (a.Dest < b.Dest ? -1 : a.Dest > b.Dest ? 1 : 0))
        .slice(0, 5);
      drawDetailRoutes('#detailRoutes', top5, airport.airport, nationalReference());
    },
    // D1 heatmap: weekday x scheduled-hour, pooled over the selected months,
    // airline, and airport. Month partitions load on demand and stay cached.
    'tab-temporal': async isLatest => {
      const snapshot = state.snapshot();
      const months = [];
      for (let m = snapshot.start; m <= snapshot.end; m++) months.push(m);
      const rows = await loadTemporalPartitions(months);
      if (!isLatest()) return; // a newer selection superseded this render
      const filtered = filterRows(rows, { ...snapshot, airportId: snapshot.airport });
      const cells = poolBy(filtered, ['Weekday', 'ScheduledDepHour']);
      const { months: monthsLabel, carrier } = scopeText(snapshot);
      const airportLabel = snapshot.airport == null ? 'all origin airports' : `Airport: ${codeByAirportId.get(snapshot.airport)}`;
      drawHeatmap('#temporalHeatmap', cells, {
        scopeText: `${monthsLabel} · ${carrier} · ${airportLabel}. Gray = no observations; dashed outline = fewer than ${LOW_SAMPLE_THRESHOLD} eligible arrivals.`,
      });
    },
    // D2: comparative 100% stacked reported cause minutes across airports or
    // airlines under the shared filters; the national pie stays as the overview.
    'tab-cause-compare': () => {
      const snapshot = state.snapshot();
      let rows, selectedLabel = null, scopeLine;
      if (causeCompareMode === 'airlines') {
        // Airport selection scopes the airline comparison to that airport; the
        // selected airline is emphasized, every carrier stays for context.
        rows = poolBy(filterRows(airportMonth, { ...snapshot, airline: null, airportId: snapshot.airport }),
          ['Reporting_Airline']).map(row => ({ ...row, label: row.Reporting_Airline }));
        selectedLabel = snapshot.airline;
        scopeLine = `${scopeText(snapshot).months} · ${snapshot.airport == null ? 'all origin airports' : `airport ${codeByAirportId.get(snapshot.airport)}`} · one bar per reporting airline`;
      } else {
        // Airports: the busiest 12 by scheduled flights plus the selected airport
        // when it falls outside; the airline filter applies.
        const pool = poolBy(filterRows(airportMonth, snapshot), AIRPORT_KEYS)
          .map(row => ({ ...row, label: row.Origin }))
          .sort((a, b) => b.scheduled_flights - a.scheduled_flights
            || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
        rows = pool.slice(0, 12);
        if (snapshot.airport != null && !rows.some(row => Number(row.OriginAirportID) === snapshot.airport)) {
          const selected = pool.find(row => Number(row.OriginAirportID) === snapshot.airport);
          if (selected) rows.push(selected);
        }
        selectedLabel = snapshot.airport == null ? null : codeByAirportId.get(snapshot.airport);
        scopeLine = `${scopeText(snapshot).months} · ${scopeText(snapshot).carrier} · one bar per origin airport (busiest 12 by scheduled flights${snapshot.airport != null ? ', plus the selected airport' : ''})`;
      }
      drawCauseComparison('#causeCompareChart', rows, { scopeText: scopeLine, selectedLabel });
    },
    // D3 scatter: volume (log x) versus arrival-delay rate under the shared
    // filters; the airport selection is a highlight, brushing is a transient
    // comparison set, and missing rates are excluded rather than plotted as zero.
    'tab-scatter': () => {
      const snapshot = state.snapshot();
      let rows, selectedLabel = null, selectionNote = null, modeLine;
      if (scatterMode === 'airlines') {
        // Every carrier stays for context; the selected airline is emphasized.
        rows = poolBy(filterRows(airportMonth, { ...snapshot, airline: null, airportId: snapshot.airport }),
          ['Reporting_Airline']).map(row => ({ ...row, label: row.Reporting_Airline, id: row.Reporting_Airline }));
        selectedLabel = snapshot.airline;
        if (snapshot.airline) selectionNote = `${snapshot.airline} highlighted`;
        modeLine = 'one point per reporting airline';
      } else {
        rows = poolBy(filterRows(airportMonth, snapshot), AIRPORT_KEYS)
          .map(row => ({ ...row, label: row.Origin, id: row.OriginAirportID }));
        selectedLabel = snapshot.airport;
        if (snapshot.airport != null) selectionNote = `${codeByAirportId.get(snapshot.airport)} highlighted`;
        modeLine = 'one point per origin airport';
      }
      const plotted = rows.filter(row => +row.scheduled_flights >= scatterMinVolume);
      const noEligible = plotted.filter(row => !(Number(row.eligible_arrivals) > 0)).length;
      const { months, carrier } = scopeText(snapshot);
      const parts = [months];
      if (scatterMode === 'airlines') {
        // The comparison keeps every carrier: say "all reporting airlines" and
        // name the highlighted one separately, never "reporting airline X".
        parts.push('all reporting airlines',
          snapshot.airport == null ? 'all origin airports' : `airport ${codeByAirportId.get(snapshot.airport)}`,
          modeLine);
      } else {
        parts.push(carrier, modeLine);
      }
      if (selectionNote) parts.push(selectionNote);
      document.querySelector('#scatter-brush-count').textContent =
        'Brush cleared — no groups are highlighted.'; // fresh render, fresh brush
      drawScatter('#scatterChart', plotted, {
        scopeText: `${parts.join(' · ')} · minimum volume ${fmt(scatterMinVolume)}` +
          (noEligible > 0 ? ` · ${noEligible} group(s) without eligible arrivals are not plotted (missing rate ≠ 0)` : '') +
          ` · drag on empty areas to brush a highlight set (${scatterBrushLabels.size} currently brushed)`,
        minVolume: scatterMinVolume,
        selectedLabel,
        clickHint: scatterMode === 'airports' ? 'Click to open Airport Detail' : null,
        onSelect: scatterMode === 'airports' ? selectAirport : null,
        onReady: handle => { scatterClearBrush = handle.clearBrush; },
        onBrush: box => {
          scatterBrushLabels = new Set();
          if (box) {
            for (const row of plotted) {
              if (!hasNumberJs(row.arrival_delay_rate)) continue;
              const volume = Number(row.scheduled_flights);
              const rate = Number(row.arrival_delay_rate);
              if (volume >= box.volumeMin && volume <= box.volumeMax
                  && rate >= box.rateMin && rate <= box.rateMax) {
                scatterBrushLabels.add(row.label);
              }
            }
          }
          const selection = scatterBrushLabels;
          d3.select('#scatterChart').selectAll('.scatter-point')
            .attr('stroke', row => (selection.has(row.label) ? '#d9534f'
              : (selectedLabel != null && String(row.id) === String(selectedLabel) ? '#14304d' : '#fff')))
            .attr('stroke-width', row => (selection.has(row.label) ? 2.4
              : (selectedLabel != null && String(row.id) === String(selectedLabel) ? 2.6 : 1)));
          document.querySelector('#scatter-brush-count').textContent = box
            ? `Brushed: ${selection.size} group(s) as a highlight set only — filters and denominators unchanged.`
            : 'Brush cleared — no groups are highlighted.';
        },
      });
    },
    'tab-cause': () => drawCauses(national),
    'tab-network': async isLatest => {
      const snapshot = state.snapshot();
      let selection = null;
      if (snapshot.airport != null) {
        const airport = airportById.get(snapshot.airport);
        const rows = await loadRoutePartition(airport.airport);
        if (!isLatest()) return;
        // The map keeps its full-year, all-airline scope; outgoing routes are the
        // busiest 20 by annual departures, with destination coordinates from the
        // airport directory.
        const outgoing = poolBy(rows, ['DestAirportID', 'Dest'])
          .map(row => {
            const destination = airportDirectory.find(entry => entry.airport === row.Dest);
            return destination ? { ...row, longitude: destination.longitude, latitude: destination.latitude } : null;
          })
          .filter(Boolean)
          .sort((a, b) => b.scheduled_flights - a.scheduled_flights)
          .slice(0, 20);
        selection = {
          code: airport.airport,
          longitude: +airport.longitude,
          latitude: +airport.latitude,
          outgoing,
        };
      }
      // Await the map's completion so the status line only reports the loaded
      // state after the marks are actually drawn.
      await drawNetworkMap(baseline, isLatest, selection, showAirportChooser);
    },
  };

  // Token-guarded rendering: rapid selection changes let only the newest render
  // finish, so a delayed response can never replace results for a newer selection.
  const drawn = new Set();
  let activeTab = 'tab-monthly';
  let renderToken = 0;
  let renderInFlight = 0;
  let prevSnapshot = null;

  function isStateDependent(id) { return !FIXED_SCOPE_TABS.has(id) && id !== 'tab-network'; }

  function loadedStatusMessage() {
    if (state.isDefault()) {
      return 'Verified 2025 snapshot loaded. Hover chart marks for details; the filters above change months and airline.';
    }
    if (state.isFilterDefault()) {
      return `Airport ${codeByAirportId.get(state.snapshot().airport)} selected — the airport comparison highlights it and Airport Detail pools the full year; national scopes stay national.`;
    }
    return `Filters applied — ${summary.textContent.replace(/^Showing: /, '')}. Rates are recomputed from pooled counts.`;
  }

  async function renderActiveTab() {
    const token = ++renderToken;
    const id = activeTab;
    if (drawn.has(id)) {
      // Returning to an already-rendered tab must clear any leftover loading or
      // error text from the previous tab.
      status.textContent = loadedStatusMessage();
      return;
    }
    if (isStateDependent(id)) clearChart(id); // never show stale marks from another filter scope
    status.textContent = isStateDependent(id) ? 'Updating chart…' : 'Rendering chart…';
    renderInFlight = token;
    try {
      await renderers[id](() => token === renderToken); // renderers abort when superseded
      if (token !== renderToken) return; // superseded: leave UI state to the newest render
      drawn.add(id);
      status.textContent = loadedStatusMessage();
    } catch (error) {
      if (token !== renderToken) return;
      chartError(id, `Chart could not load: ${error.message}. Select the tab to retry or change the filters.`);
      status.textContent = `Chart could not load: ${error.message}. Select the tab to retry or change the filters.`;
      console.error(error);
    } finally {
      if (token === renderToken) renderInFlight = 0;
    }
  }

  async function activate(button) {
    const id = button.dataset.tab;
    activeTab = id;
    buttons.forEach(b => {
      b.classList.toggle('active', b === button);
      b.setAttribute('aria-pressed', String(b === button));
    });
    document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.toggle('active', panel.id === id));
    const tooltip = document.querySelector('#tooltip');
    tooltip.style.opacity = 0;
    tooltip.style.display = 'none';
    hideChooser();
    await renderActiveTab();
  }

  state.subscribe(() => {
    const snapshot = state.snapshot();
    // Controls mirror the normalized state (a reversed range is reordered, never emptied).
    syncControls(snapshot);
    updateSummary();
    drawKPIs(poolAll(filterRows(airlineMonth, snapshot))); // cheap, always current
    for (const id of [...drawn]) if (isStateDependent(id)) drawn.delete(id);
    // The scatter brush set is transient per scope: any global filter change
    // clears the set and its note so the scope line's count cannot go stale.
    if (scatterBrushLabels.size) {
      scatterBrushLabels = new Set();
      document.querySelector('#scatter-brush-count').textContent =
        'Brush cleared — no groups are highlighted.';
    }
    // The map ignores months/airline (fixed scope) but must re-render when the
    // selected airport changes — including the very first change, where no
    // previous snapshot exists yet.
    if (prevSnapshot === null || prevSnapshot.airport !== snapshot.airport) drawn.delete('tab-network');
    prevSnapshot = snapshot;
    if (!drawn.has(activeTab)) {
      renderActiveTab();
    } else if (renderInFlight === 0) {
      // Cached tabs (cause, map) still refresh the global scope text so it never
      // describes an outdated selection.
      status.textContent = loadedStatusMessage();
    }
  });

  document.querySelectorAll('input[name="cause-compare-mode"]').forEach(input => {
    input.addEventListener('change', () => {
      setCauseCompareMode(input.value);
      renderActiveTab(); // re-render in place with the new mode
    });
  });
  document.querySelectorAll('input[name="scatter-mode"]').forEach(input => {
    input.addEventListener('change', () => {
      setScatterMode(input.value);
      renderActiveTab(); // re-render in place with the new mode
    });
  });
  const minVolumeInput = document.querySelector('#scatter-min-volume');
  const minVolumeOut = document.querySelector('#scatter-min-volume-out');
  minVolumeInput.addEventListener('input', () => {
    minVolumeOut.textContent = fmt(Math.max(0, Number(minVolumeInput.value) || 0));
    setScatterMinVolume(minVolumeInput.value);
    renderActiveTab(); // re-render in place with the new threshold
  });
  document.querySelector('#scatter-clear-brush').addEventListener('click', () => {
    // Moving the brush to null fires the cleared-set path; styling follows there.
    if (scatterClearBrush) scatterClearBrush();
  });

  buttons.forEach(button => {
    button.disabled = false;
    button.addEventListener('click', () => activate(button));
  });
  updateSummary();
  syncControls(state.snapshot());
  prevSnapshot = state.snapshot(); // the first state change must still invalidate the map
  drawKPIs(poolAll(filterRows(airlineMonth, state.snapshot())));
  await activate(buttons[0]);
}

start().catch(error => {
  status.textContent = `Data could not load: ${error.message}. Serve the site over HTTP and check site/data/.`;
  status.setAttribute('role', 'alert');
  console.error(error);
});
