# Batch D3 Handoff: Volume–Reliability Scatterplot

**Batch ID:** D3 — **Status: ready for review** (revision 2; not accepted yet).

Date: October 5, 2026. Implementer: ZCode + GLM. Scope is strictly
[Batch D3](2026-10-05-next-phase-plan.md) on top of the **accepted** Batches A–C and
D1–D2. No Batch E work, no `proposal.md` or raw-data changes, no Git staging/commit/
push/merge/deploy. Performance measurement and the participant study remain in
Batch E.

## 0. Revision 1 — fixes for the returned review

| # | Reported issue | Root cause | Fix |
|---|---|---|---|
| 1 | After Reset (default filters), the stale scatter and stale threshold text survived: Airlines stayed plotted with the Airports radio, and a 10,000 threshold stayed applied with the slider back at 0 | Reset assigned the view-local variables directly but never invalidated the cached `tab-scatter` render (the state was already default, so `state.reset()` emitted nothing); the slider's `<output>` text was never re-synced | Mode and threshold changes now go through `setScatterMode` / `setScatterMinVolume`, which **always** invalidate the cached view explicitly, sync the radio/slider/output, and clear the brush set — Reset routes through them. Regression: fresh default-scope page → Airlines + 10,000 → Reset → asserts the radio, the slider value **and its text output**, the "one point per origin airport · minimum volume 0" scope line, and the full airport point set |
| 2 | "Clear brush highlight" removed the highlight styling but left the brush selection box and handles on screen | The button only restyled points; the d3 brush selection was never moved | `drawScatter` now exposes an `onReady({ clearBrush })` handle that calls `brush.move(null)`; the Clear button uses it, so the cleared-set path fires once and the selection box and handles disappear. Regression asserts the selection box is gone (width ≤ 1 px) after clearing |
| 3 | Airlines mode inconsistency: with UA selected the scope said "reporting airline UA" while all 14 airlines stayed plotted, and UA's point carried no highlight (airline rows had no `id` for the stroke logic) | Airline rows lacked the selection identity, and the scope line described a filter rather than a highlight | Airline rows now carry `id = Reporting_Airline`; the selected airline's point gets the selection stroke; the scope line says "… · one point per reporting airline · UA highlighted". Regression: UA selected → 14 points remain, UA's computed stroke is the selection color, the scope line names the highlight |
| 4 | Rendered positions were never verified — the QA checked bound counts/rates only, and the x ticks could crowd | No position assertions; default log ticks span beyond the domain | New `assertPointPositions`: the rendered **cx/cy of every point** are verified against scales reconstructed from the rendered axis ticks (log-volume slope from tick spacing, linear-rate slope likewise, anchored at x(1)=0 and y(0)=plot bottom; sub-pixel crisp shifts cancel in the spacing). Tolerance ±0.5 px. The x ticks are also clamped to the domain (decade ticks ≤ the largest plotted volume) and their count asserted ≤ 7 |
| — | Handoff correction | — | The initial handoff's bug list is retained; revision-1 additions are described in §5, including two further defects the new checks caught during development (below) |

| 5 | Revision-2 leftovers: after brushing, a global filter change cleared the strokes and note but left the scope line counting stale brushed groups ("349 currently brushed" with everything else cleared); and airlines mode still described the selected carrier as "reporting airline UA" although all 14 stayed plotted | The state subscription invalidated the cached render but never cleared the transient `scatterBrushLabels` set, and the scope line was built from `scopeText`'s filter wording plus the stale count | The subscription now clears the brush set and resets the note on any global filter change (the brush set is transient per scope); the airlines scope line reads "all reporting airlines · … · one point per reporting airline · UA highlighted" — the selection is named as a highlight, never as a filter. Regressions: brush → change months → assert the note, a "0 currently brushed" scope count, no red strokes, and no selection box; airlines + UA → assert "all reporting airlines" and "UA highlighted" in the scope, the absence of "reporting airline UA", 14 points, and UA's selection stroke |

## 1. Changed files and purpose

| File | Change | Purpose |
|---|---|---|
| `site/js/charts.js` | extended/corrected | `drawScatter`: decade ticks clamped to the domain; `onReady({ clearBrush })` so the Clear control and Reset can move the brush to null; brush layer kept under the points. |
| `site/js/app.js` | extended/corrected | `setScatterMode` / `setScatterMinVolume` with explicit cache invalidation, control syncing (radio/slider/output), and brush-set clearing; Reset routes through them and also clears the brush selection and note; the scatter renderer resets the brush note on every render and registers the clear-brush handle; airline rows carry the selection identity; scope lines distinguish filters from highlights. |
| `site/index.html` | extended | "Volume & Reliability" tab (mode radios, minimum-volume slider + output, clear-brush button, brush-status line, scope note). |
| `site/css/style.css` | extended | Slider/button/status styles, brush selection outline. |
| `scripts/qa_batch_d3.cjs` | new | Browser QA incl. revision-1 regressions; writes `docs/assets/batch-d3/` and `reports/site_validation_batch_d3.json` only. |
| `README.md` | modified | Current-implementation paragraph and the D3 QA script. |

## 2. Design decisions

- **Modes and scope.** Airports mode (default): one point per origin airport under
  the shared months + airline filters. Airlines mode: one point per reporting
  airline, scoped by the airport selection; the selected airline is highlighted
  without dropping the comparison. The airport selection in airports mode is a
  highlight, never a filter; the scope line states months, airline, mode, minimum
  volume, exclusions, highlight, and the brush count.
- **Log-scale volume.** Volumes span 1 to ~330k; the x axis is logarithmic with
  decade ticks clamped to the domain and an explicit "log scale" title. Coordinate
  verification uses axis-derived pixel positions, so the scale choice does not
  weaken the acceptance checks.
- **Missing rates.** Groups with zero eligible arrivals are excluded from the plot
  and reported on the scope line; no point is ever drawn at y = 0 for a missing
  rate.
- **Brush = highlight set only.** Dragging on empty areas selects points; the
  status line reports the count as highlight-only; the KPIs are asserted unchanged
  during brushing; Clear (and any scope/mode/threshold change, and Reset) clears
  both the styling and the brush selection box.
- **Minimum volume.** Slider (0–20,000, step 250) with a synced numeric output;
  Reset restores 0 and the output text follows.
- **Association framing.** The panel note is descriptive; no trend or correlation
  claim is drawn.

## 3. Verification commands, exit statuses, results

Python via locked uv (Python 3.13); JS via **Node v24.21.0** (nvm + `.nvmrc`).

| Command | Exit | Result |
|---|---|---|
| `uv run --locked python scripts/test_metrics.py` | 0 | 3 tests OK |
| `uv run --locked python scripts/test_site_data.py` | 0 | 7 tests OK |
| `node scripts/test_filter_state.mjs` | 0 | 12 tests OK |
| `uv run --locked python scripts/verify_data.py` | 0 | full year verified, 7,001,619 rows |
| `uv run --locked python scripts/verify_site_filters.py` | 0 | 77 count checks + 916,323-row row-by-row reconciliation |
| `NODE_PATH=… CHROME_PATH=… node scripts/qa_batch_d3.cjs` (served site) | 0 | 7 check groups incl. revision-1 regressions |
| `NODE_PATH=… CHROME_PATH=… node scripts/qa_batch_b.cjs` | 0 | Batch B checks still pass |
| `NODE_PATH=… CHROME_PATH=… node scripts/qa_batch_c.cjs` | 0 | Batch C checks still pass |
| `NODE_PATH=… CHROME_PATH=… node scripts/qa_batch_d1.cjs` | 0 | Batch D1 checks still pass |
| `NODE_PATH=… CHROME_PATH=… node scripts/qa_batch_d2.cjs` | 0 | Batch D2 checks still pass |
| `git diff --check` | 0 | clean |

Not run, with reasons: `export_site_data.py` / `write_report.py` (no data or report
change), `render_site.cjs` (overwrites interim figures).

## 4. Browser evidence (actually executed, Node 24.21.0)

Headless Chrome (Playwright 1.63.0, system Chrome), site served on 127.0.0.1:8765 —
`qa_batch_d3.cjs` exit 0. Expectations are computed in the QA directly from
`site/data/airport_month_airline.csv`, mirroring the documented pooling rule
independently of the app code:

- **Coordinates (acceptance, revision 1):** all 352 rendered points match their
  independently pooled values (scheduled/eligible/delayed/rate) **and** their
  rendered cx/cy match log/linear positions reconstructed from the rendered axis
  ticks within ±0.5 px; x ticks are decade values inside the plotted range
  (`scatter-brushed.png` shows the clean axes and a brush box).
- **Missing rates (acceptance):** November+OO contains two zero-eligible groups
  (TLH and SPI — one cancelled/diverted flight each); neither is plotted, the count
  is asserted from the pooled data, and the scope line reports "2 group(s) without
  eligible arrivals are not plotted (missing rate ≠ 0)"
  (`scatter-oo-november.png`). No rendered point has a missing rate.
- **Minimum-volume filter (acceptance):** 10,000 leaves exactly the expected points
  and updates the scope line; the slider/output stay in sync.
- **Tooltips:** real hover on the top-volume point (ORD, 327,028 scheduled, rate
  84,927/320,418 = 26.5%) asserts all four fields exactly.
- **Brush and clearing (acceptance):** a real mouse drag selects a highlight set
  whose red-stroked point count equals the reported count; the KPI stays at the
  national 7,001,619; "Clear brush highlight" removes every highlight stroke **and
  the brush selection box/handles**; a threshold change likewise clears the box,
  the set, and resets the note.
- **Airlines mode:** 14 points with pooled coordinates; selecting UA keeps all 14
  points, highlights UA's stroke, and the scope line reads "… · UA highlighted".
- **Selection → detail (acceptance):** clicking an unoccluded airport point opens
  Airport Detail with that airport's name and pooled statistics.
- **Reset (revision 1):** from Airlines + 10,000 at default filters, Reset restores
  the airports radio, the slider value and its text output, and the full 352-point
  airports scope.
- Evidence: `reports/site_validation_batch_d3.json` (source SHA-256 of all touched
  frontend files) and 3 screenshots in `docs/assets/batch-d3/`, visually inspected.
- **Not browser-checked:** interaction timing performance (Batch E), user study
  (Batch E), `render_site.cjs` (interim-figure overwrite).

## 5. Bugs found and fixed across both revisions

Initial submission (caught by smoke tests and the first QA run): the temporal-style
batched loader needed flattening; the brush inversion used wrong selection indices;
the brush layer covered the points; default log ticks overlapped; the scope line
collided with the y-axis title and duplicated a phrase; the QA's zero-eligible
fixture was wrong (FCA+OO+April has 62 eligible arrivals and correctly plots as an
observed-zero point — replaced with the genuine TLH/SPI November+OO fixtures); two
QA-script slips (unawaited locator, status-text wait). Revision 1 (this review):
the four defects in §0 — plus the new checks caught one more real app bug during
development: a dropped `minVolumeOut` declaration made the slider's input handler
throw, which silently disabled the minimum-volume filter and made Reset's
threshold reset a no-op (fixed; this is why the review's second repro existed).
QA-script slips fixed along the way: browser-context helper references, cy missing
from the extracted point data, tick pixel anchoring that double-counted the plot
translation and ignored d3's half-pixel crisp shift (resolved by deriving slopes
from tick spacing and anchoring at the scale definitions). Revision 2: the brush
set is now cleared by the state subscription on any global filter change, and the
airlines scope line distinguishes the full comparison from the highlighted carrier —
both covered by the two new regressions.

## 6. Remaining work, limitations, requested review

- **Batch E** (evaluation, performance, delivery) remains — it will measure load
  and interaction timing, run the participant study, refresh figures without
  touching interim assets, and update delivery documentation.
- The brush set is transient (cleared on scope/mode/threshold changes and Reset) by
  design; persisting brushed groups across scope changes would need a defined
  semantic and was not required.
- The minimum-volume control caps at 20,000; the slider applies to both modes as
  documented on the page.
- No Git operations were performed by the implementer.

**Requested next review:** Codex re-acceptance of Batch D3 (revision 1). On
acceptance, Batch E may be assigned. This batch stops here; no Batch E work has
been started.
