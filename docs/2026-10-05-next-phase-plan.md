# Next-Phase Implementation and Acceptance Plan

Date: October 5, 2026

Last status update: October 17, 2026

## Goal and ownership

Build a complete exploration flow: national overview -> month/airline selection ->
airport selection -> airport trends, attribution, and outgoing routes -> reset.
Then complete the remaining proposal views and evaluate the integrated dashboard.

ZCode + GLM is the implementer. Codex assigns batches, reviews actual changes and
evidence, and accepts or returns each batch for revision. The project owner relays
handoffs and controls Git commits and publication. Completing implementation does
not constitute acceptance. Do not begin the next batch until its release is explicit.

This plan authorizes the scope of each batch only when that batch is assigned.
At creation, the initial assignment was **Batch A only** and writing the plan did
not implement any batch. That initial assignment is historical; current status follows.

## Current status: October 17, 2026

- **A–D3: implemented and functionally validated.** The project owner confirmed
  validation on October 16. Filter-ready data, shared filters, Airport Detail,
  geographic entry points, the temporal heatmap, comparative cause bars, and the
  volume–reliability scatterplot are present. The retained
  [B](../reports/site_validation_batch_b.json),
  [C](../reports/site_validation_batch_c.json),
  [D1](../reports/site_validation_batch_d1.json),
  [D2](../reports/site_validation_batch_d2.json), and
  [D3](../reports/site_validation_batch_d3.json) browser reports record passing
  checks of that implementation. They remain historical snapshots; the current
  refinement has separate evidence below.
- **Refinements 1 and 2: implemented on October 17.** The header describes
  interactive exploration, and the fixed national cause view links to the working
  Cause Comparison tab. Airport and route comparisons offer arrival-delay versus
  cancellation rate, busiest/highest/lowest ranking, and a minimum sample.
  The [new browser report](../reports/site_validation_comparisons.json) records
  independently pooled counts, rankings, metric-specific sample thresholds,
  exclusions, national references, Reset, zero-rate interactions, and mobile layout.
- **View explanations and airline-label repair: implemented on October 17.** All
  ten tabs have a visible metric/purpose introduction and an expandable reading
  guide. The airline national-reference label now occupies a separate band above
  the plotting area. [Browser evidence](../reports/site_validation_view_guides.json)
  covers guide interaction at 1440px and 390px, and measured label/bar separation
  in annual and filtered states. These are layout checks, not timing measurements.
- **Appearance refresh:** the dashboard now uses shared CSS design tokens, system
  font stacks, updated cards/controls, and a coordinated chart palette. The retained
  comparison and guide evidence was refreshed after these appearance changes.
  Cause-category and scatter-highlight color assertions were updated to the new
  palette; their numeric, missingness, filter, and Reset checks remain in place.
- **Feedback refinements: implemented on October 17.** The city-level network map
  is now the first tab and initial/reset view. Selecting an airport from the shared
  input, comparison bars, scatterplot points, or map keeps the current page active;
  Airport Detail is opened explicitly. Choices display codes with full names, while
  chart labels remain compact and tooltips append names. Airport names reuse the
  existing directory; the display-only airline list records its BTS source and
  covers all 14 reporting codes. [Navigation evidence](../reports/site_validation_navigation.json)
  checks selection across all ten tabs. Reporting-carrier codes and stable airport
  IDs remain the analytical keys, and no rate definition or data aggregate changed.
- **Data baseline:** the retained [verification record](../reports/verification.json)
  covers all twelve months of 2025 and 7,001,619 flight records. This documentation
  update does not rerun preparation or full-year verification.
- **Batch E:** functional validation is confirmed; documentation is synchronized
  with the implemented dashboard. Quantitative performance evidence remains
  unrecorded. No measured loading-time distribution or achievement of the cached
  update target is claimed. Final publication is still the owner's action; this
  update does not verify the deployed website.
- **Classmate study: deferred by the owner.** Recruiting and testing classmates is
  not practical at present. It does not block current documentation or refinement.
  No participant responses, task completion times, clarity ratings, or empirical
  usability conclusions are available. Automated checks are not a participant study.
- The Batch A–D3 handoffs retain their original review-stage wording and revision
  history. This section supersedes their pending-review and remaining-work statements.
  The interim document and its images remain unchanged historical submission evidence.

## Refinement priorities after functional validation

Items 1, 2, and 5 were approved and implemented; items 3–4 remain recommendations,
not new batch assignments. Preserve existing metric definitions and obtain agreement
on a concrete change before implementing the remaining recommendations.

1. **Completed: make the interface describe the current product accurately.**
   Replaced the outdated static-analysis header and planned-cause-comparison wording.
   Added a direct action from the fixed national cause overview to Cause Comparison,
   retaining visible fixed-scope versus filtered-scope explanations.
2. **Completed: make reliability questions easier to answer.** Airport and route
   comparisons retain the busiest-groups default and add highest/lowest rate ranking,
   delay/cancellation metric selection, and a minimum sample. Counts are pooled
   before recomputing rates. Delay thresholds use eligible arrivals; cancellation
   thresholds use scheduled records. Thresholds apply before choosing the top 15.
   The selected airport is appended only if it meets the sample/missingness rules,
   with an explicit note when outside the ranking. The page states the filtered
   scope, qualifying groups, missing/zero-denominator exclusions, and sample exclusions.
   The national reference retains selected months across all airlines and airports,
   independent of the sample threshold. Global Reset restores both comparison panels
   even when the shared filters are already at their defaults. Tooltips expose counts
   and denominators; visible zero markers and row targets retain access to zero rates.
3. **Provide keyboard and touch access to chart details.** SVG marks currently use
   mouse movement for tooltips and clicks for airport selection. Add focusable
   selection targets with Enter/Space activation, focus-triggered detail text, and
   a touch-friendly way to inspect values without accidentally opening another view.
   A compact accessible data table could expose the same counts and rates. Check
   focus placement after opening Airport Detail and after dismissing the city chooser.
   Existing keyboard checks of filter controls do not establish chart accessibility.
4. **Measure loading and aggregation before choosing an optimization.**
   `loadRoutePartitions()` reads all 352 origin files for the filtered national route
   comparison; the twelve temporal files total 23,564,871 uncompressed CSV bytes in
   the current snapshot. These are workload observations, not measured bottlenecks.
   Separate transfer, CSV parsing, pooling, and rendering costs. If measurements
   justify it, consider an additional compact national-route aggregate, smaller
   startup dependencies, and cached pooled results for repeated temporal/scatter
   scopes. Any new aggregate must be generated and reconcile with the existing
   counts; do not hand-edit publication data or claim faster interaction from size alone.
5. **Completed: explain each view in two layers.** All ten tabs have a short visible
   introduction explaining the measure and its purpose. Expandable guides cover
   denominators, filter/highlight scope, reading the marks, and relevant limitations.
   The temporal guide explains local scheduled hours, low samples, and missing cells;
   cause guides distinguish minute shares from flight counts; scatterplot guidance
   explains the log axis and highlight-only brushing. Airport Detail explains the
   full-year context trend separately from filtered headline/cause/route statistics.
   Guide controls support keyboard open/close, and expanded text stays within the
   page at desktop and narrow-screen widths. The airline reference label was also
   moved out of the bars into a reserved upper band, preserving its numeric value
   and selected-month national scope.

## Sources and current baseline

Read [AGENTS.md](../AGENTS.md), [proposal.md](../proposal.md),
[interim-check.md](interim-check.md), [README.md](../README.md), and the relevant
current source files before implementation. Preserve edits made since this plan.

The original October 5 read-only inspection found the following historical baseline
(superseded by the current-status section above):

- Six static D3 views, national KPI cards, tabs, and hover details on the first five
  charts. The city map is a static overview.
- A verified data record covering 7,001,619 flights and all twelve months of 2025.
- Website sources and the data manifest matching the source hashes in the existing
  browser-validation report. The inspection did not rerun browser tests.
- A GitHub Pages workflow and a published URL recorded in README. The inspection
  did not independently verify the live deployment.
- Missing coordinated filters, airport detail, temporal heatmap, comparative cause
  bars, scatterplot, and actual participant evaluation.

Existing local inputs include `airline_month.csv` (168 rows),
`airport_month_airline.csv` (17,791 rows, approximately 3.65 MB),
`route_month_airline.csv` (116,878 rows, approximately 21.37 MB), and monthly
temporal files (January: 63,956 rows, approximately 7.22 MB). These measurements
are planning evidence, not permanent schema or size guarantees. Recheck inputs.

## Global constraints

- Use uv and Python 3.13, with `uv sync --locked` and `uv run --locked python ...`.
- Retain native JavaScript, HTML, CSS, and D3. Do not introduce a frontend framework.
- Preserve `data/raw/` and `proposal.md`. Reuse existing verified summaries whenever
  their dimensions support the required result; avoid unnecessary full preparation.
- Keep analytical aggregates in `data/summaries/`, publication snapshots in
  `site/data/`, and audits in `reports/`. Do not hand-edit generated CSVs.
- Pool numerators and denominators before calculating rates. Preserve nulls,
  observed zeros, cancellations, diversions, and original anomalies.
- Arrival-delay denominator: noncancelled, nondiverted flights with observed
  arrival delay. Delayed arrivals have `ArrDelay >= 15`. Cancellation/diversion
  denominators include all scheduled records.
- Use `AirportID` for stable airport selection. Join historical coordinates using
  `AirportSeqID` with a many-to-one constraint. City identity is not airport identity.
- Airport metrics describe arrival outcomes of outgoing flights. City-pair edges
  combine directions; directed airport-route data must remain separate.
- Cause shares use reported attributed minutes and observation counts. Missing
  attribution is not zero. WeatherDelay does not capture all weather effects.
- Write project artifacts and comments in English. Put plans directly in `docs/`.
- Preserve the interim document and its images as historical submission evidence.
  Record subsequent implementation status separately; never label plans as results.
- Do not stage, commit, push, merge, change branches, or deploy automatically.
- Preserve unrelated changes and ignore large data, local environments, temporary
  tooling, and sensitive files. Never terminate unrelated local servers.

## Sequence and milestones

Execute A -> B -> C -> D1/D2/D3 -> E, with separate acceptance for each batch.

1. **Milestone 1:** A-C deliver the complete airport exploration flow.
2. **Milestone 2:** D1-D3 cover the remaining proposal questions and interactions.
3. **Milestone 3:** E provides technical evaluation evidence and final delivery
   readiness, with the classmate study explicitly deferred as of October 16.

No new deadline was supplied. These are dependency milestones, not calendar promises;
do not reuse elapsed week numbers from the original proposal as current deadlines.

## Batch A: Filter-ready publication data

### Objective and scope

Provide reliable browser inputs for month, airline, and airport filtering without
breaking the current static dashboard. This batch does not implement frontend controls.

Primary files: `scripts/export_site_data.py`, `scripts/test_site_data.py`, generated
`site/data/` files and manifest. Add narrowly scoped verification helpers if needed.
Record the data contract in `docs/2026-10-05-filter-data-contract.md` during execution.

### Execution steps

1. Inspect actual source schemas and existing export consumers. Define output paths,
   keys, dimensions, units, null semantics, count fields, and attribution observation
   fields before changing the exporter. Record these decisions in the contract.
2. Export compact month x reporting-airline x origin-airport data. Keep counts and
   cause minutes/observation counts needed for later pooling, not just precomputed rates.
3. Partition outgoing-route data primarily by origin airport. Partition temporal
   data for on-demand access; document the selected grain and cross-partition pooling.
   Avoid loading full route and temporal datasets on the initial page load.
4. Export an airport directory with stable IDs, display names, city membership, and
   display coordinates. Document how historical coordinate versions become one display
   location; do not silently join by IATA code or select an arbitrary coordinate row.
5. Extend the manifest with source/output hashes, dimensions, row counts, file sizes,
   coverage, and partition discovery. Keep all current static export paths compatible.
6. Add meaningful regression checks and independent source-to-output reconciliations.
   Run the required checks and deliver a batch handoff.

### Acceptance criteria

- Pooling all months and airlines restores national scheduled, eligible, delayed,
  cancelled, and diverted counts.
- ORD annual, January, January-February, and a specified reporting-airline subset
  match independent Python calculations from source summaries. State the selected
  airline and report exact numerators and denominators, not only rounded percentages.
- Reverse airport routes remain separate. City-pair aggregation does not change them.
- Zero eligible arrivals produce a missing rate. Unobserved cause minutes remain
  missing, while observed zero minutes remain zero.
- Tests include unequal group sizes: 5/10 and 9/90 must pool to 14/100, not the mean
  of their percentages. Include zero-denominator and all-missing-cause cases.
- No dropped or duplicated counts arise from directory joins or partition boundaries.
- Repeated export from unchanged inputs produces identical CSV contents and hashes.
- Report total publication size, largest partition, and proposed initial versus
  on-demand loading. Do not claim a performance target from file size alone.
- Current static export paths and schemas remain compatible, with manifest hashes
  matching the delivered artifacts. Do not claim new browser verification unless run.

## Batch B: Shared filtering and existing views

### Objective and scope

Connect existing views to one month-range and airline selection state. Depend on the
accepted Batch A contract. Use separate state/data/aggregation modules as appropriate;
avoid putting all new behavior inside `app.js` or `charts.js`.

Primary files: `site/js/app.js`, `site/js/metrics.js`, `site/js/charts.js`,
`site/index.html`, `site/css/style.css`, and focused new JavaScript modules/tests.

### Required behavior

- Provide month-range controls, airline selection, an active-filter summary, and Reset.
  Implement reliable controls first; visual brushing can feed the same state later.
- KPI, airport comparison, and route comparison use selected months and airline.
- Airline comparison uses selected months but retains other airlines for context;
  highlight the chosen airline rather than reducing the comparison to one bar.
- Monthly trends retain twelve months, apply the airline selection, and highlight
  the chosen month range. Airport-specific trends belong to the detail view in C.
- The national reference uses the selected months across all airlines and all origin
  airports. Label this scope explicitly; do not silently make it airport-specific.
- A view not yet filterable must clearly state its fixed scope.
- Cache compatible loaded data, recompute pooled rates, and prevent an older response
  from replacing results for a newer selection.

### Acceptance criteria

- Filter state persists across tabs; Reset restores the initial annual/all-airline view.
- Empty selections display a clear empty state, never an artificial zero delay rate.
- Rapid selection changes settle on the most recent state, including delayed responses.
- Visible values match independent source-summary calculations for the A fixtures.
- Keyboard operation and loading/error states work. Existing charts remain usable.

## Batch C: Airport detail and geographic entry points

### Objective and scope

Deliver national overview -> month/airline selection -> ORD detail -> reset.

Add airport search/selection and selection from the comparison chart. Detail includes
monthly trends, cause composition, and the five busiest outgoing directed routes.
Use the shared month/airline state and a stable selected `AirportID`.

### Required behavior

- Airport comparison retains its comparison context and highlights the selected airport.
- Detail statistics use the selected airport, airline, and month range. A full-year
  context trend may be shown only if explicitly labeled and the selection highlighted.
- City-map information shows member airports. Selecting a multi-airport city opens
  an explicit airport choice rather than silently pooling airport detail.
- Add an airport layer and directed outgoing-route layer for a selected origin to
  meet the proposal's geographic design. Preserve the city overview as a separate mode.
- Retain access to airports outside the map projection through the airport selector.

### Acceptance criteria

- Chicago's ORD and MDW can be selected separately with distinct, correct statistics.
- Details reconcile with source summaries under combined filters.
- Top five routes are selected by filtered scheduled flight count with deterministic
  tie-breaking and clear direction. Do not keep an annual top-five list after filtering.
- Empty airport/month/airline combinations show an explicit empty state.
- Map exclusions never silently remove flights from national or detail totals.
- Selection, clearing selection, and Reset update all affected views consistently.

## Batch D1: Weekday x scheduled-hour heatmap

Use selected months, airline, and airport. Horizontal position is scheduled local
departure hour; rows are weekdays. Display delayed and eligible counts and the rate
in each tooltip. Distinguish no observations from observed zero delay and mark low
sample sizes with a documented rule.

Acceptance: verify weekday order, hour boundaries, the existing `2400` convention,
selected cell counts against source summaries, cross-month pooling, and consistent
filter/reset behavior. Preserve the existing calendar/time semantics.

## Batch D2: Comparative 100% stacked cause bars

Compare airports or airlines using reported attributed minutes. Keep five stable
category colors and expose observation/completeness counts. The national pie can
remain as an overview, but does not replace the comparison requirement.

Acceptance: each bar with a positive reported-minute total sums to 100% within numeric
tolerance. Missing or zero-total attribution does not produce a fabricated complete
bar. Verify pooled minutes and category observations independently, including partial
and all-missing cases. Describe reported attribution without causal claims.

## Batch D3: Volume-reliability scatterplot

Support airport/airline mode, scheduled-flight volume versus arrival-delay rate,
minimum-volume controls, tooltips, and selection highlighting. Brushing initially
defines a comparison/highlight set, not a new national denominator. Single-airport
selection can open airport detail.

Acceptance: point coordinates match source summaries; missing rates are not plotted
as zero. Volume filters and clearing the brush behave predictably. Distinguish the
brush set from the selected airport and global filters. Do not label association as
causal evidence. Use shared month/airline state with explicitly labeled view scope.

## Batch E: Evaluation, performance, and delivery

### Implementer responsibilities

- Extend browser checks to cover filters, airport detail, brush/reset, empty states,
  failures/retry, rapid actions, keyboard use, and narrow-screen layout.
- Measure initial loading separately from cached interaction updates. Record device,
  browser, dataset size, repeat count, and timing distribution rather than one best run.
- Treat the interim document's sub-500-ms cached update goal as a target to evaluate,
  not an already achieved result. Report misses and their causes honestly.
- Participant materials are optional while the study is deferred. If resumed,
  prepare tasks, source-derived answer keys, and anonymous feedback forms first.
- After validation, update README and subsequent-stage evidence. Keep interim assets
  intact: `scripts/render_site.cjs` currently overwrites `docs/assets/interim/`, so
  separate the new stage's output before refreshing figures.
- Account for the current GitHub Pages subpath and workflow in checks. Publication
  remains the owner's action; do not push to trigger deployment.

### Human responsibilities and acceptance

The original target was to recruit and test 3–5 classmates. **On October 16, the
owner deferred this work because arranging classmate participation is not practical.**
It is not a gate for current documentation and refinement. Keep the absence of
participant evidence explicit in delivery materials; do not claim demonstrated
usability or invent responses.

If the study resumes, agents may prepare materials and analyze real feedback.
Collect task correctness, completion time, help requests, misinterpretations,
comments, and clarity ratings. Prioritize incorrect readings and blocked tasks,
then retest affected interactions.

Technical acceptance requires traceable functionality evidence, actual performance
measurements, current documentation, and no unsupported completion or causal claims.
The owner's functional-validation confirmation does not establish a timing result.
Until timings are recorded, keep that technical evaluation item open and the
sub-500-ms goal unmeasured. Record the participant study separately as deferred.

## Verification commands and conditions

Use the current environment and run checks appropriate to each change:

```bash
uv sync --locked
uv run --locked python scripts/test_metrics.py
uv run --locked python scripts/test_site_data.py
uv run --locked python scripts/verify_data.py
uv run --locked python scripts/export_site_data.py
uv run --locked python scripts/write_report.py
git diff --check
```

For preparation changes, additionally run the full `scripts/prepare_data.py` before
`scripts/verify_data.py`. Never deliver partial-month output as full-year data.
After report generation, inspect the report. Include focused new checks as needed;
do not use static checks as substitutes for browser interaction validation.
Check new/untracked files as well as tracked diffs for whitespace and accidental files.

Browser tooling and reproduction are described in README. Do not overwrite interim
figures when collecting later-stage evidence. Stop unrelated server interference by
choosing a free port, not by killing another process.

## Handoff and acceptance protocol

At the end of each assigned batch, provide an English handoff in
`docs/2026-10-05-batch-<id>-handoff.md`, where `<id>` is `a`, `b`, `c`, `d1`, `d2`,
`d3`, or `e`. Include:

1. Batch ID and status: **ready for review**, **incomplete**, or **blocked**.
2. Changed files and the purpose of each change; identify unrelated changes left intact.
3. Inputs/outputs and any data-contract decisions or deviations.
4. Exact verification commands, exit statuses, key results, and failures not resolved.
5. Independent numeric comparisons, with counts and denominators where applicable.
6. Browser steps and evidence where relevant; explicitly state checks not performed.
7. Generated data size, lineage/hash evidence, and repeatability where relevant.
8. Remaining work, limitations, and the requested next review.

Codex reviews actual files and evidence and returns **accepted**, **revision required**,
or **blocked with a stated reason**. Numeric errors, inconsistent filter state,
missing-as-zero mistakes, stale responses replacing current data, and false completion
claims prevent acceptance. Implementer self-assessment cannot release the next batch.

## Initial executor prompt

Use [the Batch A executor prompt](2026-10-05-zcode-glm-batch-a-prompt.md).
