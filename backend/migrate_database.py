#!/usr/bin/env python3
"""
Database Migration Script
Migrates all data from old Supabase database to new database
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

OLD_DB_URL = os.getenv("VOLCRE_OLD_DB_URL", "").strip()
NEW_DB_URL = os.getenv("VOLCRE_NEW_DB_URL", "").strip()


class DatabaseMigrator:
    def __init__(self, old_url, new_url):
        self.old_url = old_url
        self.new_url = new_url
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
        """Connect to both databases"""
        self.log("Connecting to databases...")
        
        # Try to connect to old database with retries
        max_retries = 3
        for attempt in range(max_retries):
            try:
                self.log(f"  Attempt {attempt + 1}/{max_retries} - Connecting to OLD database...")
                self.old_conn = psycopg2.connect(
                    self.old_url,
                    connect_timeout=30,  # Increased from default 10s to 30s
                    keepalives=1,
                    keepalives_idle=30,
                    keepalives_interval=10,
                    keepalives_count=5
                )
                self.old_conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
                self.log("✓ Connected to OLD database (ap-northeast-2)")
                break
            except Exception as e:
                self.log(f"  ✗ Attempt {attempt + 1} failed: {e}")
                if attempt == max_retries - 1:
                    self.log(f"\n⚠️  WARNING: Cannot connect to old database after {max_retries} attempts")
                    self.log("   The old database may be unresponsive due to quota limits.")
                    self.log("   Falling back to online migration (will retry periodically)...")
                    self.old_conn = None
                else:
                    time.sleep(5)

        try:
            self.log("  Connecting to NEW database...")
            self.new_conn = psycopg2.connect(
                self.new_url,
                connect_timeout=15,
                keepalives=1,
                keepalives_idle=30,
                keepalives_interval=10,
                keepalives_count=5
            )
            self.new_conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
            self.log("✓ Connected to NEW database (ap-south-1)")
        except Exception as e:
            self.log(f"✗ Failed to connect to new database: {e}")
            return False

        if self.old_conn is None:
            self.log("\n⚠️  CRITICAL: Cannot proceed without old database connection")
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

    def get_table_definition(self, conn, table_name):
        """Get CREATE TABLE statement for a table"""
        with conn.cursor() as cur:
            cur.execute(f"""
                SELECT column_name, data_type, is_nullable, column_default
                FROM information_schema.columns
                WHERE table_name = '{table_name}'
                ORDER BY ordinal_position
            """)
            return cur.fetchall()

    def get_table_constraints(self, conn, table_name):
        """Get constraints for a table"""
        with conn.cursor() as cur:
            cur.execute(f"""
                SELECT constraint_name, constraint_type
                FROM information_schema.table_constraints
                WHERE table_name = '{table_name}'
            """)
            return cur.fetchall()

    def migrate_table_schema(self, table_name):
        """Create table in new database with same schema"""
        self.log(f"  Migrating schema for table: {table_name}")
        
        with self.old_conn.cursor() as old_cur:
            old_cur.execute(f"SELECT * FROM {table_name} LIMIT 0")
            
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
                    self.log(f"    Creating table: {table_name}")
                    new_cur.execute(create_stmt)
                    self.stats["tables_created"] += 1
                else:
                    # Fallback: manually create from column info
                    self.log(f"    Creating table from column definitions: {table_name}")
                    self._create_table_from_columns(new_cur, table_name)
                    self.stats["tables_created"] += 1
                    
            except Exception as e:
                self.log(f"    ✗ Error creating table {table_name}: {e}")
                return False
        
        return True

    def _create_table_from_columns(self, cur, table_name):
        """Create table from column definitions"""
        columns_info = self.get_table_definition(self.old_conn, table_name)
        
        columns_sql = []
        for col_name, data_type, is_nullable, col_default in columns_info:
            col_def = f"{col_name} {data_type}"
            if col_default:
                col_def += f" DEFAULT {col_default}"
            if is_nullable == "NO":
                col_def += " NOT NULL"
            columns_sql.append(col_def)
        
        create_stmt = f"CREATE TABLE {table_name} ({', '.join(columns_sql)})"
        cur.execute(create_stmt)

    def migrate_table_data(self, table_name):
        """Copy all data from table in old database to new database"""
        self.log(f"  Migrating data for table: {table_name}")
        
        try:
            with self.old_conn.cursor() as old_cur:
                old_cur.execute(f"SELECT COUNT(*) FROM {table_name}")
                row_count = old_cur.fetchone()[0]
                
                if row_count == 0:
                    self.log(f"    → No data to migrate (0 rows)")
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
                            if (i + batch_size) % (batch_size * 5) == 0:
                                self.log(f"    → Progress: {min(i + batch_size, len(rows))}/{row_count} rows")
                        except Exception as e:
                            self.log(f"    ✗ Error inserting batch: {e}")
                            return False
                
                self.log(f"    ✓ Migrated {row_count} rows")
                self.stats["tables_migrated"] += 1
                return True
                
        except Exception as e:
            self.log(f"    ✗ Error migrating table {table_name}: {e}")
            return False

    def migrate_indexes_and_constraints(self):
        """Migrate indexes and constraints"""
        self.log("Migrating indexes and constraints...")
        
        try:
            with self.old_conn.cursor() as old_cur:
                # Get all indexes (excluding primary key indexes)
                old_cur.execute("""
                    SELECT schemaname, tablename, indexname, indexdef
                    FROM pg_indexes
                    WHERE schemaname = 'public'
                    AND indexname NOT LIKE '%_pkey'
                """)
                indexes = old_cur.fetchall()
            
            with self.new_conn.cursor() as new_cur:
                for schema, table, index_name, index_def in indexes:
                    try:
                        new_cur.execute(index_def)
                        self.log(f"  ✓ Created index: {index_name}")
                    except Exception as e:
                        self.log(f"  ⚠ Index {index_name} already exists or skipped: {e}")
            
            self.log("✓ Indexes migrated")
            return True
        except Exception as e:
            self.log(f"✗ Error migrating indexes: {e}")
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
                self.log(f"  ✗ {table}: old={old_count} rows, new={new_count} rows")
                all_good = False
        
        return all_good

    def run_migration(self):
        """Execute full migration"""
        self.stats["start_time"] = datetime.now()
        self.log("\n" + "=" * 60)
        self.log("DATABASE MIGRATION STARTED")
        self.log("=" * 60)
        
        # Connect to databases
        if not self.connect_databases():
            self.log("\n" + "=" * 60)
            self.log("MIGRATION FAILED - CONNECTION ERROR")
            self.log("=" * 60)
            self.log("\nThe old database connection pooler is unresponsive.")
            self.log("This happens when a Supabase database exceeds its quota.")
            self.log("\nALTERNATIVE SOLUTIONS:")
            self.log("1. Wait 30-60 minutes for the pooler to recover")
            self.log("2. Use Supabase Dashboard SQL Editor:")
            self.log("   - Login to https://app.supabase.com/projects")
            self.log("   - Navigate to SQL Editor")
            self.log("   - Run manual SQL queries to extract data")
            self.log("3. Contact Supabase support to unlock the database")
            self.log("\nOr try again in a few minutes:")
            self.log("  npm run db:migrate")
            return False
        
        # Get list of tables to migrate
        tables = self.get_tables(self.old_conn)
        self.log(f"\nFound {len(tables)} tables to migrate")
        
        # Migrate each table
        self.log("\n--- PHASE 1: Migrating Schemas ---")
        for table in tables:
            if not self.migrate_table_schema(table):
                self.log(f"✗ Failed to migrate schema for {table}")
        
        self.log("\n--- PHASE 2: Migrating Data ---")
        for table in tables:
            if not self.migrate_table_data(table):
                self.log(f"⚠ Failed to migrate data for {table}")
        
        # Migrate indexes and constraints
        self.log("\n--- PHASE 3: Creating Indexes & Constraints ---")
        self.migrate_indexes_and_constraints()
        
        # Verify migration
        self.log("\n--- PHASE 4: Verification ---")
        if self.verify_migration():
            self.log("✓ Migration verification PASSED")
        else:
            self.log("✗ Migration verification FAILED - please review")
        
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
        self.log(f"Tables with data migrated: {self.stats['tables_migrated']}")
        self.log(f"Total rows migrated: {self.stats['rows_migrated']}")
        self.log(f"Duration: {duration:.2f} seconds")
        self.log("=" * 60 + "\n")
        
        return True


def main():
    require_shared_db_unlock("database-to-database migration", DB_MIGRATION_UNLOCK_ENV_VAR)

    if not OLD_DB_URL or not NEW_DB_URL:
        print("Missing migration database URLs.")
        print("Set VOLCRE_OLD_DB_URL and VOLCRE_NEW_DB_URL before running this script.")
        sys.exit(1)

    migrator = DatabaseMigrator(OLD_DB_URL, NEW_DB_URL)
    success = migrator.run_migration()
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
