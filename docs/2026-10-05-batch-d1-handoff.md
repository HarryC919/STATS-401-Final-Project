# Batch D1 Handoff: Weekday × Scheduled-Hour Heatmap

**Batch ID:** D1 — **Status: ready for review** (revision 1; not accepted yet).

Date: October 5, 2026. Implementer: ZCode + GLM. Scope is strictly
[Batch D1](2026-10-05-next-phase-plan.md) on top of the **accepted** Batches A–C.
No D2/D3/E work, no `proposal.md` or raw-data changes, no Git staging/commit/push/
merge/deploy. Performance measurement and the participant study remain in Batch E.

## 0. Revision 1 — fixes for the returned review

| # | Reported defect | Root cause | Fix |
|---|---|---|---|
| 1 | Legend colors were reversed: cells mapped low rate → blue and high rate → red, but the legend labeled the red end 0% and the blue end the maximum (`charts.js` legend) | The gradient stops sampled `color(maxRate * (1 - i/20))`, putting the maximum's red at offset 0 while the "0%" label sat under it | Stops now sample `color(maxRate * i/20)`, so the left end is 0% (blue) and the right end the scope maximum (red) — matching the cells. The QA now asserts both ends against rendered cells: the legend's first stop equals the zero-rate cell's computed fill and the last stop equals the max-*rate* cell's fill (the assertion initially compared the busiest cell, which is not necessarily the hottest — the check caught its own bug and now uses the max-rate cell) |
| 2 | A failed month load kept the stale grid: January stayed on screen with a Jan–Feb summary after February was blocked (`CHART_SVGS` had no `tab-temporal` entry, so `clearChart`/`chartError` no-op'd) | The heatmap tab was never registered in the panel map | `tab-temporal → #temporalHeatmap` added. New regressions (fresh pages, so the fetches are real): **failure** — January-only grid → block `temporal/2025-02.csv` → widen to Jan–Feb → the old grid is cleared (0 cells), the error appears inside the panel, the summary reads Jan–Feb; **retry** — unblocking and returning to the cached January scope recovers a fully verified January grid; **slow response** — February throttled by 700 ms while the selection narrows back to January → the settled grid is January's (the newest selection wins), verified slot-by-slot |
| 3 | Suggested hardening (all three adopted) | — | (a) Strict hour validation: a pooled row now requires a non-null `ScheduledDepHour` that is an integer in 0–23 — `Number(null) === 0` can no longer slip an empty hour into column 0; invalid rows are still counted and reported on the chart (2025 has none). (b) The legend gained a "No eligible arrivals" entry for the gray-blue all-cancelled/diverted slots, the page subtitle documents it, and the legend margin was widened so no text clips. (c) The QA now performs a **whole-grid verification**: all 168 rendered slots (via their bound data) are compared against the independently pooled expected grid — values, emptiness, weekday range, and integer hours 0–23 — instead of only checking CSV-side totals |

## 1. Changed files and purpose

| File | Change | Purpose |
|---|---|---|
| `site/js/charts.js` | extended/corrected | `drawHeatmap`: corrected legend gradient direction with the cell mapping; strict hour validation helper; fourth legend entry ("No eligible arrivals"); wider legend area (no clipping); `CHART_SVGS` gained `tab-temporal → #temporalHeatmap` so scope changes clear the panel and failures render in it. |
| `site/js/data.js` | extended | `loadTemporalPartition(month)` / `loadTemporalPartitions(months)`: on-demand, cached, batched (4), per-file retry ×3. |
| `site/js/app.js` | extended | `tab-temporal` renderer: loads only the selected months, filters by the shared airline/airport, pools by (Weekday, ScheduledDepHour) with the accepted semantics, renders with an explicit scope line; state-dependent with token-guard/lazy-re-render. |
| `site/index.html` | extended | "Temporal Patterns" tab; subtitle documents grain, 2400 convention, gray/no-observation, gray-blue/no-eligible, dashed/low-sample rules. |
| `scripts/qa_batch_d1.cjs` | new | Browser QA incl. revision-1 regressions (§0); RFC-4180 CSV parser; writes `docs/assets/batch-d1/` and `reports/site_validation_batch_d1.json` only. |
| `README.md` | modified | Documents the D1 QA script and the current view list. |

Batch A artifacts, `proposal.md`, `data/raw/`, interim figures, and accepted B/C
evidence files are untouched.

## 2. Data contract and semantics decisions

- **Grain and pooling:** the published `temporal/2025-MM.csv` partitions (Batch A)
  already carry airline × origin airport × weekday × scheduled hour with the five
  core counts — no new exports. The heatmap pools the selected rows in the browser
  (sum counts, recompute rates; zero denominators stay missing).
- **Calendar/time semantics preserved:** weekday 1–7 = Monday–Sunday; hour 0–23
  with the BTS-2400-maps-to-0 convention (stated on the axis and in the subtitle);
  no UTC inference. Revision 1 hardened the hour check: null/non-integer/out-of-range
  hours are excluded from the grid and their count is reported on the chart instead
  of being silently mapped onto hour 0 (the 2025 baseline has zero such rows).
- **Missing vs zero:** no scheduled flights → gray cell, "No observations under the
  current filters"; observed arrivals with zero delays → 0% (blue) cell, "Rate:
  0.0%"; scheduled but all cancelled/diverted → gray-blue cell, "Rate: No data (no
  eligible arrivals)".
- **Low-sample rule (documented on the page and in the legend):** dashed outline on
  cells with more than 0 but fewer than 30 eligible arrivals.
- **Scope:** months, airline, and the airport selection (national across all
  airports when none); the scope line names the exact pooled scope; Reset restores
  the full-year national grid.

## 3. Verification commands, exit statuses, results

Python via locked uv (Python 3.13); JS via **Node v24.21.0** (nvm + `.nvmrc`).

| Command | Exit | Result |
|---|---|---|
| `uv run --locked python scripts/test_metrics.py` | 0 | 3 tests OK |
| `uv run --locked python scripts/test_site_data.py` | 0 | 7 tests OK |
| `node scripts/test_filter_state.mjs` | 0 | 12 tests OK |
| `uv run --locked python scripts/verify_data.py` | 0 | full year verified, 7,001,619 rows |
| `uv run --locked python scripts/verify_site_filters.py` | 0 | 77 count checks + 916,323-row row-by-row reconciliation |
| `NODE_PATH=… CHROME_PATH=… node scripts/qa_batch_d1.cjs` (served site) | 0 | 13 check groups incl. revision-1 regressions |
| `NODE_PATH=… CHROME_PATH=… node scripts/qa_batch_b.cjs` | 0 | all Batch B checks still pass |
| `NODE_PATH=… CHROME_PATH=… node scripts/qa_batch_c.cjs` | 0 | all Batch C checks still pass |
| `git diff --check` | 0 | clean |

Not run, with reasons: `export_site_data.py` / `write_report.py` (no data or report
change), `render_site.cjs` (overwrites interim figures).

## 4. Browser evidence (actually executed, Node 24.21.0)

Headless Chrome (Playwright 1.63.0, system Chrome), site served on 127.0.0.1:8765 —
`qa_batch_d1.cjs` exit 0. Expectations are computed in the QA directly from
`site/data/temporal/2025-MM.csv`, independent of the app code:

- **Whole-grid verification (revision 1):** all 168 rendered slots are extracted
  from the DOM and compared value-by-value (scheduled/eligible/delayed, plus
  emptiness) against the independently pooled national grid; every slot's weekday
  is in 1–7 and its hour an integer in 0–23. The grid's pooled total equals
  **7,001,619** — no flights dropped or duplicated at partition boundaries.
- **Axes and conventions:** row labels Mon…Sun in order; hour ticks 00–22 every two
  hours; the axis title states "Scheduled local departure hour (BTS 2400 maps to
  00)"; the scope line names the pooled scope.
- **Cell fixtures:** ORD + UA + Jan–Feb top-volume cell (Fri 18:00: 278 / 276 / 78,
  rate 28.3%) matches the independent sum of the two partition files (cross-month
  pooling); observed-zero cell Mon 22:00 (1/1/0) reads "Rate: 0.0%" and renders the
  blue endpoint `rgb(49, 54, 149)`; MDT + June + OO shows 23 observed cells with 22
  dashed low-sample markers and 145 gray unobserved slots whose tooltips read "No
  observations under the current filters"; the MDT grid total equals its 48
  scheduled summary rows.
- **Legend (revision 1):** the gradient's first stop equals the zero-rate cell fill
  and its last stop equals the max-rate cell fill — legend direction now provably
  matches the cells; the "No eligible arrivals" and "Low sample (< 30 eligible)"
  entries render unclipped (screenshots inspected).
- **Failure / retry / race (revision 1):** blocking February after a January-only
  grid clears the panel (0 cells), shows "Chart could not load…" inside the panel
  with the Jan–Feb summary; unblocking and returning to the cached January scope
  recovers a grid that passes the whole-grid verification for January. With
  February throttled by 700 ms and the selection narrowed mid-load, the settled
  grid is January's (newest selection wins), again verified slot-by-slot.
- **Filter/reset consistency:** ORD + HA shows the explicit empty state; Reset
  restores the 168-cell full-year national grid.
- Evidence: `reports/site_validation_batch_d1.json` (13 check groups, source
  SHA-256 of all touched frontend files) and 2 screenshots in `docs/assets/batch-d1/`.
- **Not browser-checked:** interaction timing performance (Batch E), user study
  (Batch E), `render_site.cjs` (interim-figure overwrite).

## 5. Bugs found and fixed across both revisions

Initial submission (caught by the new checks): the temporal loader missed `.flat()`
(empty grid); two QA-script scope/ordering errors; clipped legend text. Revision 1
(this review): the legend-direction inversion, the missing `tab-temporal` panel
registration, the lax hour validation, the missing no-eligible legend entry, and
grid-total-only verification — each with the persistent checks described in §0.
Two additional QA-script bugs were caught during revision 1's own development (the
"hottest cell" assertion initially used the busiest cell; the failure regression
initially scoped months after the first open, by which point February was cached and
the block could not hit a real request — fresh-page, scope-first ordering fixes it).

## 6. Remaining work, limitations, requested review

- **D2** (comparative 100% stacked cause bars), **D3** (volume–reliability
  scatterplot), and **Batch E** (evaluation, performance, delivery) remain.
- The heatmap loads the selected months' temporal partitions on demand (~1.9 MB per
  month; 12 months ≈ 22.5 MB for the full year, cached after the first open; the
  first full-year render completed in under a second locally). No performance claim
  beyond that (measurement is Batch E).
- The heatmap responds to the airport *selection*; the map and cause views keep
  their fixed scopes as documented in Batch C.
- No Git operations were performed by the implementer.

**Requested next review:** Codex re-acceptance of Batch D1 (revision 1). On
acceptance, Batch D2 may be assigned. This batch stops here; no D2 work has been
started.
