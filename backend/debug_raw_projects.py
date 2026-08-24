#!/usr/bin/env python3
import os, json
from dotenv import load_dotenv
load_dotenv()

import psycopg
from psycopg.rows import dict_row

db_url = os.getenv('SUPABASE_DB_URL')
conn = psycopg.connect(db_url, connect_timeout=5, row_factory=dict_row)
cur = conn.cursor()

cur.execute("SELECT projects_id, title, is_event, parent_project_id, partner_id, status, location FROM projects;")
rows = cur.fetchall()
print(f"Total projects in DB: {len(rows)}")
for r in rows:
    print(f"ID: {r['projects_id']}, Title: {r['title']}, isEvent: {r['is_event']}, parentProjectId: {r['parent_project_id']}, partnerId: {r['partner_id']}, location: {r['location']}")

conn.close()
