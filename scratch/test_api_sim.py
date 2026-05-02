"""Directly simulate what the API does when it receives PUT /storage/programTracks."""
import sys, os, json
sys.path.insert(0, r"c:\Users\ASUS\Desktop\VMS\volunteer-system\backend")
from dotenv import load_dotenv
load_dotenv()

from db import get_postgres_connection
from app_storage_seed import replace_postgres_hot_storage_collection, get_postgres_hot_storage_collection
from field_rules import sanitize_hot_storage_item

# Simulate the API payload
items = [
    {
        "id": "Education",
        "title": "Education",
        "description": "Learning.",
        "icon": "school",
        "color": "#2563eb",
        "imageUrl": "",
        "isActive": True,
        "createdAt": "2026-05-01T00:00:00Z",
        "updatedAt": "2026-05-01T00:00:00Z",
    },
    {
        "id": "_test_new_api",
        "title": "New Test From API Sim",
        "description": "Simulate API save",
        "icon": "folder",
        "color": "#6366f1",
        "isActive": True,
        "createdAt": "2026-05-01T00:00:00Z",
        "updatedAt": "2026-05-01T00:00:00Z",
    },
]

print("Checking sanitize_hot_storage_item for each item...")
for item in items:
    try:
        sanitized = sanitize_hot_storage_item("programTracks", item)
        print(f"  OK: {item['id']} -> {sanitized.get('id')}")
    except Exception as e:
        print(f"  ERROR on {item['id']}: {e}")

print("\nCalling replace_postgres_hot_storage_collection...")
try:
    with get_postgres_connection() as conn:
        replace_postgres_hot_storage_collection(conn, "programTracks", items)
        conn.commit()
    print("SUCCESS!")
    
    with get_postgres_connection() as conn:
        rows = get_postgres_hot_storage_collection(conn, "programTracks")
        print(f"Tracks in DB: {[r.get('id') for r in rows]}")

    # Cleanup
    with get_postgres_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM program_tracks WHERE id = '_test_new_api'")
        conn.commit()
    print("Cleaned up test row.")
except Exception as e:
    import traceback
    print(f"ERROR: {type(e).__name__}: {e}")
    traceback.print_exc()
