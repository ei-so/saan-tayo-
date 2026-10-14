import unittest
from import_overture import bounded_query, validate_bounds

class ImportTests(unittest.TestCase):
    def test_caps(self):
        for bbox, limit in [((0, 0, 1, 1), 20), ((120, 15, 119, 16), 20), ((120.64, 14.985, 120.665, 15.01), 101), ((float('nan'), 1, 2, 3), 20)]:
            with self.assertRaises(ValueError): validate_bounds(bbox, limit)
    def test_projection_and_current_taxonomy(self):
        query, values = bounded_query((120.64, 14.985, 120.665, 15.01), 20, '2026-09-23.1')
        self.assertNotIn('SELECT *', query)
        self.assertNotIn('categories', query)
        self.assertIn('taxonomy.hierarchy', query)
        self.assertIn("'casual_eatery'", query)
        self.assertIn('bbox.xmin BETWEEN', query)
        self.assertEqual(values[-1], 20)
        with self.assertRaises(ValueError): bounded_query((120.64, 14.985, 120.665, 15.01), 20, "bad'; DROP TABLE places;")

if __name__ == '__main__': unittest.main()
