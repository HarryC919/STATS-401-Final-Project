"""Focused regression checks for website city aggregation and filter-ready exports."""
import unittest
import pandas as pd

try:
    from export_site_data import (aggregate_cities, aggregate_city_pairs, build_airport_directory,
                                  partition_routes, pool_rows, FILTER_COLUMNS, COUNTS)
except ImportError:
    aggregate_cities = aggregate_city_pairs = build_airport_directory = None
    partition_routes = pool_rows = None
    FILTER_COLUMNS = COUNTS = None


def filter_rows(*rows):
    """Build filter-table frames with every retained column present."""
    base = {column: 0 for column in FILTER_COLUMNS}
    return pd.DataFrame([{**base, **row} for row in rows])


class SiteDataTests(unittest.TestCase):
    def test_city_rates_pool_counts_and_keep_empty_denominators(self):
        self.assertIsNotNone(aggregate_cities, "Website city aggregator is missing")
        rows = pd.DataFrame({
            'city': ['Metro, AA', 'Metro, AA', 'Empty, BB'],
            'state': ['AA', 'AA', 'BB'], 'airport': ['AAA', 'AAB', 'BBB'],
            'latitude': [10., 20., 30.], 'longitude': [-70., -80., -90.],
            'scheduled_flights': [10, 90, 2], 'eligible_arrivals': [10, 90, 0],
            'delayed_arrivals': [5, 9, 0], 'cancelled_flights': [0, 0, 2],
            'diverted_flights': [0, 0, 0],
        })
        result = aggregate_cities(rows).set_index('city')
        self.assertAlmostEqual(result.loc['Metro, AA', 'arrival_delay_rate'], .14)
        self.assertAlmostEqual(result.loc['Metro, AA', 'latitude'], 19.)
        self.assertEqual(result.loc['Metro, AA', 'airports'], 'AAA, AAB')
        self.assertTrue(pd.isna(result.loc['Empty, BB', 'arrival_delay_rate']))
        self.assertEqual(result.scheduled_flights.sum(), 102)

    def test_city_pairs_combine_directions_without_duplicating_counts(self):
        self.assertIsNotNone(aggregate_city_pairs, "Website city-pair aggregator is missing")
        rows = pd.DataFrame({
            'origin_city': ['A', 'B', 'A'], 'dest_city': ['B', 'A', 'A'],
            'scheduled_flights': [10, 90, 3], 'eligible_arrivals': [10, 90, 3],
            'delayed_arrivals': [5, 9, 0], 'cancelled_flights': [0, 0, 0],
            'diverted_flights': [0, 0, 0],
        })
        result = aggregate_city_pairs(rows)
        self.assertEqual(len(result), 1)
        self.assertEqual(result.iloc[0].scheduled_flights, 100)
        self.assertAlmostEqual(result.iloc[0].arrival_delay_rate, .14)
        self.assertEqual((result.iloc[0].city_a, result.iloc[0].city_b), ('A', 'B'))

    def test_pool_rows_combines_unequal_denominators(self):
        self.assertIsNotNone(pool_rows, "Reference pooling helper is missing")
        result = pool_rows(filter_rows(
            {'eligible_arrivals': 10, 'delayed_arrivals': 5, 'scheduled_flights': 10},
            {'eligible_arrivals': 90, 'delayed_arrivals': 9, 'scheduled_flights': 90}))
        # 5/10 plus 9/90 must pool to 14/100, not the mean of the percentages.
        self.assertEqual(int(result.iloc[0].delayed_arrivals), 14)
        self.assertEqual(int(result.iloc[0].eligible_arrivals), 100)
        self.assertAlmostEqual(result.iloc[0].arrival_delay_rate, .14)

    def test_pool_rows_zero_denominator_stays_missing(self):
        self.assertIsNotNone(pool_rows, "Reference pooling helper is missing")
        empty = pool_rows(filter_rows({'scheduled_flights': 4, 'cancelled_flights': 4}))
        self.assertTrue(pd.isna(empty.iloc[0].arrival_delay_rate))
        pooled = pool_rows(filter_rows(
            {'scheduled_flights': 4, 'cancelled_flights': 4},
            {'scheduled_flights': 6, 'eligible_arrivals': 6, 'delayed_arrivals': 3}))
        self.assertAlmostEqual(pooled.iloc[0].arrival_delay_rate, .5)
        self.assertAlmostEqual(pooled.iloc[0].cancellation_rate, .4)

    def test_pool_rows_keeps_missing_cause_minutes_missing_and_zero_observed_zero(self):
        self.assertIsNotNone(pool_rows, "Reference pooling helper is missing")
        unobserved = pool_rows(filter_rows(
            {'scheduled_flights': 3, 'eligible_arrivals': 3, 'delayed_arrivals': 2,
             'cause_observed_flights': 0, 'cause_complete_flights': 0}))
        self.assertTrue(pd.isna(unobserved.iloc[0]['CarrierDelay_minutes']))
        self.assertTrue(pd.isna(unobserved.iloc[0]['CarrierDelay_share']))
        self.assertTrue(pd.isna(unobserved.iloc[0].reported_cause_minutes))
        zero = pool_rows(filter_rows(
            {'scheduled_flights': 3, 'eligible_arrivals': 3, 'delayed_arrivals': 2,
             'cause_observed_flights': 2, 'cause_complete_flights': 2,
             'CarrierDelay_minutes': 0.0, 'CarrierDelay_observations': 2,
             'WeatherDelay_minutes': 0.0, 'WeatherDelay_observations': 2,
             'NASDelay_minutes': 0.0, 'NASDelay_observations': 2,
             'SecurityDelay_minutes': 0.0, 'SecurityDelay_observations': 2,
             'LateAircraftDelay_minutes': 0.0, 'LateAircraftDelay_observations': 2}))
        self.assertEqual(zero.iloc[0]['CarrierDelay_minutes'], 0.0)
        self.assertEqual(zero.iloc[0]['WeatherDelay_minutes'], 0.0)
        partial = pool_rows(filter_rows(
            {'delayed_arrivals': 1, 'cause_observed_flights': 1, 'cause_complete_flights': 1,
             'CarrierDelay_minutes': 30.0, 'CarrierDelay_observations': 1},
            {'delayed_arrivals': 1, 'eligible_arrivals': 1}))
        self.assertEqual(partial.iloc[0]['CarrierDelay_minutes'], 30.0)
        self.assertEqual(int(partial.iloc[0]['CarrierDelay_observations']), 1)
        self.assertTrue(pd.isna(partial.iloc[0]['WeatherDelay_minutes']))

    def test_partition_routes_keeps_reverse_directions_separate(self):
        self.assertIsNotNone(partition_routes, "Route partitioner is missing")
        rows = pd.DataFrame({
            'Month': [1, 1], 'Reporting_Airline': ['AA', 'AA'],
            'OriginAirportID': [1, 2], 'Origin': ['AAA', 'BBB'],
            'DestAirportID': [2, 1], 'Dest': ['BBB', 'AAA'],
            'scheduled_flights': [10, 90], 'eligible_arrivals': [10, 90],
            'delayed_arrivals': [5, 9], 'cancelled_flights': [0, 0],
            'diverted_flights': [0, 0],
        })
        parts = partition_routes(rows)
        self.assertEqual(sorted(parts), ['AAA', 'BBB'])
        self.assertEqual(parts['AAA'].iloc[0].Dest, 'BBB')
        self.assertEqual(int(parts['AAA'].iloc[0].scheduled_flights), 10)
        self.assertEqual(parts['BBB'].iloc[0].Dest, 'AAA')
        self.assertEqual(int(parts['BBB'].iloc[0].scheduled_flights), 90)
        self.assertNotIn('Origin', parts['AAA'].columns)
        self.assertEqual(int(sum(part.scheduled_flights.sum() for part in parts.values())), 100)

    def test_directory_collapses_versions_without_duplicating_counts(self):
        self.assertIsNotNone(build_airport_directory, "Airport directory builder is missing")
        metadata = pd.DataFrame({
            'AIRPORT_SEQ_ID': [111, 112, 113, 222],
            'AIRPORT_ID': [11, 11, 11, 22],
            'DISPLAY_AIRPORT_NAME': ['Alpha Old', 'Alpha', 'Alpha Alt', 'Beta'],
            'AIRPORT_START_DATE': pd.to_datetime(['2020-01-01', '2025-01-01', '2024-01-01', '2020-01-01']),
        })
        monthly_airports = pd.DataFrame({
            'city': ['Alpha City, AA'] * 3 + ['Beta City, BB'],
            'state': ['AA'] * 3 + ['BB'],
            'airport': ['AAA'] * 3 + ['BBB'],
            'OriginAirportSeqID': [111, 112, 113, 222],
            'scheduled_flights': [10, 90, 90, 5],
            'latitude': [10., 20., 30., 40.],
            'longitude': [-70., -80., -85., -90.],
        })
        result = build_airport_directory(monthly_airports, metadata).set_index('airport_id')
        self.assertEqual(len(result), 2)
        # Coordinates are the departure-weighted mean across the versions each
        # airport used; each version's flights count exactly once.
        self.assertAlmostEqual(result.loc[11, 'latitude'], (10 * 10 + 90 * 20 + 90 * 30) / 190)
        self.assertAlmostEqual(result.loc[11, 'longitude'], (10 * -70 + 90 * -80 + 90 * -85) / 190)
        self.assertEqual(int(result.loc[11, 'coordinate_versions']), 3)
        # Dominant version supplies the display name; ties break to the latest start date.
        self.assertEqual(result.loc[11, 'name'], 'Alpha')
        self.assertEqual(result.loc[11, 'city'], 'Alpha City, AA')
        self.assertEqual(result.loc[22, 'name'], 'Beta')
        self.assertEqual(int(result.loc[22, 'coordinate_versions']), 1)


if __name__ == '__main__':
    unittest.main()
