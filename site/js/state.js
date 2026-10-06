// Shared month/airline filter state for the dashboard (Batch B).
// Pure module: no DOM and no d3, so scripts/test_filter_state.mjs can import it.
export const MONTH_MIN = 1;
export const MONTH_MAX = 12;

export function normalizeRange(start, end) {
  let from = clampMonth(start);
  let to = clampMonth(end);
  if (from > to) [from, to] = [to, from]; // a reversed range keeps its months, not an empty set
  return { start: from, end: to };
}

function clampMonth(value) {
  const month = Math.round(Number(value));
  if (!Number.isFinite(month)) return MONTH_MIN;
  return Math.min(MONTH_MAX, Math.max(MONTH_MIN, month));
}

export function createFilterState(initial = {}) {
  let range = normalizeRange(initial.start ?? MONTH_MIN, initial.end ?? MONTH_MAX);
  let airline = initial.airline || null;
  // Batch C: the airport selection is a stable BTS AirportID (or null), not a
  // filter — it drives the detail view, the highlight, and the map layers while
  // national scopes stay national.
  let airport = initial.airport == null || initial.airport === '' ? null : normalizeAirport(initial.airport);
  let version = 0;
  const listeners = new Set();
  const api = {
    snapshot: () => ({ start: range.start, end: range.end, airline, airport, version }),
    months: () => {
      const months = [];
      for (let month = range.start; month <= range.end; month++) months.push(month);
      return months;
    },
    version: () => version,
    isFilterDefault: () => range.start === MONTH_MIN && range.end === MONTH_MAX && airline === null,
    isDefault: () => api.isFilterDefault() && airport === null,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setRange(start, end) {
      const next = normalizeRange(start, end);
      if (next.start === range.start && next.end === range.end) return;
      range = next;
      version += 1;
      emit();
    },
    setAirline(code) {
      const next = code ? String(code) : null;
      if (next === airline) return;
      airline = next;
      version += 1;
      emit();
    },
    setAirport(id) {
      let next = null;
      if (id != null && id !== '') {
        next = Number(id);
        if (!Number.isFinite(next)) next = null;
      }
      if (next === airport) return;
      airport = next;
      version += 1;
      emit();
    },
    reset() {
      if (api.isDefault()) return;
      range = { start: MONTH_MIN, end: MONTH_MAX };
      airline = null;
      airport = null;
      version += 1;
      emit();
    },
  };
  function emit() {
    const snapshot = api.snapshot();
    listeners.forEach(listener => listener(snapshot));
  }
  return api;
}

function normalizeAirport(id) {
  const value = Number(id);
  return Number.isFinite(value) ? value : null;
}
