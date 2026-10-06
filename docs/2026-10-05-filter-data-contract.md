# Filter-Ready Publication Data Contract (Batch A)

Date: October 5, 2026.
Status: implemented by Batch A (`scripts/export_site_data.py`); intended consumers are
the Batch B shared filters, the Batch C airport detail, the Batch D1 heatmap, and the
Batch D2 comparative cause bars. This document is written before the corresponding
export changes and records the decisions the exporter must satisfy.

Batch A publishes data only. It adds no frontend controls and changes no metric
definitions; all rates remain recomputable from retained counts.

## 1. Verified inputs

The exporter reads only verified baseline artifacts and fails on incomplete coverage:

| Input | Grain | Used for |
|---|---|---|
| `data/summaries/airport_month_airline.csv` (17,791 rows) | month × reporting airline × origin airport | new filter table |
| `data/summaries/airline_month.csv` (168 rows) | month × reporting airline | new airline-month table |
| `data/summaries/route_month_airline.csv` (116,878 rows) | month × airline × directed airport pair | new route partitions |
| `data/summaries/temporal/2025-MM.csv` (12 files) | month × airline × origin airport × weekday × scheduled hour | new temporal partitions |
| `data/processed/airports.csv` (510 sequence versions) | one row per `AIRPORT_SEQ_ID` | airport directory metadata |
| `data/processed/flights_2025_MM.parquet` (12 partitions) | flight level | existing city/city-pair export; directory city membership and coordinate weights |
| `data/summaries/{national,monthly,airline_annual,airport_annual,route_annual}.csv` | aggregates | existing outputs (unchanged) and pooled-total guards |

`reports/verification.json` and `reports/quality_report.json` must confirm the
twelve-month verified baseline before export, as before.

### Cardinality guarantees (asserted at export)

Verified against the current baseline and re-asserted on every export:

- Origin IATA code ↔ `OriginAirportID` is one-to-one in the flight, filter, and route
  inputs; destination code ↔ `DestAirportID` likewise. Files may therefore be keyed by
  either identifier, with the mapping recorded in the manifest.
- `OriginAirportSeqID → OriginAirportID` is many-to-one (510 versions → 352 airports),
  matching `data/processed/airports.csv`, whose sequence-ID set equals the set of
  sequence IDs observed as origins.
- `OriginAirportID → (OriginCityName, OriginState)` is one-to-one in the flight data,
  so each airport has exactly one flight-data city.
- No route has `Origin == Dest`, so directed route partitions never contain
  self-loops.

## 2. Published files

All under `site/data/`. Paths and schemas of the seven existing CSVs are unchanged;
only `manifest.json` gains keys.

### Existing (unchanged)

`national.csv`, `monthly.csv`, `airline_annual.csv`, `airport_annual.csv`,
`route_annual.csv`, `city_summary.csv`, `city_routes.csv` — same columns, rows, and
(bytes-)identical content when inputs are unchanged. These remain the initial page
load of the current static dashboard.

### New top-level CSVs

- `airport_month_airline.csv` — **the filter table.** One row per observed
  (Month, Reporting_Airline, OriginAirportID, Origin). 17,791 rows at the current
  baseline. Columns: `Month` (1–12), `Reporting_Airline` (BTS code),
  `OriginAirportID` (stable BTS airport ID), `Origin` (IATA code), ten count fields
  (`scheduled_flights`, `eligible_arrivals`, `delayed_arrivals`,
  `cancelled_flights`, `diverted_flights`, `missing_arrival_delay`,
  `cause_complete_flights`, `delayed_cause_missing`, `cause_observed_flights`,
  `cause_partial_flights`), five `*_minutes` fields, five `*_observations` fields.
  No rate or share columns: consumers pool counts and recompute rates.
- `airline_month.csv` — same count/attribution columns keyed by
  (Month, Reporting_Airline). Convenience for airline-filtered monthly trends; also
  fully derivable by pooling the filter table.
- `airport_directory.csv` — one row per airport with at least one 2025 departure
  (352 rows). Columns: `airport_id`, `airport`, `name`, `city`, `state`, `latitude`,
  `longitude`, `coordinate_versions`. See §4 for the directory rules.

### Partitions (on-demand, never loaded on initial page view)

- `routes/<ORIGIN>.csv` — one file per origin IATA code (352 files). Rows are that
  origin's observed (Month, Reporting_Airline, DestAirportID, Dest) with the five
  core counts (`scheduled_flights`, `eligible_arrivals`, `delayed_arrivals`,
  `cancelled_flights`, `diverted_flights`). Rows stay directed:
  A→B and B→A live in different files and are never merged. The origin itself is not
  repeated inside the file; `manifest.json` maps each file name to its
  `origin_airport_id` and code. Cause minutes are not exported at route grain
  (not required by Batches C–D2 as scoped).
- `temporal/2025-MM.csv` — one file per month (12 files), mirroring the local summary
  names. Rows are that month's observed (Reporting_Airline, OriginAirportID, Origin,
  Weekday, ScheduledDepHour) with the five core counts. `Weekday` is Monday=1 …
  Sunday=7. `ScheduledDepHour` is 0–23 with the BTS `2400` convention mapped to hour 0;
  invalid scheduled times remain missing (empty cell) and those rows are retained, so
  partition totals still reconcile with `monthly.csv`.

Consumers discover partitions through `manifest.json` (`partitions.routes.files` and
`partitions.temporal.files`), which lists every file with its key, row count, byte
size, and SHA-256.

## 3. Units, null semantics, and pooling rules

- Counts are non-negative integers in flights; cause minutes are in minutes; rates are
  proportions in [0, 1]. The exporter ships counts only (plus minutes/observations);
  it does not ship new precomputed rates.
- **Pooling (consumer rule):** filter rows first, then sum each count over the
  selected rows, then recompute `arrival_delay_rate = delayed_arrivals /
  eligible_arrivals`, `cancellation_rate = cancelled_flights / scheduled_flights`,
  `diversion_rate = diverted_flights / scheduled_flights`. A zero denominator yields a
  missing rate, never zero. Never average precomputed percentages. Unequal group
  sizes (5/10 and 9/90) must pool to 14/100.
- **Cause minutes:** an empty minutes cell means *no observation*; `0` means an
  observed zero. A cause's minutes are missing exactly where its `*_observations`
  count is zero (true of the source summaries and preserved by export). Pooling sums
  minutes only over rows where that cause has observations; the pooled value is
  missing iff the pooled observation count is zero. Observed zeros stay zero.
- `reported_cause_minutes` and per-cause shares are recomputed by consumers from
  pooled minutes/observations with the same rule; missing attribution is never
  treated as zero.
- A filtered combination with no rows (e.g., an airline that does not serve an
  airport) means *no observations*: missing rates, an explicit empty state — never an
  artificial zero rate.
- Airport metrics describe arrival outcomes of outgoing flights, as elsewhere in the
  project. City-pair aggregation exists only in `city_routes.csv`; airport-level route
  partitions are directed and unaffected by it.

## 4. Airport directory rules

- One row per airport (stable `airport_id` = BTS `AirportID`), not per historical
  sequence version.
- `city`/`state` come from the flight records' `OriginCityName`/`OriginState`
  (one-to-one per airport, asserted), so membership matches the `city_summary.csv`
  identity exactly. The metadata city string is not used for membership.
- Display location: the departure-weighted mean of the historical
  `AirportSeqID`-version coordinates actually used by 2025 departures —
  Σ(version coordinate × version departures) / Σ(version departures). This mirrors the
  existing city-coordinate rule; it never joins by IATA code and never picks an
  arbitrary version row. `coordinate_versions` records how many versions contributed.
- Display name: `DISPLAY_AIRPORT_NAME` from the sequence version with the most 2025
  departures; ties break to the latest `AIRPORT_START_DATE`, then the highest
  `AIRPORT_SEQ_ID`. (Ten airports have name variants across versions; the rule makes
  the choice deterministic and documented rather than silent.)

## 5. Manifest extension

`site/data/manifest.json` keeps every existing key and adds:

- `files` entries for the three new top-level CSVs (SHA-256, rows, bytes).
- `partitions.routes` / `partitions.temporal`: grain description, per-file key, file
  path, `origin_airport_id` (routes), rows, bytes, SHA-256, plus group totals and file
  counts.
- `sources` entries for the newly consumed summary inputs
  (`airport_month_airline.csv`, `airline_month.csv`, `route_month_airline.csv`,
  `temporal/2025-MM.csv`) with SHA-256, alongside the existing source hashes.
- `filter_data`: null-semantics and pooling notes, the directory rules, and a
  non-normative `loading_plan` proposal (initial: the seven existing files plus
  `airport_directory.csv`, `airport_month_airline.csv`, `airline_month.csv`;
  on-demand: route partitions per selected origin, temporal partitions per selected
  month). File sizes cannot establish browser performance; no such claim is made.

## 6. Compatibility and scope boundaries

- No `site/js`, `site/index.html`, or `site/css` changes; the current page's five
  fetches and the map's two fetches are byte-compatible.
- The exporter must remain deterministic: identical inputs produce identical CSV
  contents and hashes (verified by re-running the export and comparing manifests).
- Out of scope for Batch A: frontend state or controls (Batch B), airport detail and
  map layers (Batch C), the heatmap and cause/scatter views (D1–D3), browser
  performance measurement (E), and cause attribution at route or temporal grain.
