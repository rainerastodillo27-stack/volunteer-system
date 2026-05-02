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
        cur.execute("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, column_name")
        rows = cur.fetchall()
        print("Schema:")
        current_table = None
        for table, column in rows:
            if table != current_table:
                print(f"\nTable: {table}")
                current_table = table
            print(f" - {column}")
