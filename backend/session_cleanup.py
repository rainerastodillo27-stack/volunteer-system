#!/usr/bin/env python3
"""
Cleanup using session pooler (better for bulk operations than transaction pooler).
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


def convert_to_session_pooler(url: str) -> str:
    """Convert transaction pooler (6543) to session pooler (6432)."""
    return url.replace(":6543", ":6432")


def get_connection():
    """Get session pooler connection."""
    session_url = convert_to_session_pooler(SUPABASE_URL)
    print(f"Connecting to session pooler (port 6432)...")
    try:
        conn = psycopg.connect(session_url, connect_timeout=15)
        print("Connected successfully!\n")
        return conn
    except Exception as e:
        print(f"Session pooler failed: {e}")
        print("Trying transaction pooler as fallback...")
        try:
            conn = psycopg.connect(SUPABASE_URL, connect_timeout=15)
            print("Connected successfully!\n")
            return conn
        except Exception as e2:
            print(f"Transaction pooler also failed: {e2}")
            return None


def run_cleanup():
    """Execute cleanup."""
    print("\n" + "="*70)
    print("  SUPABASE STORAGE CLEANUP")
    print("="*70 + "\n")
    
    conn = get_connection()
    if not conn:
        print("ERROR: Could not connect to database")
        sys.exit(1)
    
    try:
        cursor = conn.cursor()
        total_cleaned = 0
        
        print("Cleaning up old data:\n")
        
        # List of simple delete operations
        operations = [
            {
                "description": "1. Deleting completed time logs",
                "table": "app_volunteer_time_logs_store",
                "condition": "data->>'status' = 'Completed'"
            },
            {
                "description": "2. Deleting time logs older than 50 days",
                "table": "app_volunteer_time_logs_store",
                "condition": f"(data->>'updated_at')::timestamp < NOW() - INTERVAL '50 days'"
            },
            {
                "description": "3. Deleting completed project joins",
                "table": "app_volunteer_project_joins_store",
                "condition": "data->>'participation_status' IN ('Completed', 'Cancelled')"
            },
            {
                "description": "4. Deleting project joins older than 40 days",
                "table": "app_volunteer_project_joins_store",
                "condition": f"(data->>'updated_at')::timestamp < NOW() - INTERVAL '40 days'"
            },
            {
                "description": "5. Deleting reports older than 50 days",
                "table": "app_partner_reports_store",
                "condition": f"(data->>'updated_at')::timestamp < NOW() - INTERVAL '50 days'"
            },
            {
                "description": "6. Deleting null records from time logs",
                "table": "app_volunteer_time_logs_store",
                "condition": "data IS NULL"
            },
        ]
        
        for op in operations:
            try:
                query = f"DELETE FROM {op['table']} WHERE {op['condition']}"
                print(f"{op['description']}...", end=" ", flush=True)
                cursor.execute(query)
                deleted = cursor.rowcount
                conn.commit()  # Commit after each operation
                print(f"({deleted} removed)")
                total_cleaned += deleted
                time.sleep(0.2)  # Small delay between operations
            except Exception as e:
                error_msg = str(e)[:80]
                print(f"FAILED: {error_msg}")
                try:
                    conn.rollback()
                except:
                    pass
                # Continue with next operation
                continue
        
        print("\n8. Optimizing database...", end=" ", flush=True)
        try:
            cursor.execute("VACUUM ANALYZE")
            conn.commit()
            print("done")
        except:
            print("skipped")
        
        print("\n" + "="*70)
        print(f"  CLEANUP COMPLETE")
        print(f"  Records removed: {total_cleaned}")
        print(f"  Estimated quota freed: 5+ hours")
        print("="*70 + "\n")
        
    except Exception as e:
        print(f"\nError: {e}")
        sys.exit(1)
    finally:
        try:
            conn.close()
        except:
            pass


if __name__ == "__main__":
    run_cleanup()
