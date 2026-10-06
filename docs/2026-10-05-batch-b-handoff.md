# Batch B Handoff: Shared Month/Airline Filtering and Existing Views

**Batch ID:** B — **Status: ready for review** (revision 1; not accepted yet).

Date: October 5, 2026. Implementer: ZCode + GLM. Scope is strictly
[Batch B](2026-10-05-next-phase-plan.md) on top of the **accepted** Batch A contract
([2026-10-05-filter-data-contract.md](2026-10-05-filter-data-contract.md)).
No Batch C–E work, no `proposal.md` or raw-data changes, no Git staging/commit/push/
merge/deploy.

**Revision 1** addresses the three defects Codex reproduced in the browser (map
double-render, stale chart mixed with a newer filter scope, stale error/loading
status across tab switches), adds the requested browser regression checks and
delay-rate numeric assertions, and unifies the JavaScript tooling on Node 24.
Section 0 lists the revision; the rest of the document describes the batch as
revised.

## 0. Revision 1 — fixes for the returned review

| # | Reported defect | Root cause | Fix |
|---|---|---|---|
| 1 | Map drew 440 routes instead of 220 when months changed during the map's first load (`charts.js` `drawNetworkMap`) | `drawNetworkMap` performs async loads and then writes the DOM without checking whether it is still the current render; a second overlapping render (triggered by the state subscription re-rendering the active tab) appended a second layer of marks | `drawNetworkMap(baseline, isLatest)` validates `isLatest()` before every DOM write (success path and failure path), and the state subscription no longer re-renders fixed-scope tabs (`if (isStateDependent(activeTab)) renderActiveTab()`), so an in-flight map render is never stacked with a second one |
| 2 | After viewing the annual route chart, switching to Jan–Mar with the partition fetch failing kept the 15 annual bars on screen while the summary already said Jan–Mar (`app.js` render start/failure) | A failed render never touched the old chart, leaving another scope's marks visible next to the new summary | Every state-dependent render starts by clearing its panel (`charts.js` `clearChart`, exported), and a failure renders the error message inside the panel (`charts.js` `chartError`) plus the status line — stale marks can never survive a load or a failure |
| 3 | Returning to an already-rendered tab kept the previous tab's "Chart could not load…" or "Updating chart…" status text (`app.js` early return) | `renderActiveTab` returned early on `drawn.has(id)` without refreshing the status | The early return now sets the loaded message via `loadedStatusMessage()` (shared with the normal completion path), so a rendered tab always shows the current scope's status |

New browser regressions in `scripts/qa_batch_b.cjs` cover all three (throttled map
assets with a mid-load filter change → exactly 220 routes and no duplicated nodes;
annual route view → Jan–Mar with `manifest.json` aborted → zero bars, in-panel error,
correct summary, and a clean status after returning to the monthly tab → recovery
with Jan–Mar bars). Per the review request, the QA now also asserts the **arrival
delay rate**, not just flight volume: every KPI scope check compares the rate text
computed from pooled counts, and every hovered airport/route bar must report the
pooled `Delay rate:` line exactly.

Node unification (adopted as proposed): `.nvmrc` pins `24.21.0`;
`package.json` declares `"engines": {"node": ">=24 <25"}`; the README documents
`nvm install && nvm use` (nvm reads `.nvmrc`);
[.github/workflows/deploy-pages.yml](../.github/workflows/deploy-pages.yml) gained a
`actions/setup-node` step with `node-version-file: .nvmrc` followed by
`node scripts/test_filter_state.mjs`, so the pages workflow now gates deploys on the
JS unit tests too. All local JS runs in this revision used Node v24.21.0 via nvm.

## 1. Changed files and purpose

Batch B implementation files:

| File | Change | Purpose |
|---|---|---|
| `site/js/state.js` | new | Pure shared filter state: month range (clamped to 1–12, reordered never emptied), airline (`null` = all), a monotonically increasing version token, subscriber notification. No DOM/d3, so it is Node-unit-testable. |
| `site/js/aggregate.js` | new | Pure pooling implementing the Batch A consumer rule: filter rows, sum counts, recompute the three rates from pooled counts (zero denominators stay missing); `poolAll` returns `null` for an empty selection (never a zero rate); `poolBy` keeps every observed group; `poolByMonth` always yields twelve months. |
| `site/js/data.js` | new | Cached, deduplicated CSV/JSON loading with failure eviction (retry re-fetches); `loadRoutePartitions()` discovers route partitions through the manifest, fetches them in small batches (6 at a time — hundreds of simultaneous requests reset connections on simple static servers), retries each file up to 3×, and injects origin identity from the manifest. |
| `site/js/app.js` | rewritten | Orchestration: one `createFilterState` instance; controls → state → subscription; KPI recomputed synchronously on every change; token-guarded rendering (`isLatest()` closures) so a delayed response can never replace a newer selection; state-dependent renders clear their panel first and show in-panel errors; fixed-scope tabs are not re-rendered by filter changes; default route view uses `route_annual.csv`, filtered views load partitions on demand. |
| `site/js/charts.js` | modified | `drawKPIs` renders an explicit empty state; `drawMonthly(data, {range, airline})` shades the selected months while keeping all twelve; `drawAirline(data, national, {selectedAirline})` outlines the chosen carrier; airport/route charts gain an explicit reference-scope caption and filter-aware empty messages; `drawNetworkMap(baseline, isLatest)` validates currency before its async DOM writes; new exported `clearChart`/`chartError` panel helpers. Existing marks/axes/tooltips unchanged. |
| `site/index.html` | modified | Filter bar (two month selects, airline select, live `aria-live` summary, Reset) above the KPI cards; updated chart subtitles to filter-neutral wording; explicit fixed-scope notes on the cause and network tabs. |
| `site/css/style.css` | modified | Filter-bar styling and focus rings, `.bar-selected` outline, `.range-band`, `.chart-scope`, `.chart-empty`, `.scope-note`, narrow-viewport wrapping. |
| `package.json` | new | `{"type": "module", "engines": {"node": ">=24 <25"}}` so Node imports the browser ES modules for unit testing; `scripts/*.cjs` remain CommonJS. Not deployed (outside `site/`). |
| `.nvmrc` | new | Pins Node `24.21.0` for nvm, CI, and QA runs. |
| `.github/workflows/deploy-pages.yml` | modified | Adds the Node-from-`.nvmrc` setup step and the JS unit-test gate (revision 1; explicitly requested). |
| `scripts/test_filter_state.mjs` | new | 9 Node unit tests over `state.js`/`aggregate.js` (see §4). |
| `scripts/qa_batch_b.cjs` | new | Browser QA for the shared filters (see §6). Writes **only** `docs/assets/batch-b/` and `reports/site_validation_batch_b.json`; it never touches `docs/assets/interim/` or `reports/site_validation.json`. |
| `README.md` | modified | Current-implementation paragraph, the two new Batch B check commands, and the Node 24/nvm requirement. |
| `docs/assets/batch-b/` (10 PNGs), `reports/site_validation_batch_b.json` | new | Browser evidence (regenerated by the revision-1 QA run). |

Untracked-before-this-work files (`.zcodeignore` — now also listed in `.gitignore` by
the owner, and the two plan docs) and Batch A's accepted artifacts (`site/data/*`,
`scripts/export_site_data.py`, `scripts/test_site_data.py`,
`scripts/verify_site_filters.py`, contract/handoff docs) were left as-is except where
listed above. The `.gitignore` edit adding `.zcodeignore` is an owner change made
during the session — preserved untouched. `site/js/metrics.js`, `proposal.md`,
`data/raw/`, and `docs/assets/interim/` are untouched (verified via `git status`).

## 1b. Pre-Batch verification enhancement (done first, as requested)

Before implementing Batch B, `scripts/verify_site_filters.py` gained a row-by-row
source↔export comparison under each table's **full primary key** (`compare_full_key`):
airport_month_airline (Month, Reporting_Airline, OriginAirportID, Origin × all 20
count/minutes/observation columns), airline_month, airport_annual, airline_annual,
route_annual (counts + rates), all 352 route partitions (origin identity taken from
the manifest, so the manifest mapping itself is cross-checked), and all 12 temporal
partitions (missing scheduled hour paired via a sentinel key). Result: **916,323
exported rows match their source rows exactly** (missing == missing).

## 2. Filter semantics (contract adherence and decisions)

- **One shared state.** Month range (inclusive 1–12) + airline code or all. Controls
  mirror the normalized state after every change, so a reversed range reorders
  instead of emptying, and Reset restores `1–12 + all airlines` everywhere.
- **View scopes** (per the plan's required behavior):
  - KPI, airport comparison, route comparison: selected months × selected airline.
  - Airline comparison: selected months × **all** airlines retained; the chosen
    airline is outlined, never isolated. (Browser QA caught an initial
    implementation that reduced it to one bar — fixed.)
  - Monthly trends: **airline selection only**, all twelve months retained; the
    chosen month range is shaded, never cropped. (Browser QA caught the initial
    implementation cropping months outside the range — fixed.)
  - National reference in every chart: pooled over selected months, **all airlines,
    all origin airports**, labeled "(selected months, all airlines, all airports)";
    never airport-specific.
  - Cause chart and city map: fixed scope, explicitly stated in the page
    (`scope-note`), still render as before.
- **Pooling.** All filtered values are recomputed from pooled counts client-side
  (aggregate.js = the Batch A rule in JavaScript); zero denominators yield missing
  rates ("No data"), empty selections yield explicit empty states, never zero rates.
- **On-demand loading.** Initial load = the seven legacy files + `airline_month.csv`
  + `airport_month_airline.csv` (per the Batch A loading plan). Route partitions
  (352 files, ≈3.2 MB) load once, on demand, only when a filtered route view is
  requested, then stay cached; the default route view keeps using `route_annual.csv`
  (row-by-row reconciliation proved the two are the same aggregation).
- **Stale responses.** Every render captures a token; after any `await` the renderer
  verifies `isLatest()` before touching the DOM, status, or drawn-state — including
  inside `drawNetworkMap` (revision 1). Superseded renders abort silently; the
  newest selection always wins. A failed state-dependent render clears the panel and
  shows the error in-place; hidden tabs re-render lazily on activation.

## 3. Bugs found and fixed during this batch

Caught by the new checks before the review: (1) route renderer compared the render
token against the state version, so the first route render aborted — fixed with
`isLatest()` closures; (2) monthly chart cropped months outside the selected range —
fixed to highlight instead; (3) airline comparison collapsed to the selected carrier —
fixed to retain context; (4) `month-end` initialized to its first option instead of
mirroring the state — fixed with an initial `syncControls`; (5) 352 simultaneous
partition fetches reset connections on the local static server — fixed with bounded
batches (6) + per-file retry (×3). The three defects reported in the returned review
are fixed as described in §0.

## 4. Verification commands, exit statuses, results

All Python commands via locked uv (Python 3.13); JS via **Node v24.21.0** (nvm,
`.nvmrc`).

| Command | Exit | Result |
|---|---|---|
| `uv sync --locked` | 0 | environment unchanged |
| `uv run --locked python scripts/test_metrics.py` | 0 | 3 tests OK |
| `uv run --locked python scripts/test_site_data.py` | 0 | 7 tests OK |
| `uv run --locked python scripts/verify_data.py` | 0 | full year verified, 7,001,619 rows |
| `uv run --locked python scripts/verify_site_filters.py` | 0 | 77 count checks + row-by-row 916,323 rows exact |
| `node scripts/test_filter_state.mjs` (Node 24.21.0) | 0 | 9 tests OK: unequal denominators (5/10 + 9/90 → 14/100), zero-denominator missing rates, empty selection → `null`, range normalization/reorder, version tokens, no-op suppression, group-context pooling, twelve-month completion |
| `node --check` on the five `site/js` modules and `qa_batch_b.cjs` | 0 | all parse (one duplicate-export slip was caught and fixed here) |
| `NODE_PATH=/tmp/stats401-qa/node_modules CHROME_PATH=… node scripts/qa_batch_b.cjs` (site served on 127.0.0.1:8765, Node 24.21.0) | 0 | all checks passed, including the three new regressions; evidence JSON + 10 screenshots |
| `git diff --check` | 0 | clean; new files also grep-clean for trailing whitespace |

Not run, with reasons: `export_site_data.py` (site/data is byte-identical to the
accepted Batch A artifacts), `write_report.py` (no preparation or report change;
`reports/` contains only the new QA evidence file), `scripts/render_site.cjs` (it
overwrites `docs/assets/interim/`, which must be preserved).

## 5. Independent numeric comparisons (browser-verified, counts and rates)

The QA script computes expectations in Node directly from `site/data/*.csv` and the
352 partition files (independent of the app code), then asserts what the rendered
dashboard shows — flight totals **and delay rates**:

| Scope (in-browser) | Expected (computed from CSVs) | Verified in browser |
|---|---|---|
| Full year, all airlines (default KPI) | scheduled 7,001,619; delay rate 1,534,638/6,879,484 = 22.3% | KPI text (both) |
| Jan–Mar, all airlines (KPI) | scheduled 1,645,503; rate 317,266/1,611,046 = 19.7% | KPI text (both) |
| Jan–Mar, UA (KPI) | scheduled 186,629; rate 32,997/184,634 = 17.9% | KPI text (both) |
| May–Dec via keyboard (KPI) | pooled scheduled + rate from `airline_month` | KPI text (both) |
| Jan–Mar, all airlines (national reference) | 317,266 / 1,611,046 = 19.7% | reference label on airline/airport/route charts |
| Jan–Mar, UA airport bars | top-15 by volume from pooled `airport_month_airline` | all 15 tooltips: label, pooled flights, pooled delay rate |
| Jan–Mar, UA route bars | top-15 from the 352 partitions | all 15 tooltips (three fields each) |
| Jan–Feb, UA route bars (after mid-load filter change) | 119,635 scheduled; top-15 pooled | summary text + all 15 tooltips |
| Jan–Mar, all airlines route bars (after failure recovery) | top-15 pooled | all 15 tooltips |

Backend reconciliation remains available and green: `verify_site_filters.py`
re-derives ORD annual (84,927/320,418), ORD January (4,495/21,200), ORD Jan–Feb
(9,268/40,896), ORD+UA annual (23,128/94,624) and ORD+UA January (1,167/6,548) from
source summaries and Parquet, independent of the exporter.

## 6. Browser evidence (actually executed, Node 24.21.0)

Headless Chrome (Playwright 1.63.0 with the installed system Chrome), server
`scripts/serve_site.py --port 8765`:

- **Default pass:** all six tabs render with unchanged mark counts (24 monthly
  circles, 14 airline bars, 15 airport bars, 15 route bars, 5 cause legend entries,
  220 map routes), no invalid SVG geometry, tooltips work, default summary text
  "Showing: full year 2025 · all reporting airlines · all origin airports",
  reference label reads "(selected months, all airlines, all airports)", KPI delay
  rate 22.3%.
- **Month range (Jan–Mar):** KPI 1,645,503 and rate 19.7%; summary updates; monthly
  chart shades M1–M3 while keeping 24 month dots; reference label/value updates.
- **Airline UA (with Jan–Mar):** KPI 186,629 and rate 17.9%; airline chart keeps 14
  bars with exactly one `.bar-selected` (UA); airport and route bar tooltips match
  pooled expectations including the delay-rate line; screenshots inspected visually
  (UA hub airports EWR/DEN/ORD/IAD and hub routes confirm correct pooling; reverse
  directions remain separate bars).
- **On-demand partitions:** filtered route tab loads 352 partition files, renders 15
  bars matching pooled expectations; reset returns the route tab to the annual
  snapshot.
- **Stale-response race:** with every partition response throttled by 40 ms, the
  route tab was opened under (Jan–Mar, UA) and the month end was changed to Feb
  while loading; the settled chart matches (Jan–Feb, UA) — proving the newest
  selection wins.
- **Regression (map overlap, review item 1):** with `states-10m.json` throttled by
  600 ms, the network tab was opened and both month selects changed mid-load; the
  settled map has exactly **220** `.map-route` marks (not 440) and the same node
  count as the default pass (no duplicated circles), with no page errors.
- **Regression (stale chart + status, review items 2–3):** annual route view →
  Jan–Mar with `manifest.json` aborted → the 15 annual bars are cleared (0 `.bar`),
  the panel shows the error text, the summary reads Jan–Mar; clicking the already
  rendered monthly tab replaces the status with "Filters applied …" (no leftover
  "could not load"); after unrouting, re-selecting the route tab recovers with 15
  Jan–Mar bars whose tooltips match pooled expectations.
- **Keyboard:** Tab reaches month-start → month-end → airline select → Reset;
  type-ahead selects M5 (summary "May–Dec 2025", KPI = pooled total and rate) and
  'u' → UA (KPI = UA May–Dec pooled total and rate); Enter on Reset restores the
  full-year view (22.3%). Arrow keys on native selects open the macOS picker and
  cannot be automated headlessly; type-ahead is the same native keyboard mechanism.
- **Failure/retry:** aborting `airline_month.csv` shows the role=alert "Data could
  not load" state.
- **Narrow viewport (390×844):** no horizontal page overflow with the filter bar.
- Evidence: `reports/site_validation_batch_b.json` (with source SHA-256 of all
  touched frontend files and the full `checked` list) and 10 screenshots in
  `docs/assets/batch-b/` — visually inspected: `monthly-jan-mar.png` (band, 12
  months), `airline-jan-mar-ua.png` (context + UA outline), `airport-jan-mar-ua.png`,
  `route-jan-mar-ua.png`.

**Explicitly not browser-checked:** the empty-selection state (no month/airline
combination yields zero rows in this full-coverage dataset — a UI cannot produce it;
the code path is unit-tested in `test_filter_state.mjs`), interaction timing
performance (Batch E), and anything requiring `render_site.cjs` (interim-figure
overwrite).

## 7. Sizes and lineage

No `site/data/` artifact changed in this batch; the accepted Batch A manifest hashes
still match the delivered files (`verify_site_filters.py` re-verified all 375 files
and 35 source hashes). Initial browser payload grows by `airline_month.csv`
(19,409 B) + `airport_month_airline.csv` (1,475,284 B) per the Batch A loading plan;
route partitions (≈3.2 MB) remain on-demand. New evidence: 10 PNG screenshots
(≈1.3 MB total) and one JSON report.

## 8. Remaining work, limitations, requested review

- Airport search/selection, airport detail (trends, cause composition, top-5
  outgoing routes), map layers, and city-vs-airport choice are **Batch C**; heatmap
  **D1**, comparative cause bars **D2**, scatterplot **D3**; performance measurement
  and the participant study are **Batch E**.
- The filtered route view's first open fetches 352 small files; local wall time was
  not measured as a performance claim (the QA race test deliberately throttles it);
  GitHub Pages serves HTTP/2 and is unaffected by the local-server constraint. The
  batched+retrying loader is also what makes the local server reliable.
- Fixed-scope views (cause, map) still render annual national data by design; their
  filtered variants belong to D2/C respectively.
- Hidden tabs re-render lazily on activation (KPI is always current); this is a
  deliberate choice to avoid recomputing off-screen charts on every keystroke. The
  map never re-renders on filter changes (fixed scope), which is what removed the
  overlapping-render hazard.
- No Git operations were performed by the implementer.

**Requested next review:** Codex re-acceptance of Batch B (revision 1). On
acceptance, Batch C may be assigned. This batch stops here; no Batch C work has been
started.
