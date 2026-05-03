#!/usr/bin/env python3
"""Quick test of query performance with new indices."""

import time
import psycopg
import os
from datetime import datetime, timezone

# Get database URL from environment
DB_URL = os.getenv("DATABASE_URL", "postgresql://postgres:password@aws-1-ap-southeast-1.pooler.supabase.com/postgres")

def test_projects_query():
    """Test the projects query performance."""
    try:
        with psycopg.connect(DB_URL, connect_timeout=10) as conn:
            with conn.cursor() as cur:
                # Test 1: Query without image_url
                start = time.time()
                query1 = """
                SELECT id, title, description, partner_id, image_hidden, program_module, 
                       is_event, parent_project_id, status_mode, manual_status, program_id, 
                       status, category, start_date, end_date, location, volunteers_needed, 
                       volunteers, joined_user_ids, skills_needed, internal_tasks, created_at, updated_at
                FROM projects WHERE is_event = false ORDER BY id ASC
                """
                cur.execute(query1)
                rows = cur.fetchall()
                elapsed1 = time.time() - start
                
                print(f"✓ Query without image_url: {len(rows)} rows in {elapsed1:.2f}s")
                
                # Test 2: Query with image_url
                start = time.time()
                query2 = """
                SELECT * FROM projects WHERE is_event = false ORDER BY id ASC
                """
                cur.execute(query2)
                rows = cur.fetchall()
                elapsed2 = time.time() - start
                
                print(f"✓ Query with image_url: {len(rows)} rows in {elapsed2:.2f}s")
                
                # Test 3: Events query
                start = time.time()
                query3 = """
                SELECT id, title, description, partner_id, image_hidden, program_module, 
                       is_event, parent_project_id, status_mode, manual_status, program_id, 
                       status, category, start_date, end_date, location, volunteers_needed, 
                       volunteers, joined_user_ids, skills_needed, internal_tasks, created_at, updated_at
                FROM projects WHERE is_event = true ORDER BY id ASC
                """
                cur.execute(query3)
                rows = cur.fetchall()
                elapsed3 = time.time() - start
                
                print(f"✓ Events query: {len(rows)} rows in {elapsed3:.2f}s")
                
                # Show index info
                print("\n📊 Indices on projects table:")
                cur.execute("""
                SELECT indexname, indexdef 
                FROM pg_indexes 
                WHERE tablename = 'projects' 
                ORDER BY indexname
                """)
                for idx_name, idx_def in cur.fetchall():
                    print(f"  - {idx_name}")
                
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    print("Testing query performance...\n")
    test_projects_query()
