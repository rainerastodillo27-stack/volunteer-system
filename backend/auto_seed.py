#!/usr/bin/env python
"""
Auto-seed demo data on backend startup if database is empty.
This prevents the "all zeros" issue after npm stop/start.
Runs via direct SQL to avoid connection pool exhaustion from Python seed function.
"""
import sys
sys.path.insert(0, 'backend')
import os
from datetime import datetime, timedelta

def auto_seed_if_empty():
    """Check if tables are empty and seed demo data if needed."""
    try:
        from db import get_postgres_connection
        
        with get_postgres_connection() as conn:
            with conn.cursor() as cur:
                # Check if data already exists
                cur.execute("SELECT COUNT(*) FROM users WHERE role = %s", ('admin',))
                if cur.fetchone()[0] > 0:
                    print("[SEED] Demo data already exists, skipping auto-seed")
                    return
                
                print("[SEED] Database empty, auto-seeding demo data...")
                tomorrow = (datetime.now() + timedelta(days=1)).isoformat()
                today = datetime.now().isoformat()
                
                # Add users
                cur.execute("""
                    INSERT INTO users (id, email, name, role, password, created_at, updated_at) 
                    VALUES (gen_random_uuid()::text, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT DO NOTHING
                """, ('admin@nvc.org', 'Admin Account', 'admin', 'hashed', today, today))
                
                cur.execute("""
                    INSERT INTO users (id, email, name, role, password, created_at, updated_at) 
                    VALUES (gen_random_uuid()::text, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT DO NOTHING  
                """, ('volunteer@example.org', 'Sample Volunteer', 'volunteer', 'hashed', today, today))
                
                # Add programs
                for i in range(1, 5):
                    cur.execute("""
                        INSERT INTO programs (id, title, description, status, created_at, updated_at) 
                        VALUES (gen_random_uuid()::text, %s, %s, %s, %s, %s)
                        ON CONFLICT DO NOTHING
                    """, (f'Program {i}', f'Description for program {i}', 'active', today, today))
                
                # Add projects  
                for i in range(1, 5):
                    cur.execute("""
                        INSERT INTO projects (id, title, description, status, start_date, created_at, updated_at) 
                        VALUES (gen_random_uuid()::text, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT DO NOTHING
                    """, (f'Project {i}', f'Description for project {i}', 'active', tomorrow, today, today))
                
                # Add events
                for i in range(1, 5):
                    cur.execute("""
                        INSERT INTO events (id, title, description, status, start_date, created_at, updated_at) 
                        VALUES (gen_random_uuid()::text, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT DO NOTHING
                    """, (f'Event {i}', f'Description for event {i}', 'active', tomorrow, today, today))
                
                conn.commit()
                print("[SEED] ✓ Demo data auto-seeded successfully")
    except Exception as e:
        print(f"[SEED] Warning: Auto-seed failed: {type(e).__name__}: {e}")
        # Don't fail startup if seeding fails

if __name__ == '__main__':
    auto_seed_if_empty()
