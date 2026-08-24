import json
from backend.database import get_db_cursor

with get_db_cursor() as cur:
    cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;")
    tables = [r['table_name'] for r in cur.fetchall()]
    print("Tables:", tables)

    # Check partner proposals/applications
    if 'partner_project_applications' in tables:
        cur.execute("SELECT id, partner_name, status, partner_user_id, project_id, proposal_details FROM partner_project_applications LIMIT 10;")
        print("\npartner_project_applications sample:")
        for r in cur.fetchall():
            print(dict(r))

    if 'proposals' in tables:
        cur.execute("SELECT id, title, status, partner_id, partner_name FROM proposals LIMIT 10;")
        print("\nproposals sample:")
        for r in cur.fetchall():
            print(dict(r))

    # Check projects table for partnerId / proposal fields / isEvent
    if 'projects' in tables:
        cur.execute("""
            SELECT id, title, is_event, parent_project_id, partner_id, status, 
                   location_latitude, location_longitude, location_address, raw_data 
            FROM projects LIMIT 10;
        """)
        print("\nprojects sample:")
        for r in cur.fetchall():
            rd = r['raw_data'] if isinstance(r['raw_data'], dict) else (json.loads(r['raw_data']) if r['raw_data'] else {})
            print(f"ID: {r['id']}, Title: {r['title']}, isEvent: {r['is_event']}, partnerId: {r['partner_id']}, status: {r['status']}, lat: {r['location_latitude']}, lng: {r['location_longitude']}, proposalStatus: {rd.get('proposalStatus')}, proposalDetails: {bool(rd.get('proposalDetails'))}")

    # Check volunteer matches / join records
    if 'volunteer_project_matches' in tables:
        cur.execute("SELECT id, volunteer_id, project_id, status FROM volunteer_project_matches LIMIT 10;")
        print("\nvolunteer_project_matches sample:")
        for r in cur.fetchall():
            print(dict(r))

    if 'volunteer_project_join_records' in tables:
        cur.execute("SELECT id, volunteer_id, volunteer_user_id, project_id, status FROM volunteer_project_join_records LIMIT 10;")
        print("\nvolunteer_project_join_records sample:")
        for r in cur.fetchall():
            print(dict(r))
