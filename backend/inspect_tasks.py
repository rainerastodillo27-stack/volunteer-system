import json
from db import get_postgres_connection

def inspect_internal_tasks():
    try:
        connection = get_postgres_connection()
        with connection.cursor() as cursor:
            print("=== SEARCHING FOR 'PROJECT' IN INTERNAL TASKS ===")
            cursor.execute("SELECT id, title, internal_tasks FROM events")
            rows = cursor.fetchall()
            found_any = False
            for row in rows:
                event_id, event_title, tasks = row
                if tasks:
                    for task in tasks:
                        task_str = json.dumps(task)
                        if "Project" in task_str or "project" in task_str:
                            found_any = True
                            print(f"Event: {event_title} ({event_id})")
                            print(f"  Task: {task}")
                
            cursor.execute("SELECT id, title, internal_tasks FROM projects")
            rows = cursor.fetchall()
            for row in rows:
                project_id, project_title, tasks = row
                if tasks:
                    for task in tasks:
                        task_str = json.dumps(task)
                        if "Project" in task_str or "project" in task_str:
                            found_any = True
                            print(f"Project: {project_title} ({project_id})")
                            print(f"  Task: {task}")
            
            if not found_any:
                print("No tasks found containing 'Project' or 'project' in their data.")
        connection.close()
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    inspect_internal_tasks()
