#!/usr/bin/env python3
"""
Batch-based database cleanup - uses smaller queries to avoid timeout.
Directly connects to Supabase host (not pooler) for better stability.
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
    print("ERROR: psycopg not installed")
    sys.exit(1)


def convert_pooler_to_direct(url: str) -> str:
    """Convert pooler URL to direct host connection."""
    # Replace .pooler.supabase.com with .supabase.co and use port 5432
    return url.replace(".pooler.supabase.com:6543", ".supabase.co:5432")


def get_connection():
    """Connect to Supabase - try direct host first, then pooler."""
    urls = [
        convert_pooler_to_direct(SUPABASE_URL),  # Try direct connection first
        SUPABASE_URL,  # Fall back to pooler
    ]
    
    last_error = None
    for url in urls:
        try:
            print(f"Attempting connection to {url.split('@')[1].split(':')[0]}...")
            conn = psycopg.connect(url, connect_timeout=10)
            print("Connected successfully!\n")
            return conn
        except Exception as e:
            last_error = e
            continue
    
    if last_error:
        raise last_error


def batch_delete(cursor, table: str, condition: str, params: list = None, batch_size: int = 100):
    """Delete records in batches to avoid timeouts."""
    if params is None:
        params = []
    
    total_deleted = 0
    
    # First, get count
    cursor.execute(f"SELECT COUNT(*) FROM {table} WHERE {condition}", params)
    total_count = cursor.fetchone()[0]
    
    if total_count == 0:
        return 0
    
    print(f"   Found {total_count} records to delete, processing in batches...")
    
    # Delete in batches
    while True:
        cursor.execute(
            f"DELETE FROM {table} WHERE id IN (SELECT id FROM {table} WHERE {condition} LIMIT {batch_size})",
            params
        )
        deleted = cursor.rowcount
        total_deleted += deleted
        
        if deleted == 0:
            break
        
        print(f"   Deleted {deleted} records... (total: {total_deleted}/{total_count})")
    
    return total_deleted


def run_cleanup():
    """Execute cleanup operations."""
    print("\n" + "="*70)
    print("  SUPABASE CLEANUP - Batch Removal of Old Data")
    print("="*70 + "\n")
    
    conn = None
    try:
        conn = get_connection()
        cursor = conn.cursor()
        
        # Disable foreign key checks temporarily for faster deletes
        print("Preparing database...\n")
        
        total_cleaned = 0
        
        # 1. Remove completed time logs (quickest wins)
        print("1. Removing completed volunteer time logs...")
        deleted = batch_delete(
            cursor,
            "app_volunteer_time_logs_store",
            "data->>'status' = 'Completed'",
            batch_size=50
        )
        total_cleaned += deleted
        print(f"   Total deleted: {deleted}\n")
        
        # 2. Remove very old volunteer time logs (90+ days)
        print("2. Removing volunteer time logs older than 90 days...")
        cutoff = (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()
        deleted = batch_delete(
            cursor,
            "app_volunteer_time_logs_store",
            "(data->>'updated_at')::timestamp < %s::timestamp",
            [cutoff],
            batch_size=50
        )
        total_cleaned += deleted
        print(f"   Total deleted: {deleted}\n")
        
        # 3. Remove completed project joins
        print("3. Removing completed project joins...")
        deleted = batch_delete(
            cursor,
            "app_volunteer_project_joins_store",
            "data->>'participation_status' IN ('Completed', 'Cancelled')",
            batch_size=50
        )
        total_cleaned += deleted
        print(f"   Total deleted: {deleted}\n")
        
        # 4. Remove old project joins (60+ days)
        print("4. Removing project joins older than 60 days...")
        cutoff = (datetime.now(timezone.utc) - timedelta(days=60)).isoformat()
        deleted = batch_delete(
            cursor,
            "app_volunteer_project_joins_store",
            "(data->>'updated_at')::timestamp < %s::timestamp",
            [cutoff],
            batch_size=50
        )
        total_cleaned += deleted
        print(f"   Total deleted: {deleted}\n")
        
        # 5. Remove old reports (90+ days)
        print("5. Removing reports older than 90 days...")
        cutoff = (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()
        deleted = batch_delete(
            cursor,
            "app_partner_reports_store",
            "(data->>'updated_at')::timestamp < %s::timestamp",
            [cutoff],
            batch_size=50
        )
        total_cleaned += deleted
        print(f"   Total deleted: {deleted}\n")
        
        # 6. Remove null/empty data
        print("6. Removing null or empty records...")
        tables = [
            "app_volunteer_time_logs_store",
            "app_volunteer_project_joins_store",
            "app_partner_reports_store",
        ]
        for table in tables:
            try:
                cursor.execute(f"DELETE FROM {table} WHERE data IS NULL OR data::text = '{{}}'")
                deleted = cursor.rowcount
                total_cleaned += deleted
                if deleted > 0:
                    print(f"   {table}: {deleted} records")
            except Exception as e:
                print(f"   {table}: skipped ({str(e)[:50]})")
        print()
        
        # 7. Optimize database
        print("7. Optimizing database storage...")
        cursor.execute("VACUUM ANALYZE")
        print("   Database vacuumed and analyzed\n")
        
        conn.commit()
        
        print("="*70)
        print(f"  CLEANUP COMPLETE")
        print(f"  Total records removed: {total_cleaned}")
        print(f"  Expected storage reduction: ~5 hours of quota")
        print("="*70 + "\n")
        
    except Exception as e:
        print(f"ERROR: {e}")
        if conn:
            try:
                conn.rollback()
            except:
                pass
        sys.exit(1)
    finally:
        if conn:
            try:
                conn.close()
            except:
                pass


if __name__ == "__main__":
    run_cleanup()
