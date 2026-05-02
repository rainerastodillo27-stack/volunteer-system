from db import get_connection
import json

def list_all_tasks():
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id, title, internal_tasks FROM events")
        rows = cur.fetchall()
        for row in rows:
            event_id, event_title, tasks = row
            print(f"Event: {event_title} ({event_id})")
            if tasks:
                for task in tasks:
                    print(f"  - ID: {task.get('id')}")
                    print(f"    Title: {task.get('title')}")
                    print(f"    Description: {task.get('description')}")
            else:
                print("  No tasks.")

if __name__ == "__main__":
    list_all_tasks()
