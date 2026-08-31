"""Quick script to check what proposals exist"""
import psycopg2

DATABASE_URL = "postgresql://postgres.fwzqvdywrhmeanqotqpp:hRYfFoi0RI5nM9oq@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres?sslmode=require"

conn = psycopg2.connect(DATABASE_URL)
cursor = conn.cursor()

cursor.execute("""
    SELECT partner_project_applications_id, partner_name, status, requested_at,
           LEFT(proposal_details::text, 100)
    FROM public.partner_project_applications
    ORDER BY requested_at DESC
    LIMIT 5
""")

results = cursor.fetchall()
print("📋 All recent proposals:")
for r in results:
    print(f"  ID: {r[0]}")
    print(f"  Partner: {r[1]}")
    print(f"  Status: '{r[2]}'")
    print(f"  Details: {r[4]}")
    print()

cursor.close()
conn.close()
