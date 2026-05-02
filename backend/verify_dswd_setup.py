"""
Verify DSWD Accreditation Numbers setup.
"""

try:
    from .db import get_connection
except ImportError:
    from db import get_connection

import json


def verify_dswd_setup() -> None:
    """Verify that DSWD accreditation table and assignments are correct."""
    
    with get_connection() as connection:
        with connection.cursor() as cursor:
            print("="*70)
            print("VERIFICATION: DSWD ACCREDITATION SETUP")
            print("="*70)
            
            # Check dswd_accreditation_numbers table
            print("\n1. DSWD ACCREDITATION NUMBERS TABLE:")
            print("-" * 70)
            cursor.execute("SELECT COUNT(*) FROM dswd_accreditation_numbers")
            count = cursor.fetchone()[0]
            print(f"   Total accreditation numbers: {count}")
            
            cursor.execute("""
                SELECT accreditation_no, is_assigned, assigned_to_partner_id 
                FROM dswd_accreditation_numbers 
                ORDER BY accreditation_no
            """)
            accreds = cursor.fetchall()
            assigned_count = sum(1 for _, is_assigned, _ in accreds if is_assigned)
            
            print(f"   Assigned: {assigned_count}, Unassigned: {count - assigned_count}")
            print("\n   Accreditation Numbers:")
            for accred_no, is_assigned, partner_id in accreds:
                status = "✓ ASSIGNED" if is_assigned else "✗ UNASSIGNED"
                print(f"     • {accred_no}: {status}", end="")
                if partner_id:
                    print(f" (Partner: {partner_id})")
                else:
                    print()
            
            # Check partners table
            print("\n2. PARTNERS WITH ASSIGNED ACCREDITATION NUMBERS:")
            print("-" * 70)
            cursor.execute("""
                SELECT partners_id, name, dswd_accreditation_no, created_at 
                FROM partners 
                ORDER BY created_at
            """)
            partners = cursor.fetchall()
            print(f"   Total partners: {len(partners)}")
            print("\n   Partner Details:")
            for idx, (p_id, p_name, accred_no, created_at) in enumerate(partners, 1):
                print(f"     {idx}. {p_name}")
                print(f"        ID: {p_id}")
                print(f"        Accreditation: {accred_no}")
                print()
            
            # Check for unassigned accreditation numbers
            print("3. UNASSIGNED ACCREDITATION NUMBERS:")
            print("-" * 70)
            cursor.execute("""
                SELECT accreditation_no 
                FROM dswd_accreditation_numbers 
                WHERE is_assigned = FALSE
                ORDER BY accreditation_no
            """)
            unassigned = cursor.fetchall()
            if unassigned:
                print(f"   Found {len(unassigned)} unassigned numbers:")
                for (accred_no,) in unassigned:
                    print(f"     • {accred_no}")
            else:
                print("   ✓ All accreditation numbers are assigned!")
            
            print("\n" + "="*70)
            print("✓ VERIFICATION COMPLETE")
            print("="*70)


if __name__ == "__main__":
    verify_dswd_setup()
