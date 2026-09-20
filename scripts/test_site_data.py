"""Focused regression checks for website city aggregation."""
import unittest
import pandas as pd

try:
    from export_site_data import aggregate_cities, aggregate_city_pairs
except ImportError:
    aggregate_cities = aggregate_city_pairs = None


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


if __name__ == '__main__':
    unittest.main()
