import psycopg
from dotenv import load_dotenv
import os

load_dotenv()
db_url = os.getenv("SUPABASE_DB_URL")
if not db_url:
    print("SUPABASE_DB_URL not found")
    exit(1)

with psycopg.connect(db_url) as conn:
    with conn.cursor() as cur:
        # Get all tables in public schema
        cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")
        tables = [row[0] for row in cur.fetchall()]
        
        for table in tables:
            expected_id_col = f"{table}_id"
            # Check if this column exists
            cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name = %s AND column_name = %s", (table, expected_id_col))
            if cur.fetchone():
                print(f"Renaming {table}.{expected_id_col} to id...")
                try:
                    cur.execute(f'ALTER TABLE "{table}" RENAME COLUMN "{expected_id_col}" TO "id"')
                    conn.commit()
                    print(f" - Success")
                except Exception as e:
                    conn.rollback()
                    print(f" - Failed: {e}")
            else:
                print(f"Table {table} does not have column {expected_id_col}")
