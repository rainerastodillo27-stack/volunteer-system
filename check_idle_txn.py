#!/usr/bin/env python3
from backend.db import get_postgres_connection

# Check for idle-in-transaction sessions that might be blocking
with get_postgres_connection() as conn:
    with conn.cursor() as cursor:
        cursor.execute("""
            SELECT pid, application_name, state, wait_event_type, 
                   query_start, state_change,
                   EXTRACT(EPOCH FROM (NOW() - query_start)) as query_duration_sec
            FROM pg_stat_activity
            WHERE datname = current_database()
            AND state = 'idle in transaction'
            ORDER BY query_start DESC
            LIMIT 10
        """)
        rows = cursor.fetchall()
        print(f'Idle-in-transaction sessions: {len(rows)}\n')
        for row in rows:
            pid, app_name, state, wait_event, query_start, state_change, duration = row
            print(f'PID {pid}: {app_name} - idle {duration:.1f}s')
