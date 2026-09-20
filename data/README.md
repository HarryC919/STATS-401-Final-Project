# Week 3 Data Preparation

This directory implements Week 3 of [proposal.md](../proposal.md): cleaning the full year of 2025 flight records, validating airport coordinates, documenting data quality, and producing exploratory summaries. Reports and code can be tracked in Git. Raw data, processed datasets, summaries, and the virtual environment remain local and are excluded by `.gitignore`.

## Sources and files

- `raw/flights/2025-MM.zip`: immutable, full-column monthly BTS Reporting Carrier On-Time Performance archives. Each includes a CSV and the BTS `readme.html`.
- `raw/flights_manifest.json`: twelve source URLs, archive member names, byte sizes, SHA-256 checksums, and verification timestamps. Monthly URLs follow `https://transtats.bts.gov/PREZIP/On_Time_Reporting_Carrier_On_Time_Performance_1987_present_2025_M.zip`.
- `raw/airports/master_coordinate.zip`: historical BTS Master Coordinate data with ten selected fields. Its source and checksum are recorded in `raw/airports/manifest.json`.
- `processed/flights_2025_MM.parquet`: monthly cleaned partitions with 31 retained source fields and seven derived fields, compressed with Zstandard. Raw CSVs do not need to be extracted to disk.
- `processed/airports.csv`: airport sequence versions used by the flights, including names, states, coordinates, and validity dates. The unique key is `AIRPORT_SEQ_ID`.
- `summaries/`: UTF-8 CSV summaries. Rates are numeric proportions from 0 to 1; empty cells indicate missing values. Tables retain numerators, denominators, and delay-cause observation counts.
- `../reports/quality_report.md`: measured quality findings, exploratory comparisons, and limitations. Detailed monthly checks are in `quality_report.json`.
- `../reports/coordinate_issues.csv`: unmatched joins, invalid coordinates, or dates outside airport-version validity periods. A header-only file means no such issues were found.
- `../reports/flight_anomalies.csv`: original values and flags for inconsistent cause totals, missing arrival delay on noncancelled/nondiverted flights, and scheduled departure time `2400`.
- `../reports/verification.json`: full-year partition checks, checksum verification, summary reconciliation, and independent counts from the raw January CSV.

Official sources: [flight downloads](https://www.transtats.bts.gov/DL_SelectFields.aspx?QO_fu146_anzr=b0-gvzr&gnoyr_VQ=FGJ), [airport metadata](https://www.transtats.bts.gov/DL_SelectFields.aspx?QO_fu146_anzr=N8vn6v10+f722146+gnoyr5&gnoyr_VQ=FLL), and [BTS delay definitions](https://www.bts.gov/explore-topics-and-geography/topics/airline-time-performance-and-causes-flight-delays). Coverage is limited to domestic scheduled flights submitted by reporting carriers, including U.S. territories; it does not represent every U.S. flight.

## Reproduction with uv

Use **uv and Python 3.13**. `.python-version` selects 3.13, and `pyproject.toml` restricts the project to Python `>=3.13,<3.14`. Dependencies are declared in `pyproject.toml` and resolved in `uv.lock`. Keep both files under version control. The first run requires network access to obtain dependencies and several hundred MB of source archives.

Run from the project root:

```bash
uv sync --locked
uv run --locked python scripts/download_data.py
uv run --locked python scripts/download_airports.py
uv run --locked python scripts/test_metrics.py
uv run --locked python scripts/prepare_data.py
uv run --locked python scripts/verify_data.py
uv run --locked python scripts/write_report.py
```

Use `uv add` or `uv remove` for dependency changes and commit the resulting `pyproject.toml` and `uv.lock` updates. Do not maintain a separate pip/requirements workflow.

The download scripts validate and reuse existing ZIPs. New downloads are validated before being saved to their final paths. Do not run the downloader while another process is writing the same final archive. The airport export requires a shared session across its GET and POST requests; the script preserves that session automatically.

`prepare_data.py --months 1` is for debugging only: it overwrites top-level summaries and the quality audit with partial-year results. Before delivery, rerun without `--months`, then pass the complete twelve-month checks in `verify_data.py`. Preparation does not modify raw archives. Failed runs may leave earlier outputs in place; downstream work should use outputs only after full verification succeeds.

## Cleaning and fields

Missing values are not automatically imputed. Cancelled and diverted flights are retained, and large delays are not truncated. Checks cover duplicates across the selected source columns and the candidate flight key `FlightDate + Reporting_Airline + Flight_Number_Reporting_Airline + OriginAirportID + DestAirportID + CRSDepTime`. Duplicate candidates are exported for review rather than automatically deleted. Because monthly date partitions do not overlap, monthly checks also cover full-year duplicates for this key.

Retained source fields:

- Dates: `FlightDate`, `Month`, and `DayOfWeek`.
- Airline and flight identifiers: `Reporting_Airline`, `DOT_ID_Reporting_Airline`, `Flight_Number_Reporting_Airline`, and `Tail_Number`. Airline codes, flight numbers, and tail numbers are strings.
- Airports: `OriginAirportID`, `OriginAirportSeqID`, `Origin`, `OriginCityName`, and `OriginState`, plus the corresponding five `Dest*` fields. Numeric identifiers use nullable integer types.
- Times and outcomes: `CRSDepTime`, `CRSArrTime`, `DepDelay`, `ArrDelay`, `ArrDel15`, `Cancelled`, `CancellationCode`, `Diverted`, and `Distance`.
- Cause minutes: `CarrierDelay`, `WeatherDelay`, `NASDelay`, `SecurityDelay`, and `LateAircraftDelay`.

`CRSDepTime` and `CRSArrTime` are local HHMM integers: for example, 659 means 06:59, not a decimal hour. Delays are measured in minutes; negative values indicate early operation. Distance is measured in miles.

Derived fields are `Weekday` (Monday = 1 through Sunday = 7), `ScheduledDepHour` (0–23), `Route` (a directed IATA-code label), `ArrivalEligible`, `ArrivalDelayed15`, `CauseComplete`, and `CauseAnyObserved`. Month and weekday are recomputed from the flight date and checked against the source. A scheduled time of `2400` maps to hour 0 while retaining the BTS `FlightDate` and weekday; the pipeline does not infer UTC timestamps or actual departure dates. Invalid scheduled departure times become missing hours and are counted in the quality audit.

Each endpoint is joined to airport metadata by sequence ID using a `many_to_one` constraint. Checks cover unchanged row counts, matching airport IDs/codes, coordinate bounds, and validity dates. Metadata remains in a separate table to avoid repeating names and coordinates on every flight. Use `AirportID` for comparisons across time and `AirportSeqID` for historical coordinate joins. Do not join solely on IATA codes or restrict the metadata to its latest versions.

## Metrics and summaries

`scheduled_flights` counts all reported records. `eligible_arrivals` includes only noncancelled, nondiverted flights with observed `ArrDelay`; eligible flights with `ArrDelay >= 15` count as `delayed_arrivals`. Arrival delay rate is `delayed_arrivals / eligible_arrivals`. Cancellation and diversion rates use `cancelled_flights / scheduled_flights` and `diverted_flights / scheduled_flights`, respectively. Rates with zero denominators remain missing. `missing_arrival_delay` counts noncancelled, nondiverted flights with missing arrival delay.

Cause fields preserve source nulls instead of treating unreported values as zero. Summaries include each cause's `*_minutes`, `*_observations`, and `*_share`, as well as `cause_complete_flights`, `cause_observed_flights`, `cause_partial_flights`, and `delayed_cause_missing`. If a category has no observations, its minutes and share remain missing; observed zero minutes remain zero. Shares use the sum of **reported minutes across all five categories** as the denominator and remain missing when that total is zero. Show completeness counts when interpreting partially observed attribution. `WeatherDelay` does not capture every weather effect because NAS can also include weather.

`CauseComplete` only checks that all five fields are nonnull; it does not guarantee that their total equals `ArrDelay`. The current dataset has 14 delayed flights with zero minutes in all five categories. Their original values are retained: they count toward delay rates but contribute no reported cause minutes. One noncancelled, nondiverted flight has missing `ArrDelay`; it remains in the scheduled count and is excluded from the eligible-arrival denominator.

Summary grains:

- `national.csv`: full-year national totals.
- `monthly.csv`: month.
- `airline_month.csv`: month × reporting airline.
- `airport_month_airline.csv`: month × reporting airline × origin airport.
- `route_month_airline.csv`: month × reporting airline × directed airport pair.
- `temporal/2025-MM.csv`: monthly partitions by reporting airline × origin airport × weekday × scheduled departure hour.
- `airport_annual.csv`, `airline_annual.csv`, and `route_annual.csv`: annual exploratory comparisons.

These tables support month, airline, and origin-airport filtering for the five proposed views. Airport reliability describes **arrival outcomes of flights departing from that airport**. Low-volume airports and routes remain in the files. Exploratory rankings use a minimum of 10,000 annual departures per airport and 1,000 flights per route; the interface can make those thresholds adjustable. Inspect `eligible_arrivals` as well as scheduled volume when comparing delay rates.

After filtering, sum numerators and denominators before recomputing rates; do not average existing percentages. Likewise, recompute cause shares from pooled minutes and observation counts. An ordinary groupby sum can turn entirely missing values into zero; use `*_observations == 0` to restore the missing-value meaning. Filters on dimensions absent from the summaries, such as an individual date, tail number, or cancellation reason, require a new aggregation from Parquet.

```python
import pandas as pd

# Load one month without holding all source columns for the full year in memory.
flights = pd.read_parquet('data/processed/flights_2025_01.parquet')
summary = pd.read_csv('data/summaries/airport_month_airline.csv')
selected = summary[(summary['Month'] == 1) & (summary['Origin'] == 'ORD')]
n = selected['delayed_arrivals'].sum()
d = selected['eligible_arrivals'].sum()
rate = n / d if d else None
```

These results support descriptive exploration, not causal claims about congestion, weather, or airline behavior. Acquisition and preparation cover the Week 3 data tasks. The D3 static dashboard is integrated in `site/`; linked month, airline, and airport filters remain planned. See [the interim check](../docs/interim-check.md) for current views and separate interface validation.

## Website publishing snapshot

After full-year verification, run `uv run --locked python scripts/export_site_data.py`.
The exporter checks summary counts and rates, processes the twelve Parquet partitions
one month at a time, and writes compact publication files to `site/data/`.
Their `manifest.json` records input SHA-256 hashes, output hashes, row counts, and coverage.
Do not edit these CSVs manually. The original large datasets and full analytical
summaries remain local; the small website snapshot is tracked for reproducible viewing.

City nodes pool airports with the same BTS city name (including state). Rates are
recomputed from pooled counts. Coordinates are departure-weighted means of historical
airport coordinates joined by `AirportSeqID`; they are representative airport locations,
not geographic city centers. City-pair edges combine both directions and omit within-city
flights only from the edge layer. Those flights still contribute to city and national totals.
The full city-pair export precedes the map's projection and top-220 display filter.
Albers USA omits some territories; the page reports projected versus total cities.
