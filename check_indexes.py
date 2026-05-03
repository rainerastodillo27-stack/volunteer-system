#!/usr/bin/env python3
from backend.db import get_postgres_connection

with get_postgres_connection() as conn:
    with conn.cursor() as cursor:
        cursor.execute("""
            SELECT schemaname, tablename, indexname, indexdef
            FROM pg_indexes
            WHERE schemaname = 'public' AND tablename IN ('projects', 'events')
            ORDER BY tablename, indexname
        """)
        rows = cursor.fetchall()
        print(f'Total indexes on projects/events: {len(rows)}\n')
        for row in rows:
            print(f'Table: {row[1]}, Index: {row[2]}')
            print(f'  Definition: {row[3]}\n')
