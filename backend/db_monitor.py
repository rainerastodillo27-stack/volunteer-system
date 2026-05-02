#!/usr/bin/env python3
"""
Database growth monitoring and auto-cleanup trigger.
Runs periodically to check database size and trigger cleanup if thresholds exceeded.

Usage:
  python db_monitor.py                  # Check current size
  python db_monitor.py --auto           # Check and auto-cleanup if needed
  python db_monitor.py --set-alert 350  # Set custom alert threshold (MB)
"""

import sys
import json
from datetime import datetime
from pathlib import Path

try:
    from db import get_connection
    from database_cleanup import (
        cleanup_old_time_logs,
        cleanup_old_project_joins,
        cleanup_old_reports,
        cleanup_orphaned_records,
        deduplicate_records,
        vacuum_analyze_tables,
        get_storage_stats,
    )
except ImportError:
    sys.exit("❌ Error: Run from backend/ directory or set PYTHONPATH")


# Thresholds (MB)
YELLOW_ALERT = 350    # 70% of 500 MB free plan
ORANGE_ALERT = 400    # 80%
RED_ALERT = 450       # 90%
CRITICAL = 480        # 96%

# Config file
CONFIG_FILE = Path(__file__).parent / ".db_monitor_config.json"


def load_config():
    """Load alert thresholds from config."""
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE) as f:
            return json.load(f)
    return {
        "yellow_mb": YELLOW_ALERT,
        "orange_mb": ORANGE_ALERT,
        "red_mb": RED_ALERT,
        "critical_mb": CRITICAL,
    }


def save_config(config):
    """Save alert thresholds to config."""
    with open(CONFIG_FILE, "w") as f:
        json.dump(config, f, indent=2)


def get_database_size():
    """Get current database size in MB."""
    try:
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT pg_size_pretty(pg_database_size('postgres')) as size, "
                    "round(pg_database_size('postgres') / 1024.0 / 1024.0) as size_mb"
                )
                result = cursor.fetchone()
                return {
                    "size_readable": result[0],
                    "size_mb": float(result[1]),
                    "percent_free": round((float(result[1]) / 500) * 100, 1),
                }
    except Exception as e:
        print(f"❌ Error querying database size: {e}")
        return None


def get_table_stats():
    """Get per-table size statistics."""
    try:
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT 
                        schemaname,
                        tablename,
                        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
                        round(pg_total_relation_size(schemaname||'.'||tablename) / 1024.0 / 1024.0) as size_mb,
                        n_live_tup as row_count
                    FROM pg_stat_user_tables
                    WHERE schemaname = 'public'
                    ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
                    LIMIT 15
                    """
                )
                tables = []
                for row in cursor.fetchall():
                    tables.append({
                        "table": row[1],
                        "size_readable": row[2],
                        "size_mb": float(row[3]),
                        "rows": row[4],
                    })
                return tables
    except Exception as e:
        print(f"⚠️  Could not fetch table stats: {e}")
        return []


def print_status(size_info):
    """Print database size status with color."""
    size_mb = size_info["size_mb"]
    percent = size_info["percent_free"]
    
    print(f"\n{'='*70}")
    print(f"  Database Size Status")
    print(f"{'='*70}")
    print(f"\nCurrent Size: {size_info['size_readable']} ({size_mb:.1f} MB)")
    print(f"Free Plan:   500 MB")
    print(f"Usage:       {percent:.1f}% of free tier")
    print(f"Remaining:   {500 - size_mb:.1f} MB")
    
    # Status indicator
    config = load_config()
    if size_mb >= config["critical_mb"]:
        status = "🔴 CRITICAL (>96%)"
        color = "RED"
    elif size_mb >= config["red_mb"]:
        status = "🔴 RED ALERT (90%+)"
        color = "RED"
    elif size_mb >= config["orange_mb"]:
        status = "🟠 ORANGE ALERT (80%+)"
        color = "ORANGE"
    elif size_mb >= config["yellow_mb"]:
        status = "🟡 YELLOW ALERT (70%+)"
        color = "YELLOW"
    else:
        status = "🟢 OK (<70%)"
        color = "GREEN"
    
    print(f"\nStatus:      {status}\n")
    
    return color


def print_top_tables():
    """Print largest tables."""
    print("Top 10 Largest Tables:")
    print("-" * 70)
    print(f"{'Table':<40} {'Size':>12} {'Rows':>15}")
    print("-" * 70)
    
    tables = get_table_stats()
    total_mb = 0
    total_rows = 0
    
    for table in tables:
        print(
            f"{table['table']:<40} {table['size_readable']:>12} {table['rows']:>15,}"
        )
        total_mb += table["size_mb"]
        total_rows += table["rows"]
    
    print("-" * 70)
    print(f"{'Subtotal (top 10):':<40} {total_mb:>12.2f} MB {total_rows:>15,}")
    print()


def trigger_cleanup(level="normal"):
    """Trigger cleanup based on alert level."""
    print(f"\n⏳ Running {level} cleanup...\n")
    
    try:
        with get_connection() as connection:
            # Remove old logs and reports
            print("  • Cleaning old time logs (>2 years)...")
            count1 = cleanup_old_time_logs(connection)
            print(f"    Removed {count1} records")
            
            print("  • Cleaning old project joins (>1 year)...")
            count2 = cleanup_old_project_joins(connection)
            print(f"    Removed {count2} records")
            
            print("  • Cleaning old reports (>1 year)...")
            count3 = cleanup_old_reports(connection)
            print(f"    Removed {count3} records")
            
            if level == "aggressive":
                print("  • Removing orphaned records...")
                count4 = cleanup_orphaned_records(connection)
                print(f"    Removed {count4} records")
                
                print("  • Deduplicating records...")
                count5 = deduplicate_records(connection)
                print(f"    Removed {count5} duplicates")
            
            print("  • Optimizing storage (VACUUM ANALYZE)...")
            vacuum_analyze_tables(connection)
            print("    Storage optimized")
            
            total = count1 + count2 + count3 + (count4 if level == "aggressive" else 0)
            print(f"\n✅ Cleanup complete: Removed {total:,} total records\n")
            return True
    except Exception as e:
        print(f"\n❌ Cleanup failed: {e}\n")
        return False


def main():
    """Main monitoring function."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Database growth monitoring")
    parser.add_argument("--auto", action="store_true", help="Auto-cleanup if thresholds exceeded")
    parser.add_argument("--aggressive", action="store_true", help="Run aggressive cleanup")
    parser.add_argument("--cleanup", action="store_true", help="Force cleanup (normal mode)")
    parser.add_argument("--set-alert", type=int, metavar="MB", help="Set yellow alert threshold")
    
    args = parser.parse_args()
    
    # Set custom alert threshold
    if args.set_alert:
        config = load_config()
        config["yellow_mb"] = args.set_alert
        save_config(config)
        print(f"✅ Yellow alert threshold set to {args.set_alert} MB")
        return
    
    # Get current size
    size_info = get_database_size()
    if not size_info:
        print("❌ Could not connect to database")
        return 1
    
    # Print status
    color = print_status(size_info)
    print_top_tables()
    
    # Auto-cleanup logic
    if args.auto or args.cleanup or args.aggressive:
        config = load_config()
        size_mb = size_info["size_mb"]
        
        if args.aggressive or size_mb >= config["red_mb"]:
            trigger_cleanup("aggressive")
        elif size_mb >= config["yellow_mb"]:
            trigger_cleanup("normal")
        else:
            print("✅ Database size is healthy, no cleanup needed")
    elif color != "GREEN":
        print(f"⚠️  Database is above safe threshold!")
        print(f"    Run with --auto flag to trigger cleanup automatically")
        print(f"    Or run: npm run db:maintenance\n")
    else:
        print(f"✅ Database growth is sustainable\n")


if __name__ == "__main__":
    exit_code = main()
    sys.exit(exit_code or 0)
