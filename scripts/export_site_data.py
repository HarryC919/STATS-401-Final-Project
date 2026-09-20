"""Export the validated 2025 baseline and reproducible city-level website data."""
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


def add_rates(frame):
    frame = frame.copy()
    for name, (numerator, denominator) in RATES.items():
        frame[name] = frame[numerator] / frame[denominator].replace(0, float('nan'))
    return frame


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
    assert list(tables['monthly'].Month) == list(range(1, 13))
    assert int(national.scheduled_flights) == audit['total_rows'] == quality['cleaned_rows']
    for name, table in tables.items():
        assert table[COUNTS].sum().tolist() == national[COUNTS].tolist(), name

    airport_path = ROOT / 'data/processed/airports.csv'
    sources.append(airport_path)
    coords = pd.read_csv(airport_path)[['AIRPORT_SEQ_ID', 'LATITUDE', 'LONGITUDE']]
    assert coords.AIRPORT_SEQ_ID.is_unique
    city_parts, pair_parts = [], []
    total_counts = pd.Series(0, index=COUNTS, dtype='int64')
    within_city = 0
    for month in range(1, 13):
        path = ROOT / f'data/processed/flights_2025_{month:02}.parquet'
        sources.append(path)
        frame = pd.read_parquet(path, columns=[
            'Month', 'Origin', 'OriginCityName', 'OriginState', 'DestCityName',
            'OriginAirportSeqID', 'ArrivalEligible', 'ArrivalDelayed15', 'Cancelled', 'Diverted'])
        assert frame.Month.eq(month).all()
        assert frame[['OriginCityName', 'OriginState', 'DestCityName']].notna().all().all()
        frame['scheduled_flights'] = 1
        frame['eligible_arrivals'] = frame.ArrivalEligible.astype('int64')
        frame['delayed_arrivals'] = frame.ArrivalDelayed15.fillna(False).astype('int64')
        frame['cancelled_flights'] = frame.Cancelled.astype('int64')
        frame['diverted_flights'] = frame.Diverted.astype('int64')
        total_counts += frame[COUNTS].sum()
        monthly_expected = tables['monthly'].set_index('Month').loc[month, COUNTS]
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
    cities = aggregate_cities(pd.concat(city_parts, ignore_index=True))
    pairs = aggregate_city_pairs(pd.concat(pair_parts, ignore_index=True))
    assert cities.city.is_unique
    assert cities[COUNTS].sum().tolist() == national[COUNTS].tolist()
    assert int(pairs.scheduled_flights.sum()) + within_city == int(national.scheduled_flights)

    # Preserve all counts and national attribution; omit unused annual cause columns.
    exports = {'city_summary': cities, 'city_routes': pairs}
    for name, table in tables.items():
        if name in ['national', 'monthly']:
            exports[name] = table
        else:
            keys = [c for c in table.columns if c in ['Reporting_Airline', 'OriginAirportID', 'Origin', 'DestAirportID', 'Dest']]
            exports[name] = table[keys + COUNTS + list(RATES)]
    target = ROOT / 'site/data'
    target.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=target.parent) as temp:
        stage = Path(temp)
        for name, table in exports.items():
            table.to_csv(stage / f'{name}.csv', index=False)
        manifest = {
            'year': 2025, 'months': list(range(1, 13)), 'scheduled_flights': int(national.scheduled_flights),
            'generator': 'scripts/export_site_data.py',
            'city_identity': 'BTS OriginCityName (including state); airports with the same city name are pooled.',
            'coordinates': 'Departure-weighted historical airport coordinates joined on AirportSeqID.',
            'city_pairs': 'Both directions pooled; within-city flights excluded only from city-pair edges.',
            'within_city_flights': within_city,
            'map_limit': 220,
            'projection_note': 'Albers USA does not display all territories; filter endpoints before selecting top routes.',
            'sources': {str(p.relative_to(ROOT)): sha256(p) for p in sources},
            'files': {p.name: {'sha256': sha256(p), 'rows': len(exports[p.stem]), 'bytes': p.stat().st_size}
                      for p in sorted(stage.glob('*.csv'))},
        }
        (stage / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        for path in stage.iterdir():
            shutil.copyfile(path, target / path.name)
    print(f'Exported {len(exports)} tables; {len(cities)} cities, {len(pairs)} city pairs.')


if __name__ == '__main__':
    main()
