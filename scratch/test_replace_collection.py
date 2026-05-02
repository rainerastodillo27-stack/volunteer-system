"""Calls replace_relational_collection directly to find exact error."""
import os, sys, json
from dotenv import load_dotenv
load_dotenv()

sys.path.insert(0, r"c:\Users\ASUS\Desktop\VMS\volunteer-system\backend")

from db import get_postgres_connection
from relational_mirror import replace_relational_collection

test_tracks = [
    {
        "id": "Education",
        "title": "Education",
        "description": "Learning, literacy.",
        "icon": "school",
        "color": "#2563eb",
        "imageUrl": "",
        "sortOrder": 20,
        "isActive": True,
        "createdAt": "2026-05-01T00:00:00Z",
        "updatedAt": "2026-05-01T00:00:00Z",
    },
    {
        "id": "_test_new_program",S
        "title": "New Test Program",
        "description": "Created by script",
        "icon": "folder",
        "color": "#6366f1",
        "imageUrl": None,
        "sortOrder": None,
        "isActive": True,
        "createdAt": "2026-05-01T00:00:00Z",
        "updatedAt": "2026-05-01T00:00:00Z",
    },
]

try:
    with get_postgres_connection() as conn:
        replace_relational_collection(conn, "programTracks", test_tracks)
        conn.commit()
    print("SUCCESS: replace_relational_collection worked!")
    
    # Verify
    with get_postgres_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, title FROM program_tracks ORDER BY sort_order")
            rows = cur.fetchall()
            print(f"Tracks in DB ({len(rows)}):")
            for row in rows:
                print(f"  {row}")

    # Cleanup test row
    with get_postgres_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM program_tracks WHERE id = '_test_new_program'")
        conn.commit()
    print("\nTest row cleaned up.")
except Exception as e:
    print(f"ERROR: {type(e).__name__}: {e}")
    import traceback
    traceback.print_exc()
