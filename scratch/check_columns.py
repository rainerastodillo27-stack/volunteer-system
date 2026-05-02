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
        cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'program_tracks'")
        rows = cur.fetchall()
        print("Columns in program_tracks:")
        for row in rows:
            print(f" - {row[0]}")
