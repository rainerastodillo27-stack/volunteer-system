"""
Data archival and retention policy management.
Implements automated archival of old data and prevents unbounded growth.
"""

from datetime import datetime, timedelta, timezone
from typing import Any


RETENTION_DAYS = {
    "volunteer_time_logs": 730,        # 2 years
    "volunteer_project_joins": 365,    # 1 year
    "partner_reports": 365,            # 1 year
    "published_impact_reports": 730,   # 2 years
    "status_updates": 180,             # 6 months
    "project_group_messages": 180,     # 6 months
}

MAX_RECORDS_PER_TABLE = {
    "app_volunteer_time_logs_store": 5000,
    "app_volunteer_project_joins_store": 10000,
    "app_partner_reports_store": 2000,
    "app_published_impact_reports_store": 1000,
    "project_group_messages": 20000,
}


def apply_retention_policies(connection: Any) -> dict[str, int]:
    """
    Apply retention policies to hot storage tables.
    Returns count of records removed from each table.
    """
    removed_counts = {}
    
    retention_policies = [
        ("app_volunteer_time_logs_store", RETENTION_DAYS.get("volunteer_time_logs", 730)),
        ("app_volunteer_project_joins_store", RETENTION_DAYS.get("volunteer_project_joins", 365)),
        ("app_partner_reports_store", RETENTION_DAYS.get("partner_reports", 365)),
        ("app_published_impact_reports_store", RETENTION_DAYS.get("published_impact_reports", 730)),
    ]
    
    with connection.cursor() as cursor:
        for table_name, days_to_keep in retention_policies:
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
                continue
            
            cutoff_date = (datetime.now(timezone.utc) - timedelta(days=days_to_keep)).isoformat()
            
            # Delete old records
            cursor.execute(
                f"""
                delete from {table_name}
                where updated_at < %s::timestamp with time zone
                """,
                (cutoff_date,),
            )
            
            removed = cursor.rowcount
            if removed > 0:
                removed_counts[table_name] = removed
    
    return removed_counts


def enforce_max_record_limits(connection: Any) -> dict[str, int]:
    """
    Enforce maximum record limits per table.
    Removes oldest records when limit is exceeded.
    Returns count of records removed from each table.
    """
    removed_counts = {}
    
    with connection.cursor() as cursor:
        for table_name, max_records in MAX_RECORDS_PER_TABLE.items():
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
                continue
            
            # Count current records
            cursor.execute(f"select count(*) from {table_name}")
            current_count = cursor.fetchone()[0]
            
            if current_count > max_records:
                excess = current_count - max_records
                
                # Delete oldest records
                cursor.execute(
                    f"""
                    delete from {table_name}
                    where id in (
                        select id from {table_name}
                        order by updated_at asc
                        limit %s
                    )
                    """,
                    (excess,),
                )
                
                removed = cursor.rowcount
                if removed > 0:
                    removed_counts[table_name] = removed
    
    return removed_counts


def analyze_storage_growth(connection: Any) -> dict[str, Any]:
    """
    Analyze storage usage patterns.
    Returns information about which tables are consuming most space.
    """
    analysis = {}
    
    storage_tables = [
        "app_volunteer_time_logs_store",
        "app_volunteer_project_joins_store",
        "app_partner_reports_store",
        "app_published_impact_reports_store",
        "project_group_messages",
        "reports",
    ]
    
    with connection.cursor() as cursor:
        for table_name in storage_tables:
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
            
            # Get row count and approximate size
            cursor.execute(
                f"""
                select 
                    count(*) as row_count,
                    pg_total_relation_size('{table_name}') as total_bytes
                from {table_name}
                """
            )
            
            row_count, total_bytes = cursor.fetchone()
            
            if row_count > 0:
                analysis[table_name] = {
                    "row_count": row_count,
                    "total_bytes": total_bytes,
                    "avg_row_bytes": total_bytes // row_count if row_count > 0 else 0,
                }
    
    return analysis


def get_archival_recommendations(connection: Any) -> list[str]:
    """
    Analyze storage and provide archival recommendations.
    """
    recommendations = []
    analysis = analyze_storage_growth(connection)
    
    # Check for tables exceeding size thresholds
    size_thresholds = {
        "app_volunteer_time_logs_store": 50 * 1024 * 1024,      # 50 MB
        "project_group_messages": 100 * 1024 * 1024,            # 100 MB
        "app_partner_reports_store": 30 * 1024 * 1024,          # 30 MB
    }
    
    for table_name, max_size in size_thresholds.items():
        if table_name in analysis:
            info = analysis[table_name]
            if info["total_bytes"] > max_size:
                recommendations.append(
                    f"Archive old records from {table_name} "
                    f"({info['total_bytes'] / (1024 * 1024):.1f} MB exceeds {max_size / (1024 * 1024):.0f} MB limit)"
                )
    
    # Check for overly large average rows (indicates data bloat)
    for table_name, info in analysis.items():
        if info["avg_row_bytes"] > 100000:  # > 100 KB average per row
            recommendations.append(
                f"Optimize data structure in {table_name} "
                f"(average row size: {info['avg_row_bytes'] / 1024:.1f} KB is large)"
            )
    
    return recommendations


def main() -> None:
    """Generate archival report (for testing)."""
    try:
        from .db import get_connection
    except ImportError:
        from db import get_connection
    
    print("Data Archival Strategy Report")
    print("=" * 60)
    
    with get_connection() as connection:
        analysis = analyze_storage_growth(connection)
        
        print("\nStorage Analysis:")
        total_size = 0
        for table, info in sorted(analysis.items(), key=lambda x: x[1]["total_bytes"], reverse=True):
            size_mb = info["total_bytes"] / (1024 * 1024)
            print(f"\n{table}:")
            print(f"  Rows: {info['row_count']:,}")
            print(f"  Size: {size_mb:.2f} MB")
            print(f"  Avg row: {info['avg_row_bytes'] / 1024:.2f} KB")
            total_size += info["total_bytes"]
        
        print("\n" + "=" * 60)
        print(f"Total storage: {total_size / (1024 * 1024):.2f} MB")
        
        print("\n" + "=" * 60)
        print("Archival Recommendations:")
        recommendations = get_archival_recommendations(connection)
        if recommendations:
            for rec in recommendations:
                print(f"  • {rec}")
        else:
            print("  No archival needed - storage usage is optimal")


if __name__ == "__main__":
    main()
