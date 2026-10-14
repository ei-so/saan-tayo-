"""Bounded, local-only Overture pilot. No database writes or paid APIs."""
import argparse
import datetime
import json
import math
import pathlib
import re

DEFAULT_RELEASE = '2026-09-23.1'
DEFAULT_BBOX = (120.64, 14.985, 120.665, 15.01)

def validate_bounds(bbox, limit):
    if len(bbox) != 4 or not all(math.isfinite(v) for v in bbox):
        raise ValueError('Four finite bbox coordinates are required')
    west, south, east, north = bbox
    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90) or (east-west)*(north-south) > 0.02:
        raise ValueError('Bbox must be ordered and at most 0.02 square degrees')
    if not isinstance(limit, int) or not 1 <= limit <= 100:
        raise ValueError('Limit must be 1 through 100; default pilot is 20')

def bounded_query(bbox, limit, release):
    validate_bounds(bbox, limit)
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}\.\d+', release):
        raise ValueError('Invalid release identifier')
    west, south, east, north = bbox
    sql = f"""SELECT id, to_json(names) AS names, to_json(bbox) AS bbox,
        to_json(taxonomy) AS taxonomy, basic_category, confidence,
        to_json(addresses) AS addresses, to_json(websites) AS websites,
        to_json(phones) AS phones, to_json(sources) AS sources
        FROM read_parquet('s3://overturemaps-us-west-2/release/{release}/theme=places/type=place/*', hive_partitioning=true)
        WHERE bbox.xmin BETWEEN ? AND ? AND bbox.ymin BETWEEN ? AND ?
        AND list_contains(taxonomy.hierarchy, 'food_and_drink')
        AND (list_contains(taxonomy.hierarchy, 'restaurant') OR list_contains(taxonomy.hierarchy, 'casual_eatery'))
        LIMIT ?"""
    return sql, [west, east, south, north, limit]

def fetch_records(bbox, limit, release):
    import duckdb
    sql, values = bounded_query(bbox, limit, release)
    with duckdb.connect() as con:
        con.execute('INSTALL httpfs; LOAD httpfs;')
        con.execute("SET s3_region='us-west-2'; SET threads=2; SET memory_limit='512MB';")
        result = con.execute(sql, values)
        columns = [col[0] for col in result.description]
        records = [dict(zip(columns, row)) for row in result.fetchall()]
    for row in records:
        for key in ['names', 'bbox', 'taxonomy', 'addresses', 'websites', 'phones', 'sources']:
            if isinstance(row[key], str): row[key] = json.loads(row[key])
    return records

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bbox', nargs=4, type=float, default=DEFAULT_BBOX)
    parser.add_argument('--limit', type=int, default=20)
    parser.add_argument('--release', default=DEFAULT_RELEASE)
    parser.add_argument('--output', default='docs/pipeline/pilot-overture.json')
    parser.add_argument('--fetch', action='store_true', help='Execute the bounded public-data query; default prints the query without network access')
    args = parser.parse_args()
    sql, values = bounded_query(args.bbox, args.limit, args.release)
    if not args.fetch:
        print(json.dumps({'dryRun': True, 'query': sql, 'parameters': values}, indent=2))
        return
    records = fetch_records(args.bbox, args.limit, args.release)
    result = {'release': args.release, 'bbox': args.bbox, 'limit': args.limit, 'retrievedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'source': 'Overture Maps Foundation', 'attribution': 'CDLA-Permissive-2.0 / Apache-2.0; individual provider licenses retained in sources', 'records': records}
    path = pathlib.Path(args.output)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding='utf-8')
    print(f'{len(records)} bounded records written locally to {path}; no database changes')

if __name__ == '__main__': main()
