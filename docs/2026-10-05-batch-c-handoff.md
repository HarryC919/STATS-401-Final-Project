# Batch C Handoff: Airport Detail and Geographic Entry Points

**Batch ID:** C — **Status: ready for review** (revision 2; not accepted yet).

Date: October 5, 2026. Implementer: ZCode + GLM. Scope is strictly
[Batch C](2026-10-05-next-phase-plan.md) on top of the **accepted** Batch A contract
and Batch B shared filtering. No Batch D/E work, no `proposal.md` or raw-data
changes, no Git staging/commit/push/merge/deploy.

## 0. Revision 2 — fixes for the returned review

All four reported defects are fixed, each with a persistent browser regression, and
the cause composition now has itemized numeric assertions as requested:

| # | Reported defect | Root cause | Fix |
|---|---|---|---|
| 1 | First airport selection left the already-drawn map stale (0 markers, 0 outgoing routes on return) | The map-cache invalidation in the state subscription read `prevSnapshot && …` — on the **first** state change `prevSnapshot` was still `null`, so the map was never marked stale (`app.js` subscribe) | Initialize `prevSnapshot` to the startup snapshot and invalidate when `prevSnapshot === null \|\| prevSnapshot.airport !== snapshot.airport`. New regression: a fresh page draws the map first, then covers **first selection, switching airports, clearing the selection, and Reset** — the marker, the top-20 outgoing arcs, and the status note must track the selection in all four cases |
| 2 | A route with zero eligible arrivals was dropped from the detail top five (MDT + June + OO: ATL, 1 scheduled / 0 eligible, only 2 of 3 routes shown) | `drawDetailRoutes` filtered rows by `hasNumber(arrival_delay_rate)` **before** display, silently deleting the row the top-five selection had kept | Zero-eligible routes stay listed: bars render only for measurable rates; every unrated row keeps its direction label, its scheduled count, and an inline "No data" with a tooltip stating "Delay rate: No data (zero eligible arrivals)" — never deleted, never shown as zero. Regression uses the exact reviewed fixture (asserted from `routes/MDT.csv`: ORD 34/33, DTW 13/13, ATL 1/0) with tooltips on all three rows |
| 3 | The detail trend lacked the required full-year context labeling | The scope line only named airline and airport | `drawMonthly` now labels every meaning it carries; the detail trend reads "Full-year context (all twelve months) · Reporting airline: … · Airport: … · Shaded = selected months". Regression asserts all four parts of the rendered label text |
| 4 | All five cause categories rendered blue | The global `.bar { fill: #3b7dd8 }` CSS rule overrides SVG *presentation attributes*, so `.attr("fill", …)` lost to the stylesheet | The category colors are applied as **inline styles** (`style("fill", …)`), which beat the class rule. The regression asserts `getComputedStyle().fill` for all five bars equals the five expected `rgb(...)` values, so a future CSS regression fails loudly |

**Itemized cause assertions (new):** for ORD+UA+Jan–Mar the QA now checks, for each
of the five categories, the rendered color, the pooled minutes (exact integer with
thousands grouping), the share (parsed from the tooltip and compared to the pooled
share within ±0.05 pp for the one-decimal rounding), and the exact observation
count — plus the exact completeness caption string. Zero-minute categories
(observed zeros) are asserted through the same tooltip via a dispatched mousemove,
since a zero-width bar cannot be hovered.

Also noted: the detail top five are displayed in scheduled-volume order (the
selection order), not rate order; the previous handoff's wording said "display
ordered by delay rate", which was inaccurate and is corrected here. The three
comparison charts (airline/airport/route) keep their long-standing "busiest by
volume among groups with measurable rates" semantics — the reported defect concerned
the detail top five, whose selection is explicitly by scheduled flights; extending
the comparison charts would change accepted Batch B behavior and is not part of this
revision (flagged for the reviewer in case a change is wanted there).

## 1. Changed files and purpose

| File | Change | Purpose |
|---|---|---|
| `site/js/state.js` | extended | `airport` (stable BTS `AirportID` or null) joins the shared state: `setAirport`, `airport` in snapshots, `reset` clears it, `isFilterDefault` (months+airline) kept separate from `isDefault`. |
| `site/js/aggregate.js` | extended | `matchesFilters` applies `airportId` **only to rows that carry `OriginAirportID`** (unit-tested: airline_month rows stay airport-agnostic so national scopes never become airport-specific); pooling now also aggregates attribution counts and cause minutes/observations per the Batch A rule (pooled minutes missing iff pooled observations are zero; observed zeros stay zero). |
| `site/js/data.js` | extended | `loadRoutePartition(code)` fetches one origin's partition (file name = code per the Batch A contract, retry ×3); `loadCsv` retries like the partition loader after the 8-file initial burst was observed to reset connections on the local static server. |
| `site/js/charts.js` | extended | `drawMonthly` takes a `target` svg, an optional airport scope, a `fullYearContext` flag, and a "Shaded = selected months" label part; `drawAirport` gains selection highlight, appends the selected airport when outside the busiest 15, and clicking a bar selects that airport; `drawDetailCauses` uses inline-style category colors, observation tooltips, and a completeness caption; `drawDetailRoutes` keeps zero-eligible routes with "No data"; `drawNetworkMap(…, selection, onPickCity)` draws the selected-airport marker, up to 20 directed outgoing arcs (full-year scope), city-node click callbacks and tooltips, and an explicit note for airports outside the Albers USA projection. |
| `site/js/app.js` | extended | Airport selector (search input + datalist of all 352 airports), `selectAirport` (auto-opens Airport Detail), city-choice dialog for multi-airport cities, detail orchestration (headline statistics, trend, causes, top-5 routes with deterministic tie-breaking), map selection context, `loadedStatusMessage` distinguishing default / airport-only / filtered scopes, the cleanup-3 status refresh, and the fixed first-change map invalidation. |
| `site/index.html` | modified | "Airport Detail" tab, Airport search box + datalist, airport-choice dialog container, clarified route-tab subtitle, updated map fixed-scope note. |
| `site/css/style.css` | modified | Airport input, detail headings, map airport marker/label and outgoing-arc styles, airport-choice dialog, pointer cursors. |
| `scripts/test_filter_state.mjs` | extended | 12 tests: airport selection semantics, airportId filtering that spares airport-agnostic rows, cause-minute pooling semantics (missing vs observed zero), plus the Batch B pooling tests. |
| `scripts/qa_batch_c.cjs` | new | Browser QA for Batch C incl. the revision-2 regressions (§0); RFC-4180 CSV parser (directory/city files quote fields containing commas); writes `docs/assets/batch-c/` and `reports/site_validation_batch_c.json` only. |
| `scripts/qa_batch_b.cjs` | extended | Batch B follow-up regressions (cached-tab recovery, cancellation/diversion rate assertions, status refresh), tab order including the airport input. |
| `README.md` | modified | Documents the Batch B/C QA scripts and the Node 24 requirement (`engines` described as *declared*). |
| `.nvmrc`, `package.json`, `.github/workflows/deploy-pages.yml` | new/modified | Node 24.21.0 pin, `engines: ">=24 <25"`, CI Node setup + JS unit-test gate, CI path triggers incl. `.nvmrc`/`package.json`/test scripts. |
| `docs/assets/batch-c/` (6 PNGs), `reports/site_validation_batch_c.json` | new | Browser evidence (regenerated by the revision-2 QA run). |

## 2. Design decisions

- **Selection vs filter.** The airport is a *selection*, not a filter: national KPI,
  airline comparison, and monthly trends never become airport-specific (asserted in
  the browser). The airport comparison keeps its context and highlights the
  selection (appending it when outside the busiest 15); the route comparison stays
  at month/airline scope with its subtitle stating that airport selection applies in
  Airport Detail.
- **Detail scope.** All detail statistics pool the selected airport × airline ×
  month range from the verified filter table and the airport's route partition;
  rates recomputed from pooled counts. The trend keeps twelve months as an explicit
  full-year context with the selected range shaded. Top five routes: pooled
  scheduled flights, ties broken by destination code, zero-eligible routes retained
  with missing rates (revision 2).
- **Map modes.** The city overview remains a fixed-scope mode (full year, all
  airlines — stated on the page); the selected airport adds a marker and up to 20
  directed outgoing arcs at that same fixed scope, with the status line labeling
  the scope. Airports outside the projection are reachable via the selector/detail;
  the map shows an explicit note and draws no marker — national and detail totals
  are unaffected (asserted).
- **Multi-airport cities.** Clicking a city node with several airports opens an
  explicit choice dialog listing code, name, and annual departures; a
  single-airport city selects directly. Chicago therefore asks ORD vs MDW rather
  than silently pooling.

## 3. Verification commands, exit statuses, results

Python via locked uv (Python 3.13); JS via **Node v24.21.0** (nvm + `.nvmrc`).

| Command | Exit | Result |
|---|---|---|
| `uv sync --locked` | 0 | environment unchanged |
| `uv run --locked python scripts/test_metrics.py` | 0 | 3 tests OK |
| `uv run --locked python scripts/test_site_data.py` | 0 | 7 tests OK |
| `uv run --locked python scripts/verify_data.py` | 0 | full year verified, 7,001,619 rows |
| `uv run --locked python scripts/verify_site_filters.py` | 0 | 77 count checks + 916,323-row row-by-row reconciliation |
| `node scripts/test_filter_state.mjs` | 0 | 12 tests OK |
| `node --check` on all five `site/js` modules + both QA scripts | 0 | all parse |
| `NODE_PATH=… CHROME_PATH=… node scripts/qa_batch_b.cjs` (Node 24.21.0, served site) | 0 | all Batch B checks incl. follow-up regressions |
| `NODE_PATH=… CHROME_PATH=… node scripts/qa_batch_c.cjs` (Node 24.21.0, served site) | 0 | all Batch C checks incl. revision-2 regressions |
| `git diff --check` | 0 | clean |

Not run, with reasons: `export_site_data.py` (site/data unchanged since the accepted
Batch A; manifest hashes still verified by `verify_site_filters.py`), `write_report.py`
(no preparation or report change), `render_site.cjs` (overwrites interim figures).

## 4. Independent numeric comparisons (browser-verified)

`qa_batch_c.cjs` computes expectations in Node from `site/data/*.csv` and the route
partitions, then asserts the rendered detail against them (counts **and** rates):

| Fixture (in-browser) | Expected (independent) | Verified |
|---|---|---|
| ORD full year | scheduled 327,028 · 84,927/320,418 = 26.5% | headline (counts + all three rates) |
| ORD Jan–Mar | scheduled 66,212 · 15,122/65,155 = 23.2% | headline |
| MDW Jan–Mar | scheduled 16,036 · 2,830/15,813 = 17.9% | headline (distinct from ORD) |
| ORD+UA Jan–Mar | scheduled 20,902 · 4,138/20,752 = 19.9% | headline |
| ORD top-5 full year | LGA 11,542 · BOS 7,290 · LAX 7,086 · DCA 6,758 · DFW 6,722 | five tooltips (label, flights, eligible, rate) |
| ORD top-5 Jan–Mar / Jan–Mar+UA; MDW top-5 Jan–Mar | pooled from `routes/ORD.csv`, `routes/MDW.csv` | five tooltips each |
| MDT+OO June (review fixture) | airport row 48 scheduled · 19/46 = 41.3%; routes ORD 34/33, DTW 13/13, ATL 1/0 | headline + three route rows incl. "No data" for ATL |
| ORD cause composition (Jan–Mar+UA) | per-category pooled minutes, shares (±0.05 pp), observation counts, exact caption | five bars itemized + caption string equality |
| KPI under airport selection | UA Jan–Mar national total (all airports) | KPI text (national, not ORD's) |
| Non-projectable BQN full year | scheduled 2,297 · 409/2,250 = 18.2% | headline |

Backend reconciliation stays green: `verify_site_filters.py` (77 checks; ORD annual
84,927/320,418, ORD January 4,495/21,200, ORD Jan–Feb 9,268/40,896, ORD+UA annual
23,128/94,624, ORD+UA January 1,167/6,548).

## 5. Bugs found and fixed across both revisions

Revision 1 (caught by the new checks): detail headline showed national totals
(`airport` vs `airportId` field mismatch); `poolAll`/`poolBy` lacked cause pooling;
the async network renderer dropped the awaited map promise so the status reported
"Verified…" before drawing (Batch B QA caught it deterministically); the 8-file
initial fetch burst reset connections on the local static server (loadCsv retry);
two wording defects.

Revision 2 (this review): the four defects in §0, plus a `.no-rate` class slip the
new MDT regression caught during development (the element rendered but carried only
the `chart-scope` class, so the regression failed until the class was fixed — the
regression works as intended).

## 6. Browser evidence (actually executed, Node 24.21.0)

Headless Chrome (Playwright 1.63.0, system Chrome), site served on 127.0.0.1:8765 —
`qa_batch_c.cjs` exit 0 (13 check groups):

- **Map–selection consistency (review item 1):** a fresh page draws the map first;
  the first airport selection, a switch to another airport, clearing the selection,
  and Reset each leave the map consistent (marker + top-20 outgoing arcs + status
  note appear, change, disappear, and stay cleared respectively).
- **Zero-eligible route (review item 2):** MDT + June + OO shows all three routes —
  MDT→ORD and MDT→DTW as bars, MDT→ATL as a listed row with "No data" and a tooltip
  carrying its scheduled count of 1 and "Delay rate: No data (zero eligible
  arrivals)" (`detail-mdt-june-oo.png`).
- **Full-year context labeling (review item 3):** the detail trend label reads
  "Full-year context (all twelve months) · Reporting airline: UA · Airport: ORD ·
  Shaded = selected months" (asserted on the rendered text node).
- **Cause colors and itemized numbers (review item 4):** all five bars render their
  own category color (computed styles asserted against the five `rgb()` values);
  per-category tooltips carry the exact pooled minutes, shares, and observation
  counts; the completeness caption string matches the pooled counts exactly.
- **Selection → detail:** typing ORD opens Airport Detail; headline, trend, cause
  composition, and top-5 routes match the independently pooled expectations.
- **ORD vs MDW:** distinct, correct statistics (66,212 vs 16,036 Jan–Mar scheduled)
  and different top-5 routes.
- **Selection from the comparison chart:** highlight incl. append-outside-top-15
  (asserted via the MDW rank computation); clicking the ATL bar selects ATL.
- **Empty state:** ORD + HA shows "No flights match the current filters for ORD."
  with empty charts — never a zero rate; KPI keeps the national scope.
- **Map entry points:** ORD marked with top-20 outgoing arcs (`network-ord.png`);
  Chicago opens the explicit ORD/MDW choice; single-airport Denver selects directly;
  BQN shows the "outside the projection" note with unchanged totals
  (`network-territory.png`).
- **Reset:** clears selection and filters, returns to the monthly overview; detail
  then shows the explicit "No airport selected" guidance.
- Evidence: `reports/site_validation_batch_c.json` (source SHA-256 of all touched
  frontend files) and 6 screenshots in `docs/assets/batch-c/`, visually inspected.
- **Not browser-checked:** interaction timing performance (Batch E), user study
  (Batch E), and the `render_site.cjs` legacy suite (interim-figure overwrite).

## 7. Remaining work, limitations, requested review

- **Batch D1** (weekday × hour heatmap), **D2** (comparative 100% stacked cause
  bars — the detail's single-airport composition is a precursor, not the comparison
  view), **D3** (volume–reliability scatterplot), and **Batch E** (evaluation,
  performance, delivery) remain.
- The map's airport layer intentionally uses the fixed full-year scope; filtered
  geographic layers would be a scope decision for a later batch. The comparison
  charts' "busiest among groups with measurable rates" semantics are unchanged from
  the accepted baseline (see §0); the reviewer may direct a change there separately.
- The airport search is a native datalist input (keyboard-operable; exact code
  match); a fuzzy search box can be revisited if user feedback asks for it.
- No Git operations were performed by the implementer.

**Requested next review:** Codex re-acceptance of Batch C (revision 2). On
acceptance, Batch D1 may be assigned. This batch stops here; no Batch D work has
been started.
