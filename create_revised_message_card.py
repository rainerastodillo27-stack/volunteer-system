"""
Script to create a REVISED proposal MESSAGE CARD for testing.
This creates a new message card that looks like a partner revised their proposal.
"""

import psycopg2
import json
from datetime import datetime, timezone

# Supabase connection string
DATABASE_URL = "postgresql://postgres.fwzqvdywrhmeanqotqpp:hRYfFoi0RI5nM9oq@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres?sslmode=require"

def create_revised_message():
    conn = None
    cursor = None
    try:
        # Connect to database
        conn = psycopg2.connect(DATABASE_URL)
        cursor = conn.cursor()
        
        print("🔌 Connected to database")
        
        # Step 1: Find the most recent REJECTED proposal card from messages
        cursor.execute("""
            SELECT messages_id, sender_id, content
            FROM public.messages
            WHERE content LIKE '___PROPOSAL_CARD___%'
            ORDER BY timestamp DESC
            LIMIT 20
        """)
        
        messages = cursor.fetchall()
        
        # Find a rejected card
        rejected_app_data = None
        partner_id = None
        
        for msg_id, sender, content in messages:
            if '___PROPOSAL_CARD___:' in content:
                json_str = content.replace('___PROPOSAL_CARD___:', '')
                try:
                    data = json.loads(json_str)
                    if data.get('status') == 'Rejected' and not msg_id.startswith('review-card-'):
                        rejected_app_data = data
                        partner_id = sender
                        print(f"\n📋 Found rejected proposal message:")
                        print(f"   Message ID: {msg_id}")
                        print(f"   Partner: {data.get('partnerName', 'Unknown')}")
                        break
                except:
                    continue
        
        if not rejected_app_data:
            print("❌ No rejected proposal card found in messages!")
            return
        
        # Get the existing data
        app_id = rejected_app_data.get('id') or rejected_app_data.get('applicationId')
        project_id = rejected_app_data.get('projectId')
        partner_name = rejected_app_data.get('partnerName', 'Partner')
        proposal_details = rejected_app_data.get('proposalDetails', {})
        
        # Step 2: Get admin user ID
        cursor.execute("""
            SELECT users_id FROM public.users WHERE role = 'admin' LIMIT 1
        """)
        admin_result = cursor.fetchone()
        admin_id = admin_result[0] if admin_result else 'admin-default'
        
        print(f"   Admin ID: {admin_id}")
        
        # Step 3: Create a new REVISED message card
        msg_id = f"msg-proposal-{int(datetime.now(timezone.utc).timestamp() * 1000)}"
        msg_timestamp = datetime.now(timezone.utc).isoformat()
        
        # Create fake application data with revision number 1
        revised_application = {
            'id': app_id,
            'applicationId': app_id,
            'projectId': project_id,
            'partnerUserId': partner_id,
            'partnerName': partner_name,
            'status': 'Pending',  # Changed from Rejected to Pending
            'requestedAt': msg_timestamp,
            'resubmittedAt': msg_timestamp,
            'revisionNumber': 1,  # THIS IS THE KEY - marks it as a revision
            'proposalDetails': {
                **proposal_details,
                'proposedDescription': (proposal_details.get('proposedDescription', '') + 
                                       "\n\n✏️ [REVISED] Updated based on admin feedback.")
            }
        }
        
        message_content = f"___PROPOSAL_CARD___:{json.dumps(revised_application)}"
        
        # Insert the new message
        cursor.execute("""
            INSERT INTO public.messages (
                messages_id, sender_id, recipient_id, project_id, 
                content, timestamp, read, attachments
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            msg_id,
            partner_id,
            admin_id,
            None,
            message_content,
            msg_timestamp,
            False,
            json.dumps([])
        ))
        
        conn.commit()
        
        print(f"\n✅ Created REVISED message card: {msg_id}")
        print(f"\n🎉 SUCCESS! Fake revised proposal card created!")
        print(f"\n📱 Now refresh the Communication Hub:")
        print(f"   1. You should see 2 cards:")
        print(f"      - OLD: REJECTED (revision 0)")
        print(f"      - NEW: SUBMITTED - Revised Proposal #1 (revision 1)")
        print(f"   2. Open the OLD card as admin:")
        print(f"      - Should see yellow 'OLDER VERSION' warning")
        print(f"      - Should NOT see Approve/Reject buttons")
        print(f"   3. Open the NEW card as admin:")
        print(f"      - Should see Approve/Reject buttons")
        print(f"      - Can review normally")
        
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
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
    print("CREATE REVISED PROPOSAL MESSAGE CARD FOR TESTING")
    print("="*60)
    create_revised_message()
