from dotenv import load_dotenv
import os

load_dotenv()
DATABASE_URL = os.getenv("SUPABASE_DB_URL")
if not DATABASE_URL:
    raise SystemExit("SUPABASE_DB_URL not set in environment")

import psycopg

SQL = """
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS skills_needed jsonb NOT NULL DEFAULT '[]'::jsonb;
"""

print("Connecting to database...")
with psycopg.connect(DATABASE_URL) as conn:
    with conn.cursor() as cur:
        print("Executing ALTER TABLE...")
        cur.execute(SQL)
        conn.commit()
print("Done: column ensured.")
