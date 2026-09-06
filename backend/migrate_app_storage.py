"""
Migrate data from old DB to new DB using app_storage JSON storage
"""
import json
import psycopg
from pathlib import Path
import os

# Load .env
env_file = Path(__file__).parent.parent / ".env"
if env_file.exists():
    with open(env_file) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                os.environ[key] = value

OLD_DB_URL = os.getenv("OLD_SUPABASE_DB_URL", "").strip()
NEW_DB_URL = os.getenv("SUPABASE_DB_URL")

# Collections to migrate from old DB hot storage
COLLECTIONS = [
    "partners", "volunteers", "users", "programs", 
    "projects", "events", "volunteerTimeLogs",
    "volunteerMatches", "partnerProjectApplications",
    "statusUpdates", "adminPlanningCalendars"
]

def fetch_old_data(old_conn, collection: str):
    """Fetch data from old database"""
    with old_conn.cursor() as cursor:
        # Try hot storage first
        table_name = f"hot_{collection.lower()}"
        cursor.execute(f"""
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' AND table_name = %s
            )
        """, (table_name,))
        
        if cursor.fetchone()[0]:
            cursor.execute(f'SELECT data FROM "{table_name}"')
            rows = cursor.fetchall()
            if rows:
                return [row[0] for row in rows]
        
        # Try regular table with JSONB aggregation
        cursor.execute(f"""
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' AND table_name = %s
            )
        """, (collection.lower(),))
        
        if cursor.fetchone()[0]:
            cursor.execute(f'SELECT row_to_json(t) FROM "{collection.lower()}" t')
            rows = cursor.fetchall()
            return [row[0] for row in rows]
    
    return []

def save_to_app_storage(new_conn, collection: str, data: list):
    """Save data to app_storage in new database"""
    if not data:
        return 0
    
    with new_conn.cursor() as cursor:
        cursor.execute("""
            INSERT INTO app_storage (key, value)
            VALUES (%s, %s::jsonb)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
        """, (collection, json.dumps(data)))
        new_conn.commit()
        return len(data)

def main():
    print("=" * 70)
    print("APP_STORAGE MIGRATION")
    print("=" * 70)
    print()
    
    if not OLD_DB_URL:
        raise RuntimeError("OLD_SUPABASE_DB_URL is not set.")
    old_conn = psycopg.connect(OLD_DB_URL)
    new_conn = psycopg.connect(NEW_DB_URL)
    
    print("Connected to both databases")
    print()
    
    total_records = 0
    
    for collection in COLLECTIONS:
        print(f"Migrating {collection}...", end=" ", flush=True)
        try:
            data = fetch_old_data(old_conn, collection)
            if data:
                count = save_to_app_storage(new_conn, collection, data)
                print(f"✓ ({count} records)")
                total_records += count
            else:
                print("(empty)")
        except Exception as e:
            print(f"✗ Error: {e}")
    
    print()
    print(f"Migration complete! {total_records} total records transferred")
    
    old_conn.close()
    new_conn.close()

if __name__ == "__main__":
    main()
