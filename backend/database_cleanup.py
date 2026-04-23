"""
Database cleanup and archival script to reduce Supabase storage usage.
Removes old records and optimizes data retention.
"""

import json
from datetime import datetime, timedelta, timezone
from typing import Any

try:
    from .db import get_connection
except ImportError:
    from db import get_connection


def get_retention_policies() -> dict[str, int]:
    """
    Returns retention policies (days to keep) for different record types.
    Adjust these values based on your requirements.
    """
    return {
        "volunteer_time_logs": 730,      # Keep 2 years
        "volunteer_project_joins": 365,  # Keep 1 year for active projects
        "partner_reports": 365,          # Keep 1 year
        "published_impact_reports": 730, # Keep 2 years
        "status_updates": 180,           # Keep 6 months for completed projects
        "project_group_messages": 180,   # Keep 6 months of chat
    }


def cleanup_old_time_logs(connection: Any, days_to_keep: int = 730) -> int:
    """Remove volunteer time logs older than the retention period."""
    cutoff_date = (datetime.now(timezone.utc) - timedelta(days=days_to_keep)).isoformat()
    
    with connection.cursor() as cursor:
        # Check if table exists
        cursor.execute(
            """
            select exists (
                select 1 from information_schema.tables 
                where table_schema = 'public' and table_name = 'app_volunteer_time_logs_store'
            )
            """
        )
        if not cursor.fetchone()[0]:
            return 0
        
        # Get records to delete (old and completed)
        cursor.execute(
            """
            select id, data
            from app_volunteer_time_logs_store
            where (
                (data->>'updated_at')::timestamp with time zone < %s::timestamp with time zone
                or data->>'status' = 'Completed'
            )
            order by updated_at asc
            limit 1000
            """,
            (cutoff_date,),
        )
        
        old_records = cursor.fetchall()
        deleted_count = 0
        
        for record_id, _ in old_records:
            cursor.execute(
                "delete from app_volunteer_time_logs_store where id = %s",
                (record_id,),
            )
            deleted_count += 1
        
        return deleted_count


def cleanup_old_project_joins(connection: Any, days_to_keep: int = 365) -> int:
    """Remove old volunteer project joins, keeping only recent/active ones."""
    cutoff_date = (datetime.now(timezone.utc) - timedelta(days=days_to_keep)).isoformat()
    
    with connection.cursor() as cursor:
        cursor.execute(
            """
            select exists (
                select 1 from information_schema.tables 
                where table_schema = 'public' and table_name = 'app_volunteer_project_joins_store'
            )
            """
        )
        if not cursor.fetchone()[0]:
            return 0
        
        cursor.execute(
            """
            select id
            from app_volunteer_project_joins_store
            where data->>'participation_status' = 'Completed'
            and (data->>'updated_at')::timestamp with time zone < %s::timestamp with time zone
            limit 1000
            """,
            (cutoff_date,),
        )
        
        old_joins = cursor.fetchall()
        deleted_count = 0
        
        for (record_id,) in old_joins:
            cursor.execute(
                "delete from app_volunteer_project_joins_store where id = %s",
                (record_id,),
            )
            deleted_count += 1
        
        return deleted_count


def cleanup_old_reports(connection: Any, days_to_keep: int = 365) -> int:
    """Remove old reports."""
    cutoff_date = (datetime.now(timezone.utc) - timedelta(days=days_to_keep)).isoformat()
    
    with connection.cursor() as cursor:
        cursor.execute(
            """
            select exists (
                select 1 from information_schema.tables 
                where table_schema = 'public' and table_name = 'app_partner_reports_store'
            )
            """
        )
        if not cursor.fetchone()[0]:
            return 0
        
        cursor.execute(
            """
            select id
            from app_partner_reports_store
            where data->>'status' = 'Reviewed'
            and (data->>'updated_at')::timestamp with time zone < %s::timestamp with time zone
            limit 1000
            """,
            (cutoff_date,),
        )
        
        old_reports = cursor.fetchall()
        deleted_count = 0
        
        for (record_id,) in old_reports:
            cursor.execute(
                "delete from app_partner_reports_store where id = %s",
                (record_id,),
            )
            deleted_count += 1
        
        return deleted_count


def cleanup_orphaned_records(connection: Any) -> int:
    """Remove records referencing non-existent projects or volunteers."""
    deleted_count = 0
    
    with connection.cursor() as cursor:
        tables_to_check = [
            ("app_volunteer_project_joins_store", "data->>'projectId'"),
            ("app_partner_project_applications_store", "data->>'projectId'"),
            ("app_volunteer_time_logs_store", "data->>'projectId'"),
        ]
        
        for table_name, project_id_field in tables_to_check:
            cursor.execute(
                f"""
                select exists (
                    select 1 from information_schema.tables 
                    where table_schema = 'public' and table_name = '{table_name}'
                )
                """
            )
            if not cursor.fetchone()[0]:
                continue
            
            cursor.execute(
                f"""
                select id
                from {table_name}
                where not exists (
                    select 1 from app_projects_store p 
                    where p.id = {project_id_field}
                )
                and {project_id_field} is not null
                and {project_id_field} != ''
                limit 500
                """
            )
            
            orphaned = cursor.fetchall()
            for (record_id,) in orphaned:
                cursor.execute(
                    f"delete from {table_name} where id = %s",
                    (record_id,),
                )
                deleted_count += 1
    
    return deleted_count


def deduplicate_records(connection: Any) -> int:
    """Remove duplicate records, keeping the most recent."""
    deleted_count = 0
    
    with connection.cursor() as cursor:
        # Check for duplicates in volunteer time logs
        cursor.execute(
            """
            select exists (
                select 1 from information_schema.tables 
                where table_schema = 'public' and table_name = 'app_volunteer_time_logs_store'
            )
            """
        )
        if cursor.fetchone()[0]:
            cursor.execute(
                """
                with duplicates as (
                    select id, data,
                           row_number() over (
                               partition by 
                                 data->>'volunteerId',
                                 data->>'projectId',
                                 (data->>'logDate')
                               order by updated_at desc
                           ) as rn
                    from app_volunteer_time_logs_store
                )
                select id from duplicates where rn > 1
                """
            )
            
            dup_ids = cursor.fetchall()
            for (dup_id,) in dup_ids:
                cursor.execute(
                    "delete from app_volunteer_time_logs_store where id = %s",
                    (dup_id,),
                )
                deleted_count += 1
    
    return deleted_count


def vacuum_analyze_tables(connection: Any) -> None:
    """Run VACUUM and ANALYZE to optimize storage."""
    hot_storage_tables = [
        "app_volunteer_time_logs_store",
        "app_volunteer_project_joins_store",
        "app_partner_reports_store",
        "app_published_impact_reports_store",
        "app_status_updates_store",
        "project_group_messages",
    ]
    
    with connection.cursor() as cursor:
        for table_name in hot_storage_tables:
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
                continue
            
            try:
                cursor.execute(f"VACUUM ANALYZE {table_name}")
            except Exception as e:
                print(f"Warning: Could not VACUUM {table_name}: {e}")


def get_storage_stats(connection: Any) -> dict[str, int]:
    """Get current storage usage by table."""
    stats = {}
    
    hot_storage_tables = [
        "app_volunteer_time_logs_store",
        "app_volunteer_project_joins_store",
        "app_partner_reports_store",
        "app_published_impact_reports_store",
        "app_status_updates_store",
        "project_group_messages",
        "messages",
        "reports",
    ]
    
    with connection.cursor() as cursor:
        for table_name in hot_storage_tables:
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
                continue
            
            cursor.execute(f"select count(*) from {table_name}")
            count = cursor.fetchone()[0]
            stats[table_name] = count
    
    return stats


def main() -> None:
    """Run all cleanup operations."""
    print("Starting database cleanup and optimization...")
    print("=" * 60)
    
    with get_connection() as connection:
        # Get initial stats
        print("\nInitial storage stats:")
        initial_stats = get_storage_stats(connection)
        for table, count in sorted(initial_stats.items()):
            print(f"  {table}: {count} records")
        
        policies = get_retention_policies()
        
        # Run cleanup operations
        print("\n" + "=" * 60)
        print("Running cleanup operations...")
        print("=" * 60)
        
        operations = [
            ("Removing old time logs", lambda: cleanup_old_time_logs(connection, policies["volunteer_time_logs"])),
            ("Removing old project joins", lambda: cleanup_old_project_joins(connection, policies["volunteer_project_joins"])),
            ("Removing old reports", lambda: cleanup_old_reports(connection, policies["partner_reports"])),
            ("Removing orphaned records", lambda: cleanup_orphaned_records(connection)),
            ("Removing duplicate records", lambda: deduplicate_records(connection)),
        ]
        
        total_deleted = 0
        for operation_name, operation_func in operations:
            print(f"\n{operation_name}...")
            try:
                deleted = operation_func()
                total_deleted += deleted
                if deleted > 0:
                    print(f"  ✓ Deleted {deleted} records")
                    connection.commit()
                else:
                    print(f"  ✓ No records to delete")
            except Exception as e:
                print(f"  ✗ Error: {e}")
                connection.rollback()
        
        # Optimize storage
        print("\n" + "=" * 60)
        print("Optimizing storage...")
        try:
            vacuum_analyze_tables(connection)
            connection.commit()
            print("✓ Storage optimization complete")
        except Exception as e:
            print(f"✗ Error during optimization: {e}")
            connection.rollback()
        
        # Get final stats
        print("\n" + "=" * 60)
        print("Final storage stats:")
        final_stats = get_storage_stats(connection)
        for table, count in sorted(final_stats.items()):
            initial_count = initial_stats.get(table, 0)
            reduction = initial_count - count
            print(f"  {table}: {count} records (removed {reduction})")
        
        print("\n" + "=" * 60)
        print(f"✓ Total records deleted: {total_deleted}")
        print("Database cleanup complete!")


if __name__ == "__main__":
    main()
