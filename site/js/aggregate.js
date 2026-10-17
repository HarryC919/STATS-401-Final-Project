// Pure pooling over the Batch A filter-ready rows, implementing the consumer rule
// from docs/2026-10-05-filter-data-contract.md: filter rows first, sum counts,
// recompute rates from pooled counts; zero denominators stay missing and an empty
// selection stays empty (never a zero rate). Cause minutes pool only over rows
// where the cause has observations, so unobserved minutes stay missing while
// observed zeros stay zero. Pure module: no DOM and no d3.
export const CORE_COUNTS = ['scheduled_flights', 'eligible_arrivals', 'delayed_arrivals',
                            'cancelled_flights', 'diverted_flights'];
export const ATTRIBUTION_COUNTS = ['missing_arrival_delay', 'cause_complete_flights',
                                   'delayed_cause_missing', 'cause_observed_flights',
                                   'cause_partial_flights'];
export const CAUSES = ['CarrierDelay', 'WeatherDelay', 'NASDelay', 'SecurityDelay', 'LateAircraftDelay'];

export function rate(numerator, denominator) {
  return Number(denominator) > 0 ? Number(numerator) / Number(denominator) : null;
}

export function matchesFilters(row, filters) {
  if (!row) return false;
  const month = Number(row.Month);
  if (Number.isFinite(month) && (month < filters.start || month > filters.end)) return false;
  if (filters.airline && row.Reporting_Airline !== filters.airline) return false;
  // Airport selection (Batch C) applies only to rows that carry an origin airport
  // id — airline_month rows are airport-agnostic and keep pooling all airports.
  if (filters.airportId != null && row.OriginAirportID !== undefined
      && Number(row.OriginAirportID) !== filters.airportId) return false;
  return true;
}

export function filterRows(rows, filters) {
  return rows.filter(row => matchesFilters(row, filters));
}

function newAccumulator() {
  return {
    counts: Object.fromEntries(CORE_COUNTS.map(name => [name, 0])),
    attribution: Object.fromEntries(ATTRIBUTION_COUNTS.map(name => [name, 0])),
    causeMinutes: Object.fromEntries(CAUSES.map(name => [name, 0])),
    causeObservations: Object.fromEntries(CAUSES.map(name => [name, 0])),
  };
}

function accumulate(target, row) {
  for (const name of CORE_COUNTS) target.counts[name] += Number(row[name]) || 0;
  for (const name of ATTRIBUTION_COUNTS) target.attribution[name] += Number(row[name]) || 0;
  for (const cause of CAUSES) {
    const observations = Number(row[`${cause}_observations`]) || 0;
    target.causeObservations[cause] += observations;
    // Unobserved minutes contribute nothing; observed zeros pool to zero.
    if (observations > 0) target.causeMinutes[cause] += Number(row[`${cause}_minutes`]) || 0;
  }
}

function finalize(accumulator) {
  const causeFields = {};
  for (const cause of CAUSES) {
    causeFields[`${cause}_observations`] = accumulator.causeObservations[cause];
    // Pooled minutes are missing exactly when no row observed that cause.
    causeFields[`${cause}_minutes`] = accumulator.causeObservations[cause] > 0
      ? accumulator.causeMinutes[cause] : null;
  }
  return { ...accumulator.counts, ...accumulator.attribution, ...causeFields };
}

export function poolCounts(rows) {
  const sums = Object.fromEntries(CORE_COUNTS.map(name => [name, 0]));
  for (const row of rows) {
    for (const name of CORE_COUNTS) sums[name] += Number(row[name]) || 0;
  }
  return sums;
}

export function withRates(counts) {
  return { ...counts,
    arrival_delay_rate: rate(counts.delayed_arrivals, counts.eligible_arrivals),
    cancellation_rate: rate(counts.cancelled_flights, counts.scheduled_flights),
    diversion_rate: rate(counts.diverted_flights, counts.scheduled_flights) };
}

// Pool every selected row into one row, or null when nothing matches.
export function poolAll(rows) {
  if (!rows.length) return null;
  const accumulator = newAccumulator();
  for (const row of rows) accumulate(accumulator, row);
  return withRates(finalize(accumulator));
}

// Pool per dimension group, keeping every observed group so comparisons retain
// their context (e.g. all airlines stay visible when one is highlighted).
export function poolBy(rows, keys) {
  const groups = new Map();
  for (const row of rows) {
    const key = JSON.stringify(keys.map(name => row[name]));
    let group = groups.get(key);
    if (!group) {
      group = { dims: keys.map(name => [name, row[name]]), accumulator: newAccumulator() };
      groups.set(key, group);
    }
    accumulate(group.accumulator, row);
  }
  return [...groups.values()].map(({dims, accumulator}) => ({
    ...Object.fromEntries(dims), ...withRates(finalize(accumulator)),
  }));
}

// Twelve monthly rows in fixed order; a month without observations keeps missing
// rates instead of a zero rate.
export function poolByMonth(rows) {
  const pooled = new Map(poolBy(rows, ['Month']).map(row => [Number(row.Month), row]));
  const months = [];
  for (let month = 1; month <= 12; month++) {
    months.push(pooled.get(month) ?? {
      Month: month,
      ...Object.fromEntries(CORE_COUNTS.map(name => [name, 0])),
      arrival_delay_rate: null, cancellation_rate: null, diversion_rate: null,
    });
  }
  return months;
}

export const COMPARISON_METRICS = {
  delay: { label: 'Arrival-delay rate', tooltipLabel: 'Delay rate',
    numerator: 'delayed_arrivals', denominator: 'eligible_arrivals',
    numeratorLabel: 'Delayed arrivals', sampleLabel: 'eligible arrivals' },
  cancellation: { label: 'Cancellation rate', tooltipLabel: 'Cancellation rate',
    numerator: 'cancelled_flights', denominator: 'scheduled_flights',
    numeratorLabel: 'Cancelled flights', sampleLabel: 'scheduled flights' },
};

// Input groups must already be pooled under the shared month/airline scope.
// Filter by the metric's denominator before selecting the top groups. A selected
// airport may supplement the ranking, but can never bypass sample/missingness rules.
export function selectComparison(rows, options = {}) {
  const metric = COMPARISON_METRICS[options.metric] ?? COMPARISON_METRICS.delay;
  const ranking = ['highest', 'lowest'].includes(options.ranking) ? options.ranking : 'busiest';
  const minSample = Math.max(0, Math.floor(Number(options.minSample) || 0));
  const limit = Math.max(1, Math.floor(Number(options.limit) || 15));
  const labelKey = options.labelKey ?? 'Origin';
  const idKey = options.idKey ?? 'OriginAirportID';
  const present = value => value != null && value !== '' && Number.isFinite(Number(value));
  let excludedMissing = 0;
  let excludedSample = 0;
  const qualified = [];
  for (const row of rows) {
    const denominator = Number(row[metric.denominator]);
    if (!row[labelKey] || !present(row.scheduled_flights)
        || !present(row[metric.numerator]) || !present(row[metric.denominator]) || denominator <= 0) {
      excludedMissing++;
    } else if (denominator < minSample) {
      excludedSample++;
    } else {
      qualified.push({ ...row, comparison_rate: Number(row[metric.numerator]) / denominator });
    }
  }
  const byVolume = (a, b) => Number(b.scheduled_flights) - Number(a.scheduled_flights)
    || String(a[labelKey]).localeCompare(String(b[labelKey]), 'en');
  const byRate = (a, b) => (ranking === 'lowest' ? 1 : -1)
    * (a.comparison_rate - b.comparison_rate) || byVolume(a, b);
  qualified.sort(ranking === 'busiest' ? byVolume : byRate);
  const shown = qualified.slice(0, limit);
  const selected = options.selectedId == null ? null
    : qualified.find(row => String(row[idKey]) === String(options.selectedId));
  const selectedExtra = Boolean(selected && !shown.includes(selected));
  if (selectedExtra) shown.push(selected);
  shown.sort(byRate);
  return { rows: shown, metric, total: rows.length, qualifiedCount: qualified.length,
    excludedMissing, excludedSample, selectedExtra,
    selectedExcluded: options.selectedId != null && !selected };
}
