"""Export the validated 2025 baseline, city-level website data, and the filter-ready
publication partitions described in docs/2026-10-05-filter-data-contract.md."""
from pathlib import Path
import hashlib
import json
import tempfile
import shutil
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
COUNTS = ['scheduled_flights', 'eligible_arrivals', 'delayed_arrivals',
          'cancelled_flights', 'diverted_flights']
RATES = {'arrival_delay_rate': ('delayed_arrivals', 'eligible_arrivals'),
         'cancellation_rate': ('cancelled_flights', 'scheduled_flights'),
         'diversion_rate': ('diverted_flights', 'scheduled_flights')}
ATTRIBUTION_COUNTS = ['missing_arrival_delay', 'cause_complete_flights',
                      'delayed_cause_missing', 'cause_observed_flights', 'cause_partial_flights']
CAUSES = ['CarrierDelay', 'WeatherDelay', 'NASDelay', 'SecurityDelay', 'LateAircraftDelay']
CAUSE_MINUTES = [cause + '_minutes' for cause in CAUSES]
CAUSE_OBSERVATIONS = [cause + '_observations' for cause in CAUSES]
FILTER_COUNTS = COUNTS + ATTRIBUTION_COUNTS
FILTER_COLUMNS = FILTER_COUNTS + CAUSE_MINUTES + CAUSE_OBSERVATIONS
FILTER_KEYS = {
    'airport_month_airline': ['Month', 'Reporting_Airline', 'OriginAirportID', 'Origin'],
    'airline_month': ['Month', 'Reporting_Airline'],
    'route_month_airline': ['Month', 'Reporting_Airline', 'OriginAirportID', 'Origin',
                            'DestAirportID', 'Dest'],
}
TEMPORAL_KEYS = ['Reporting_Airline', 'OriginAirportID', 'Origin', 'Weekday', 'ScheduledDepHour']


def add_rates(frame):
    frame = frame.copy()
    for name, (numerator, denominator) in RATES.items():
        frame[name] = frame[numerator] / frame[denominator].replace(0, float('nan'))
    return frame


def pool_rows(frame, by=None):
    """Reference consumer-side pooling over exported filter rows.

    Sums the retained counts, recomputes the three rates from pooled counts (a zero
    denominator stays missing), and pools cause minutes only where the cause has
    observations, so unobserved minutes stay missing while observed zeros stay zero.
    This function documents the semantics Batch B must implement in JavaScript;
    the exporter itself only ships counts, minutes, and observations.
    """
    frame = frame.copy()
    for cause in CAUSES:
        unobserved = frame[cause + '_observations'].fillna(0) == 0
        frame.loc[unobserved, cause + '_minutes'] = float('nan')
    if by is None:
        pooled = pd.DataFrame({column: [frame[column].sum()] for column in FILTER_COLUMNS})
    else:
        keys = [by] if isinstance(by, str) else list(by)
        pooled = frame.groupby(keys, dropna=False, sort=True)[FILTER_COLUMNS].sum().reset_index()
    for name, (numerator, denominator) in RATES.items():
        pooled[name] = pooled[numerator] / pooled[denominator].replace(0, float('nan'))
    total = pooled[CAUSE_MINUTES].sum(axis=1)
    pooled['reported_cause_minutes'] = total.where(pooled['cause_observed_flights'] > 0)
    for cause in CAUSES:
        pooled[cause + '_minutes'] = pooled[cause + '_minutes'].where(pooled[cause + '_observations'] > 0)
        pooled[cause + '_share'] = pooled[cause + '_minutes'] / total.replace(0, float('nan'))
    return pooled


def partition_routes(rows):
    """Split directed route rows into one frame per origin IATA code.

    Directions stay separate: A to B and B to A land in different partitions with
    their own counts. The origin identity is the partition key and is not repeated
    inside the frames; the manifest maps file names to origin airport IDs.
    """
    parts = {}
    for code, part in rows.groupby('Origin', sort=True):
        parts[code] = part.sort_values(
            ['Month', 'Reporting_Airline', 'DestAirportID', 'Dest'], kind='stable'
        )[['Month', 'Reporting_Airline', 'DestAirportID', 'Dest'] + COUNTS].reset_index(drop=True)
    return parts


def build_airport_directory(monthly_airports, metadata):
    """Collapse historical AirportSeqID versions into one row per stable AirportID.

    monthly_airports holds per-month origin rows (city, state, airport,
    OriginAirportSeqID, counts, latitude, longitude). metadata is the used subset of
    the BTS master coordinate with one row per AIRPORT_SEQ_ID. Coordinates are
    departure-weighted across the versions each airport actually used; the display
    name comes from the version with the most departures (ties: latest start date,
    then highest sequence ID). City membership uses flight-data city names so it
    matches city_summary.csv exactly.
    """
    for column in ['latitude', 'longitude']:
        assert monthly_airports.groupby('OriginAirportSeqID')[column].nunique().eq(1).all()
    weights = monthly_airports.groupby('OriginAirportSeqID', as_index=False, sort=True).agg(
        departures=('scheduled_flights', 'sum'),
        latitude=('latitude', 'first'), longitude=('longitude', 'first'))
    assert set(weights.OriginAirportSeqID) == set(metadata.AIRPORT_SEQ_ID), \
        'Airport metadata versions and observed origin sequence IDs must match'
    weights = weights.merge(
        metadata[['AIRPORT_SEQ_ID', 'AIRPORT_ID', 'DISPLAY_AIRPORT_NAME', 'AIRPORT_START_DATE']],
        left_on='OriginAirportSeqID', right_on='AIRPORT_SEQ_ID', validate='one_to_one')
    weights['weighted_lat'] = weights.latitude * weights.departures
    weights['weighted_lon'] = weights.longitude * weights.departures
    pooled = weights.groupby('AIRPORT_ID', sort=True)[['departures', 'weighted_lat', 'weighted_lon']].sum()
    pooled['latitude'] = pooled.pop('weighted_lat') / pooled.departures
    pooled['longitude'] = pooled.pop('weighted_lon') / pooled.departures

    rows = monthly_airports.copy()
    rows['airport_id'] = rows.OriginAirportSeqID.map(metadata.set_index('AIRPORT_SEQ_ID').AIRPORT_ID)
    assert rows.airport_id.notna().all()
    for column in ['airport', 'city', 'state']:
        assert rows.groupby('airport_id')[column].nunique().eq(1).all(), column
    identity = rows.groupby('airport_id', sort=True).agg(
        airport=('airport', 'first'), city=('city', 'first'), state=('state', 'first'),
        coordinate_versions=('OriginAirportSeqID', 'nunique')).reset_index()

    ordered = weights.sort_values(
        ['AIRPORT_ID', 'departures', 'AIRPORT_START_DATE', 'AIRPORT_SEQ_ID'],
        ascending=[True, False, False, False], kind='stable')
    identity['name'] = identity.airport_id.map(ordered.groupby('AIRPORT_ID').DISPLAY_AIRPORT_NAME.first())
    assert identity.name.notna().all()
    directory = identity.merge(pooled.reset_index().rename(columns={'AIRPORT_ID': 'airport_id'}),
                               on='airport_id', validate='one_to_one')
    directory = directory[['airport_id', 'airport', 'name', 'city', 'state',
                           'latitude', 'longitude', 'coordinate_versions']]
    return directory.sort_values('airport_id', kind='stable').reset_index(drop=True)


def aggregate_cities(rows):
    rows = rows.copy()
    rows['weighted_lat'] = rows.latitude * rows.scheduled_flights
    rows['weighted_lon'] = rows.longitude * rows.scheduled_flights
    groups = rows.groupby(['city', 'state'], dropna=False)
    out = groups[COUNTS + ['weighted_lat', 'weighted_lon']].sum().reset_index()
    airports = groups.airport.agg(lambda values: ', '.join(sorted(set(values)))).reset_index(name='airports')
    out = out.merge(airports, on=['city', 'state'], validate='one_to_one')
    out['latitude'] = out.pop('weighted_lat') / out.scheduled_flights
    out['longitude'] = out.pop('weighted_lon') / out.scheduled_flights
    return add_rates(out).sort_values(['scheduled_flights', 'city'], ascending=[False, True])


def aggregate_city_pairs(rows):
    rows = rows[rows.origin_city != rows.dest_city].copy()
    rows[['city_a', 'city_b']] = pd.DataFrame(
        [sorted(pair) for pair in zip(rows.origin_city, rows.dest_city)], index=rows.index,
        columns=['city_a', 'city_b'])
    out = rows.groupby(['city_a', 'city_b'], dropna=False)[COUNTS].sum().reset_index()
    return add_rates(out).sort_values(['scheduled_flights', 'city_a', 'city_b'], ascending=[False, True, True])


def sha256(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def main():
    audit_path = ROOT / 'reports/verification.json'
    quality_path = ROOT / 'reports/quality_report.json'
    audit = json.loads(audit_path.read_text())
    quality = json.loads(quality_path.read_text())
    if not audit.get('full_year_verified') or quality.get('months') != list(range(1, 13)):
        raise ValueError('Export requires a verified twelve-month baseline.')
    sources = [audit_path, quality_path]
    tables = {}
    for name in ['national', 'monthly', 'airline_annual', 'airport_annual', 'route_annual']:
        path = ROOT / f'data/summaries/{name}.csv'
        sources.append(path)
        table = pd.read_csv(path)
        for metric, (num, den) in RATES.items():
            expected = table[num] / table[den].replace(0, float('nan'))
            pd.testing.assert_series_equal(table[metric], expected, check_names=False, check_dtype=False)
        tables[name] = table
    national = tables['national'].iloc[0]
    monthly_indexed = tables['monthly'].set_index('Month')
    assert list(tables['monthly'].Month) == list(range(1, 13))
    assert int(national.scheduled_flights) == audit['total_rows'] == quality['cleaned_rows']
    for name, table in tables.items():
        assert table[COUNTS].sum().tolist() == national[COUNTS].tolist(), name

    airport_path = ROOT / 'data/processed/airports.csv'
    sources.append(airport_path)
    metadata = pd.read_csv(airport_path)[['AIRPORT_SEQ_ID', 'AIRPORT_ID', 'DISPLAY_AIRPORT_NAME',
                                          'AIRPORT_START_DATE', 'LATITUDE', 'LONGITUDE']]
    assert metadata.AIRPORT_SEQ_ID.is_unique
    metadata['AIRPORT_START_DATE'] = pd.to_datetime(metadata.AIRPORT_START_DATE)
    coords = metadata[['AIRPORT_SEQ_ID', 'LATITUDE', 'LONGITUDE']]
    city_parts, pair_parts, seq_map_parts = [], [], []
    total_counts = pd.Series(0, index=COUNTS, dtype='int64')
    within_city = 0
    for month in range(1, 13):
        path = ROOT / f'data/processed/flights_2025_{month:02}.parquet'
        sources.append(path)
        frame = pd.read_parquet(path, columns=[
            'Month', 'Origin', 'OriginCityName', 'OriginState', 'DestCityName',
            'OriginAirportID', 'OriginAirportSeqID', 'ArrivalEligible', 'ArrivalDelayed15',
            'Cancelled', 'Diverted'])
        assert frame.Month.eq(month).all()
        assert frame[['OriginCityName', 'OriginState', 'DestCityName']].notna().all().all()
        seq_map_parts.append(frame[['OriginAirportSeqID', 'OriginAirportID']].drop_duplicates())
        frame['scheduled_flights'] = 1
        frame['eligible_arrivals'] = frame.ArrivalEligible.astype('int64')
        frame['delayed_arrivals'] = frame.ArrivalDelayed15.fillna(False).astype('int64')
        frame['cancelled_flights'] = frame.Cancelled.astype('int64')
        frame['diverted_flights'] = frame.Diverted.astype('int64')
        total_counts += frame[COUNTS].sum()
        monthly_expected = monthly_indexed.loc[month, COUNTS]
        assert frame[COUNTS].sum().tolist() == monthly_expected.tolist()
        by_origin = frame.groupby(['OriginCityName', 'OriginState', 'Origin', 'OriginAirportSeqID'])[COUNTS].sum().reset_index()
        by_origin = by_origin.merge(coords, left_on='OriginAirportSeqID', right_on='AIRPORT_SEQ_ID', validate='many_to_one')
        assert by_origin.scheduled_flights.sum() == len(frame)
        assert by_origin.LATITUDE.between(-90, 90).all() and by_origin.LONGITUDE.between(-180, 180).all()
        city_parts.append(by_origin.rename(columns={
            'OriginCityName': 'city', 'OriginState': 'state', 'Origin': 'airport',
            'LATITUDE': 'latitude', 'LONGITUDE': 'longitude'}))
        pairs = frame.groupby(['OriginCityName', 'DestCityName'])[COUNTS].sum().reset_index()
        within_city += int(pairs.loc[pairs.OriginCityName == pairs.DestCityName, 'scheduled_flights'].sum())
        pair_parts.append(pairs.rename(columns={'OriginCityName': 'origin_city', 'DestCityName': 'dest_city'}))
        print(f'Export input verified: month {month:02}', flush=True)
    assert total_counts.tolist() == national[COUNTS].tolist()
    seq_map = pd.concat(seq_map_parts, ignore_index=True).drop_duplicates()
    assert seq_map.OriginAirportSeqID.is_unique, 'A sequence ID maps to multiple airport IDs'
    mapped = seq_map.merge(metadata[['AIRPORT_SEQ_ID', 'AIRPORT_ID']],
                           left_on='OriginAirportSeqID', right_on='AIRPORT_SEQ_ID', validate='one_to_one')
    assert len(mapped) == len(metadata), 'Airport metadata versions missing from origin flights'
    assert (mapped.OriginAirportID == mapped.AIRPORT_ID).all(), \
        'Flight airport IDs disagree with the airport metadata join'
    cities = aggregate_cities(pd.concat(city_parts, ignore_index=True))
    pairs = aggregate_city_pairs(pd.concat(pair_parts, ignore_index=True))
    assert cities.city.is_unique
    assert cities[COUNTS].sum().tolist() == national[COUNTS].tolist()
    assert int(pairs.scheduled_flights.sum()) + within_city == int(national.scheduled_flights)
    directory = build_airport_directory(pd.concat(city_parts, ignore_index=True), metadata)
    assert len(directory) == metadata.AIRPORT_ID.nunique()
    assert directory.airport_id.is_unique
    assert directory.latitude.between(-90, 90).all() and directory.longitude.between(-180, 180).all()

    # Batch A: filter-ready tables from verified summaries (counts and attribution
    # inputs only; consumers pool counts and recompute rates and cause shares).
    filter_inputs = {}
    for name in FILTER_KEYS:
        path = ROOT / f'data/summaries/{name}.csv'
        sources.append(path)
        filter_inputs[name] = pd.read_csv(path)
        assert not filter_inputs[name][FILTER_COUNTS].isna().any().any(), name
        assert not filter_inputs[name].duplicated(FILTER_KEYS[name]).any(), name
        assert filter_inputs[name][COUNTS].sum().tolist() == national[COUNTS].tolist(), name
    for name, roles in [('airport_month_airline', ['Origin']), ('route_month_airline', ['Origin', 'Dest'])]:
        table = filter_inputs[name]
        for role in roles:
            id_column = role + 'AirportID'
            assert table.groupby(role)[id_column].nunique().eq(1).all(), (name, role)
            assert table.groupby(id_column)[role].nunique().eq(1).all(), (name, role)
    assert (filter_inputs['route_month_airline'].Origin != filter_inputs['route_month_airline'].Dest).all()
    temporal_exports, temporal_total = {}, pd.Series(0, index=COUNTS, dtype='int64')
    for month in range(1, 13):
        path = ROOT / f'data/summaries/temporal/2025-{month:02}.csv'
        sources.append(path)
        frame = pd.read_csv(path, usecols=['Month', 'Reporting_Airline', 'OriginAirportID', 'Origin',
                                           'Weekday', 'ScheduledDepHour'] + COUNTS,
                            dtype={'ScheduledDepHour': 'Int64'})
        assert frame.Month.eq(month).all()
        assert frame.Weekday.between(1, 7).all()
        assert frame.ScheduledDepHour.dropna().between(0, 23).all()
        assert not frame[COUNTS].isna().any().any()
        assert frame.groupby('Origin').OriginAirportID.nunique().eq(1).all()
        assert frame.groupby('OriginAirportID').Origin.nunique().eq(1).all()
        for count in COUNTS:
            temporal_total[count] += int(frame[count].sum())
            assert int(frame[count].sum()) == int(monthly_indexed.loc[month, count]), count
        temporal_exports[month] = frame.sort_values(
            TEMPORAL_KEYS, na_position='last', kind='stable').reset_index(drop=True)
    assert temporal_total.tolist() == national[COUNTS].tolist()
    assert set(directory.airport_id) == set(filter_inputs['airport_month_airline'].OriginAirportID)
    assert set(directory.airport) == set(filter_inputs['airport_month_airline'].Origin)
    partitions = partition_routes(filter_inputs['route_month_airline'])
    origin_ids = filter_inputs['route_month_airline'].drop_duplicates('Origin').set_index('Origin').OriginAirportID

    # Preserve all counts and national attribution; omit unused annual cause columns.
    exports = {'city_summary': cities, 'city_routes': pairs, 'airport_directory': directory,
               'airport_month_airline': filter_inputs['airport_month_airline'][FILTER_KEYS['airport_month_airline'] + FILTER_COLUMNS],
               'airline_month': filter_inputs['airline_month'][FILTER_KEYS['airline_month'] + FILTER_COLUMNS]}
    for name, table in tables.items():
        if name in ['national', 'monthly']:
            exports[name] = table
        else:
            keys = [c for c in table.columns if c in ['Reporting_Airline', 'OriginAirportID', 'Origin', 'DestAirportID', 'Dest']]
            exports[name] = table[keys + COUNTS + list(RATES)]
    for name in ['airport_month_airline', 'airline_month']:
        exports[name] = exports[name].sort_values(FILTER_KEYS[name], kind='stable').reset_index(drop=True)

    target = ROOT / 'site/data'
    target.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=target.parent) as temp:
        stage = Path(temp)
        for name, table in exports.items():
            table.to_csv(stage / f'{name}.csv', index=False)
        routes_dir = stage / 'routes'
        routes_dir.mkdir()
        route_files = {}
        for code in sorted(partitions):
            partitions[code].to_csv(routes_dir / f'{code}.csv', index=False)
            path = routes_dir / f'{code}.csv'
            route_files[code] = {'file': f'routes/{code}.csv', 'origin_airport_id': int(origin_ids.loc[code]),
                                 'rows': int(len(partitions[code])), 'bytes': path.stat().st_size,
                                 'sha256': sha256(path)}
        temporal_dir = stage / 'temporal'
        temporal_dir.mkdir()
        temporal_files = {}
        for month in range(1, 13):
            name = f'2025-{month:02}'
            path = temporal_dir / f'{name}.csv'
            temporal_exports[month].to_csv(path, index=False)
            temporal_files[name] = {'file': f'temporal/{name}.csv', 'rows': int(len(temporal_exports[month])),
                                    'bytes': path.stat().st_size, 'sha256': sha256(path)}
        partition_bytes = sum(entry['bytes'] for entry in list(route_files.values()) + list(temporal_files.values()))
        largest_code = max(route_files, key=lambda code: route_files[code]['bytes'])
        largest_month = max(temporal_files, key=lambda name: temporal_files[name]['bytes'])
        largest_name, largest_bytes = max(
            [(route_files[largest_code]['file'], route_files[largest_code]['bytes']),
             (temporal_files[largest_month]['file'], temporal_files[largest_month]['bytes'])],
            key=lambda item: item[1])
        manifest = {
            'year': 2025, 'months': list(range(1, 13)), 'scheduled_flights': int(national.scheduled_flights),
            'generator': 'scripts/export_site_data.py',
            'city_identity': 'BTS OriginCityName (including state); airports with the same city name are pooled.',
            'coordinates': 'Departure-weighted historical airport coordinates joined on AirportSeqID.',
            'city_pairs': 'Both directions pooled; within-city flights excluded only from city-pair edges.',
            'within_city_flights': within_city,
            'map_limit': 220,
            'projection_note': 'Albers USA does not display all territories; filter endpoints before selecting top routes.',
            'coverage': {'airports': int(len(directory)), 'route_origins': int(len(route_files)),
                         'reporting_airlines': int(len(tables['airline_annual']))},
            'filter_data': {
                'contract': 'docs/2026-10-05-filter-data-contract.md',
                'pooling': 'Filter rows first, sum counts, recompute rates; zero denominators stay missing.',
                'cause_nulls': 'Cause minutes are missing exactly where observations are zero; observed zeros stay zero.',
                'airport_directory': ('One row per AirportID; departure-weighted coordinates across historical '
                                      'AirportSeqID versions; name from the dominant version; city membership from '
                                      'flight-data city names.'),
                'loading_plan': {
                    'initial': ['national.csv', 'monthly.csv', 'airline_annual.csv', 'airport_annual.csv',
                                'route_annual.csv', 'city_summary.csv', 'city_routes.csv', 'airport_directory.csv',
                                'airport_month_airline.csv', 'airline_month.csv'],
                    'on_demand': {'routes/<ORIGIN>.csv': 'selected origin airport (Batch C detail)',
                                  'temporal/2025-MM.csv': 'selected months (Batch D1 heatmap)'},
                },
            },
            'partitions': {
                'routes': {'path': 'site/data/routes',
                           'grain': 'One file per origin IATA code; rows are Month x Reporting_Airline x DestAirportID x Dest with the five core counts; directions stay separate.',
                           'count': len(route_files),
                           'total_rows': int(sum(entry['rows'] for entry in route_files.values())),
                           'total_bytes': int(sum(entry['bytes'] for entry in route_files.values())),
                           'files': route_files},
                'temporal': {'path': 'site/data/temporal',
                             'grain': 'One file per month; rows are Reporting_Airline x OriginAirportID x Origin x Weekday x ScheduledDepHour with the five core counts; ScheduledDepHour 2400 maps to 0 and invalid times stay missing.',
                             'count': len(temporal_files),
                             'total_rows': int(sum(entry['rows'] for entry in temporal_files.values())),
                             'total_bytes': int(sum(entry['bytes'] for entry in temporal_files.values())),
                             'files': temporal_files},
            },
            'sources': {str(p.relative_to(ROOT)): sha256(p) for p in sources},
            'files': {p.name: {'sha256': sha256(p), 'rows': len(exports[p.stem]), 'bytes': p.stat().st_size}
                      for p in sorted(stage.glob('*.csv'))},
        }
        (stage / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        for name in ['routes', 'temporal']:  # generated partition directories; never stale
            stale = target / name
            if stale.exists():
                shutil.rmtree(stale)
        for path in sorted(stage.rglob('*')):
            if path.is_file():
                destination = target / path.relative_to(stage)
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(path, destination)
    publication_bytes = sum(p.stat().st_size for p in target.rglob('*') if p.is_file())
    print(f'Exported {len(exports)} tables, {len(route_files)} route partitions, '
          f'{len(temporal_files)} temporal partitions; {len(cities)} cities, {len(pairs)} city pairs.')
    print(f'Publication size: {publication_bytes / 1024 ** 2:.1f} MiB; partitions {partition_bytes / 1024 ** 2:.1f} MiB; '
          f'largest partition {largest_name} ({largest_bytes / 1024:.0f} KiB).')


if __name__ == '__main__':
    main()
