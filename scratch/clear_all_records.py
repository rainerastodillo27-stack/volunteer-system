import os
from dotenv import load_dotenv
import psycopg

# Use absolute path to load the workspace .env file
dotenv_path = r"c:\Users\ACER\OneDrive\Desktop\volunteer-system\.env"
load_dotenv(dotenv_path=dotenv_path)

db_url = os.getenv('SUPABASE_DB_URL')
if not db_url:
    print('No DB URL found in environment')
    raise SystemExit(1)

tables_to_clear = [
    "admin_planning_items",
    "admin_planning_calendars",
    "reports",
    "partner_project_applications",
    "volunteer_event_joins",
    "volunteer_time_logs",
    "volunteer_matches",
    "status_updates",
    "events",
    "tasks",
    "skills",
    "projects",
    "programs",
    "volunteers",
    "partners",
    "project_group_messages",
    "messages",
    "users"
]

print("Connecting to database...")
try:
    conn = psycopg.connect(db_url, connect_timeout=10)
    with conn.cursor() as cur:
        print("Trimming/Clearing tables...")
        for table in tables_to_clear:
            try:
                print(f"  Clearing {table}...")
                cur.execute(f"DELETE FROM {table};")
            except Exception as e:
                print(f"  Failed to delete from {table}: {e}")
                conn.rollback()
                try:
                    print(f"  Attempting TRUNCATE CASCADE on {table}...")
                    cur.execute(f"TRUNCATE TABLE {table} CASCADE;")
                except Exception as cascade_error:
                    print(f"  Failed TRUNCATE CASCADE on {table}: {cascade_error}")
                    conn.rollback()
        conn.commit()
    print("Database cleared successfully!")
except Exception as conn_error:
    print("Database connection or execution failed:", conn_error)
finally:
    if 'conn' in locals() and conn:
        conn.close()
