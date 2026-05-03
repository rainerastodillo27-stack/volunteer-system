#!/usr/bin/env python3
from backend.db import get_postgres_connection

with get_postgres_connection() as conn:
    with conn.cursor() as cursor:
        cursor.execute('SELECT COUNT(*) FROM projects')
        p_count = cursor.fetchone()[0]
        cursor.execute('SELECT COUNT(*) FROM events')
        e_count = cursor.fetchone()[0]
        print(f'projects rows: {p_count}, events rows: {e_count}')
        
        # Get actual query that gets_relational_collection will run
        cursor.execute("""
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'projects' 
            ORDER BY ordinal_position
        """)
        print('\nprojects columns:')
        for col_name, col_type in cursor.fetchall():
            print(f'  {col_name}: {col_type}')
