import json
from db import get_connection

def find_project_in_tasks():
    conn = get_connection()
    cur = conn.cursor()
    
    print("Searching in events.internal_tasks...")
    cur.execute("SELECT id, title, internal_tasks FROM events")
    rows = cur.fetchall()
    for row in rows:
        event_id, event_title, tasks = row
        if tasks:
            for task in tasks:
                task_str = json.dumps(task).lower()
                if "project" in task_str:
                    print(f"Event {event_id}: Task {task.get('id')} contains 'project'")
                    # print(f"  Task Data: {task}")

    print("\nSearching in projects.internal_tasks...")
    cur.execute("SELECT id, title, internal_tasks FROM projects")
    rows = cur.fetchall()
    for row in rows:
        proj_id, proj_title, tasks = row
        if tasks:
            for task in tasks:
                task_str = json.dumps(task).lower()
                if "project" in task_str:
                    print(f"Project {proj_id}: Task {task.get('id')} contains 'project'")
    
    conn.close()

if __name__ == "__main__":
    find_project_in_tasks()
