#!/usr/bin/env python3
"""
Script to run the relational mirror DDL statements to ensure tables are properly set up.
"""
from db import get_connection
from relational_mirror import RELATIONAL_TABLE_DDL

def run_ddl():
    """Execute all DDL statements to create/update tables."""
    with get_connection() as connection:
        with connection.cursor() as cursor:
            print(f"Executing {len(RELATIONAL_TABLE_DDL)} DDL statements...")
            executed = 0
            skipped = 0
            errors = 0
            
            for i, ddl in enumerate(RELATIONAL_TABLE_DDL, 1):
                if not ddl.strip():
                    continue
                    
                try:
                    cursor.execute(ddl)
                    executed += 1
                    print(f"✓ {i}: {ddl[:60]}...")
                except Exception as e:
                    # Some statements might fail (e.g., if table doesn't exist for alter)
                    # but that's okay
                    if "already exists" in str(e) or "does not exist" in str(e):
                        skipped += 1
                    else:
                        print(f"✗ {i}: Error - {e}")
                        errors += 1
            
            connection.commit()
            print(f"\nResults:")
            print(f"  Executed: {executed}")
            print(f"  Skipped: {skipped}")
            print(f"  Errors: {errors}")

if __name__ == "__main__":
    run_ddl()
