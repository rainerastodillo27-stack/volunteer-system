import psycopg
from dotenv import load_dotenv
import os
import json

load_dotenv()
db_url = os.getenv("SUPABASE_DB_URL")
if not db_url:
    print("SUPABASE_DB_URL not found")
    exit(1)

with psycopg.connect(db_url) as conn:
    with conn.cursor() as cur:
        # Check projects
        cur.execute("SELECT id, internal_tasks FROM projects")
        rows = cur.fetchall()
        for project_id, tasks in rows:
            if tasks and not isinstance(tasks, list):
                print(f"Fixing project {project_id}: {type(tasks)}")
                cur.execute("UPDATE projects SET internal_tasks = %s WHERE id = %s", (json.dumps([]), project_id))
        
        # Check events
        cur.execute("SELECT id, internal_tasks FROM events")
        rows = cur.fetchall()
        for event_id, tasks in rows:
            if tasks and not isinstance(tasks, list):
                print(f"Fixing event {event_id}: {type(tasks)}")
                cur.execute("UPDATE events SET internal_tasks = %s WHERE id = %s", (json.dumps([]), event_id))
        
        conn.commit()
print("Cleanup done")
