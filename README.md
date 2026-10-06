# Delay Across the Network

**STATS 401 · 2025 U.S. Domestic Flight Reliability**\
Henghao Jiang · Linjin Di · Hanchi Zhao

Explore geographic differences, monthly patterns, and reported delay attribution in
BTS reporting-carrier data. The verified baseline contains **7,001,619 flight records**
across all twelve months of 2025. Comparisons are descriptive, not causal.

**Start here:** [Interim check and six actual visualizations](docs/interim-check.md) ·
[Project proposal](proposal.md) · [Data documentation](data/README.md) ·
[Data quality report](reports/quality_report.md)

## View the dashboard

**Published:** <https://harryc919.github.io/STATS-401-Final-Project/> — pushes to `main`
that change `site/` are redeployed automatically by
[GitHub Actions](.github/workflows/deploy-pages.yml) after the site data checks pass.

To run locally from the repository root:

```bash
uv sync --locked
uv run --locked python scripts/serve_site.py
```

Open **<http://127.0.0.1:8765/>**. Stop with **Ctrl+C**. If that port is occupied,
use `uv run --locked python scripts/serve_site.py --port 8766` and open port 8766.
The server never stops another process and serves only `site/`.

The small [website data snapshot](site/data/) and pinned [vendor assets](site/vendor/)
are included, so viewing does not require raw data, a frontend build, or CDN access.
Python is managed by uv at version 3.13. A first `uv sync` may need network access.

The [HTML source](site/index.html) alone is not a hosted application when viewed in
GitHub's file viewer; the published site above is the hosted copy. The interim
document's embedded figures are visible directly on the GitHub repository page.

## Current implementation

Six real-data D3 views are implemented: monthly trends, airline comparison, airport
comparison, directed-route comparison, reported delay-cause composition, and a city-level
network map. KPI cards provide national context. Tabs and hover details on the first five
charts work.

A shared filter bar drives month-range and reporting-airline selection across the KPI
cards and the monthly, airline, airport, and route views; rates are recomputed from
pooled counts, a Reset restores the annual all-airline view, filtered routes load the
per-origin partitions on demand, and the cause chart and city map state their fixed
scope. Airport selection (search box, comparison-chart bars, or map cities) opens an
Airport Detail view — filtered trend, reported cause composition, and the five busiest
outgoing directed routes. The temporal-patterns heatmap shows the arrival-delay rate
by weekday and scheduled departure hour, the cause-comparison view stacks reported
attribution across airports or airlines, and the volume–reliability scatterplot plots
volume (log scale) against delay rate with a minimum-volume filter and a highlight-only
brush. Performance measurement and the participant study remain future work.
See the [interim check](docs/interim-check.md) for scope and evaluation plans.

## Reproduce the data

The complete download, preparation, and verification workflow is in
[data/README.md](data/README.md). Raw archives, monthly Parquet partitions, and large
analytical summaries are local and ignored by Git. Once that baseline is verified:

```bash
uv run --locked python scripts/test_metrics.py
uv run --locked python scripts/verify_data.py
uv run --locked python scripts/test_site_data.py
uv run --locked python scripts/export_site_data.py
uv run --locked python scripts/write_report.py
```

Do not edit `site/data/*.csv` manually. Its [manifest](site/data/manifest.json) records
source/output hashes, coverage, and aggregation definitions. Export fails on incomplete
year coverage or inconsistent counts/rates. The exporter reads Parquet partitions one
month at a time and leaves the original data unchanged.

## Repository layout

- `site/`: HTML, CSS, JavaScript, generated publication data, and pinned vendor assets.
- `scripts/`: data acquisition, preparation, verification, website export, and serving.
- `data/`: source documentation and local raw/processed/summary data.
- `reports/`: data audits and separate browser-validation evidence.
- `docs/`: plans, interim check, and actual chart figures.
- `proposal.md`: original proposal, preserved separately from implementation status.

## Browser checks and figure refresh

The optional browser tool uses Node and Playwright only for QA; neither is required
for viewing or data processing. Install it outside the repository, start the local site,
and run (macOS example with installed Chrome):

```bash
npm install --prefix /tmp/stats401-qa --cache /tmp/stats401-npm playwright@1.63.0
NODE_PATH=/tmp/stats401-qa/node_modules \
CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
node scripts/render_site.cjs
```

Set `SITE_URL=http://127.0.0.1:8766/` if using another port. On other systems, set
`CHROME_PATH` to an installed Chrome/Chromium executable, or install Playwright's Chromium
and omit that variable. The tool checks six charts, data/mark counts, national baseline,
missing-value semantics, tooltips, tabs, keyboard activation, mobile overflow, and loading
failures/retry. It refreshes `docs/assets/interim/*.png` and
[reports/site_validation.json](reports/site_validation.json). Inspect the figures visually
after export. These checks are separate from the planned user study and performance evaluation.

Batch B adds two focused checks that never touch the interim figures:
`node scripts/test_filter_state.mjs` unit-tests the pure filter-state and pooling
modules, and `NODE_PATH=<playwright modules> node scripts/qa_batch_b.cjs` (with the
site served) exercises the shared filters in a real browser, writing screenshots to
`docs/assets/batch-b/` and evidence to
[reports/site_validation_batch_b.json](reports/site_validation_batch_b.json).
Batch C adds `scripts/qa_batch_c.cjs` the same way for the airport detail and map
entry points (`docs/assets/batch-c/`, `reports/site_validation_batch_c.json`); D1
adds `scripts/qa_batch_d1.cjs` for the weekday × hour heatmap; D2 adds
`scripts/qa_batch_d2.cjs` for the comparative cause bars; D3 adds
`scripts/qa_batch_d3.cjs` for the volume–reliability scatterplot (each with its own
`docs/assets/batch-*/` and `reports/site_validation_batch_*.json`).

Both checks run on **Node 24** (pinned in [.nvmrc](.nvmrc) and declared by the
`engines` field in `package.json` — it documents intent but does not stop a directly
invoked `node`; CI installs the same version from `.nvmrc`).
Before running them locally, install and select that version with
[nvm](https://github.com/nvm-sh/nvm) from the repository root:

```bash
nvm install && nvm use
```
