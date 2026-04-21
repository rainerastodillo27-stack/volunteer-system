#!/usr/bin/env python3
"""
Direct aggressive database cleanup - bypasses complex imports.
Connects directly to Supabase and removes old/unused data.
"""

import os
import sys
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv

# Load environment
load_dotenv()
SUPABASE_URL = os.getenv("SUPABASE_DB_URL", "").strip()

if not SUPABASE_URL:
    print("ERROR: SUPABASE_DB_URL not found in environment")
    sys.exit(1)

try:
    import psycopg
except ImportError:
    print("ERROR: psycopg not installed. Install with: pip install psycopg[binary]")
    sys.exit(1)


def get_connection():
    """Connect directly to Supabase PostgreSQL."""
    return psycopg.connect(SUPABASE_URL, connect_timeout=5)


def run_cleanup():
    """Execute cleanup operations."""
    print("\n" + "="*70)
    print("  SUPABASE CLEANUP - Removing Old Data")
    print("="*70 + "\n")
    
    conn = None
    try:
        conn = get_connection()
        cursor = conn.cursor()
        
        # 1. Remove very old volunteer time logs (keep only last 90 days)
        print("1. Removing volunteer time logs older than 90 days...")
        cutoff = (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()
        cursor.execute(
            "DELETE FROM app_volunteer_time_logs_store WHERE (data->>'updated_at')::timestamp < %s::timestamp",
            (cutoff,)
        )
        print(f"   Deleted {cursor.rowcount} records\n")
        
        # 2. Remove completed time logs (all of them)
        print("2. Removing ALL completed volunteer time logs...")
        cursor.execute(
            "DELETE FROM app_volunteer_time_logs_store WHERE data->>'status' = 'Completed'"
        )
        print(f"   Deleted {cursor.rowcount} records\n")
        
        # 3. Remove old project joins (keep only 60 days)
        print("3. Removing project joins older than 60 days...")
        cutoff = (datetime.now(timezone.utc) - timedelta(days=60)).isoformat()
        cursor.execute(
            "DELETE FROM app_volunteer_project_joins_store WHERE (data->>'updated_at')::timestamp < %s::timestamp",
            (cutoff,)
        )
        print(f"   Deleted {cursor.rowcount} records\n")
        
        # 4. Remove completed project joins
        print("4. Removing ALL completed project joins...")
        cursor.execute(
            "DELETE FROM app_volunteer_project_joins_store WHERE data->>'participation_status' IN ('Completed', 'Cancelled')"
        )
        print(f"   Deleted {cursor.rowcount} records\n")
        
        # 5. Remove old event check-ins (keep only 30 days)
        print("5. Removing event check-ins older than 30 days...")
        cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        cursor.execute(
            "DELETE FROM app_partner_event_check_ins_store WHERE (data->>'updated_at')::timestamp < %s::timestamp",
            (cutoff,)
        )
        print(f"   Deleted {cursor.rowcount} records\n")
        
        # 6. Remove old reports (keep only 90 days)
        print("6. Removing partner reports older than 90 days...")
        cutoff = (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()
        cursor.execute(
            "DELETE FROM app_partner_reports_store WHERE (data->>'updated_at')::timestamp < %s::timestamp",
            (cutoff,)
        )
        print(f"   Deleted {cursor.rowcount} records\n")
        
        # 7. Remove old status updates (keep only 30 days)
        print("7. Removing status updates older than 30 days...")
        cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        try:
            cursor.execute(
                "DELETE FROM status_updates_store WHERE (data->>'updated_at')::timestamp < %s::timestamp",
                (cutoff,)
            )
            print(f"   Deleted {cursor.rowcount} records\n")
        except:
            print("   Table not found or error - skipping\n")
        
        # 8. Remove old messages (keep only 30 days)
        print("8. Removing messages older than 30 days...")
        cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        try:
            cursor.execute(
                "DELETE FROM project_group_messages_store WHERE (data->>'created_at')::timestamp < %s::timestamp",
                (cutoff,)
            )
            print(f"   Deleted {cursor.rowcount} records\n")
        except:
            print("   Table not found or error - skipping\n")
        
        # 9. Remove null/empty data
        print("9. Removing null or empty records...")
        tables = [
            "app_volunteer_time_logs_store",
            "app_volunteer_project_joins_store",
            "app_partner_event_check_ins_store",
            "app_partner_reports_store",
        ]
        total_null_deleted = 0
        for table in tables:
            try:
                cursor.execute(f"DELETE FROM {table} WHERE data IS NULL OR data::text = '{{}}'")
                deleted = cursor.rowcount
                total_null_deleted += deleted
                if deleted > 0:
                    print(f"   {table}: deleted {deleted} null records")
            except:
                pass
        print(f"   Total null records deleted: {total_null_deleted}\n")
        
        # 10. Optimize database
        print("10. Optimizing database...")
        cursor.execute("VACUUM ANALYZE")
        print("   Database optimized\n")
        
        conn.commit()
        
        print("="*70)
        print("  CLEANUP COMPLETE - Supabase usage reduced")
        print("="*70 + "\n")
        
    except Exception as e:
        print(f"ERROR: {e}")
        if conn:
            conn.rollback()
        sys.exit(1)
    finally:
        if conn:
            conn.close()


if __name__ == "__main__":
    run_cleanup()
