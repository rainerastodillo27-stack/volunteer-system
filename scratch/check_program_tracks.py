import psycopg, os, json
from dotenv import load_dotenv
load_dotenv()
url = os.getenv("SUPABASE_DB_URL")
with psycopg.connect(url) as conn:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT column_name, data_type FROM information_schema.columns "
            "WHERE table_schema='public' AND table_name='program_tracks' "
            "ORDER BY ordinal_position"
        )
        cols = cur.fetchall()
        print("program_tracks columns:")
        for row in cols:
            print(" ", row)
        
        # Also try a direct insert
        cur.execute("SELECT * FROM program_tracks LIMIT 2")
        rows = cur.fetchall()
        print(f"\nExisting rows: {len(rows)}")
        for row in rows:
            print(" ", row)
