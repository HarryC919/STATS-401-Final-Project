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
charts work; the city map is currently a static overview.

Linked month/airline filters, airport drill-down, the temporal heatmap, comparative cause
bars, and the volume–reliability scatterplot remain future work from the proposal.
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
