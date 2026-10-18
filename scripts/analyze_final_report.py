"""Recompute descriptive final-report findings from the committed website snapshot."""
import hashlib
import json
import math
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]


def main():
    sources = {'scripts/analyze_final_report.py': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}

    def read_csv(name):
        path = ROOT / 'site/data' / name
        sources[str(path.relative_to(ROOT))] = hashlib.sha256(path.read_bytes()).hexdigest()
        return pd.read_csv(path)

    national = read_csv('national.csv').iloc[0]
    airports = read_csv('airport_annual.csv')
    rated = airports[(airports.eligible_arrivals > 0) & (airports.scheduled_flights > 0)].copy()
    rated['rate'] = rated.delayed_arrivals / rated.eligible_arrivals
    rated['log_volume'] = rated.scheduled_flights.map(math.log10)

    def volume_summary(rows):
        return {
            'airports': len(rows),
            'pearson_log10_volume_delay_rate': float(rows.log_volume.corr(rows.rate)),
            'delay_rate_iqr_percentage_points': float(100 * (rows.rate.quantile(.75) - rows.rate.quantile(.25))),
        }

    airlines = read_csv('airline_annual.csv')
    airlines['rate'] = airlines.delayed_arrivals / airlines.eligible_arrivals
    low = airlines.loc[airlines.rate.idxmin()]
    high = airlines.loc[airlines.rate.idxmax()]
    temporal = pd.concat([read_csv(f'temporal/2025-{month:02}.csv') for month in range(1, 13)])
    assert temporal.scheduled_flights.sum() == national.scheduled_flights
    assert temporal.eligible_arrivals.sum() == national.eligible_arrivals
    extrema = {}
    for key in ['ScheduledDepHour', 'Weekday']:
        pooled = temporal.groupby(key)[['delayed_arrivals', 'eligible_arrivals']].sum()
        rates = pooled.delayed_arrivals / pooled.eligible_arrivals
        extrema[key] = {
            'lowest': {'value': int(rates.idxmin()), 'rate': float(rates.min())},
            'highest': {'value': int(rates.idxmax()), 'rate': float(rates.max())},
        }
    cause_columns = [f'{category}Delay_minutes' for category in ['Carrier', 'Weather', 'NAS', 'Security', 'LateAircraft']]
    airport_month = read_csv('airport_month_airline.csv')
    minutes = airport_month.groupby('Origin')[cause_columns].sum(min_count=1)
    shares = minutes.div(minutes.sum(axis=1, min_count=1), axis=0)
    result = {
        'generator': 'scripts/analyze_final_report.py',
        'scope': 'Full-year 2025, all reporting airlines and origin airports; descriptive analysis.',
        'volume_method': 'One unweighted observation per airport with positive scheduled flights and eligible arrivals; Pearson correlation uses log10 scheduled volume and pooled arrival-delay rate. IQR uses linear-interpolated quartiles.',
        'volume': {
            'all': volume_summary(rated),
            'below_10000_departures': volume_summary(rated[rated.scheduled_flights < 10000]),
            'at_least_10000_departures': volume_summary(rated[rated.scheduled_flights >= 10000]),
        },
        'airlines': {
            'lowest': {'code': low.Reporting_Airline, 'rate': float(low.rate)},
            'highest': {'code': high.Reporting_Airline, 'rate': float(high.rate)},
        },
        'temporal_extrema': extrema,
        'cause_shares': {code: {column: float(shares.loc[code, column]) for column in cause_columns} for code in ['ATL', 'DFW']},
        'source_sha256': sources,
    }
    output = ROOT / 'reports/final_report_findings.json'
    output.write_text(json.dumps(result, indent=2, allow_nan=False) + '\n')
    print(f'Wrote {output.relative_to(ROOT)}: {len(rated)} airports; r={result["volume"]["all"]["pearson_log10_volume_delay_rate"]:.4f}.')


if __name__ == '__main__':
    main()
