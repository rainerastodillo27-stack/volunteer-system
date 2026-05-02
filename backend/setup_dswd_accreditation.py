"""
Setup DSWD Accreditation Numbers table and assign to partners.

Purpose:
- Creates a new dswd_accreditation_numbers table to store accreditation numbers
- Inserts provided DSWD accreditation numbers
- Assigns accreditation numbers to existing partners in the system
"""

try:
    from .db import get_connection
    from .operation_guard import SCHEMA_SETUP_UNLOCK_ENV_VAR, require_shared_db_unlock
except ImportError:
    from db import get_connection
    from operation_guard import SCHEMA_SETUP_UNLOCK_ENV_VAR, require_shared_db_unlock

import json


# DSWD Accreditation Numbers provided
DSWD_ACCREDITATION_NUMBERS = [
    "DSWD-SB-A-00101",
    "DSWD-SB-A-000122",
    "DSWD-SB-A-000163",
    "DSWD-SB-A-000038",
    "SB-2008-128",
    "DSWD-SB-A-00004",
    "DSWD-SB-A-000103",
    "DSWD-SB-A-000024",
    "DSWD-SB-A-00152",
    "DSWD-SB-A-001287",
]


def setup_dswd_accreditation() -> None:
    """Create DSWD accreditation table and assign numbers to partners."""
    
    require_shared_db_unlock(
        "setting up DSWD accreditation numbers",
        SCHEMA_SETUP_UNLOCK_ENV_VAR
    )

    with get_connection() as connection:
        with connection.cursor() as cursor:
            # Create the DSWD accreditation numbers table
            print("Creating dswd_accreditation_numbers table...")
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS dswd_accreditation_numbers (
                    dswd_accreditation_numbers_id SERIAL PRIMARY KEY,
                    accreditation_no TEXT NOT NULL UNIQUE,
                    is_assigned BOOLEAN NOT NULL DEFAULT FALSE,
                    assigned_to_partner_id TEXT,
                    assigned_at TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)
            print("✓ Table created successfully")

            cursor.execute("""
                DO $$
                BEGIN
                  IF EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = 'dswd_accreditation_numbers'
                      AND column_name = 'id'
                  ) AND NOT EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = 'dswd_accreditation_numbers'
                      AND column_name = 'dswd_accreditation_numbers_id'
                  ) THEN
                    ALTER TABLE dswd_accreditation_numbers
                    RENAME COLUMN id TO dswd_accreditation_numbers_id;
                  END IF;
                END $$;
            """)

            # Create index on accreditation_no for fast lookups
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS dswd_accred_no_idx 
                ON dswd_accreditation_numbers (accreditation_no)
            """)
            
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS dswd_accred_partner_idx 
                ON dswd_accreditation_numbers (assigned_to_partner_id)
            """)
            
            print("✓ Indexes created")

            # Insert DSWD accreditation numbers
            print(f"\nInserting {len(DSWD_ACCREDITATION_NUMBERS)} DSWD accreditation numbers...")
            from datetime import datetime, timezone
            now = datetime.now(timezone.utc).isoformat()
            
            inserted_count = 0
            for accred_no in DSWD_ACCREDITATION_NUMBERS:
                try:
                    cursor.execute("""
                        INSERT INTO dswd_accreditation_numbers 
                        (accreditation_no, is_assigned, assigned_to_partner_id, assigned_at, created_at, updated_at)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        ON CONFLICT (accreditation_no) DO NOTHING
                    """, (accred_no, False, None, None, now, now))
                    inserted_count += 1
                    print(f"  ✓ {accred_no}")
                except Exception as e:
                    print(f"  ✗ {accred_no}: {str(e)}")
            
            print(f"✓ Inserted {inserted_count} accreditation numbers")

            # Get all partners and assign accreditation numbers
            print("\nAssigning accreditation numbers to partners...")
            cursor.execute("""
                SELECT partners_id, name, dswd_accreditation_no 
                FROM partners 
                ORDER BY created_at ASC
            """)
            partners = cursor.fetchall()
            partner_count = len(partners)
            print(f"Found {partner_count} existing partners")

            if partner_count > 0 and len(DSWD_ACCREDITATION_NUMBERS) > 0:
                # Assign accreditation numbers to partners in round-robin fashion
                for idx, (partner_id, partner_name, current_accred) in enumerate(partners):
                    accred_idx = idx % len(DSWD_ACCREDITATION_NUMBERS)
                    new_accred_no = DSWD_ACCREDITATION_NUMBERS[accred_idx]
                    
                    # Update partner with new accreditation number
                    cursor.execute("""
                        UPDATE partners 
                        SET dswd_accreditation_no = %s
                        WHERE partners_id = %s
                    """, (new_accred_no, partner_id))
                    
                    # Mark accreditation number as assigned
                    cursor.execute("""
                        UPDATE dswd_accreditation_numbers 
                        SET is_assigned = TRUE, assigned_to_partner_id = %s, assigned_at = %s, updated_at = %s
                        WHERE accreditation_no = %s
                    """, (partner_id, now, now, new_accred_no))
                    
                    old_accred = current_accred or "(none)"
                    print(f"  Partner {idx+1}: {partner_name}")
                    print(f"    Old: {old_accred} → New: {new_accred_no}")

            connection.commit()
            
            # Print summary
            print("\n" + "="*60)
            print("✓ DSWD ACCREDITATION SETUP COMPLETE")
            print("="*60)
            print(f"Total accreditation numbers created: {len(DSWD_ACCREDITATION_NUMBERS)}")
            print(f"Total partners updated: {partner_count}")
            if partner_count > 0:
                print(f"Assignment pattern: Round-robin distribution")
                print(f"Partners per accreditation number: {(partner_count + len(DSWD_ACCREDITATION_NUMBERS) - 1) // len(DSWD_ACCREDITATION_NUMBERS)}")
            print("="*60)


if __name__ == "__main__":
    setup_dswd_accreditation()
