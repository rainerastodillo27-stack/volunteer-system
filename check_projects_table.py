#!/usr/bin/env python
"""Check projects table accessibility and size"""
from backend.db import get_connection
import time

try:
    with get_connection() as conn:
        with conn.cursor() as cur:
            # Set timeout to 10 seconds
            cur.execute("SET statement_timeout = '10000'")
            
            # Try a simple count first
            print("Attempting COUNT(*) on projects table...")
            start = time.time()
            cur.execute('SELECT COUNT(*) FROM projects')
            count_result = cur.fetchone()
            count_time = time.time() - start
            row_count = count_result[0] if count_result else 0
            print(f'✓ COUNT(*) took {count_time:.2f}s, result: {row_count} rows')
            
            if row_count > 0:
                # Try to fetch first few rows
                print(f"\nFetching first 5 projects...")
                start = time.time()
                cur.execute('SELECT id, title, is_event FROM projects ORDER BY id LIMIT 5')
                rows = cur.fetchall()
                fetch_time = time.time() - start
                print(f'✓ Fetched {len(rows)} rows in {fetch_time:.2f}s')
                for row in rows:
                    print(f'   - {row[0]}: {row[1]} (isEvent={row[2]})')
            else:
                print("⚠ No projects in database!")

except Exception as e:
    error_str = str(e)
    if len(error_str) > 300:
        error_str = error_str[:300] + "..."
    print(f'✗ Error: {type(e).__name__}: {error_str}')
