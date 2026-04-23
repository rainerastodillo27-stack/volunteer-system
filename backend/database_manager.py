#!/usr/bin/env python3
"""
Database maintenance manager - runs cleanup, archival, and optimization tasks.
Can be run manually or scheduled via cron/scheduled tasks.

Usage:
  python database_cleanup.py           # Run full cleanup
  python database_cleanup.py --report  # Generate storage report
"""

import sys
from datetime import datetime

try:
    from .db import get_connection
    from .database_cleanup import (
        cleanup_old_time_logs,
        cleanup_old_project_joins,
        cleanup_old_reports,
        cleanup_orphaned_records,
        deduplicate_records,
        vacuum_analyze_tables,
        get_storage_stats,
        get_retention_policies,
    )
    from .data_archival import get_archival_recommendations, analyze_storage_growth
except ImportError:
    from db import get_connection
    from database_cleanup import (
        cleanup_old_time_logs,
        cleanup_old_project_joins,
        cleanup_old_reports,
        cleanup_orphaned_records,
        deduplicate_records,
        vacuum_analyze_tables,
        get_storage_stats,
        get_retention_policies,
    )
    from data_archival import get_archival_recommendations, analyze_storage_growth


def print_header(text: str) -> None:
    """Print a formatted header."""
    print(f"\n{'=' * 70}")
    print(f"  {text}")
    print(f"{'=' * 70}\n")


def generate_report() -> None:
    """Generate a storage usage report."""
    print_header("Database Storage Report")
    
    with get_connection() as connection:
        analysis = analyze_storage_growth(connection)
        
        print("Storage Analysis by Table:")
        print("-" * 70)
        print(f"{'Table':<45} {'Rows':>10} {'Size':>12}")
        print("-" * 70)
        
        total_size = 0
        total_rows = 0
        
        for table, info in sorted(analysis.items(), key=lambda x: x[1]["total_bytes"], reverse=True):
            size_mb = info["total_bytes"] / (1024 * 1024)
            size_str = f"{size_mb:.2f} MB" if size_mb >= 1 else f"{info['total_bytes'] / 1024:.2f} KB"
            print(f"{table:<45} {info['row_count']:>10,} {size_str:>12}")
            total_size += info["total_bytes"]
            total_rows += info["row_count"]
        
        print("-" * 70)
        total_mb = total_size / (1024 * 1024)
        print(f"{'TOTAL':<45} {total_rows:>10,} {total_mb:>12.2f} MB")
        print()
        
        print("Archival Recommendations:")
        print("-" * 70)
        recommendations = get_archival_recommendations(connection)
        if recommendations:
            for i, rec in enumerate(recommendations, 1):
                print(f"  {i}. {rec}")
        else:
            print("  ✓ Storage usage is optimal - no archival needed")
        print()


def run_full_cleanup() -> None:
    """Run comprehensive database cleanup and optimization."""
    print_header("Running Full Database Cleanup")
    
    with get_connection() as connection:
        # Get initial stats
        print("1. Analyzing current storage...")
        initial_stats = get_storage_stats(connection)
        initial_total = sum(1 for _ in initial_stats.items())
        print(f"   Found {initial_total} storage tables")
        
        policies = get_retention_policies()
        total_deleted = 0
        
        # Run cleanup operations
        print("\n2. Running cleanup operations...")
        print("-" * 70)
        
        operations = [
            ("Removing old time logs (>730 days)", 
             lambda: cleanup_old_time_logs(connection, policies["volunteer_time_logs"])),
            ("Removing old project joins (>365 days)", 
             lambda: cleanup_old_project_joins(connection, policies["volunteer_project_joins"])),
            ("Removing old reports (>365 days)", 
             lambda: cleanup_old_reports(connection, policies["partner_reports"])),
            ("Removing orphaned records", 
             lambda: cleanup_orphaned_records(connection)),
            ("Removing duplicate records", 
             lambda: deduplicate_records(connection)),
        ]
        
        for operation_name, operation_func in operations:
            try:
                deleted = operation_func()
                status = f"✓ {deleted} records" if deleted > 0 else "✓ None found"
                print(f"  {operation_name:<50} {status:>15}")
                total_deleted += deleted
                connection.commit()
            except Exception as e:
                print(f"  {operation_name:<50} ✗ Error: {e}")
                connection.rollback()
        
        # Optimize storage
        print("\n3. Optimizing storage...")
        print("-" * 70)
        try:
            vacuum_analyze_tables(connection)
            connection.commit()
            print("  Storage optimization complete                        ✓")
        except Exception as e:
            print(f"  Storage optimization failed                          ✗ {e}")
            connection.rollback()
        
        # Get final stats
        print("\n4. Final storage analysis...")
        print("-" * 70)
        final_stats = get_storage_stats(connection)
        
        total_reduction = 0
        for table in initial_stats:
            if table in final_stats:
                reduction = initial_stats[table] - final_stats[table]
                total_reduction += reduction
        
        print(f"  Total records removed: {total_deleted:,}")
        print(f"  Estimated space freed: ~{(total_deleted * 1024):,} bytes")


def show_help() -> None:
    """Show help message."""
    print("""
Database Maintenance Manager
=============================

Usage:
  python database_manager.py [COMMAND]

Commands:
  (no command)    Run full database cleanup
  --report        Generate storage usage report
  --help          Show this help message

Cleanup Operations:
  • Removes time logs older than 730 days
  • Removes project joins older than 365 days
    • Removes reviewed reports older than 365 days
  • Removes orphaned records with missing references
  • Removes duplicate records

Retention Policies:
  Can be adjusted in database_cleanup.py and data_archival.py

Examples:
  python database_manager.py               # Full cleanup
  python database_manager.py --report      # View storage report
""")


def main() -> None:
    """Main entry point."""
    print(f"\n{'=' * 70}")
    print(f"  Database Maintenance Manager")
    print(f"  Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'=' * 70}")
    
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    
    if command == "--help" or command == "-h":
        show_help()
    elif command == "--report":
        generate_report()
    else:
        run_full_cleanup()
    
    print(f"\n{'=' * 70}")
    print(f"  Maintenance Complete: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'=' * 70}\n")


if __name__ == "__main__":
    main()
