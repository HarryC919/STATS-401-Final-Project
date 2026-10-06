# Batch D2 Handoff: Comparative 100% Stacked Cause Bars

**Batch ID:** D2 — **Status: ready for review** (revision 2; not accepted yet).

Date: October 5, 2026. Implementer: ZCode + GLM. Scope is strictly
[Batch D2](2026-10-05-next-phase-plan.md) on top of the **accepted** Batches A–C and
D1. No D3/E work, no `proposal.md` or raw-data changes, no Git staging/commit/push/
merge/deploy. Performance measurement and the participant study remain in Batch E.

## 0. Revision 1 — fixes for the returned review

| # | Reported issue | Root cause | Fix |
|---|---|---|---|
| 1 | Completeness statistics were unreachable by real hover: they were bound to `.cause-row` backdrops that the 100% stacked segments fully cover, and the QA used `dispatchEvent`, bypassing hit-testing | Layering design put an invisible full-row rect *underneath* the segments | The backdrops are removed. Completeness statistics now live in **two reachable places**: every segment tooltip repeats them (real hover on any visible segment), and the **y-axis row labels** are real hover targets for the full completeness tooltip. The QA now hovers with the actual pointer (`locator.hover()` on located indexes/labels) — no synthetic events anywhere |
| 2 | Reset did not restore the cause-comparison mode: Airlines mode survived Reset | The view-local mode variable was never touched by Reset | Reset now restores `airports` mode **and** the radio state, together with the shared filters. The regression starts from airlines mode, resets, and asserts the radio state and that the re-opened view renders "one bar per origin airport" |
| 3 | No rendering verification for partial / all-missing attribution | The 2025 baseline has no such pooled groups | Both cases are now tested with **synthetic data injected via request fulfillment** (the QA rewrites one `airport_month_airline.csv` combo row per scenario and serves it from the disk copy — `route.fetch` is deliberately avoided because the local server resets burst connections): **partial** — Security becomes unobserved → the group renders four segments that renormalize to 100%, Security contributes none, and the segment/label tooltips expose the simulated partial count; **all-missing** — all five categories unobserved with delayed > 0 → the group renders zero segments with "No reported cause minutes (attribution missing or zero)" and "Attribution observed on 0 of N delayed arrivals" — never zeros, never a fabricated bar |
| 4 | D1's two persistent regressions did not test what they claimed: the "retry" fell back to cached January instead of re-fetching the failed February, and the race test closed the page before the throttled response completed | The retry scenario changed the scope away from the failed one; the race assertions ran before the stale response could land | `qa_batch_d1.cjs` failure regression now stays on the failed scope, unblocks February, re-selects the tab, and verifies the **re-fetched Jan–Feb grid** slot-by-slot; the race regression now waits past the throttled response's completion **after** the final render and re-verifies the grid is still January — the stale response provably does not overwrite |
| — | Handoff correction: the previous revision claimed "ORD + HA shows the explicit empty state" in this view | The D2 QA has no such scenario, and with the comparison context retained an ORD+HA selection is not an empty chart here (it compares Hawaiian's other airports) | Claim removed. (The Airport *Detail* empty state for ORD+HA remains correct and is covered by the Batch C QA.) The D1 follow-up section is also corrected: the failure/race regressions existed but did not assert the right paths; they now do (item 4) |

| 5 | Revision-2 blocker: with the global filters already at their defaults, switching to Airlines and pressing Reset left the cached airlines chart in place (radio said Airports, chart still said "one bar per reporting airline") | `state.reset()` does not emit a notification when the state is already default, so the cached cause-comparison view was never invalidated even though the mode had changed | Mode changes now go through a single `setCauseCompareMode(mode)` that **always** invalidates the cached `tab-cause-compare` view explicitly (independent of the state notification cycle) and syncs the radio state; the Reset handler routes through it. New regression reproduces the exact review scenario on a fresh default-scope page — switch to Airlines, Reset, reopen — asserting the radio state, the "one bar per origin airport" scope line, the absence of the airlines scope text, and that the rows are the busiest airports rather than airlines |

## 1. Changed files and purpose

| File | Change | Purpose |
|---|---|---|
| `site/js/charts.js` | extended/corrected | `drawCauseComparison`: completeness statistics moved into every segment tooltip and onto the y-axis row labels (real hover targets); unreachable `.cause-row` backdrops removed; 100% stacked segments from reported attributed minutes with five stable inline-style colors; zero/missing-total groups render no segments with explicit notes; selected group's label emphasized; legend and reported-attribution footer. |
| `site/js/app.js` | extended/corrected | `tab-cause-compare` renderer (airports/airlines modes, scope lines, selected-group emphasis); Reset now restores the default mode and radio state. |
| `site/index.html` | extended | "Cause Comparison" tab with mode radios, acceptance-oriented scope note, chart svg. |
| `site/css/style.css` | extended | Mode toggle and placeholder styles. |
| `scripts/qa_batch_d2.cjs` | new | Browser QA with real-pointer hovers only, synthetic attribution scenarios, and the reset-mode regression; writes `docs/assets/batch-d2/` and `reports/site_validation_batch_d2.json` only. |
| `scripts/qa_batch_d1.cjs` | extended | Failure-retry and stale-response regressions deepened per review item 4. |
| `README.md` | modified | Documents the D2 QA script and current view list. |

## 2. Design decisions

- **Scope.** Both modes respect the shared month range; the airline filter applies
  to the airports mode, and the airport *selection* scopes the airlines mode.
  The national pie remains the overview.
- **Group selection.** Airports: busiest 12 by pooled scheduled flights (deterministic
  tie-break) plus the selected airport when outside. Airlines: all reporting
  airlines, selected one emphasized.
- **100% rule.** Segments are shares of the group's reported attributed minutes;
  every bar with a positive total spans the full axis width; observed-zero
  categories render zero-width segments (tooltip: 0 min, 0%).
- **Missing vs zero vs none.** No delayed arrivals → "No delayed arrivals under the
  current filters"; delayed with zero/missing minutes → "No reported cause minutes
  (attribution missing or zero)"; never fabricated, never zeroed.
- **Attribution framing.** Tooltips and footer describe *reported* attribution,
  without causal claims.

## 3. Verification commands, exit statuses, results

Python via locked uv (Python 3.13); JS via **Node v24.21.0** (nvm + `.nvmrc`).

| Command | Exit | Result |
|---|---|---|
| `uv run --locked python scripts/test_metrics.py` | 0 | 3 tests OK |
| `uv run --locked python scripts/test_site_data.py` | 0 | 7 tests OK |
| `node scripts/test_filter_state.mjs` | 0 | 12 tests OK |
| `uv run --locked python scripts/verify_data.py` | 0 | full year verified, 7,001,619 rows |
| `uv run --locked python scripts/verify_site_filters.py` | 0 | 77 count checks + 916,323-row row-by-row reconciliation |
| `NODE_PATH=… CHROME_PATH=… node scripts/qa_batch_d2.cjs` (served site) | 0 | 8 check groups incl. revision-1 regressions |
| `NODE_PATH=… CHROME_PATH=… node scripts/qa_batch_b.cjs` | 0 | Batch B checks still pass |
| `NODE_PATH=… CHROME_PATH=… node scripts/qa_batch_c.cjs` | 0 | Batch C checks still pass |
| `NODE_PATH=… CHROME_PATH=… node scripts/qa_batch_d1.cjs` | 0 | Batch D1 checks incl. deepened failure/race regressions |
| `git diff --check` | 0 | clean |

Not run, with reasons: `export_site_data.py` / `write_report.py` (no data or report
change), `render_site.cjs` (overwrites interim figures).

## 4. Browser evidence (actually executed, Node 24.21.0)

Headless Chrome (Playwright 1.63.0, system Chrome), site served on 127.0.0.1:8765 —
`qa_batch_d2.cjs` exit 0. All interactions in the tooltip/color assertions use the
real pointer (`locator.hover()`); no synthetic event dispatch remains in the suite.

- **100% rule, every complete bar:** default airports mode (busiest 12) and airlines
  mode under Jan–Mar: each bar's segment widths sum to the full axis width within
  ±0.5 px; each segment's rendered share matches the independently pooled minutes
  share within ±0.002 (expected values computed in the QA from the CSV, mirroring
  the documented pooling rule).
- **Real-hover completeness (review item 1):** hovering a segment (ORD, 6,448,168
  reported minutes; largest category asserted field-by-field: minutes, share ±0.05 pp,
  observation count) also surfaces "Attribution observed on X of Y delayed arrivals ·
  Partial: P · delayed with no attribution: Z"; hovering a row label shows the same
  completeness statistics.
- **Five stable colors:** the set of rendered segment fills equals exactly the five
  expected `rgb()` values (computed styles).
- **Missing/zero-total rule:** fixture FCA + OO + April (62 scheduled, 0 delayed,
  0 minutes — asserted from the CSV first) renders no segments with the explicit
  note and a real-hover tooltip carrying its scheduled count and "Reported minutes:
  none"; other groups in scope still sum to 100% (`cause-zero-total.png`).
- **Synthetic partial (review item 3):** with the fulfilled CSV, the rewritten group
  renders four segments (Security absent), renormalized to 100% (±0.5 px), and both
  the segment and label tooltips expose "Partial: N" (`cause-partial-synthetic.png`).
- **Synthetic all-missing (review item 3):** the rewritten group renders zero
  segments with "No reported cause minutes (attribution missing or zero)", "Reported
  minutes: none", and "Attribution observed on 0 of 6,499 delayed arrivals" — the
  other groups are unaffected (`cause-all-missing-synthetic.png`).
- **Reset (review item 2):** starting from airlines mode, Reset restores the
  airports radio state and the re-opened view renders the airports comparison.
- **Scoping:** ORD selection re-pools the airline comparison to ORD; BQN is appended
  as the 13th row outside the busiest 12.
- Evidence: `reports/site_validation_batch_d2.json` (source SHA-256 of all touched
  frontend files) and 5 screenshots in `docs/assets/batch-d2/`, visually inspected.
- **Not browser-checked:** interaction timing performance (Batch E), user study
  (Batch E), `render_site.cjs` (interim-figure overwrite).

## 5. Bugs found and fixed across both revisions

Initial submission: legend clipped at the right margin; several QA-script defects
(month-range reorder semantics, `selectOption` types, tooltip line indices, a file
read misuse). Revision 1: the unreachable completeness layer (removed and replaced
with reachable surfaces), the unreset mode, the missing synthetic attribution
coverage, and the D1 regressions that did not exercise the paths they claimed —
plus, during its own development, the QA caught remaining tooltip-index slips, and
`route.fetch` was replaced with disk-copy fulfillment after the local server reset
the connection mid-scenario. Revision 2: the mode reset no longer relies on the
global state's notification cycle (the cache is invalidated explicitly), and the
review's exact reproduction is a persistent regression.

## 6. Remaining work, limitations, requested review

- **D3** (volume–reliability scatterplot) and **Batch E** (evaluation, performance,
  delivery) remain.
- The airports mode caps the comparison at the busiest 12 plus the selection; the
  count is fixed for now and could become a control if user feedback asks.
- Cause attribution exists only at the airport/airline grain in the published data
  (Batch A contract), so route- or hour-level cause comparisons are out of scope.
- No Git operations were performed by the implementer.

**Requested next review:** Codex re-acceptance of Batch D2 (revision 1). On
acceptance, Batch D3 may be assigned. This batch stops here; no D3 work has been
started.
