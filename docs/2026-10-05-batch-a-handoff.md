# Batch A Handoff: Filter-Ready Publication Data

**Batch ID:** A — **Status: ready for review** (not accepted; awaiting Codex review).

Date: October 5, 2026. Implementer: ZCode + GLM. Scope was strictly
[Batch A](2026-10-05-next-phase-plan.md) from the assigned
[executor prompt](2026-10-05-zcode-glm-batch-a-prompt.md): publication data for
month/airline/airport filtering only. No frontend changes, no Batch B–E work,
no Git staging/commit/push/merge/deploy.

## 1. Changed files and purpose

| File | Change | Purpose |
|---|---|---|
| `docs/2026-10-05-filter-data-contract.md` | new | Data contract, written **before** the export changes: paths, keys, units, null semantics, retained counts, partitioning, directory rules, compatibility. |
| `scripts/export_site_data.py` | modified | Extends the verified exporter with the filter table, airline-month table, airport directory, directed route partitions, month temporal partitions, extended manifest, a reference pooling helper (`pool_rows`), `partition_routes`, and `build_airport_directory`, plus cardinality/pooled-total guards. Legacy export logic untouched. |
| `scripts/test_site_data.py` | modified | 5 new synthetic regression tests (7 total). Still data-independent, so the GitHub Pages CI gate keeps passing. |
| `scripts/verify_site_filters.py` | new | Independent reconciliation of delivered `site/data/` artifacts against source summaries and the Parquet baseline; does **not** import the exporter. Local-only (needs the verified baseline). |
| `data/README.md` | modified | Publishing-snapshot section documents the new filter-ready files and links the contract. |
| `site/data/manifest.json` | regenerated | Extended manifest (see §3). |
| `site/data/airport_month_airline.csv`, `airline_month.csv`, `airport_directory.csv` | new (generated) | Filter-ready top-level tables. |
| `site/data/routes/` (352 files), `site/data/temporal/` (12 files) | new (generated) | On-demand partitions. |

Unrelated work preserved untouched: `.zcodeignore`, `docs/2026-10-05-next-phase-plan.md`,
`docs/2026-10-05-zcode-glm-batch-a-prompt.md` (pre-existing untracked files),
`site/js/*`, `site/index.html`, `site/css/*`, `proposal.md`, `data/raw/`,
`docs/assets/interim/`. No Git operations were performed by the implementer.

## 2. Data-contract decisions and deviations

Full contract: [2026-10-05-filter-data-contract.md](2026-10-05-filter-data-contract.md).
Decisions worth reviewer attention:

- **Counts without rates.** The filter table and airline-month table ship the ten
  count fields, five cause `*_minutes`, and five `*_observations` — deliberately no
  precomputed rates or shares, so consumers must pool numerators/denominators. The
  existing annual tables keep their rates (schema compatibility).
- **Route partitions carry no origin columns.** File name = origin IATA code; the
  manifest maps each file to its `origin_airport_id` and code. Documented in the
  contract; the exporter asserts code ↔ AirportID is one-to-one, so keying cannot
  mislabel a partition (it fails loudly instead).
- **No cause attribution at route or temporal grain.** Not required by Batches C/D1/D2
  as scoped; the filter table carries attribution for airport/airline pooling (D2).
  This is recorded as an omission, not a silent drop.
- **Airport directory rules.** One row per stable `AirportID`; coordinates are the
  departure-weighted mean across the historical `AirportSeqID` versions the airport's
  2025 departures actually used (never an arbitrary row, never an IATA join); display
  name from the dominant version (ties: latest `AIRPORT_START_DATE`, then highest
  `AIRPORT_SEQ_ID`); city/state from flight-data city names (one-to-one per airport,
  asserted) so membership matches `city_summary.csv`. ABE illustrates the collapse
  (2 versions → weighted coordinate, `coordinate_versions=2`).
- **Temporal grain and pooling.** Partitioned by month; grain is
  airline × airport × weekday × scheduled hour. Cross-partition pooling = filter rows
  per partition (airline/airport), sum counts across selected months, recompute rates.
  BTS `2400` maps to hour 0 (existing convention). 2025 has zero invalid scheduled
  times (1 flight at `2400`), so no missing-hour rows currently exist; the contract
  still specifies their handling and the exporter retains them if they occur.
- No deviations from metric definitions or project scope were made.

## 3. Inputs/outputs

Inputs (all verified, hashed into the manifest): `data/summaries/{airport_month_airline,
airline_month,route_month_airline,national,monthly,airline_annual,airport_annual,
route_annual}.csv`, `data/summaries/temporal/2025-MM.csv`, `data/processed/airports.csv`,
`data/processed/flights_2025_MM.parquet`, `reports/{verification,quality_report}.json`.

Outputs: the seven legacy CSVs (byte-identical, see §7), three new top-level CSVs,
352 + 12 partition files, and the extended `manifest.json` (per-file SHA-256/rows/bytes,
partition discovery with `origin_airport_id`, coverage, source hashes including the
newly consumed summaries, null-semantics notes, and a non-normative loading plan).

## 4. Verification commands, exit statuses, and results

All commands run with the locked uv environment (Python 3.13):

| Command | Exit | Key results |
|---|---|---|
| `uv sync --locked` | 0 | environment already in sync |
| `uv run --locked python scripts/test_metrics.py` | 0 | 3 tests OK |
| `uv run --locked python scripts/test_site_data.py` | 0 | 7 tests OK (first run exposed a real column-name bug in `build_airport_directory`; fixed and re-run) |
| `uv run --locked python scripts/verify_data.py` | 0 | full year verified; 7,001,619 rows; independent raw-January counts match; `reports/verification.json` rewritten byte-identically |
| `uv run --locked python scripts/export_site_data.py` | 0 | 10 tables, 352 route + 12 temporal partitions; run twice for repeatability (§7) |
| `uv run --locked python scripts/verify_site_filters.py` | 0 | 70 count checks + structural asserts passed (§5) |
| `uv run --locked python scripts/write_report.py` | 0 | regenerated; `git status` shows `reports/` unchanged (no drift from Batch A) |
| `git diff --check` | 0 | clean; new/changed files also grep-verified free of trailing whitespace |

Failures encountered and resolved: the two test-script bugs above (a merge key name,
a `global` declaration, and missing minutes in a reconciliation grouping). None remain.

## 5. Independent numeric reconciliation

`scripts/verify_site_filters.py` recomputes expectations from source summaries and
from raw source fields of the Parquet baseline (never from the exporter), then checks
the delivered artifacts. Selected fixtures — exact numerators/denominators, arrival
delay rate = delayed ÷ eligible:

| Fixture | scheduled | eligible | delayed | cancelled | diverted | delay rate |
|---|---|---|---|---|---|---|
| National (all months/airlines/airports) | 7,001,619 | 6,879,484 | 1,534,638 | 102,876 | 19,258 | 1,534,638 / 6,879,484 ≈ 0.223075 |
| ORD annual | 327,028 | 320,418 | 84,927 | 5,656 | 954 | 84,927 / 320,418 ≈ 0.265051 |
| ORD January | 21,643 | 21,200 | 4,495 | 383 | 60 | 4,495 / 21,200 ≈ 0.212028 |
| ORD January–February | 41,632 | 40,896 | 9,268 | 615 | 121 | 9,268 / 40,896 ≈ 0.226624 |
| ORD + UA annual (specified airline subset) | 95,572 | 94,624 | 23,128 | 720 | 228 | 23,128 / 94,624 ≈ 0.244420 |
| ORD + UA January | 6,637 | 6,548 | 1,167 | 70 | 19 | 1,167 / 6,548 ≈ 0.178222 |

Provenance per fixture: ORD annual matches the `airport_annual.csv` row exactly; ORD
January / Jan–Feb / ORD+UA match both the pooled `temporal/2025-MM.csv` summaries and
independent Parquet calculations; ORD+UA annual matches the Parquet calculation.
Pooling all 17,791 filter-table rows (and all 168 airline-month rows) restores the
national counts exactly.

Other reconciliation results: 352 route partitions ↔ 352 summary origins; 116,878
route rows preserved; route partitions pool to national exactly; the three busiest
directed pairs match their own directed summary rows in each direction — e.g.
LGA→ORD 11,545 scheduled / 3,379 delayed vs ORD→LGA 11,542 / 3,327, i.e. reverse
routes remain separate and city-pair aggregation does not touch them; temporal
partitions reconcile per-month against `monthly.csv` (774,182 rows total); cause
minutes are missing exactly where observations are zero across all filter-table rows
(observed zeros stay zero); the directory has exactly the 352 metadata airports,
distinct ORD (13930) and MDW (13232), both "Chicago, IL"; every manifest file hash
(10 top-level + 364 partitions) and all 35 source hashes verify.

## 6. Browser checks

**Browser validation was not run.** Rationale: the deliverable is data-only; all five
fetches of the current page (plus the map's two) are byte-identical files, and no
frontend file changed (no `site/js`, `index.html`, or CSS diffs), so behavior is
unchanged by construction. Running `scripts/render_site.cjs` would overwrite
`docs/assets/interim/*.png`, which the plan says to preserve. As a static smoke
check, `scripts/serve_site.py --port 8791` served HTTP 200 for `data/national.csv`,
the three new top-level CSVs, `data/routes/ORD.csv`, `data/temporal/2025-01.csv`,
`manifest.json`, and `js/app.js`. No performance claim is made from file sizes.
Codex may run the README's browser checks if desired.

## 7. Sizes, lineage, repeatability

- **Total publication** (`site/data/`): 375 files, 29,455,065 bytes ≈ 28.1 MiB.
- **Proposed initial load** (7 legacy + 3 new top-level files): 2,507,885 bytes
  ≈ 2.39 MiB — the legacy seven (982,281 B) are unchanged; new:
  `airport_month_airline.csv` 1,475,284 B, `airline_month.csv` 19,409 B,
  `airport_directory.csv` 30,911 B.
- **On-demand partitions:** routes 352 files / 3,288,567 B total, largest
  `routes/ORD.csv` 141,016 B; temporal 12 files / 23,564,871 B total, largest
  `temporal/2025-12.csv` 2,178,210 B (2,127 KiB) — the largest partition overall.
  Proposed on-demand rule: load `routes/<ORIGIN>.csv` for the selected origin (C),
  `temporal/2025-MM.csv` for selected months (D1); never both families on initial
  load. This is a proposal, not a measured performance result.
- **Compatibility evidence:** all seven legacy CSVs hash-identical to the pre-change
  snapshot (e.g. `route_annual.csv` 36f34ec3…, `city_summary.csv` e8439082…); the
  pre-change manifest was archived at `/tmp/manifest_before_batch_a.json` for review.
- **Repeatability:** two consecutive export runs produced SHA-256-identical content
  for all 375 files (`diff` of per-file hashes: empty). Manifest hashes match the
  delivered artifacts (verified by `verify_site_filters.py`).

## 8. Remaining work, limitations, requested review

- No consumer exists yet for the new files; wiring them into shared filter state,
  caching, and stale-response protection is Batch B. Airport detail/map layers are C;
  heatmap/cause/scatter are D1–D3; performance measurement and browser interaction
  validation are E.
- Temporal partitions total ≈22.5 MiB on disk (plain CSV; transfer compression
  unmeasured and not claimed). If D1 needs leaner loads, a reduced column set is a
  contract revision.
- Route and temporal grains omit cause attribution (documented above).
- `verify_site_filters.py` requires the local verified baseline and is therefore not
  part of CI; CI keeps running the synthetic `test_site_data.py` only.
- Checks not performed: browser interaction validation, gzip transfer measurement,
  participant/performance evaluation (E scope).

**Requested next review:** Codex acceptance of Batch A against the plan's acceptance
criteria. On acceptance, Batch B (shared month/airline filtering) may be assigned.
This batch stops here; no Batch B work has been started.
