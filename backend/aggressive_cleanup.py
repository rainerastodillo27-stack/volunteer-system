#!/usr/bin/env python3
"""
Aggressive database cleanup to rapidly reduce Supabase usage below limits.
Removes old data with shorter retention periods using bulk operations.
"""

from datetime import datetime, timedelta, timezone
from typing import Any

try:
    from .db import get_connection
except ImportError:
    from db import get_connection


def get_aggressive_retention_policies() -> dict[str, int]:
    """
    Aggressive retention policies - much shorter retention to free up space quickly.
    """
    return {
        "volunteer_time_logs": 90,         # Keep only 3 months
        "volunteer_project_joins": 60,     # Keep only 2 months
        "partner_event_check_ins": 30,     # Keep only 1 month
        "partner_reports": 90,             # Keep only 3 months
        "published_impact_reports": 180,   # Keep 6 months
        "status_updates": 30,              # Keep only 1 month
        "project_group_messages": 30,      # Keep only 1 month
    }


def cleanup_table_bulk(connection: Any, table_name: str, days_to_keep: int) -> int:
    """Bulk delete old records from a table using a single query."""
    cutoff_date = (datetime.now(timezone.utc) - timedelta(days=days_to_keep)).isoformat()
    
    with connection.cursor() as cursor:
        # Check if table exists
        cursor.execute(
            """
            select exists (
                select 1 from information_schema.tables 
                where table_schema = 'public' and table_name = %s
            )
            """,
            (table_name,),
        )
        
        if not cursor.fetchone()[0]:
            return 0
        
        # Bulk delete old records
        try:
            cursor.execute(
                f"""
                delete from {table_name}
                where (data->>'updated_at')::timestamp with time zone < %s::timestamp with time zone
                """,
                (cutoff_date,),
            )
            return cursor.rowcount
        except Exception as e:
            print(f"Error deleting from {table_name}: {e}")
            return 0


def cleanup_completed_status(connection: Any, table_name: str, status_field: str = "status") -> int:
    """Remove all completed records regardless of date."""
    with connection.cursor() as cursor:
        # Check if table exists
        cursor.execute(
            """
            select exists (
                select 1 from information_schema.tables 
                where table_schema = 'public' and table_name = %s
            )
            """,
            (table_name,),
        )
        
        if not cursor.fetchone()[0]:
            return 0
        
        try:
            cursor.execute(
                f"""
                delete from {table_name}
                where data->>%s in ('Completed', 'Archived', 'Cancelled')
                """,
                (status_field,),
            )
            return cursor.rowcount
        except Exception as e:
            print(f"Error removing completed records from {table_name}: {e}")
            return 0


def remove_null_or_empty_data(connection: Any) -> int:
    """Remove records with null or empty data fields."""
    tables = [
        "app_volunteer_time_logs_store",
        "app_volunteer_project_joins_store",
        "app_partner_event_check_ins_store",
        "app_partner_reports_store",
        "published_impact_reports_store",
        "status_updates_store",
        "project_group_messages_store",
    ]
    
    total_deleted = 0
    with connection.cursor() as cursor:
        for table_name in tables:
            try:
                cursor.execute(
                    f"""
                    delete from {table_name}
                    where data is null or data = '{{}}'::jsonb or data::text = ''
                    """
                )
                deleted = cursor.rowcount
                total_deleted += deleted
                if deleted > 0:
                    print(f"  Removed {deleted} null/empty records from {table_name}")
            except Exception:
                pass
    
    return total_deleted


def vacuum_database(connection: Any) -> None:
    """Optimize database storage with VACUUM ANALYZE."""
    with connection.cursor() as cursor:
        cursor.execute("VACUUM ANALYZE")
        print("  Database vacuumed and analyzed")


def run_aggressive_cleanup() -> None:
    """Execute aggressive cleanup to reduce usage quickly."""
    print("\n" + "="*70)
    print("  AGGRESSIVE DATABASE CLEANUP - Rapid Usage Reduction")
    print("="*70 + "\n")
    
    try:
        connection = get_connection()
        
        print("Step 1: Remove completed/cancelled records...")
        removed_completed = cleanup_completed_status(connection, "app_volunteer_time_logs_store", "status")
        removed_completed += cleanup_completed_status(connection, "app_volunteer_project_joins_store", "participation_status")
        print(f"  Removed {removed_completed} completed records\n")
        
        print("Step 2: Remove records older than aggressive retention periods...")
        policies = get_aggressive_retention_policies()
        table_mapping = {
            "app_volunteer_time_logs_store": policies["volunteer_time_logs"],
            "app_volunteer_project_joins_store": policies["volunteer_project_joins"],
            "app_partner_event_check_ins_store": policies["partner_event_check_ins"],
            "app_partner_reports_store": policies["partner_reports"],
            "published_impact_reports_store": policies["published_impact_reports"],
            "status_updates_store": policies["status_updates"],
            "project_group_messages_store": policies["project_group_messages"],
        }
        
        total_old = 0
        for table, days in table_mapping.items():
            deleted = cleanup_table_bulk(connection, table, days)
            if deleted > 0:
                print(f"  Removed {deleted} old records from {table}")
            total_old += deleted
        print(f"  Total old records removed: {total_old}\n")
        
        print("Step 3: Remove null/empty records...")
        removed_null = remove_null_or_empty_data(connection)
        print(f"  Total null/empty records removed: {removed_null}\n")
        
        print("Step 4: Optimize database storage...")
        vacuum_database(connection)
        
        connection.commit()
        connection.close()
        
        print("\n" + "="*70)
        print(f"  CLEANUP COMPLETE - Freed up significant storage space")
        print(f"  Total records removed: {removed_completed + total_old + removed_null}")
        print("="*70 + "\n")
        
    except Exception as e:
        print(f"Error during cleanup: {e}")
        raise


if __name__ == "__main__":
    run_aggressive_cleanup()
