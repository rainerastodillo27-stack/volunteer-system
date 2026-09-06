"""
Data Migration Script - Transfer all data from old Supabase DB to new Supabase DB
"""
import os
import sys
from typing import Any, Dict, List
import psycopg
from pathlib import Path

# Load environment variables
env_file = Path(__file__).parent.parent / ".env"
if env_file.exists():
    with open(env_file) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                os.environ[key] = value

# The source database must be supplied explicitly when this legacy migration
# utility is used; never keep an old Supabase credential in the repository.
OLD_DB_URL = os.getenv("OLD_SUPABASE_DB_URL", "").strip()
# New database connection string (from .env)
NEW_DB_URL = os.getenv("SUPABASE_DB_URL")

# Tables to migrate in order (respecting foreign key dependencies)
MIGRATION_ORDER = [
    # Core tables first
    "app_storage",
    "users",
    "partners",
    "volunteers",
    "programs",
    "projects",
    "events",
    
    # Dependent tables
    "messages",
    "project_group_messages",
    "volunteer_time_logs",
    "volunteer_project_joins",
    "volunteer_matches",
    "partner_reports",
    "partner_project_applications",
    "status_updates",
    "admin_planning_calendars",
    
    # Hot storage tables (if they exist)
    "hot_users",
    "hot_partners",
    "hot_volunteers",
    "hot_programs",
    "hot_projects",
    "hot_events",
    "hot_volunteer_time_logs",
    "hot_volunteer_project_joins",
    "hot_volunteer_matches",
    "hot_partner_reports",
    "hot_partner_project_applications",
    "hot_status_updates",
    "hot_admin_planning_calendars",
    
    # Relational mirror tables (if they exist)
    "relational_partners",
    "relational_volunteers",
    "relational_projects",
    "relational_events",
]


def get_table_exists(cursor, table_name: str) -> bool:
    """Check if table exists in database"""
    cursor.execute("""
        SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = %s
        )
    """, (table_name,))
    return cursor.fetchone()[0]


def get_table_columns(cursor, table_name: str) -> List[str]:
    """Get all column names for a table"""
    cursor.execute("""
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = %s
        ORDER BY ordinal_position
    """, (table_name,))
    return [row[0] for row in cursor.fetchall()]


def migrate_table(old_conn, new_conn, table_name: str) -> int:
    """Migrate all data from one table to another"""
    print(f"  Migrating table: {table_name}...", end=" ", flush=True)
    
    with old_conn.cursor() as old_cursor:
        # Check if table exists in old DB
        if not get_table_exists(old_cursor, table_name):
            print("(doesn't exist in old DB, skipping)")
            return 0
        
        # Get columns
        columns = get_table_columns(old_cursor, table_name)
        if not columns:
            print("(no columns found, skipping)")
            return 0
        
        # Fetch all data
        columns_str = ", ".join([f'"{col}"' for col in columns])
        old_cursor.execute(f'SELECT {columns_str} FROM "{table_name}"')
        rows = old_cursor.fetchall()
        
        if not rows:
            print("(empty table)")
            return 0
        
        # Insert into new DB
        with new_conn.cursor() as new_cursor:
            placeholders = ", ".join(["%s"] * len(columns))
            insert_sql = f'INSERT INTO "{table_name}" ({columns_str}) VALUES ({placeholders}) ON CONFLICT DO NOTHING'
            
            inserted = 0
            for row in rows:
                try:
                    new_cursor.execute(insert_sql, row)
                    inserted += 1
                except Exception as e:
                    print(f"\n    Warning: Failed to insert row: {e}")
                    continue
            
            new_conn.commit()
            print(f"✓ ({inserted} rows)")
            return inserted


def main():
    print("=" * 70)
    print("DATABASE MIGRATION TOOL")
    print("=" * 70)
    print()
    
    if not OLD_DB_URL:
        print("ERROR: OLD_SUPABASE_DB_URL not found in environment")
        sys.exit(1)
    if not NEW_DB_URL:
        print("ERROR: SUPABASE_DB_URL not found in environment")
        sys.exit(1)
    
    print(f"Old DB: {OLD_DB_URL[:50]}...")
    print(f"New DB: {NEW_DB_URL[:50]}...")
    print()
    
    # Connect to both databases
    print("Connecting to databases...")
    try:
        old_conn = psycopg.connect(OLD_DB_URL, autocommit=False)
        new_conn = psycopg.connect(NEW_DB_URL, autocommit=False)
        print("✓ Connected to both databases")
    except Exception as e:
        print(f"ERROR: Failed to connect: {e}")
        sys.exit(1)
    
    print()
    print("Starting migration...")
    print("-" * 70)
    
    total_rows = 0
    migrated_tables = 0
    
    try:
        for table_name in MIGRATION_ORDER:
            try:
                rows = migrate_table(old_conn, new_conn, table_name)
                if rows > 0:
                    total_rows += rows
                    migrated_tables += 1
            except Exception as e:
                print(f"  ERROR migrating {table_name}: {e}")
                continue
        
        print("-" * 70)
        print()
        print("MIGRATION COMPLETE!")
        print(f"  Tables migrated: {migrated_tables}")
        print(f"  Total rows transferred: {total_rows}")
        print()
        
    except KeyboardInterrupt:
        print("\n\nMigration interrupted by user")
        sys.exit(1)
    finally:
        old_conn.close()
        new_conn.close()
        print("Database connections closed")


if __name__ == "__main__":
    main()
