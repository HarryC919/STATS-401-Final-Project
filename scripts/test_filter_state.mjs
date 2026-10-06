// Unit tests for the Batch B pure modules (state.js, aggregate.js). Run:
//   node scripts/test_filter_state.mjs
// They need no DOM, no d3, and no large data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFilterState, normalizeRange } from '../site/js/state.js';
import { filterRows, matchesFilters, poolAll, poolBy, poolByMonth, rate, withRates } from '../site/js/aggregate.js';

function rows(...spec) {
  return spec.map(([month, airline, scheduled, eligible, delayed, cancelled, diverted]) => ({
    Month: month, Reporting_Airline: airline, scheduled_flights: scheduled,
    eligible_arrivals: eligible, delayed_arrivals: delayed,
    cancelled_flights: cancelled, diverted_flights: diverted,
  }));
}

test('normalizeRange clamps to 1..12 and never empties a reversed range', () => {
  assert.deepEqual(normalizeRange(3, 7), { start: 3, end: 7 });
  assert.deepEqual(normalizeRange(7, 3), { start: 3, end: 7 });
  assert.deepEqual(normalizeRange(0, 99), { start: 1, end: 12 });
  assert.deepEqual(normalizeRange('5', '5'), { start: 5, end: 5 });
});

test('filter state persists across readers and bumps the version on change', () => {
  const state = createFilterState();
  assert.ok(state.isDefault());
  assert.deepEqual(state.months(), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const seen = [];
  state.subscribe(snapshot => seen.push({ ...snapshot }));
  state.setRange(2, 4);
  state.setAirline('UA');
  assert.equal(state.version(), 2);
  assert.deepEqual(state.snapshot(), { start: 2, end: 4, airline: 'UA', airport: null, version: 2 });
  // A second reader observes the same state: one shared state across tabs.
  assert.equal(state.snapshot().airline, 'UA');
  state.setRange(4, 2); // already-selected months normalize back: a no-op, not an empty set
  assert.equal(state.version(), 2);
  state.setRange(5, 2); // a genuinely different reversed range expands to 2..5
  assert.equal(state.version(), 3);
  assert.deepEqual(state.snapshot(), { start: 2, end: 5, airline: 'UA', airport: null, version: 3 });
  state.setAirline('UA'); // no-op change must not notify
  assert.equal(state.version(), 3);
  assert.equal(seen.length, 3);
  assert.equal(seen[2].airline, 'UA');
});

test('reset restores the annual all-airline view and notifies once', () => {
  const state = createFilterState();
  state.setRange(5, 8);
  state.setAirline('B6');
  const seen = [];
  state.subscribe(snapshot => seen.push(snapshot.version));
  state.reset();
  assert.ok(state.isDefault());
  assert.deepEqual(state.months(), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.equal(state.snapshot().airline, null);
  assert.deepEqual(seen, [state.version()]);
  state.reset(); // already default: no notification
  assert.deepEqual(seen, [state.version()]);
});

test('airport selection is a stable id, independent of the month/airline filters', () => {
  const state = createFilterState();
  state.setAirport('13930'); // ORD
  assert.equal(state.snapshot().airport, 13930);
  assert.ok(!state.isDefault());
  assert.ok(state.isFilterDefault(), 'airport selection alone leaves the filters at their defaults');
  state.setAirport(13930); // no-op
  assert.equal(state.version(), 1);
  state.setAirport(null);
  assert.equal(state.snapshot().airport, null);
  assert.ok(state.isDefault());
  state.setAirport(13232); // MDW
  state.setRange(2, 4);
  state.setAirline('UA');
  state.reset();
  assert.equal(state.snapshot().airport, null, 'reset clears the airport selection too');
  assert.ok(state.isDefault());
  state.setAirport('not-a-number');
  assert.equal(state.snapshot().airport, null, 'unparseable input stays unselected');
});

test('pooled rates sum numerators and denominators: 5/10 + 9/90 = 14/100', () => {
  const pooled = poolAll(rows([1, 'AA', 10, 10, 5, 0, 0], [2, 'AA', 90, 90, 9, 0, 0]));
  assert.equal(pooled.scheduled_flights, 100);
  assert.equal(pooled.eligible_arrivals, 100);
  assert.equal(pooled.delayed_arrivals, 14);
  assert.equal(pooled.arrival_delay_rate, 0.14);
});

test('zero denominators stay missing and never become a zero rate', () => {
  const onlyCancelled = withRates({ scheduled_flights: 4, eligible_arrivals: 0,
    delayed_arrivals: 0, cancelled_flights: 4, diverted_flights: 0 });
  assert.equal(onlyCancelled.arrival_delay_rate, null);
  const pooled = poolAll(rows([1, 'AA', 4, 0, 0, 4, 0], [2, 'AA', 6, 6, 3, 0, 0]));
  assert.equal(pooled.arrival_delay_rate, 0.5);
  assert.equal(pooled.cancellation_rate, 0.4);
});

test('an empty selection pools to null, never to a zero rate', () => {
  assert.equal(poolAll([]), null);
  const empty = filterRows(rows([1, 'AA', 10, 10, 5, 0, 0]), { start: 5, end: 6, airline: 'ZZ' });
  assert.equal(empty.length, 0);
  assert.equal(poolAll(empty), null);
});

test('filterRows applies the inclusive month range and airline selection', () => {
  const data = rows([1, 'AA', 1, 1, 0, 0, 0], [2, 'UA', 2, 2, 0, 0, 0], [3, 'AA', 3, 3, 0, 0, 0]);
  assert.equal(filterRows(data, { start: 1, end: 2, airline: null }).length, 2);
  assert.equal(filterRows(data, { start: 1, end: 3, airline: 'AA' }).length, 2);
  assert.equal(filterRows(data, { start: 2, end: 2, airline: 'UA' }).length, 1);
  assert.equal(matchesFilters({ Month: 2, Reporting_Airline: 'UA' }, { start: 2, end: 2, airline: 'UA' }), true);
  assert.equal(rate(0, 0), null);
});

test('airport selection filters airport rows but not airport-agnostic rows', () => {
  const airportRows = [
    { Month: 1, Reporting_Airline: 'UA', OriginAirportID: 13930, scheduled_flights: 5 },
    { Month: 1, Reporting_Airline: 'UA', OriginAirportID: 13232, scheduled_flights: 7 },
  ];
  const filters = { start: 1, end: 12, airline: null, airportId: 13930 };
  assert.equal(filterRows(airportRows, filters).length, 1);
  assert.equal(filterRows(airportRows, { ...filters, airportId: null }).length, 2);
  // airline_month rows carry no OriginAirportID: the airport selection must not
  // drop them, or the national KPI would silently become airport-specific.
  const airlineRows = [{ Month: 1, Reporting_Airline: 'UA', scheduled_flights: 12 }];
  assert.equal(filterRows(airlineRows, filters).length, 1);
});

test('pooled cause minutes stay missing without observations and zero when observed', () => {
  const pooled = poolAll([
    { scheduled_flights: 5, CarrierDelay_minutes: null, CarrierDelay_observations: 0 },
    { scheduled_flights: 5, CarrierDelay_minutes: 30, CarrierDelay_observations: 1,
      WeatherDelay_minutes: 0, WeatherDelay_observations: 1, cause_observed_flights: 1 },
  ]);
  assert.equal(pooled.CarrierDelay_minutes, 30, 'observed minutes pool by summation');
  assert.equal(pooled.CarrierDelay_observations, 1);
  assert.equal(pooled.WeatherDelay_minutes, 0, 'observed zero minutes stay zero');
  assert.equal(pooled.cause_observed_flights, 1, 'attribution counts pool by summation');
  const unobserved = poolAll([{ scheduled_flights: 5, CarrierDelay_observations: 0 }]);
  assert.equal(unobserved.CarrierDelay_minutes, null, 'all-unobserved minutes stay missing');
});

test('poolBy keeps every observed group so comparisons retain context', () => {
  const pooled = poolBy(rows([1, 'AA', 10, 10, 5, 0, 0], [2, 'UA', 90, 90, 9, 1, 0]), ['Reporting_Airline']);
  assert.equal(pooled.length, 2);
  const byCode = new Map(pooled.map(row => [row.Reporting_Airline, row]));
  assert.equal(byCode.get('AA').arrival_delay_rate, 0.5);
  assert.equal(byCode.get('UA').arrival_delay_rate, 0.1);
  assert.equal(byCode.get('UA').cancellation_rate, 1 / 90);
});

test('poolByMonth always returns twelve months with missing rates when absent', () => {
  const months = poolByMonth(rows([1, 'AA', 10, 10, 5, 0, 0], [12, 'AA', 90, 90, 9, 0, 0]));
  assert.equal(months.length, 12);
  assert.equal(months[0].arrival_delay_rate, 0.5);
  assert.equal(months[11].arrival_delay_rate, 0.1);
  assert.equal(months[5].arrival_delay_rate, null);
  assert.equal(months[5].scheduled_flights, 0);
});
