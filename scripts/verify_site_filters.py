"""Independent reconciliation of the filter-ready publication data (Batch A).

Recomputes expectations from the verified local summaries and the cleaned Parquet
baseline without importing scripts/export_site_data.py, then checks the delivered
site/data artifacts against them. Requires the verified twelve-month baseline
(data/summaries, data/processed), so this is a local check, not part of CI.
"""
from pathlib import Path
import hashlib
import json
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
COUNTS = ['scheduled_flights', 'eligible_arrivals', 'delayed_arrivals',
          'cancelled_flights', 'diverted_flights']
CAUSES = ['CarrierDelay', 'WeatherDelay', 'NASDelay', 'SecurityDelay', 'LateAircraftDelay']
ATTRIBUTION_COUNTS = ['missing_arrival_delay', 'cause_complete_flights', 'delayed_cause_missing',
                      'cause_observed_flights', 'cause_partial_flights']
FILTER_COLUMNS = (COUNTS + ATTRIBUTION_COUNTS
                  + [cause + '_minutes' for cause in CAUSES]
                  + [cause + '_observations' for cause in CAUSES])
SITE_RATES = ['arrival_delay_rate', 'cancellation_rate', 'diversion_rate']
CHECKS = 0


def pooled_counts(frame):
    return {count: int(frame[count].sum()) for count in COUNTS}


def parquet_counts(months, origin=None, airline=None):
    """Independent expectations from raw source fields of the cleaned baseline."""
    totals = dict.fromkeys(COUNTS, 0)
    for month in months:
        frame = pd.read_parquet(ROOT / f'data/processed/flights_2025_{month:02}.parquet',
                                columns=['Origin', 'Reporting_Airline', 'Cancelled', 'Diverted',
                                         'ArrDelay'])
        selected = pd.Series(True, index=frame.index)
        if origin is not None:
            selected &= frame.Origin.eq(origin)
        if airline is not None:
            selected &= frame.Reporting_Airline.eq(airline)
        eligible = selected & frame.Cancelled.eq(0) & frame.Diverted.eq(0) & frame.ArrDelay.notna()
        totals['scheduled_flights'] += int(selected.sum())
        totals['eligible_arrivals'] += int(eligible.sum())
        totals['delayed_arrivals'] += int((eligible & frame.ArrDelay.ge(15)).sum())
        totals['cancelled_flights'] += int((selected & frame.Cancelled.eq(1)).sum())
        totals['diverted_flights'] += int((selected & frame.Diverted.eq(1)).sum())
    return totals


def check(label, expected, actual):
    global CHECKS
    assert expected == actual, f'{label}: expected {expected}, got {actual}'
    CHECKS += 1
    print(f'  ok  {label}: {actual}')


def delay_rate_text(counts):
    denominator = counts['eligible_arrivals']
    if not denominator:
        return 'missing (zero eligible arrivals)'
    rate = counts['delayed_arrivals'] / denominator
    return f'{counts["delayed_arrivals"]:,}/{denominator:,} = {rate:.6f}'


def compare_full_key(source, exported, keys, columns, label):
    """Row-by-row: every source row appears exactly once in the export and vice
    versa, with identical values on all compared columns (missing == missing)."""
    assert not source.duplicated(keys).any(), f'{label}: duplicate keys in source'
    assert not exported.duplicated(keys).any(), f'{label}: duplicate keys in export'
    merged = source.merge(exported, on=keys, how='outer', suffixes=('_src', '_out'),
                          indicator=True)
    unmatched = merged.loc[merged._merge != 'both']
    assert unmatched.empty, (f'{label}: {len(unmatched)} rows not in both, first: '
                             f'{unmatched[keys].head(3).to_dict("records")}')
    for column in columns:
        left, right = merged[column + '_src'], merged[column + '_out']
        same = (left == right) | (left.isna() & right.isna())
        assert same.all(), f'{label}: column {column} differs in {int((~same).sum())} rows'
    return len(source)


def main():
    global CHECKS
    national = pd.read_csv(ROOT / 'data/summaries/national.csv').iloc[0]
    monthly = pd.read_csv(ROOT / 'data/summaries/monthly.csv').set_index('Month')
    airport_annual = pd.read_csv(ROOT / 'data/summaries/airport_annual.csv').set_index('Origin')
    route_summary = pd.read_csv(ROOT / 'data/summaries/route_month_airline.csv')
    temporal_source = {m: pd.read_csv(ROOT / f'data/summaries/temporal/2025-{m:02}.csv')
                       for m in range(1, 13)}

    site = ROOT / 'site/data'
    manifest = json.loads((site / 'manifest.json').read_text())
    filters = pd.read_csv(site / 'airport_month_airline.csv')
    airline_month = pd.read_csv(site / 'airline_month.csv')
    directory = pd.read_csv(site / 'airport_directory.csv')
    routes = {path.stem: pd.read_csv(path) for path in sorted((site / 'routes').glob('*.csv'))}
    temporal_out = {path.stem: pd.read_csv(path) for path in sorted((site / 'temporal').glob('*.csv'))}

    print('National restoration:')
    expected_national = {count: int(national[count]) for count in COUNTS}
    check('filter table pools to national', pooled_counts(filters), expected_national)
    check('airline_month pools to national', pooled_counts(airline_month), expected_national)
    minute_columns = [cause + '_minutes' for cause in CAUSES]
    pooled_airline = filters.groupby(['Month', 'Reporting_Airline'], sort=True)[
        COUNTS + [cause + '_observations' for cause in CAUSES] + minute_columns].sum().reset_index()
    for cause in CAUSES:
        # Grouped sums treat skipped NaN minutes as zero; restore missing semantics.
        pooled_airline.loc[pooled_airline[cause + '_observations'] == 0, cause + '_minutes'] = float('nan')
    merged = airline_month.merge(pooled_airline, on=['Month', 'Reporting_Airline'],
                                 suffixes=('', '_pooled'), validate='one_to_one')
    assert len(merged) == len(airline_month), 'airline_month has keys missing from the filter table'
    for column in COUNTS + [cause + '_observations' for cause in CAUSES]:
        assert (merged[column] == merged[column + '_pooled']).all(), column
    for cause in CAUSES:
        delivered = airline_month[cause + '_minutes']
        pooled = merged[cause + '_minutes_pooled']
        assert ((delivered == pooled) | (delivered.isna() & pooled.isna())).all(), cause
    CHECKS += 2 + len(COUNTS) + len(CAUSES)
    print(f'  ok  airline_month equals the pooled filter table '
          f'({len(airline_month)} month-airline rows)')

    print('Acceptance fixtures (independent expectations):')
    ord_rows = filters[filters.Origin == 'ORD']
    ord_annual = pooled_counts(ord_rows)
    check('ORD annual == airport_annual row', ord_annual,
          {count: int(airport_annual.loc['ORD', count]) for count in COUNTS})
    ord_january = pooled_counts(ord_rows[ord_rows.Month == 1])
    ord_temporal_january = temporal_source[1]
    ord_temporal_january = ord_temporal_january[ord_temporal_january.Origin == 'ORD']
    check('ORD January == pooled temporal 2025-01', ord_january, pooled_counts(ord_temporal_january))
    check('ORD January == independent parquet counts', ord_january, parquet_counts([1], origin='ORD'))
    ord_janfeb = pooled_counts(ord_rows[ord_rows.Month.isin([1, 2])])
    ord_temporal_janfeb = pd.concat([temporal_source[1], temporal_source[2]])
    ord_temporal_janfeb = ord_temporal_janfeb[ord_temporal_janfeb.Origin == 'ORD']
    check('ORD January-February == pooled temporal 2025-01+02', ord_janfeb,
          pooled_counts(ord_temporal_janfeb))
    check('ORD January-February == independent parquet counts', ord_janfeb,
          parquet_counts([1, 2], origin='ORD'))
    ord_ua = ord_rows[ord_rows.Reporting_Airline == 'UA']
    ord_ua_annual = pooled_counts(ord_ua)
    check('ORD+UA annual == independent parquet counts', ord_ua_annual,
          parquet_counts(range(1, 13), origin='ORD', airline='UA'))
    ord_ua_january = pooled_counts(ord_ua[ord_ua.Month == 1])
    check('ORD+UA January == independent parquet counts', ord_ua_january,
          parquet_counts([1], origin='ORD', airline='UA'))
    ord_ua_temporal = temporal_source[1]
    ord_ua_temporal = ord_ua_temporal[(ord_ua_temporal.Origin == 'ORD')
                                      & (ord_ua_temporal.Reporting_Airline == 'UA')]
    check('ORD+UA January == pooled temporal 2025-01', ord_ua_january, pooled_counts(ord_ua_temporal))

    print('Route partitions (directed, origin-partitioned):')
    origins = set(route_summary.Origin.unique())
    check('route partition files', len(routes), len(origins))
    assert set(routes) == origins, 'Route partitions and summary origins differ'
    expected_route_columns = ['Month', 'Reporting_Airline', 'DestAirportID', 'Dest'] + COUNTS
    for frame in routes.values():
        assert list(frame.columns) == expected_route_columns, 'unexpected route partition columns'
        assert not frame.duplicated(['Month', 'Reporting_Airline', 'DestAirportID', 'Dest']).any()
    check('route partition rows', sum(len(frame) for frame in routes.values()), len(route_summary))
    route_pooled = {count: int(sum(int(frame[count].sum()) for frame in routes.values()))
                    for count in COUNTS}
    check('route partitions pool to national', route_pooled, expected_national)
    busiest = route_summary.groupby(['Origin', 'Dest'], as_index=False)[COUNTS].sum()
    busiest = busiest.nlargest(3, 'scheduled_flights')
    for _, pair in busiest.iterrows():
        forward = routes[pair.Origin]
        forward = forward[forward.Dest == pair.Dest]
        summary_forward = route_summary[(route_summary.Origin == pair.Origin)
                                        & (route_summary.Dest == pair.Dest)]
        check(f'partition {pair.Origin}->{pair.Dest} matches its directed summary rows',
              pooled_counts(forward), pooled_counts(summary_forward))
        reverse = routes[pair.Dest]
        assert (reverse.Dest == pair.Origin).any(), f'{pair.Dest}->{pair.Origin} missing'
        check(f'partition {pair.Dest}->{pair.Origin} matches its directed summary rows',
              pooled_counts(reverse[reverse.Dest == pair.Origin]),
              pooled_counts(route_summary[(route_summary.Origin == pair.Dest)
                                          & (route_summary.Dest == pair.Origin)]))

    print('Temporal partitions (month-partitioned):')
    check('temporal partition files', len(temporal_out), 12)
    assert set(temporal_out) == {f'2025-{month:02}' for month in range(1, 13)}
    for month in range(1, 13):
        out = temporal_out[f'2025-{month:02}']
        check(f'temporal {month:02} pools to monthly.csv', pooled_counts(out),
              {count: int(monthly.loc[month, count]) for count in COUNTS})
        assert len(out) == len(temporal_source[month])
        assert out.Weekday.between(1, 7).all()
        assert out.ScheduledDepHour.dropna().between(0, 23).all()
    missing_out = sum(int(frame.ScheduledDepHour.isna().sum()) for frame in temporal_out.values())
    missing_source = sum(int(frame.ScheduledDepHour.isna().sum()) for frame in temporal_source.values())
    check('missing ScheduledDepHour rows preserved', missing_out, missing_source)

    print('Cause null semantics in the filter table:')
    for cause in CAUSES:
        minutes = filters[cause + '_minutes']
        observations = filters[cause + '_observations']
        assert (observations.eq(0) == minutes.isna()).all(), cause
        assert (minutes.dropna() >= 0).all(), cause
    CHECKS += 2 * len(CAUSES)
    print(f'  ok  minutes missing exactly where observations are zero, all {len(filters):,} rows')

    print('Airport directory:')
    metadata = pd.read_csv(ROOT / 'data/processed/airports.csv')
    check('directory rows equal metadata airports', len(directory), int(metadata.AIRPORT_ID.nunique()))
    assert directory.airport_id.is_unique
    assert set(directory.airport_id) == set(filters.OriginAirportID)
    assert set(directory.airport) == set(filters.Origin)
    assert directory.name.notna().all()
    assert directory.coordinate_versions.ge(1).all()
    assert directory.latitude.between(-90, 90).all() and directory.longitude.between(-180, 180).all()
    ord_directory = directory[directory.airport == 'ORD'].iloc[0]
    mdw_directory = directory[directory.airport == 'MDW'].iloc[0]
    assert ord_directory.city == 'Chicago, IL' and ord_directory.state == 'IL'
    assert mdw_directory.city == 'Chicago, IL' and mdw_directory.state == 'IL'
    assert ord_directory.airport_id != mdw_directory.airport_id, 'ORD and MDW must stay distinct'
    CHECKS += 8
    print(f'  ok  {len(directory)} airports; ORD id {ord_directory.airport_id} and '
          f'MDW id {mdw_directory.airport_id} are distinct Chicago airports; '
          f'ORD uses {int(ord_directory.coordinate_versions)} coordinate version(s)')

    print('Manifest integrity:')
    for name, entry in manifest['files'].items():
        data = (site / name).read_bytes()
        assert len(data) == entry['bytes'], name
        assert hashlib.sha256(data).hexdigest() == entry['sha256'], name
        assert len(pd.read_csv(site / name)) == entry['rows'], name
    for group in ['routes', 'temporal']:
        section = manifest['partitions'][group]
        for entry in section['files'].values():
            data = (site / entry['file']).read_bytes()
            assert len(data) == entry['bytes'], entry['file']
            assert hashlib.sha256(data).hexdigest() == entry['sha256'], entry['file']
            assert len(pd.read_csv(site / entry['file'])) == entry['rows'], entry['file']
        check(f'{group} partition total rows', section['total_rows'],
              sum(entry['rows'] for entry in section['files'].values()))
    assert manifest['partitions']['routes']['total_rows'] == len(route_summary)
    assert manifest['partitions']['temporal']['total_rows'] == sum(
        len(frame) for frame in temporal_source.values())
    for relative, digest in manifest['sources'].items():
        path = ROOT / relative
        assert path.exists(), relative
        assert hashlib.sha256(path.read_bytes()).hexdigest() == digest, relative
    CHECKS += 4
    print(f'  ok  {len(manifest["files"])} top-level files, '
          f'{len(manifest["partitions"]["routes"]["files"])} route and '
          f'{len(manifest["partitions"]["temporal"]["files"])} temporal partitions '
          f'hash-verified; {len(manifest["sources"])} source hashes still match inputs')

    print('Row-by-row source↔export comparison (full primary key, exact values):')
    covered = compare_full_key(
        pd.read_csv(ROOT / 'data/summaries/airport_month_airline.csv'), filters,
        ['Month', 'Reporting_Airline', 'OriginAirportID', 'Origin'],
        FILTER_COLUMNS, 'airport_month_airline')
    covered += compare_full_key(
        pd.read_csv(ROOT / 'data/summaries/airline_month.csv'), airline_month,
        ['Month', 'Reporting_Airline'], FILTER_COLUMNS, 'airline_month')
    for name, keys in [('airport_annual', ['OriginAirportID', 'Origin']),
                       ('airline_annual', ['Reporting_Airline']),
                       ('route_annual', ['OriginAirportID', 'Origin', 'DestAirportID', 'Dest'])]:
        covered += compare_full_key(pd.read_csv(ROOT / 'data/summaries' / f'{name}.csv'),
                                    pd.read_csv(site / f'{name}.csv'), keys,
                                    COUNTS + SITE_RATES, name)
    route_parts = []
    for code, entry in manifest['partitions']['routes']['files'].items():
        part = routes[code].copy()
        part['Origin'] = code
        part['OriginAirportID'] = entry['origin_airport_id']
        route_parts.append(part)
    covered += compare_full_key(route_summary, pd.concat(route_parts, ignore_index=True),
                                ['Month', 'Reporting_Airline', 'OriginAirportID', 'Origin',
                                 'DestAirportID', 'Dest'], COUNTS, 'route partitions')
    for month in range(1, 13):
        source_t = temporal_source[month].copy()
        exported_t = temporal_out[f'2025-{month:02}'].copy()
        for frame in (source_t, exported_t):
            # Merge key sentinel so a missing scheduled hour would still pair up.
            frame['hour_key'] = frame['ScheduledDepHour'].fillna(-1).astype('int64')
        covered += compare_full_key(source_t, exported_t,
                                    ['Month', 'Reporting_Airline', 'OriginAirportID', 'Origin',
                                     'Weekday', 'hour_key'], COUNTS, f'temporal 2025-{month:02}')
    CHECKS += 7
    print(f'  ok  every exported row matches its source row exactly '
          f'({covered:,} rows across 7 table groups; missing == missing)')

    print('\nAcceptance fixtures (exact counts; arrival-delay rate = delayed/eligible):')
    fixtures = [('National, all months/airlines/airports', expected_national),
                ('ORD annual', ord_annual),
                ('ORD January', ord_january),
                ('ORD January-February', ord_janfeb),
                ('ORD + UA annual', ord_ua_annual),
                ('ORD + UA January', ord_ua_january)]
    for label, counts in fixtures:
        print(f'  {label}: scheduled={counts["scheduled_flights"]:,} '
              f'eligible={counts["eligible_arrivals"]:,} delayed={counts["delayed_arrivals"]:,} '
              f'cancelled={counts["cancelled_flights"]:,} diverted={counts["diverted_flights"]:,} '
              f'delay_rate={delay_rate_text(counts)}')
    print(f'\nIndependent reconciliation passed: {CHECKS} count checks plus structural asserts.')


if __name__ == '__main__':
    main()
