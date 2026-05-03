#!/usr/bin/env python
"""Check relational mirror tables"""
from backend.db import get_connection
import time

tables_to_check = ["events", "projects_lite", "volunteers_lite", "programs", "program_tracks", "users"]

try:
    with get_connection() as conn:
        with conn.cursor() as cur:
            # Set timeout
            cur.execute("SET statement_timeout = '5000'")
            
            for table in tables_to_check:
                try:
                    start = time.time()
                    cur.execute(f'SELECT COUNT(*) FROM "{table}"')
                    result = cur.fetchone()
                    elapsed = time.time() - start
                    count = result[0] if result else 0
                    print(f'✓ {table}: {count:,} rows ({elapsed:.2f}s)')
                except Exception as e:
                    error = str(e)[:80]
                    print(f'✗ {table}: {type(e).__name__}: {error}')

except Exception as e:
    print(f'Connection error: {e}')
