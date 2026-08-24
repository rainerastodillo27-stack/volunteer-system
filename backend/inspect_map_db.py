#!/usr/bin/env python3
import os, json
from dotenv import load_dotenv
load_dotenv()

import psycopg
from psycopg.rows import dict_row

db_url = os.getenv('SUPABASE_DB_URL')
conn = psycopg.connect(db_url, connect_timeout=5, row_factory=dict_row)
cur = conn.cursor()

# First inspect schema of relevant tables
for table in ['partner_project_applications', 'projects', 'volunteer_event_joins', 'volunteer_matches', 'volunteers', 'partners']:
    cur.execute("""
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_schema='public' AND table_name=%s 
        ORDER BY ordinal_position;
    """, (table,))
    cols = cur.fetchall()
    print(f"\n=== {table} columns ===")
    for c in cols:
        print(f"  {c['column_name']} ({c['data_type']})")

conn.close()
