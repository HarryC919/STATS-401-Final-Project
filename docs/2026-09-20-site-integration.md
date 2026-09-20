# Website Integration Plan and Execution Record

## Approved scope

Integrate the teammate's static D3 dashboard into `site/`, retaining its six
charts and separating HTML, CSS, data loading, and chart rendering. Keep the
existing uv/Python 3.13 data pipeline and proposal unchanged. Add a reproducible
website export, a safe local server, a root README, and an English interim check
with real chart images. New linked filters remain future work.

## Tasks and acceptance criteria

- [x] Export compact website CSVs with source hashes, coverage, counts, and
  documented city aggregation. Check pooled rates and missing denominators.
- [x] Migrate the dashboard and fix national baselines, missing-value handling,
  city-map descriptions, loading failures, and responsive layout.
- [x] Replace platform-specific launchers with a uv server that serves only
  `site/` and never terminates unrelated processes.
- [x] Render the actual D3 charts, save static figures, and inspect their layout.
- [x] Write `docs/interim-check.md`, link it from the root README, document
  reproduction and current-versus-planned interactions, and retire the old package.
- [x] Run metric tests, source verification, export checks, report generation,
  website checks, and `git diff --check`. Record limits honestly.

## Decisions

- Work in the current workspace as requested; do not stage, commit, push, or
  change branches. Existing untracked project artifacts are user work.
- City identity uses the BTS city name and state in flight records. Pool counts
  before computing rates. Coordinates are departure-weighted means of historical
  airport coordinates joined by sequence ID, not a claim of a city-center location.
- City-pair edges combine both directions, exclude within-city flights from the
  edge layer, and show up to 220 pairs whose endpoints the map can project.
  Full city totals still include within-city flights and unprojectable territories.
- The publishing snapshot is generated; `data/summaries/` remains local. No
  repository publication is authorized by this integration request.

## Validation record

- `uv sync --locked` completed with the existing Python 3.13 environment.
- Three existing metric tests and two city-aggregation regression tests passed.
  The latter first failed because the exporter did not yet exist, then passed.
- `verify_data.py` verified twelve raw archive checksums, the airport checksum,
  twelve Parquet partitions, full-year summary counts, and independent January counts.
  The existing preparation script and original partitions were not modified.
- `export_site_data.py` verified each month's counts and exported seven tables:
  346 cities and 3,212 undirected city pairs before map filtering. Source and output
  hashes were independently checked. `write_report.py` regenerated the quality report.
- Computer-use browser connection was unavailable. An isolated headless Chrome
  153.0.8010.48 session instead rendered and tested the actual local site, using
  temporary Playwright tooling outside the repository. No frontend build was added.
- All six charts passed mark-count and SVG-geometry checks; national baseline,
  missing-value semantics, tooltips, tabs, keyboard activation, mobile overflow,
  initial data failure, and map retry were exercised. Evidence is in
  `reports/site_validation.json`; actual chart images are in `docs/assets/interim/`.
- Visual inspection covered all six exported figures and the narrow-screen page.
  It led to fixes for a tooltip that caused horizontal overflow and a map legend
  that overlapped northeastern nodes. The corrected browser suite passed.
- Relative documentation links and publication-file visibility were checked.
  A separate read-only reviewer found no critical or important defects and
  independently checked the CSV and browser-evidence hashes.
- The original teammate package was moved unchanged to the ignored local directory
  `.local-backups/2026-09-20-teammate-original/`; before/after hashes matched for all
  16 original files. It is a recovery copy, not a second project entry point.
- Port 8765 was already occupied, so preview/QA used 8766 without stopping the
  existing service. No commit, push, merge, or hosted deployment was performed.
- User testing and measured performance-target evaluation remain planned.
