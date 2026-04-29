import time
import sys
import os

# Add the current directory to sys.path to import backend modules
sys.path.append(os.getcwd())

from backend.db import get_postgres_connection, get_configured_db_mode

def test_perf():
    print(f"DB Mode: {get_configured_db_mode()}")
    
    try:
        start_time = time.time()
        conn = get_postgres_connection()
        conn_time = time.time() - start_time
        print(f"Connection established in {conn_time:.4f}s")
        
        with conn.cursor() as cursor:
            start_time = time.time()
            cursor.execute("SELECT 1")
            cursor.fetchone()
            query_time = time.time() - start_time
            print(f"Simple query (SELECT 1) took {query_time:.4f}s")
            
            start_time = time.time()
            cursor.execute("SELECT count(*) FROM users")
            count = cursor.fetchone()[0]
            query_time = time.time() - start_time
            print(f"Query (SELECT count(*) FROM users) took {query_time:.4f}s (Result: {count})")

            # Check for parent_project_id column in projects table
            try:
                start_time = time.time()
                cursor.execute("SELECT parent_project_id FROM projects LIMIT 1")
                cursor.fetchone()
                query_time = time.time() - start_time
                print(f"Query (SELECT parent_project_id FROM projects LIMIT 1) took {query_time:.4f}s")
            except Exception as e:
                print(f"Error querying parent_project_id in projects: {e}")
                conn.rollback()

            # Check for parent_project_id column in events table
            try:
                start_time = time.time()
                cursor.execute("SELECT parent_project_id FROM events LIMIT 1")
                cursor.fetchone()
                query_time = time.time() - start_time
                print(f"Query (SELECT parent_project_id FROM events LIMIT 1) took {query_time:.4f}s")
            except Exception as e:
                print(f"Error querying parent_project_id in events: {e}")
                conn.rollback()

        conn.close()
    except Exception as e:
        print(f"Failed to connect or query: {e}")

if __name__ == "__main__":
    test_perf()
