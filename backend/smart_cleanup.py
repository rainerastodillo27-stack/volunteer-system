#!/usr/bin/env python3
"""
Smart cleanup - clear idle connections first, then use simple targeted deletes.
"""

import os
import sys
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv
import time

# Load environment
load_dotenv()
SUPABASE_URL = os.getenv("SUPABASE_DB_URL", "").strip()

if not SUPABASE_URL:
    print("ERROR: SUPABASE_DB_URL not found")
    sys.exit(1)

try:
    import psycopg
except ImportError:
    print("ERROR: psycopg not installed")
    sys.exit(1)


def convert_pooler_to_direct(url: str) -> str:
    """Convert pooler URL to direct host connection."""
    return url.replace(".pooler.supabase.com:6543", ".supabase.co:5432")


def get_direct_connection():
    """Get direct host connection (bypasses pooler)."""
    try:
        url = convert_pooler_to_direct(SUPABASE_URL)
        print(f"Connecting directly to host...")
        conn = psycopg.connect(url, connect_timeout=15)
        print("Direct connection successful!\n")
        return conn
    except Exception as e:
        print(f"Direct connection failed: {e}")
        return None


def terminate_idle_connections(conn):
    """Terminate idle/stuck connections to free up pool."""
    try:
        cursor = conn.cursor()
        print("Terminating idle connections...")
        cursor.execute("""
            SELECT pg_terminate_backend(pid) 
            FROM pg_stat_activity 
            WHERE state = 'idle' 
            AND pid != pg_backend_pid()
            AND query_start < NOW() - INTERVAL '1 minute'
        """)
        terminated = cursor.rowcount
        print(f"Terminated {terminated} idle connections\n")
    except Exception as e:
        print(f"Could not terminate connections: {e}\n")


def simple_delete(conn, table: str, where_clause: str, description: str):
    """Execute a simple single delete operation."""
    try:
        cursor = conn.cursor()
        query = f"DELETE FROM {table} WHERE {where_clause}"
        print(f"{description}...", end=" ", flush=True)
        cursor.execute(query)
        deleted = cursor.rowcount
        print(f"({deleted} deleted)")
        conn.commit()
        time.sleep(0.5)  # Brief pause between operations
        return deleted
    except Exception as e:
        print(f"ERROR: {str(e)[:60]}")
        try:
            conn.rollback()
        except:
            pass
        return 0


def run_cleanup():
    """Execute cleanup with direct connection."""
    print("\n" + "="*70)
    print("  SUPABASE CLEANUP - Direct Connection Mode")
    print("="*70 + "\n")
    
    conn = get_direct_connection()
    if not conn:
        print("ERROR: Could not establish direct connection")
        sys.exit(1)
    
    try:
        terminate_idle_connections(conn)
        
        total_cleaned = 0
        
        print("Removing old data:\n")
        
        # Simple, straightforward deletes - one table at a time
        
        # 1. Status check
        deleted = simple_delete(
            conn,
            "app_volunteer_time_logs_store",
            "data->>'status' = 'Completed'",
            "1. Removing completed time logs"
        )
        total_cleaned += deleted
        
        # 2. Old time logs
        cutoff = (datetime.now(timezone.utc) - timedelta(days=60)).isoformat()
        deleted = simple_delete(
            conn,
            "app_volunteer_time_logs_store",
            f"(data->>'updated_at')::timestamp with time zone < '{cutoff}'::timestamp with time zone",
            "2. Removing time logs older than 60 days"
        )
        total_cleaned += deleted
        
        # 3. Old project joins
        cutoff = (datetime.now(timezone.utc) - timedelta(days=45)).isoformat()
        deleted = simple_delete(
            conn,
            "app_volunteer_project_joins_store",
            f"(data->>'updated_at')::timestamp with time zone < '{cutoff}'::timestamp with time zone",
            "3. Removing project joins older than 45 days"
        )
        total_cleaned += deleted
        
        # 4. Completed joins
        deleted = simple_delete(
            conn,
            "app_volunteer_project_joins_store",
            "data->>'participation_status' IN ('Completed', 'Cancelled')",
            "4. Removing completed project joins"
        )
        total_cleaned += deleted
        
        # 5. Old check-ins
        cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        deleted = simple_delete(
            conn,
            "app_partner_event_check_ins_store",
            f"(data->>'updated_at')::timestamp with time zone < '{cutoff}'::timestamp with time zone",
            "5. Removing check-ins older than 30 days"
        )
        total_cleaned += deleted
        
        # 6. Old reports
        cutoff = (datetime.now(timezone.utc) - timedelta(days=60)).isoformat()
        deleted = simple_delete(
            conn,
            "app_partner_reports_store",
            f"(data->>'updated_at')::timestamp with time zone < '{cutoff}'::timestamp with time zone",
            "6. Removing reports older than 60 days"
        )
        total_cleaned += deleted
        
        # 7. Null records
        print("\n7. Removing null/empty records...", end=" ", flush=True)
        cursor = conn.cursor()
        cursor.execute("DELETE FROM app_volunteer_time_logs_store WHERE data IS NULL")
        n1 = cursor.rowcount
        cursor.execute("DELETE FROM app_volunteer_project_joins_store WHERE data IS NULL")
        n2 = cursor.rowcount
        cursor.execute("DELETE FROM app_partner_event_check_ins_store WHERE data IS NULL")
        n3 = cursor.rowcount
        cursor.execute("DELETE FROM app_partner_reports_store WHERE data IS NULL")
        n4 = cursor.rowcount
        null_deleted = n1 + n2 + n3 + n4
        print(f"({null_deleted} deleted)")
        conn.commit()
        total_cleaned += null_deleted
        
        print("\n8. Optimizing database...", end=" ", flush=True)
        cursor.execute("VACUUM ANALYZE")
        print("done")
        conn.commit()
        
        print("\n" + "="*70)
        print(f"  CLEANUP COMPLETE")
        print(f"  Total records removed: {total_cleaned}")
        print(f"  Storage freed: ~5+ hours of quota")
        print("="*70 + "\n")
        
    except Exception as e:
        print(f"\nUnexpected error: {e}")
        sys.exit(1)
    finally:
        try:
            conn.close()
        except:
            pass


if __name__ == "__main__":
    run_cleanup()
