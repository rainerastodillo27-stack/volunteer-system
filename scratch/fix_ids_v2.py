import psycopg
from dotenv import load_dotenv
import os

load_dotenv()
db_url = os.getenv("SUPABASE_DB_URL")

tables_to_fix = [
    "program_tracks",
    "programs",
    "projects",
    "events",
    "volunteers",
    "partners",
    "volunteer_event_joins",
    "admin_planning_calendars",
    "admin_planning_items",
    "reports",
    "messages",
    "project_group_messages"
]

with psycopg.connect(db_url) as conn:
    with conn.cursor() as cur:
        for table in tables_to_fix:
            expected_id_col = f"{table}_id"
            print(f"Trying to fix {table}...")
            try:
                cur.execute(f'ALTER TABLE "{table}" RENAME COLUMN "{expected_id_col}" TO "id"')
                conn.commit()
                print(f" - Success")
            except Exception as e:
                conn.rollback()
                print(f" - Skipped or failed: {e}")
