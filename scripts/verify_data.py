"""Independently reconcile saved outputs and raw January counts; fail on drift."""
import csv
import hashlib
import io
import json
from pathlib import Path
import zipfile
import pandas as pd
import pyarrow.parquet as pq

ROOT=Path(__file__).resolve().parents[1]

def main():
    quality=json.loads((ROOT/'reports/quality_report.json').read_text())
    assert quality['complete_year'] and quality['months']==list(range(1,13))
    manifest=json.loads((ROOT/'data/raw/flights_manifest.json').read_text())
    assert len(manifest)==12
    for record in manifest:
        path=ROOT/record['file']
        assert hashlib.sha256(path.read_bytes()).hexdigest()==record['sha256']
    ap=json.loads((ROOT/'data/raw/airports/manifest.json').read_text())
    assert hashlib.sha256((ROOT/ap['file']).read_bytes()).hexdigest()==ap['sha256']
    monthly=pd.read_csv(ROOT/'data/summaries/monthly.csv').set_index('Month')
    for month in range(1,13):
        path=ROOT/f'data/processed/flights_2025_{month:02}.parquet'
        saved=pd.read_parquet(path,columns=['FlightDate','Cancelled','Diverted','ArrDelay'])
        assert pq.ParquetFile(path).metadata.num_rows==monthly.loc[month,'scheduled_flights']
        eligible=saved.Cancelled.eq(0)&saved.Diverted.eq(0)&saved.ArrDelay.notna()
        assert eligible.sum()==monthly.loc[month,'eligible_arrivals']
        assert (eligible&saved.ArrDelay.ge(15)).sum()==monthly.loc[month,'delayed_arrivals']
        assert saved.Cancelled.eq(1).sum()==monthly.loc[month,'cancelled_flights']
        assert saved.Diverted.eq(1).sum()==monthly.loc[month,'diverted_flights']
        assert saved.FlightDate.nunique()==pd.Period(f'2025-{month:02}').days_in_month
        temporal=pd.read_csv(ROOT/f'data/summaries/temporal/2025-{month:02}.csv')
        for count in ['scheduled_flights','eligible_arrivals','delayed_arrivals','cancelled_flights','diverted_flights']:
            assert temporal[count].sum()==monthly.loc[month,count]
    national=pd.read_csv(ROOT/'data/summaries/national.csv').iloc[0]
    for name in ['airport_annual','airline_annual','route_annual','airport_month_airline','airline_month','route_month_airline','monthly']:
        table=pd.read_csv(ROOT/f'data/summaries/{name}.csv')
        for count in ['scheduled_flights','eligible_arrivals','delayed_arrivals','cancelled_flights','diverted_flights']:
            assert table[count].sum()==national[count],(name,count)
        expected=table.delayed_arrivals/table.eligible_arrivals.replace(0,float('nan'))
        assert ((table.arrival_delay_rate-expected).abs().dropna()<1e-12).all()
    # Independent parser over raw data, without importing the preparation module.
    raw_counts=dict(scheduled_flights=0,eligible_arrivals=0,delayed_arrivals=0,cancelled_flights=0,diverted_flights=0)
    with zipfile.ZipFile(ROOT/'data/raw/flights/2025-01.zip') as z:
        name=next(n for n in z.namelist() if n.endswith('.csv'))
        for row in csv.DictReader(io.TextIOWrapper(z.open(name),encoding='utf-8-sig')):
            raw_counts['scheduled_flights']+=1
            cancelled=float(row['Cancelled'])==1
            diverted=float(row['Diverted'])==1
            eligible=not cancelled and not diverted and row['ArrDelay'].strip()!=''
            raw_counts['cancelled_flights']+=cancelled
            raw_counts['diverted_flights']+=diverted
            raw_counts['eligible_arrivals']+=eligible
            raw_counts['delayed_arrivals']+=eligible and float(row['ArrDelay'])>=15
    for field,value in raw_counts.items():
        assert value==monthly.loc[1,field],(field,value)
    result=dict(full_year_verified=True,raw_zip_checksums_verified=12,airport_checksum_verified=True,
                parquet_partitions_verified=12,summary_count_reconciliation=True,
                raw_january_independent_counts=raw_counts,total_rows=int(national.scheduled_flights))
    (ROOT/'reports/verification.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2))

if __name__=='__main__': main()
