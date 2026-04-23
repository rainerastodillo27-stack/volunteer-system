#!/usr/bin/env python3
"""
Alternative Database Migration Script - Direct Host Connection
Uses direct host connection (port 5432) instead of pooler (port 6543)
Bypasses the pooler when it's saturated due to quota limits
"""

import os
import psycopg2
import psycopg2.extras
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT
import sys
import time
from datetime import datetime
from dotenv import load_dotenv

try:
    from .operation_guard import DB_MIGRATION_UNLOCK_ENV_VAR, require_shared_db_unlock
except ImportError:
    from operation_guard import DB_MIGRATION_UNLOCK_ENV_VAR, require_shared_db_unlock

load_dotenv()

OLD_DB_DIRECT = os.getenv("VOLCRE_OLD_DB_URL_DIRECT", "").strip()
NEW_DB_DIRECT = os.getenv("VOLCRE_NEW_DB_URL_DIRECT", "").strip()


class DirectDatabaseMigrator:
    def __init__(self):
        self.old_conn = None
        self.new_conn = None
        self.stats = {
            "tables_created": 0,
            "tables_migrated": 0,
            "rows_migrated": 0,
            "start_time": None,
            "end_time": None,
        }

    def log(self, message):
        """Print timestamped log message"""
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        print(f"[{timestamp}] {message}")

    def connect_databases(self):
        """Connect to both databases using direct host connection"""
        self.log("Connecting to databases using direct host connection (port 5432)...")
        self.log("This bypasses the pooler which may be saturated...")
        
        # Connect to old database
        max_retries = 3
        for attempt in range(max_retries):
            try:
                self.log(f"  Attempt {attempt + 1}/{max_retries} - OLD database (direct)...")
                self.old_conn = psycopg2.connect(
                    OLD_DB_DIRECT,
                    connect_timeout=30,
                    keepalives=1,
                    keepalives_idle=30,
                    keepalives_interval=10,
                    keepalives_count=5
                )
                self.old_conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
                self.log("  ✓ Connected to OLD database via direct host")
                break
            except Exception as e:
                self.log(f"  ✗ Attempt {attempt + 1} failed: {e}")
                if attempt < max_retries - 1:
                    time.sleep(5)
                else:
                    self.log("\n✗ Cannot connect to old database (direct host also unresponsive)")
                    return False

        # Connect to new database
        try:
            self.log("  Connecting to NEW database (direct)...")
            self.new_conn = psycopg2.connect(
                NEW_DB_DIRECT,
                connect_timeout=15,
                keepalives=1,
                keepalives_idle=30,
                keepalives_interval=10,
                keepalives_count=5
            )
            self.new_conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
            self.log("  ✓ Connected to NEW database via direct host")
        except Exception as e:
            self.log(f"✗ Failed to connect to new database: {e}")
            return False

        return True

    def get_tables(self, conn):
        """Get list of all tables from database"""
        with conn.cursor() as cur:
            cur.execute("""
                SELECT table_name FROM information_schema.tables 
                WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
                ORDER BY table_name
            """)
            return [row[0] for row in cur.fetchall()]

    def migrate_table_schema(self, table_name):
        """Create table in new database with same schema"""
        self.log(f"  Migrating schema: {table_name}")
        
        with self.new_conn.cursor() as new_cur:
            try:
                # Drop table if exists
                new_cur.execute(f"DROP TABLE IF EXISTS {table_name} CASCADE")
                
                # Get the create table statement from old database
                with self.old_conn.cursor() as old_cur:
                    old_cur.execute(f"""
                        SELECT pg_get_createtablestmt('{table_name}'::regclass);
                    """)
                    result = old_cur.fetchone()
                    
                if result and result[0]:
                    create_stmt = result[0]
                    self.log(f"    Creating table...")
                    new_cur.execute(create_stmt)
                    self.stats["tables_created"] += 1
                else:
                    self.log(f"    ⚠ Could not create table {table_name}")
                    return False
                    
            except Exception as e:
                self.log(f"    ✗ Error: {e}")
                return False
        
        return True

    def migrate_table_data(self, table_name):
        """Copy all data from table in old database to new database"""
        self.log(f"  Migrating data: {table_name}")
        
        try:
            with self.old_conn.cursor() as old_cur:
                old_cur.execute(f"SELECT COUNT(*) FROM {table_name}")
                row_count = old_cur.fetchone()[0]
                
                if row_count == 0:
                    self.log(f"    → No data (0 rows)")
                    return True
                
                self.log(f"    → Copying {row_count} rows...")
                
                # Get column names
                old_cur.execute(f"""
                    SELECT column_name FROM information_schema.columns
                    WHERE table_name = '{table_name}'
                    ORDER BY ordinal_position
                """)
                columns = [row[0] for row in old_cur.fetchall()]
                
                # Fetch all data
                old_cur.execute(f"SELECT * FROM {table_name}")
                rows = old_cur.fetchall()
                
                # Insert into new database in batches
                batch_size = 1000
                with self.new_conn.cursor() as new_cur:
                    for i in range(0, len(rows), batch_size):
                        batch = rows[i:i + batch_size]
                        col_str = ", ".join(columns)
                        placeholders = ", ".join(["%s"] * len(columns))
                        
                        insert_sql = f"INSERT INTO {table_name} ({col_str}) VALUES ({placeholders})"
                        
                        try:
                            new_cur.executemany(insert_sql, batch)
                            self.stats["rows_migrated"] += len(batch)
                        except Exception as e:
                            self.log(f"    ✗ Error inserting batch: {e}")
                            return False
                
                self.log(f"    ✓ Migrated {row_count} rows")
                self.stats["tables_migrated"] += 1
                return True
                
        except Exception as e:
            self.log(f"    ✗ Error: {e}")
            return False

    def verify_migration(self):
        """Verify data consistency between databases"""
        self.log("\nVerifying migration...")
        
        old_tables = self.get_tables(self.old_conn)
        new_tables = self.get_tables(self.new_conn)
        
        all_good = True
        
        for table in old_tables:
            if table not in new_tables:
                self.log(f"  ✗ Table {table} NOT found in new database")
                all_good = False
                continue
            
            with self.old_conn.cursor() as old_cur:
                old_cur.execute(f"SELECT COUNT(*) FROM {table}")
                old_count = old_cur.fetchone()[0]
            
            with self.new_conn.cursor() as new_cur:
                new_cur.execute(f"SELECT COUNT(*) FROM {table}")
                new_count = new_cur.fetchone()[0]
            
            if old_count == new_count:
                self.log(f"  ✓ {table}: {new_count} rows")
            else:
                self.log(f"  ✗ {table}: old={old_count}, new={new_count}")
                all_good = False
        
        return all_good

    def run_migration(self):
        """Execute full migration"""
        self.stats["start_time"] = datetime.now()
        self.log("\n" + "=" * 60)
        self.log("DATABASE MIGRATION (DIRECT HOST)")
        self.log("=" * 60)
        
        # Connect to databases
        if not self.connect_databases():
            self.log("\n" + "=" * 60)
            self.log("MIGRATION FAILED")
            self.log("=" * 60)
            self.log("\nBoth pooler and direct host connections failed.")
            self.log("The old database may still be recovering from quota limits.")
            self.log("\nTry again in 30-60 minutes when recovery is complete:")
            self.log("  npm run db:migrate")
            return False
        
        # Get list of tables to migrate
        tables = self.get_tables(self.old_conn)
        self.log(f"\nFound {len(tables)} tables to migrate")
        
        # Migrate each table
        self.log("\n--- PHASE 1: Creating Schemas ---")
        for table in tables:
            if not self.migrate_table_schema(table):
                self.log(f"⚠ Failed to create schema for {table}")
        
        self.log("\n--- PHASE 2: Migrating Data ---")
        for table in tables:
            if not self.migrate_table_data(table):
                self.log(f"⚠ Failed to migrate data for {table}")
        
        # Verify migration
        self.log("\n--- PHASE 3: Verification ---")
        if self.verify_migration():
            self.log("✓ Verification PASSED")
        else:
            self.log("⚠ Some verification issues found")
        
        # Close connections
        if self.old_conn:
            self.old_conn.close()
        if self.new_conn:
            self.new_conn.close()
        
        self.stats["end_time"] = datetime.now()
        duration = (self.stats["end_time"] - self.stats["start_time"]).total_seconds()
        
        # Print summary
        self.log("\n" + "=" * 60)
        self.log("MIGRATION SUMMARY")
        self.log("=" * 60)
        self.log(f"Tables created: {self.stats['tables_created']}")
        self.log(f"Tables with data: {self.stats['tables_migrated']}")
        self.log(f"Total rows migrated: {self.stats['rows_migrated']}")
        self.log(f"Duration: {duration:.2f} seconds")
        self.log("=" * 60 + "\n")
        
        return True


def main():
    require_shared_db_unlock("direct database-to-database migration", DB_MIGRATION_UNLOCK_ENV_VAR)

    if not OLD_DB_DIRECT or not NEW_DB_DIRECT:
        print("Missing direct migration database URLs.")
        print("Set VOLCRE_OLD_DB_URL_DIRECT and VOLCRE_NEW_DB_URL_DIRECT before running this script.")
        sys.exit(1)

    migrator = DirectDatabaseMigrator()
    success = migrator.run_migration()
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
