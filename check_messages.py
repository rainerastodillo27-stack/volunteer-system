"""Check what proposal cards exist in messages"""
import psycopg2
import json

DATABASE_URL = "postgresql://postgres.fwzqvdywrhmeanqotqpp:hRYfFoi0RI5nM9oq@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres?sslmode=require"

conn = psycopg2.connect(DATABASE_URL)
cursor = conn.cursor()

cursor.execute("""
    SELECT messages_id, sender_id, content, timestamp
    FROM public.messages
    WHERE content LIKE '___PROPOSAL_CARD___%'
    ORDER BY timestamp DESC
    LIMIT 5
""")

results = cursor.fetchall()
print("📋 Recent proposal cards in messages:")
for msg_id, sender, content, timestamp in results:
    # Extract the JSON part
    if '___PROPOSAL_CARD___:' in content:
        json_str = content.replace('___PROPOSAL_CARD___:', '')
        try:
            data = json.loads(json_str)
            print(f"\n  Message ID: {msg_id}")
            print(f"  Sender: {sender}")
            print(f"  Status: {data.get('status', 'N/A')}")
            print(f"  Revision: {data.get('revisionNumber', 0)}")
            print(f"  Title: {data.get('proposalDetails', {}).get('proposedTitle', 'N/A')}")
        except:
            print(f"\n  Message ID: {msg_id} (parse error)")

cursor.close()
conn.close()
