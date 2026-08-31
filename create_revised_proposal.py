"""
Script to create a REVISED proposal card for testing.
This simulates a partner revising a rejected proposal.

Run this with: python create_revised_proposal.py
"""

import psycopg2
import json
from datetime import datetime, timezone

# Supabase connection string
DATABASE_URL = "postgresql://postgres.fwzqvdywrhmeanqotqpp:hRYfFoi0RI5nM9oq@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres?sslmode=require"

def create_revised_proposal():
    conn = None
    cursor = None
    try:
        # Connect to database
        conn = psycopg2.connect(DATABASE_URL)
        cursor = conn.cursor()
        
        print("🔌 Connected to database")
        
        # Check what tables exist
        cursor.execute("""
            SELECT tablename FROM pg_tables 
            WHERE schemaname = 'public' AND tablename LIKE '%partner%'
            ORDER BY tablename
        """)
        tables = cursor.fetchall()
        print(f"\n📊 Found partner-related tables: {[t[0] for t in tables]}")
        
        # Check columns in partner_project_applications
        cursor.execute("""
            SELECT column_name, data_type FROM information_schema.columns
            WHERE table_name = 'partner_project_applications'
            ORDER BY ordinal_position
        """)
        columns = cursor.fetchall()
        print(f"📋 Columns:")
        for col in columns:
            print(f"   - {col[0]} ({col[1]})")
        
        # Step 1: Find the rejected proposal
        cursor.execute("""
            SELECT id, project_id, partner_user_id, partner_name, partner_email,
                   program_module, proposal_details, revision_number
            FROM public.partner_project_applications
            WHERE status = 'Rejected'
            ORDER BY requested_at DESC
            LIMIT 1
        """)
        
        rejected = cursor.fetchone()
        
        if not rejected:
            print("❌ No rejected proposal found!")
            print("   Please reject a proposal first in the admin panel.")
            return
        
        app_id, project_id, partner_id, partner_name, partner_email, program_module, proposal_details, revision_number = rejected
        
        print(f"\n📋 Found rejected proposal:")
        print(f"   Application ID: {app_id}")
        print(f"   Partner: {partner_name}")
        print(f"   Current Revision: {revision_number}")
        
        # Step 2: Update the application to revision 1 with Pending status
        new_revision = (revision_number or 0) + 1
        resubmitted_at = datetime.now(timezone.utc).isoformat()
        
        # Update proposal details (you can modify these)
        if isinstance(proposal_details, str):
            proposal_details = json.loads(proposal_details)
        
        proposal_details['proposedDescription'] = (proposal_details.get('proposedDescription', '') + 
                                                   "\n\n[REVISED] Updated based on feedback.")
        
        cursor.execute("""
            UPDATE public.partner_project_applications
            SET status = 'Pending',
                revision_number = %s,
                resubmitted_at = %s,
                requested_at = %s,
                reviewed_at = NULL,
                reviewed_by = NULL,
                review_notes = NULL,
                proposal_details = %s
            WHERE id = %s
        """, (new_revision, resubmitted_at, resubmitted_at, json.dumps(proposal_details), app_id))
        
        print(f"\n✅ Updated application to revision {new_revision}")
        
        # Step 3: Create a new message card for the revision
        msg_id = f"msg-proposal-{int(datetime.now(timezone.utc).timestamp() * 1000)}"
        
        # Get admin user ID
        cursor.execute("""
            SELECT id FROM public.users WHERE role = 'admin' LIMIT 1
        """)
        admin_result = cursor.fetchone()
        admin_id = admin_result[0] if admin_result else 'admin-default'
        
        # Fetch the updated application to embed in message
        cursor.execute("""
            SELECT id, project_id, partner_user_id, partner_name, partner_email,
                   program_module, status, requested_at, resubmitted_at,
                   revision_number, proposal_details
            FROM public.partner_project_applications
            WHERE id = %s
        """, (app_id,))
        
        updated_app = cursor.fetchone()
        
        application_data = {
            'id': updated_app[0],
            'applicationId': updated_app[0],
            'projectId': updated_app[1],
            'partnerUserId': updated_app[2],
            'partnerName': updated_app[3],
            'partnerEmail': updated_app[4],
            'programModule': updated_app[5],
            'status': updated_app[6],
            'requestedAt': updated_app[7],
            'resubmittedAt': updated_app[8],
            'revisionNumber': updated_app[9],
            'proposalDetails': json.loads(updated_app[10]) if isinstance(updated_app[10], str) else updated_app[10]
        }
        
        message_content = f"___PROPOSAL_CARD___:{json.dumps(application_data)}"
        
        cursor.execute("""
            INSERT INTO public.messages (
                id, sender_id, recipient_id, project_id, content, timestamp, read, attachments
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            msg_id,
            partner_id,
            admin_id,
            None,
            message_content,
            resubmitted_at,
            False,
            json.dumps([])
        ))
        
        print(f"✅ Created message card: {msg_id}")
        
        # Commit changes
        conn.commit()
        
        print(f"\n🎉 SUCCESS! Revised proposal created:")
        print(f"   - Revision Number: {new_revision}")
        print(f"   - Status: Pending")
        print(f"   - Message ID: {msg_id}")
        print(f"\n📱 Now check the Communication Hub:")
        print(f"   - Old REJECTED card should show 'OLDER VERSION' warning")
        print(f"   - New REVISED card should appear as 'Revised Proposal #{new_revision}'")
        print(f"   - Admin should NOT be able to approve the old card")
        print(f"   - Admin SHOULD be able to approve/reject the new card")
        
    except Exception as e:
        print(f"\n❌ Error: {e}")
        if conn:
            conn.rollback()
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()
        print("\n🔌 Database connection closed")

if __name__ == "__main__":
    print("="*60)
    print("CREATE REVISED PROPOSAL FOR TESTING")
    print("="*60)
    create_revised_proposal()
