import json
from backend.db import get_connection

def consolidate_skills_and_tasks():
    print("Starting consolidation of skills and tasks...")
    try:
        with get_connection() as connection:
            # Tables to extract from
            source_tables = ['projects', 'events']
            
            all_skills = set()
            all_tasks = []

            with connection.cursor() as cursor:
                for table in source_tables:
                    print(f"Extracting from {table}...")
                    cursor.execute(f"SELECT skills_needed, internal_tasks FROM {table}")
                    rows = cursor.fetchall()
                    for skills_needed, internal_tasks_json in rows:
                        # Collect skills
                        if skills_needed:
                            for skill in skills_needed:
                                all_skills.add(skill)
                        
                        # Collect tasks
                        if internal_tasks_json:
                            tasks = json.loads(internal_tasks_json) if isinstance(internal_tasks_json, str) else internal_tasks_json
                            if isinstance(tasks, list):
                                for task in tasks:
                                    all_tasks.append(task)
                                    # Also collect skills from tasks
                                    task_skills = task.get("skillsNeeded", [])
                                    for skill in task_skills:
                                        all_skills.add(skill)

                print(f"Found {len(all_skills)} unique skills and {len(all_tasks)} tasks.")

                # Upsert skills
                print("Upserting skills into 'skills' table...")
                cursor.execute("ALTER TABLE skills ALTER COLUMN skills_id TYPE text")
                cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS skills_skills_id_idx ON skills (skills_id)")
                for skill in all_skills:
                    if skill and isinstance(skill, str):
                        cursor.execute("""
                            INSERT INTO skills (skills_id, name, created_at, updated_at)
                            VALUES (%s, %s, NOW(), NOW())
                            ON CONFLICT (skills_id) DO NOTHING
                        """, (str(skill), str(skill)))

                # Upsert tasks
                print("Upserting tasks into 'tasks' table...")
                for task in all_tasks:
                    cursor.execute("""
                        INSERT INTO tasks (
                            tasks_id, title, description, category, priority, status, 
                            assigned_volunteer_id, assigned_volunteer_name, is_field_officer, 
                            skills_needed, created_at, updated_at
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::boolean, %s::text[], NOW(), NOW())
                        ON CONFLICT (tasks_id) DO UPDATE SET
                            title = EXCLUDED.title,
                            description = EXCLUDED.description,
                            category = EXCLUDED.category,
                            priority = EXCLUDED.priority,
                            status = EXCLUDED.status,
                            assigned_volunteer_id = EXCLUDED.assigned_volunteer_id,
                            assigned_volunteer_name = EXCLUDED.assigned_volunteer_name,
                            is_field_officer = EXCLUDED.is_field_officer,
                            skills_needed = EXCLUDED.skills_needed,
                            updated_at = NOW()
                    """, (
                        task.get("id"),
                        task.get("title"),
                        task.get("description"),
                        task.get("category"),
                        task.get("priority"),
                        task.get("status"),
                        task.get("assignedVolunteerId"),
                        task.get("assignedVolunteerName"),
                        str(task.get("isFieldOfficer", False)),
                        task.get("skillsNeeded", [])
                    ))
            
            connection.commit()
            print("Consolidation complete.")
            
    except Exception as e:
        print(f"Error: {e}")
    finally:
        pass

if __name__ == "__main__":
    consolidate_skills_and_tasks()
