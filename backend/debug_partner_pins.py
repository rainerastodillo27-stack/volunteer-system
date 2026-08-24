#!/usr/bin/env python3
import os, json
from dotenv import load_dotenv
load_dotenv()

import psycopg
from psycopg.rows import dict_row

db_url = os.getenv('SUPABASE_DB_URL')
conn = psycopg.connect(db_url, connect_timeout=5, row_factory=dict_row)
cur = conn.cursor()

print("=== ALL PROJECTS ===")
cur.execute("""
    SELECT projects_id, title, is_event, parent_project_id, partner_id, status, 
           location_region, location_city, location_barangay, location
    FROM projects;
""")
for r in cur.fetchall():
    print(dict(r))

conn.close()
