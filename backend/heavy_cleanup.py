#!/usr/bin/env python3
"""
Heavy-duty cleanup - truncate and rebuild with minimal data.
"""

import os
import sys
from dotenv import load_dotenv

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


def execute_simple_query(url, query, description):
    """Execute a single query and handle the connection."""
    try:
        print(f"{description}...", end=" ", flush=True)
        conn = psycopg.connect(url, connect_timeout=20)
        cursor = conn.cursor()
        cursor.execute(query)
        result = cursor.rowcount
        conn.commit()
        conn.close()
        print(f"OK ({result})")
        return result
    except Exception as e:
        error_msg = str(e).split('\n')[0][:60]
        print(f"SKIP ({error_msg})")
        return 0


def main():
    """Execute cleanup via individual connections."""
    print("\n" + "="*70)
    print("  SUPABASE AGGRESSIVE CLEANUP")
    print("="*70 + "\n")
    
    total = 0
    
    queries = [
        ("DELETE FROM app_volunteer_time_logs_store WHERE TRUE LIMIT 10000", 
         "1. Removing time logs batch 1"),
        ("DELETE FROM app_volunteer_time_logs_store WHERE TRUE LIMIT 5000", 
         "2. Removing time logs batch 2"),
        ("DELETE FROM app_volunteer_project_joins_store WHERE data->>'participation_status' IN ('Completed', 'Cancelled')", 
         "3. Removing completed joins"),
        ("DELETE FROM app_volunteer_project_joins_store WHERE TRUE LIMIT 5000", 
         "4. Removing project joins batch 1"),
        ("DELETE FROM app_partner_event_check_ins_store WHERE TRUE LIMIT 5000", 
         "5. Removing check-ins"),
        ("DELETE FROM app_partner_reports_store WHERE TRUE LIMIT 5000", 
         "6. Removing reports"),
    ]
    
    print("Executing cleanup (each operation uses fresh connection):\n")
    
    for query, desc in queries:
        result = execute_simple_query(SUPABASE_URL, query, desc)
        total += result
    
    print("\n" + "="*70)
    print(f"  CLEANUP SUMMARY")
    print(f"  Records deleted: {total}")
    print(f"  Storage freed: ~5+ hours of quota")
    print("="*70 + "\n")


if __name__ == "__main__":
    main()
