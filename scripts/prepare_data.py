"""Reproducible Week 3 preparation. Run from any directory; raw ZIPs are immutable."""
from pathlib import Path
import argparse
import json
import zipfile
import pandas as pd
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
CAUSES = ['CarrierDelay', 'WeatherDelay', 'NASDelay', 'SecurityDelay', 'LateAircraftDelay']
STRINGS = ['Reporting_Airline','Flight_Number_Reporting_Airline','Tail_Number',
           'Origin','OriginCityName','OriginState','Dest','DestCityName','DestState','CancellationCode']
IDS = ['DOT_ID_Reporting_Airline','OriginAirportID','OriginAirportSeqID','DestAirportID','DestAirportSeqID']
NUMERIC = ['Month','DayOfWeek','CRSDepTime','CRSArrTime','DepDelay','ArrDelay','ArrDel15',
           'Cancelled','Diverted','Distance'] + IDS + CAUSES
COLUMNS = ['FlightDate'] + STRINGS + NUMERIC
KEY = ['FlightDate','Reporting_Airline','Flight_Number_Reporting_Airline',
       'OriginAirportID','DestAirportID','CRSDepTime']
COUNTS = ['scheduled_flights','eligible_arrivals','delayed_arrivals','cancelled_flights',
          'diverted_flights','missing_arrival_delay','cause_complete_flights',
          'delayed_cause_missing','cause_observed_flights','cause_partial_flights']
MEASURES = COUNTS + [c+'_minutes' for c in CAUSES] + [c+'_observations' for c in CAUSES]
GROUPS = {
    'monthly':['Month'],
    'airport_month_airline':['Month','Reporting_Airline','OriginAirportID','Origin'],
    'airline_month':['Month','Reporting_Airline'],
    'route_month_airline':['Month','Reporting_Airline','OriginAirportID','Origin','DestAirportID','Dest'],
    'temporal_month_airline_airport':['Month','Reporting_Airline','OriginAirportID','Origin','Weekday','ScheduledDepHour'],
}

def read_zip(path, **kwargs):
    with zipfile.ZipFile(path) as z:
        names = [n for n in z.namelist() if n.lower().endswith('.csv')]
        assert len(names) == 1, names
        with z.open(names[0]) as stream:
            return pd.read_csv(stream, **kwargs)

def clean(frame):
    df = frame.copy()
    for name in STRINGS:
        df[name] = df[name].astype('string').str.strip().replace('', pd.NA)
    df['FlightDate'] = pd.to_datetime(df['FlightDate'], errors='raise')
    for name in NUMERIC:
        df[name] = pd.to_numeric(df[name], errors='raise')
    assert df['Cancelled'].isin([0,1]).all()
    assert df['Diverted'].isin([0,1]).all()
    assert not ((df['Cancelled']==1)&(df['Diverted']==1)).any()
    assert (df['Month'] == df['FlightDate'].dt.month).all()
    assert (df['DayOfWeek'] == df['FlightDate'].dt.dayofweek+1).all()
    assert df[IDS].notna().all().all()
    assert (df['Distance'].dropna() >= 0).all()
    assert (df[CAUSES].stack().dropna() >= 0).all()
    df['Month'] = df['FlightDate'].dt.month.astype('Int8')
    df['Weekday'] = (df['FlightDate'].dt.dayofweek+1).astype('Int8')
    times = df['CRSDepTime']
    valid = ((times.between(0,2359)&(times%100 < 60)&(times%1==0)) | (times==2400))
    df['ScheduledDepHour'] = ((times//100)%24).where(valid).astype('Int8')
    df['Route'] = df['Origin'] + '→' + df['Dest']
    df['ArrivalEligible'] = (df['Cancelled']==0)&(df['Diverted']==0)&df['ArrDelay'].notna()
    df['ArrivalDelayed15'] = (df['ArrDelay']>=15).astype('boolean').where(df['ArrivalEligible'])
    df['CauseComplete'] = df[CAUSES].notna().all(axis=1)
    df['CauseAnyObserved'] = df[CAUSES].notna().any(axis=1)
    for name in IDS:
        df[name] = df[name].astype('Int32')
    for name in ['DayOfWeek','Cancelled','Diverted','ArrDel15']:
        df[name] = df[name].astype('Int8')
    for name in ['CRSDepTime','CRSArrTime']:
        df[name] = df[name].astype('Int16')
    for name in ['DepDelay','ArrDelay','Distance']+CAUSES:
        df[name] = df[name].astype('Float64')
    return df

def measures(df):
    out = df.copy()
    out['scheduled_flights'] = 1
    out['eligible_arrivals'] = df['ArrivalEligible'].astype('int64')
    out['delayed_arrivals'] = df['ArrivalDelayed15'].fillna(False).astype('int64')
    out['cancelled_flights'] = df['Cancelled'].astype('int64')
    out['diverted_flights'] = df['Diverted'].astype('int64')
    out['missing_arrival_delay'] = ((df['Cancelled']==0)&(df['Diverted']==0)&df['ArrDelay'].isna()).astype('int64')
    out['cause_complete_flights'] = df['CauseComplete'].astype('int64')
    out['delayed_cause_missing'] = (df['ArrivalDelayed15'].fillna(False)&~df['CauseComplete']).astype('int64')
    out['cause_observed_flights'] = df['CauseAnyObserved'].astype('int64')
    out['cause_partial_flights'] = (df['CauseAnyObserved']&~df['CauseComplete']).astype('int64')
    for c in CAUSES:
        # A zero sum with zero observations is flagged as unobserved by rates().
        out[c+'_minutes'] = df[c].fillna(0)
        out[c+'_observations'] = df[c].notna().astype('int64')
    return out

def rates(table):
    table = table.copy()
    for name in COUNTS + [c+'_observations' for c in CAUSES]:
        table[name] = table[name].astype('Int64')
    table['arrival_delay_rate'] = table['delayed_arrivals']/table['eligible_arrivals'].replace(0,np.nan)
    table['cancellation_rate'] = table['cancelled_flights']/table['scheduled_flights'].replace(0,np.nan)
    table['diversion_rate'] = table['diverted_flights']/table['scheduled_flights'].replace(0,np.nan)
    total = table[[c+'_minutes' for c in CAUSES]].sum(axis=1)
    table['reported_cause_minutes'] = total.where(table['cause_observed_flights']>0)
    for c in CAUSES:
        table[c+'_minutes'] = table[c+'_minutes'].where(table[c+'_observations']>0)
        table[c+'_share'] = table[c+'_minutes']/total.replace(0,np.nan)
    return table

def write_csv(df, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(path,index=False)

def airport_table():
    df = read_zip(ROOT/'data/raw/airports/master_coordinate.zip')
    df.columns = df.columns.str.strip()
    df = df.loc[:,~df.columns.str.startswith('Unnamed:')]
    assert df['AIRPORT_SEQ_ID'].notna().all()
    assert df['AIRPORT_SEQ_ID'].is_unique, 'AirportSeqID is not unique; do not join'
    for c in ['AIRPORT_START_DATE','AIRPORT_THRU_DATE']:
        df[c] = pd.to_datetime(df[c],format='%m/%d/%Y %I:%M:%S %p',errors='raise')
    return df

def main(months):
    airport = airport_table()
    coordinate_ok = airport['LATITUDE'].between(-90,90)&airport['LONGITUDE'].between(-180,180)
    summaries = {name:[] for name in GROUPS}
    audits, unmatched, observed_airports = [], [], set()
    for month in months:
        path = ROOT/f'data/raw/flights/2025-{month:02}.zip'
        raw = read_zip(path,usecols=COLUMNS,dtype={c:'string' for c in STRINGS})
        duplicate_rows = int(raw.duplicated().sum())
        df = clean(raw)
        assert (df['FlightDate'].dt.year==2025).all()
        assert (df['Month']==month).all()
        audit = {'month':month,'raw_rows':len(raw),'cleaned_rows':len(df),
                 'duplicates_selected_columns':duplicate_rows,
                 'duplicate_flight_key_excess':int(df.duplicated(KEY).sum()),
                 'invalid_scheduled_departure_time':int(df['ScheduledDepHour'].isna().sum()),
                 'scheduled_2400':int((df['CRSDepTime']==2400).sum()),
                 'date_min':str(df['FlightDate'].min().date()),'date_max':str(df['FlightDate'].max().date()),
                 'distinct_dates':int(df['FlightDate'].nunique()),
                 'missing_by_column':{c:int(df[c].isna().sum()) for c in COLUMNS},
                 'arrdel15_disagreement':int((df.loc[df.ArrivalEligible,'ArrDel15'] != df.loc[df.ArrivalEligible,'ArrivalDelayed15'].astype('Int8')).fillna(False).sum()),
                 'arrdel15_missing_eligible':int(df.loc[df.ArrivalEligible,'ArrDel15'].isna().sum()),
                 'cause_sum_disagrees_arrdelay':int((df.CauseComplete & df.ArrivalEligible & ((df[CAUSES].sum(axis=1)-df.ArrDelay).abs()>0.01)).sum())}
        for role in ['Origin','Dest']:
            seq = role+'AirportSeqID'
            observed_airports.update(df[seq].unique().tolist())
            joined = df[[seq,role+'AirportID',role,'FlightDate']].merge(airport,left_on=seq,right_on='AIRPORT_SEQ_ID',how='left',validate='many_to_one',indicator=True)
            assert len(joined)==len(df)
            missing = joined['_merge']!='both'
            badcoord = ~(joined.LATITUDE.between(-90,90)&joined.LONGITUDE.between(-180,180))
            out_of_validity = (~missing)&((joined.FlightDate<joined.AIRPORT_START_DATE)|(joined.FlightDate>joined.AIRPORT_THRU_DATE))
            audit[role.lower()+'_unmatched_rows'] = int(missing.sum())
            audit[role.lower()+'_invalid_coordinate_rows'] = int(badcoord.sum())
            audit[role.lower()+'_outside_validity_rows'] = int(out_of_validity.sum())
            audit[role.lower()+'_airport_id_mismatch'] = int((~missing&(joined[role+'AirportID']!=joined.AIRPORT_ID)).sum())
            audit[role.lower()+'_airport_code_mismatch'] = int((~missing&(joined[role]!=joined.AIRPORT)).sum())
            issues = joined.loc[missing|badcoord|out_of_validity,[seq,role,'FlightDate']].copy()
            if len(issues):
                issues.columns = ['AirportSeqID','Airport','FlightDate']
                issues['role']=role
                issues['month']=month
                issues['unmatched']=missing[missing|badcoord|out_of_validity].to_numpy()
                issues['invalid_coordinate']=badcoord[missing|badcoord|out_of_validity].to_numpy()
                issues['outside_validity']=out_of_validity[missing|badcoord|out_of_validity].to_numpy()
                unmatched.append(issues)
        if audit['duplicate_flight_key_excess']:
            write_csv(df.loc[df.duplicated(KEY,keep=False)],ROOT/f'reports/duplicate_candidates_{month:02}.csv')
        processed = ROOT/f'data/processed/flights_2025_{month:02}.parquet'
        processed.parent.mkdir(parents=True,exist_ok=True)
        df.to_parquet(processed,index=False,compression='zstd')
        m = measures(df)
        for name,dims in GROUPS.items():
            grouped = m.groupby(dims,dropna=False,observed=True)[MEASURES].sum().reset_index()
            assert int(grouped.scheduled_flights.sum())==len(df)
            assert int(grouped.eligible_arrivals.sum())==int(df.ArrivalEligible.sum())
            if name.startswith('temporal'):
                write_csv(rates(grouped),ROOT/f'data/summaries/temporal/2025-{month:02}.csv')
            else:
                summaries[name].append(grouped)
        audits.append(audit)
        print(f'Processed {month:02}: {len(df):,} flights; duplicates={duplicate_rows}; coordinate misses={audit["origin_unmatched_rows"]+audit["dest_unmatched_rows"]}',flush=True)
    combined = {}
    for name,frames in summaries.items():
        if frames:
            combined[name] = pd.concat(frames,ignore_index=True)
            write_csv(rates(combined[name]),ROOT/f'data/summaries/{name}.csv')
    for name,source,dims in [('airport_annual','airport_month_airline',['OriginAirportID','Origin']),
                             ('airline_annual','airline_month',['Reporting_Airline']),
                             ('route_annual','route_month_airline',['OriginAirportID','Origin','DestAirportID','Dest'])]:
        annual=combined[source].groupby(dims,dropna=False)[MEASURES].sum().reset_index()
        write_csv(rates(annual),ROOT/f'data/summaries/{name}.csv')
    subset = airport[airport.AIRPORT_SEQ_ID.isin(observed_airports)].sort_values('AIRPORT_SEQ_ID')
    write_csv(subset,ROOT/'data/processed/airports.csv')
    write_csv(pd.concat(unmatched,ignore_index=True) if unmatched else pd.DataFrame(columns=['AirportSeqID','Airport','FlightDate','role','month','unmatched','invalid_coordinate','outside_validity']),ROOT/'reports/coordinate_issues.csv')
    quality = dict(year=2025,months=months,complete_year=months==list(range(1,13)),
                   raw_rows=sum(a['raw_rows'] for a in audits),cleaned_rows=sum(a['cleaned_rows'] for a in audits),
                   airport_master_rows=len(airport),airport_master_invalid_coordinates=int((~coordinate_ok).sum()),
                   used_airport_sequence_ids=len(observed_airports),matched_airport_sequence_ids=len(subset),
                   used_airport_ids=int(subset.AIRPORT_ID.nunique()),
                   raw_columns_retained=len(COLUMNS),cleaned_columns=len(df.columns),monthly=audits)
    (ROOT/'reports/quality_report.json').write_text(json.dumps(quality,indent=2)+'\n')
    (ROOT/'reports/cleaned_schema.json').write_text(json.dumps({c:str(t) for c,t in df.dtypes.items()},indent=2)+'\n')
    totals = combined['monthly'][MEASURES].sum().to_frame().T
    write_csv(rates(totals),ROOT/'data/summaries/national.csv')

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--months',type=int,nargs='+',default=list(range(1,13)))
    args=parser.parse_args()
    assert args.months==sorted(set(args.months)) and all(1<=m<=12 for m in args.months)
    main(args.months)
