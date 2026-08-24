#!/usr/bin/env python3
"""Close idle database connections to free up connection pool slots."""
import os
import sys
import psycopg2
from dotenv import load_dotenv

load_dotenv()

def close_idle_connections():
    """Terminate idle database connections."""
    db_url = os.getenv("SUPABASE_DB_URL")
    if not db_url:
        print("❌ SUPABASE_DB_URL not found in environment")
        sys.exit(1)
    
    try:
        print("Connecting to database...")
        conn = psycopg2.connect(db_url)
        cursor = conn.cursor()
        
        # Get current connection count
        cursor.execute("""
            SELECT count(*) 
            FROM pg_stat_activity 
            WHERE datname = current_database()
        """)
        total_connections = cursor.fetchone()[0]
        print(f"📊 Total connections: {total_connections}")
        
        # Get idle connections count
        cursor.execute("""
            SELECT count(*) 
            FROM pg_stat_activity 
            WHERE datname = current_database()
            AND state = 'idle'
            AND pid != pg_backend_pid()
        """)
        idle_count = cursor.fetchone()[0]
        print(f"💤 Idle connections: {idle_count}")
        
        # Terminate idle connections (excluding our own connection)
        cursor.execute("""
            SELECT pg_terminate_backend(pid)
            FROM pg_stat_activity
            WHERE datname = current_database()
            AND state = 'idle'
            AND pid != pg_backend_pid()
        """)
        terminated = cursor.rowcount
        conn.commit()
        
        print(f"✅ Terminated {terminated} idle connections")
        
        # Show remaining connections
        cursor.execute("""
            SELECT count(*) 
            FROM pg_stat_activity 
            WHERE datname = current_database()
        """)
        remaining = cursor.fetchone()[0]
        print(f"📊 Remaining connections: {remaining}")
        
        cursor.close()
        conn.close()
        print("✅ Done! Connection pool freed up.")
        
    except Exception as e:
        print(f"❌ Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    close_idle_connections()
