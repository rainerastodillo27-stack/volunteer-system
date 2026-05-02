import os
import psycopg
from dotenv import load_dotenv
from pathlib import Path

def test_db():
    load_dotenv('.env')
    url = os.getenv("SUPABASE_DB_URL")
    print(f"Connecting to: {url[:30]}...")
    try:
        conn = psycopg.connect(url, connect_timeout=5)
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
            print("Result:", cur.fetchone())
        conn.close()
        print("Success!")
    except Exception as e:
        print("Connection failed:", e)

if __name__ == "__main__":
    test_db()
