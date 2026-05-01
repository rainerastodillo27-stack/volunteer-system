"""
Fix internal task naming: Replace 'project-' prefix with 'event-' or 'task-' as appropriate.

Purpose:
- Updates task IDs that incorrectly use 'project-' prefix when they belong to events
- Maintains backward compatibility by updating all references
- Ensures task naming convention aligns with whether tasks are in events or projects
"""

try:
    from .db import get_connection
    from .operation_guard import SCHEMA_SETUP_UNLOCK_ENV_VAR, require_shared_db_unlock
except ImportError:
    from db import get_connection
    from operation_guard import SCHEMA_SETUP_UNLOCK_ENV_VAR, require_shared_db_unlock

import json


def fix_internal_task_names() -> None:
    """Fix internal task naming by replacing 'project-' with appropriate prefix."""
    
    require_shared_db_unlock(
        "fixing internal task names",
        SCHEMA_SETUP_UNLOCK_ENV_VAR
    )

    with get_connection() as connection:
        with connection.cursor() as cursor:
            # Fix event tasks
            print("Fixing internal task names in events table...")
            cursor.execute("SELECT id, title, internal_tasks FROM events")
            events = cursor.fetchall()
            
            tasks_updated = 0
            for event_id, event_title, internal_tasks in events:
                if not internal_tasks:
                    continue
                
                tasks_list = internal_tasks if isinstance(internal_tasks, list) else json.loads(internal_tasks) if isinstance(internal_tasks, str) else []
                updated = False
                
                for task in tasks_list:
                    # If task ID starts with 'project-' and belongs to an event, rename it
                    if isinstance(task.get('id'), str) and task['id'].startswith('project-'):
                        old_id = task['id']
                        # Replace 'project-' with 'event-'
                        task['id'] = old_id.replace('project-', 'event-', 1)
                        updated = True
                        tasks_updated += 1
                        print(f"  Event '{event_title}': {old_id} → {task['id']}")
                
                if updated:
                    cursor.execute(
                        "UPDATE events SET internal_tasks = %s WHERE id = %s",
                        (json.dumps(tasks_list), event_id)
                    )
            
            # Fix project tasks (if they exist)
            print("\nFixing internal task names in projects table...")
            cursor.execute("SELECT id, title, internal_tasks FROM projects WHERE is_event = false")
            projects = cursor.fetchall()
            
            for project_id, project_title, internal_tasks in projects:
                if not internal_tasks:
                    continue
                
                tasks_list = internal_tasks if isinstance(internal_tasks, list) else json.loads(internal_tasks) if isinstance(internal_tasks, str) else []
                updated = False
                
                for task in tasks_list:
                    # If task ID starts with 'project-' and belongs to a project (not event), it's correct
                    # Just ensure consistency
                    if isinstance(task.get('id'), str) and not task['id'].startswith('task-') and not task['id'].startswith('project-'):
                        old_id = task['id']
                        # Rename to 'task-' prefix
                        task['id'] = f"task-{old_id}"
                        updated = True
                        tasks_updated += 1
                        print(f"  Project '{project_title}': {old_id} → {task['id']}")
                
                if updated:
                    cursor.execute(
                        "UPDATE projects SET internal_tasks = %s WHERE id = %s",
                        (json.dumps(tasks_list), project_id)
                    )
            
            connection.commit()
        
        print(f"\n✓ Internal task naming fixed.")
        print(f"  - Total tasks updated: {tasks_updated}")
        print(f"  - Event task IDs now use 'event-' prefix")
        print(f"  - Project task IDs now use 'task-' or 'project-' prefix")


if __name__ == "__main__":
    fix_internal_task_names()
