"""Write measured Week 3 findings after complete-year verification."""
from pathlib import Path
import json
import pandas as pd

ROOT=Path(__file__).resolve().parents[1]

def export_anomalies():
    causes=['CarrierDelay','WeatherDelay','NASDelay','SecurityDelay','LateAircraftDelay']
    cols=['FlightDate','Reporting_Airline','Flight_Number_Reporting_Airline','Origin','Dest',
          'CRSDepTime','Cancelled','Diverted','ArrDelay']+causes
    frames=[]
    for path in sorted((ROOT/'data/processed').glob('flights_2025_*.parquet')):
        df=pd.read_parquet(path,columns=cols)
        completed=df.Cancelled.eq(0)&df.Diverted.eq(0)
        difference=df[causes].sum(axis=1,min_count=5)-df.ArrDelay
        df['cause_sum_mismatch']=completed&difference.abs().gt(0.01).fillna(False)
        df['completed_missing_arrival_delay']=completed&df.ArrDelay.isna()
        df['scheduled_midnight_2400']=df.CRSDepTime.eq(2400)
        selected=df.cause_sum_mismatch|df.completed_missing_arrival_delay|df.scheduled_midnight_2400
        part=df.loc[selected].copy()
        part['cause_minus_arrdelay']=difference.loc[selected]
        frames.append(part)
    anomalies=pd.concat(frames,ignore_index=True)
    anomalies.to_csv(ROOT/'reports/flight_anomalies.csv',index=False)
    return anomalies

def main():
    q=json.loads((ROOT/'reports/quality_report.json').read_text())
    v=json.loads((ROOT/'reports/verification.json').read_text())
    assert q['complete_year'] and v['full_year_verified'] and q['cleaned_rows']==v['total_rows']
    read=lambda name:pd.read_csv(ROOT/f'data/summaries/{name}.csv')
    n=read('national').iloc[0]
    monthly=read('monthly')
    airports=read('airport_annual')
    airlines=read('airline_annual')
    routes=read('route_annual')
    ms=q['monthly']
    total=lambda key:sum(m[key] for m in ms)
    anomalies=export_anomalies()
    assert anomalies.cause_sum_mismatch.sum()==total('cause_sum_disagrees_arrdelay')
    assert anomalies.completed_missing_arrival_delay.sum()==n.missing_arrival_delay
    assert anomalies.scheduled_midnight_2400.sum()==total('scheduled_2400')
    missing={c:sum(m['missing_by_column'][c] for m in ms) for c in ms[0]['missing_by_column']}
    raw_size=sum(p.stat().st_size for p in (ROOT/'data/raw').rglob('*.zip'))
    parquet_size=sum(p.stat().st_size for p in (ROOT/'data/processed').glob('*.parquet'))
    summary_size=sum(p.stat().st_size for p in (ROOT/'data/summaries').rglob('*.csv'))
    lines=['# Week 3 Data Quality and Exploratory Findings','',
           'Coverage: BTS Reporting Carrier On-Time Performance, 2025-01-01 through 2025-12-31. All figures below are descriptive results computed from the downloaded data.','',
           '## Deliverables','',
           f'- All twelve monthly source ZIPs have been downloaded and verified: {q["raw_rows"]:,} reported records, with {q["cleaned_rows"]:,} retained after cleaning.',
           f'- The monthly Parquet files retain {q["raw_columns_retained"]} source fields and add 7 derived fields, for {q["cleaned_columns"]} columns in total.',
           f'- Coverage includes {q["used_airport_ids"]} airports, {q["used_airport_sequence_ids"]} airport sequence versions, {len(airlines)} reporting airlines, and {len(routes):,} directed airport routes.',
           f'- Source ZIPs occupy {raw_size/1024**2:.1f} MiB; flight Parquet files occupy {parquet_size/1024**2:.1f} MiB; summary CSVs occupy {summary_size/1024**2:.1f} MiB.','',
           '## Quality checks','',
           '- Dates cover all 365 days. Record months match their source partitions, and reported weekdays match the flight dates.',
           f'- Duplicate rows across selected source columns: {total("duplicates_selected_columns"):,}; excess records sharing the candidate flight key: {total("duplicate_flight_key_excess"):,}. Records are retained rather than automatically deduplicated.',
           f'- Invalid scheduled departure times: {total("invalid_scheduled_departure_time"):,}; scheduled time 2400: {total("scheduled_2400"):,}.',
           f'- Arrival delay is missing in {missing["ArrDelay"]:,} records, including {int(n.missing_arrival_delay):,} noncancelled, nondiverted flights. The latter are excluded from the arrival-delay denominator.',
           f'- Missing tail numbers: {missing["Tail_Number"]:,}; missing cancellation codes: {missing["CancellationCode"]:,}. A missing cancellation code is expected for a flight that was not cancelled.',
           f'- Disagreements between source `ArrDel15` and the recomputed indicator among eligible arrivals: {total("arrdel15_disagreement"):,}; missing source `ArrDel15` among eligible arrivals: {total("arrdel15_missing_eligible"):,}.',
           f'- Records with all five cause fields observed: {int(n.cause_complete_flights):,}; partially observed cause fields: {int(n.cause_partial_flights):,}; delayed arrivals without all cause fields observed: {int(n.delayed_cause_missing):,}.',
           f'- Eligible arrivals with all cause fields observed but a cause-minute sum inconsistent with ArrDelay: {total("cause_sum_disagrees_arrdelay"):,}.','',
           'Missing cause-field counts (not replaced with zero):','']
    for c in ['CarrierDelay','WeatherDelay','NASDelay','SecurityDelay','LateAircraftDelay']:
        lines.append(f'- `{c}`: {missing[c]:,} records.')
    mismatches=anomalies[anomalies.cause_sum_mismatch]
    if len(mismatches):
        cause_cols=['CarrierDelay','WeatherDelay','NASDelay','SecurityDelay','LateAircraftDelay']
        zero_count=int(mismatches[cause_cols].eq(0).all(axis=1).sum())
        lines += ['',f'Among the cause-total inconsistencies, {zero_count} records report zero in all five cause fields. Affected airline codes: '+', '.join(sorted(mismatches.Reporting_Airline.unique()))+'. Those zero-cause records still count toward delay rates but contribute no reported cause minutes. `CauseComplete` means that all five fields are nonnull; it does not guarantee complete minute attribution.',
                  '', 'Original anomaly values, missing arrival delays, and scheduled times of 2400 are listed in [flight_anomalies.csv](flight_anomalies.csv). No speculative corrections were applied.']
    lines += ['','## Airport coordinate validation','',
              f'The BTS Master Coordinate export contains {q["airport_master_rows"]:,} rows. `AIRPORT_SEQ_ID` is unique and nonnull. Of the {q["used_airport_sequence_ids"]} sequence versions used by flights, {q["matched_airport_sequence_ids"]} were matched.', '']
    for role,label in [('origin','Origin'),('dest','Destination')]:
        lines.append(f'- {label}: {total(role+"_unmatched_rows"):,} unmatched records; {total(role+"_invalid_coordinate_rows"):,} missing/out-of-range coordinates; {total(role+"_outside_validity_rows"):,} records outside validity dates; airport ID/code mismatches: {total(role+"_airport_id_mismatch"):,}/{total(role+"_airport_code_mismatch"):,}.')
    lines += [f'- The complete historical airport table contains {q["airport_master_invalid_coordinates"]} row with missing/out-of-range coordinates. Its impact on this project is determined by the flight-level join checks above.',
              '- Both endpoint joins enforce many-to-one cardinality and preserve flight row counts. Details are in [coordinate_issues.csv](coordinate_issues.csv).','',
              '## Exploratory findings','',
              f'Nationally, {int(n.eligible_arrivals):,} eligible arrivals include {int(n.delayed_arrivals):,} flights arriving at least 15 minutes late, an arrival delay rate of **{n.arrival_delay_rate:.2%}**. There were {int(n.cancelled_flights):,} cancellations, a cancellation rate of **{n.cancellation_rate:.2%}**, and {int(n.diverted_flights):,} diversions, a diversion rate of **{n.diversion_rate:.2%}**. Cancellation and diversion rates both use all {int(n.scheduled_flights):,} reported records as their denominator.','',
              'Monthly comparisons:','']
    for _,r in monthly.iterrows():
        lines.append(f'- Month {int(r.Month):02}: {int(r.scheduled_flights):,} flights; {int(r.eligible_arrivals):,} eligible arrivals; delay rate {r.arrival_delay_rate:.2%}; cancellation rate {r.cancellation_rate:.2%}.')
    lines += ['','Airport comparisons describe arrival outcomes of departing flights and include only airports with at least 10,000 annual departures:','']
    busy=airports[airports.scheduled_flights>=10000].dropna(subset=['arrival_delay_rate'])
    for label,frame in [('Highest delay rates',busy.nlargest(3,'arrival_delay_rate')),('Lowest delay rates',busy.nsmallest(3,'arrival_delay_rate'))]:
        lines.append(f'- {label}: '+'; '.join(f'{r.Origin} {r.arrival_delay_rate:.2%} ({int(r.eligible_arrivals):,} eligible arrivals / {int(r.scheduled_flights):,} total flights)' for r in frame.itertuples())+'.')
    lines += ['','Busy directed-route comparisons include only routes with at least 1,000 annual flights:','']
    busy_routes=routes[routes.scheduled_flights>=1000].dropna(subset=['arrival_delay_rate'])
    for label,frame in [('Highest delay rates',busy_routes.nlargest(3,'arrival_delay_rate')),('Lowest delay rates',busy_routes.nsmallest(3,'arrival_delay_rate'))]:
        lines.append(f'- {label}: '+'; '.join(f'{r.Origin} → {r.Dest} {r.arrival_delay_rate:.2%} ({int(r.eligible_arrivals):,} eligible arrivals / {int(r.scheduled_flights):,} total flights)' for r in frame.itertuples())+'.')
    lines += ['','Airline comparisons, ordered by flight volume (codes identify reporting airlines):','']
    for r in airlines.sort_values('scheduled_flights',ascending=False).itertuples():
        lines.append(f'- {r.Reporting_Airline}: {int(r.scheduled_flights):,} flights; {int(r.eligible_arrivals):,} eligible arrivals; delay rate {r.arrival_delay_rate:.2%}; cancellation rate {r.cancellation_rate:.2%}.')
    lines += ['','National composition of reported delay-cause minutes:','']
    for c in ['CarrierDelay','WeatherDelay','NASDelay','SecurityDelay','LateAircraftDelay']:
        lines.append(f'- `{c}`: {n[c+"_minutes"]:,.0f} minutes, representing {n[c+"_share"]:.2%}.')
    lines += ['','## Verification and limitations','',
              '- Metric boundary tests passed. Flight counts, eligible arrivals, delayed arrivals, cancellations, and diversions reconcile between all twelve Parquet partitions and the summary tables.',
              '- Five January counts were independently recomputed directly from the raw CSV using the Python standard library and matched the prepared results. SHA-256 checksums for the flight archives and airport export were verified.',
              '- Rankings identify directions for further visual exploration. They do not control for route composition, airport conditions, or seasonality and do not establish causality or stable small-sample rankings.',
              '- WeatherDelay is one reported attribution category; NAS can also include weather. Missing causes do not mean that no delay occurred. Cause shares describe the distribution of reported minutes.',
              '- Pool numerators and denominators before recomputing rates across groups. Complete summaries retain low-volume groups; displays should state their minimum-volume thresholds.',
              '- External weather integration and aircraft delay-propagation analysis remain outside this data preparation report. Website implementation and browser checks are documented separately in [the interim check](../docs/interim-check.md); data checks alone do not validate the interface.','',
              'Reproduction commands, metrics, field definitions, and file descriptions are in [data/README.md](../data/README.md). Machine-readable audits are in [quality_report.json](quality_report.json) and [verification.json](verification.json).',
              '', 'Sources: [BTS flight data](https://www.transtats.bts.gov/DL_SelectFields.aspx?QO_fu146_anzr=b0-gvzr&gnoyr_VQ=FGJ), [BTS airport coordinates](https://www.transtats.bts.gov/DL_SelectFields.aspx?QO_fu146_anzr=N8vn6v10+f722146+gnoyr5&gnoyr_VQ=FLL), and [BTS delay definitions and cause categories](https://www.bts.gov/explore-topics-and-geography/topics/airline-time-performance-and-causes-flight-delays).','']
    (ROOT/'reports/quality_report.md').write_text('\n'.join(lines))
    print(f'Wrote reports/quality_report.md for {q["cleaned_rows"]:,} flights')

if __name__=='__main__': main()
