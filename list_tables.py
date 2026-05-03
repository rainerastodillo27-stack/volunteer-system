#!/usr/bin/env python
"""List all tables in the database"""
from backend.db import get_connection

try:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT tablename FROM pg_tables 
                WHERE schemaname = 'public'
                ORDER BY tablename
            """)
            tables = cur.fetchall()
            print(f"Tables in 'public' schema ({len(tables)} total):")
            for table in tables:
                table_name = table[0]
                # Get row count for small tables
                try:
                    cur.execute(f'SELECT COUNT(*) FROM "{table_name}" LIMIT 1')
                    count = cur.fetchone()[0]
                    if count > 1000:
                        print(f"  - {table_name:<35} ({count:,} rows) [LARGE]")
                    else:
                        print(f"  - {table_name:<35} ({count:,} rows)")
                except:
                    print(f"  - {table_name:<35} (error getting count)")

except Exception as e:
    print(f'Error: {e}')
