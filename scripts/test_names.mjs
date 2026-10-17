import test from 'node:test';
import assert from 'node:assert/strict';
import { createNameLookup } from '../site/js/names.js';
const airports = [{ airport: 'ORD', name: "Chicago O'Hare International" },
  { airport: 'MDW', name: 'Chicago Midway International' }];
const airlines = { UA: 'United Air Lines Inc.', OH: 'PSA Airlines Inc.' };

test('airport selection accepts code or display label and rejects unknown values', () => {
  const lookup = createNameLookup?.(airports, airlines);
  assert.deepEqual(lookup && [' ord ', "ORD — Chicago O'Hare International", 'ZZZ', '']
    .map(value => lookup.airportCode(value)), ['ORD', 'ORD', null, null]);
});
test('display labels preserve codes and fall back for unknown names', () => {
  const lookup = createNameLookup?.(airports, airlines);
  assert.deepEqual(lookup && [lookup.airportLabel('ORD'), lookup.airlineLabel('OH'), lookup.airlineLabel('ZZ')],
    ["ORD — Chicago O'Hare International", 'OH — PSA Airlines Inc.', 'ZZ']);
});
test('tooltip descriptions resolve both directed airports and do not expand partial or historical codes', () => {
  const lookup = createNameLookup?.(airports, airlines);
  assert.deepEqual(lookup?.descriptions('ORD → MDW'),
    ["ORD — Chicago O'Hare International", 'MDW — Chicago Midway International']);
  assert.deepEqual(lookup?.descriptions('OH'), ['OH — PSA Airlines Inc.']);
  assert.deepEqual(lookup?.descriptions('Month 12 — NASDelay'), []);
  assert.deepEqual(lookup?.descriptions('Cleveland, OH'), [], 'a state abbreviation is not an airline label');
});
