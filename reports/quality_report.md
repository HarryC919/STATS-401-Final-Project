# Week 3 Data Quality and Exploratory Findings

Coverage: BTS Reporting Carrier On-Time Performance, 2025-01-01 through 2025-12-31. All figures below are descriptive results computed from the downloaded data.

## Deliverables

- All twelve monthly source ZIPs have been downloaded and verified: 7,001,619 reported records, with 7,001,619 retained after cleaning.
- The monthly Parquet files retain 31 source fields and add 7 derived fields, for 38 columns in total.
- Coverage includes 352 airports, 510 airport sequence versions, 14 reporting airlines, and 6,938 directed airport routes.
- Source ZIPs occupy 339.4 MiB; flight Parquet files occupy 92.1 MiB; summary CSVs occupy 111.5 MiB.

## Quality checks

- Dates cover all 365 days. Record months match their source partitions, and reported weekdays match the flight dates.
- Duplicate rows across selected source columns: 0; excess records sharing the candidate flight key: 0. Records are retained rather than automatically deduplicated.
- Invalid scheduled departure times: 0; scheduled time 2400: 1.
- Arrival delay is missing in 122,135 records, including 1 noncancelled, nondiverted flights. The latter are excluded from the arrival-delay denominator.
- Missing tail numbers: 12,501; missing cancellation codes: 6,898,743. A missing cancellation code is expected for a flight that was not cancelled.
- Disagreements between source `ArrDel15` and the recomputed indicator among eligible arrivals: 0; missing source `ArrDel15` among eligible arrivals: 0.
- Records with all five cause fields observed: 1,534,638; partially observed cause fields: 0; delayed arrivals without all cause fields observed: 0.
- Eligible arrivals with all cause fields observed but a cause-minute sum inconsistent with ArrDelay: 14.

Missing cause-field counts (not replaced with zero):

- `CarrierDelay`: 5,466,981 records.
- `WeatherDelay`: 5,466,981 records.
- `NASDelay`: 5,466,981 records.
- `SecurityDelay`: 5,466,981 records.
- `LateAircraftDelay`: 5,466,981 records.

Among the cause-total inconsistencies, 14 records report zero in all five cause fields. Affected airline codes: WN. Those zero-cause records still count toward delay rates but contribute no reported cause minutes. `CauseComplete` means that all five fields are nonnull; it does not guarantee complete minute attribution.

Original anomaly values, missing arrival delays, and scheduled times of 2400 are listed in [flight_anomalies.csv](flight_anomalies.csv). No speculative corrections were applied.

## Airport coordinate validation

The BTS Master Coordinate export contains 20,283 rows. `AIRPORT_SEQ_ID` is unique and nonnull. Of the 510 sequence versions used by flights, 510 were matched.

- Origin: 0 unmatched records; 0 missing/out-of-range coordinates; 0 records outside validity dates; airport ID/code mismatches: 0/0.
- Destination: 0 unmatched records; 0 missing/out-of-range coordinates; 0 records outside validity dates; airport ID/code mismatches: 0/0.
- The complete historical airport table contains 1 row with missing/out-of-range coordinates. Its impact on this project is determined by the flight-level join checks above.
- Both endpoint joins enforce many-to-one cardinality and preserve flight row counts. Details are in [coordinate_issues.csv](coordinate_issues.csv).

## Exploratory findings

Nationally, 6,879,484 eligible arrivals include 1,534,638 flights arriving at least 15 minutes late, an arrival delay rate of **22.31%**. There were 102,876 cancellations, a cancellation rate of **1.47%**, and 19,258 diversions, a diversion rate of **0.28%**. Cancellation and diversion rates both use all 7,001,619 reported records as their denominator.

Monthly comparisons:

- Month 01: 539,747 flights; 522,269 eligible arrivals; delay rate 18.79%; cancellation rate 3.02%.
- Month 02: 504,884 flights; 496,476 eligible arrivals; delay rate 20.77%; cancellation rate 1.47%.
- Month 03: 600,872 flights; 592,301 eligible arrivals; delay rate 19.59%; cancellation rate 1.15%.
- Month 04: 583,950 flights; 577,730 eligible arrivals; delay rate 19.66%; cancellation rate 0.84%.
- Month 05: 605,648 flights; 597,574 eligible arrivals; delay rate 23.60%; cancellation rate 1.05%.
- Month 06: 611,575 flights; 599,472 eligible arrivals; delay rate 28.26%; cancellation rate 1.59%.
- Month 07: 631,428 flights; 612,811 eligible arrivals; delay rate 28.89%; cancellation rate 2.45%.
- Month 08: 602,378 flights; 593,733 eligible arrivals; delay rate 22.56%; cancellation rate 1.08%.
- Month 09: 562,439 flights; 558,328 eligible arrivals; delay rate 16.63%; cancellation rate 0.51%.
- Month 10: 605,844 flights; 601,570 eligible arrivals; delay rate 20.32%; cancellation rate 0.53%.
- Month 11: 570,550 flights; 555,296 eligible arrivals; delay rate 20.56%; cancellation rate 2.49%.
- Month 12: 582,304 flights; 571,924 eligible arrivals; delay rate 26.77%; cancellation rate 1.55%.

Airport comparisons describe arrival outcomes of departing flights and include only airports with at least 10,000 annual departures:

- Highest delay rates: SFB 30.90% (10,420 eligible arrivals / 10,495 total flights); DFW 28.67% (306,185 eligible arrivals / 315,854 total flights); DCA 27.13% (136,684 eligible arrivals / 142,506 total flights).
- Lowest delay rates: KOA 12.37% (15,621 eligible arrivals / 15,796 total flights); LIH 13.55% (15,493 eligible arrivals / 15,664 total flights); LGB 13.70% (16,619 eligible arrivals / 16,724 total flights).

Busy directed-route comparisons include only routes with at least 1,000 annual flights:

- Highest delay rates: DCA → HPN 39.52% (1,250 eligible arrivals / 1,359 total flights); DFW → MSN 37.93% (1,065 eligible arrivals / 1,094 total flights); ASE → DFW 37.37% (1,081 eligible arrivals / 1,178 total flights).
- Lowest delay rates: SLC → SUN 4.48% (1,072 eligible arrivals / 1,086 total flights); TUS → SLC 4.98% (1,084 eligible arrivals / 1,087 total flights); PSP → SLC 5.12% (1,075 eligible arrivals / 1,078 total flights).

Airline comparisons, ordered by flight volume (codes identify reporting airlines):

- WN: 1,391,885 flights; 1,376,837 eligible arrivals; delay rate 21.40%; cancellation rate 0.85%.
- DL: 1,026,332 flights; 1,012,427 eligible arrivals; delay rate 19.79%; cancellation rate 1.08%.
- AA: 973,653 flights; 952,841 eligible arrivals; delay rate 25.71%; cancellation rate 1.82%.
- OO: 839,821 flights; 825,202 eligible arrivals; delay rate 20.72%; cancellation rate 1.41%.
- UA: 795,271 flights; 786,377 eligible arrivals; delay rate 21.47%; cancellation rate 0.82%.
- YX: 346,036 flights; 334,043 eligible arrivals; delay rate 21.51%; cancellation rate 3.26%.
- MQ: 299,322 flights; 291,835 eligible arrivals; delay rate 21.04%; cancellation rate 2.24%.
- OH: 248,735 flights; 236,682 eligible arrivals; delay rate 27.53%; cancellation rate 4.58%.
- AS: 245,588 flights; 241,927 eligible arrivals; delay rate 23.10%; cancellation rate 1.21%.
- B6: 231,413 flights; 226,703 eligible arrivals; delay rate 26.15%; cancellation rate 1.65%.
- F9: 198,065 flights; 194,192 eligible arrivals; delay rate 27.91%; cancellation rate 1.77%.
- NK: 194,515 flights; 191,191 eligible arrivals; delay rate 21.41%; cancellation rate 1.50%.
- G4: 130,899 flights; 129,892 eligible arrivals; delay rate 24.97%; cancellation rate 0.47%.
- HA: 80,084 flights; 79,335 eligible arrivals; delay rate 17.28%; cancellation rate 0.82%.

National composition of reported delay-cause minutes:

- `CarrierDelay`: 36,326,377 minutes, representing 32.45%.
- `WeatherDelay`: 7,108,714 minutes, representing 6.35%.
- `NASDelay`: 24,483,761 minutes, representing 21.87%.
- `SecurityDelay`: 152,802 minutes, representing 0.14%.
- `LateAircraftDelay`: 43,862,971 minutes, representing 39.19%.

## Verification and limitations

- Metric boundary tests passed. Flight counts, eligible arrivals, delayed arrivals, cancellations, and diversions reconcile between all twelve Parquet partitions and the summary tables.
- Five January counts were independently recomputed directly from the raw CSV using the Python standard library and matched the prepared results. SHA-256 checksums for the flight archives and airport export were verified.
- Rankings identify directions for further visual exploration. They do not control for route composition, airport conditions, or seasonality and do not establish causality or stable small-sample rankings.
- WeatherDelay is one reported attribution category; NAS can also include weather. Missing causes do not mean that no delay occurred. Cause shares describe the distribution of reported minutes.
- Pool numerators and denominators before recomputing rates across groups. Complete summaries retain low-volume groups; displays should state their minimum-volume thresholds.
- External weather integration and aircraft delay-propagation analysis remain outside this data preparation report. Website implementation and browser checks are documented separately in [the interim check](../docs/interim-check.md); data checks alone do not validate the interface.

Reproduction commands, metrics, field definitions, and file descriptions are in [data/README.md](../data/README.md). Machine-readable audits are in [quality_report.json](quality_report.json) and [verification.json](verification.json).

Sources: [BTS flight data](https://www.transtats.bts.gov/DL_SelectFields.aspx?QO_fu146_anzr=b0-gvzr&gnoyr_VQ=FGJ), [BTS airport coordinates](https://www.transtats.bts.gov/DL_SelectFields.aspx?QO_fu146_anzr=N8vn6v10+f722146+gnoyr5&gnoyr_VQ=FLL), and [BTS delay definitions and cause categories](https://www.bts.gov/explore-topics-and-geography/topics/airline-time-performance-and-causes-flight-delays).
