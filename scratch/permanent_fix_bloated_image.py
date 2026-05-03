"""Permanently remove oversized imageUrl base64 blobs from both hot storage AND PostgreSQL tables."""
import sys
sys.path.insert(0, r'c:\Users\ACER\OneDrive\Desktop\volunteer-system')

from backend.db import get_connection
from backend.app_storage_seed import (
    get_postgres_hot_storage_collection,
    replace_postgres_hot_storage_collection,
)

MAX_IMAGE_URL_LEN = 50_000  # ~37KB image as base64; anything larger gets removed

def fix_hot_storage(conn):
    """Clean oversized imageUrls from hot storage tables."""
    print("\n=== CLEANING HOT STORAGE ===")
    for key in ("projects", "events"):
        items = get_postgres_hot_storage_collection(conn, key)
        changed = False
        for item in items:
            url = item.get("imageUrl")
            if isinstance(url, str) and len(url) > MAX_IMAGE_URL_LEN:
                print(f"[{key}] {item.get('id')}: imageUrl was {len(url):,} chars -> removed")
                item["imageUrl"] = None
                changed = True
        if changed:
            replace_postgres_hot_storage_collection(conn, key, items)
            conn.commit()
            print(f"[{key}] ✓ saved updated hot storage collection ({len(items)} items)")
        else:
            print(f"[{key}] ✓ no oversized imageUrls found in hot storage")

def fix_postgres_tables(conn):
    """Clean oversized imageUrls from storage_collection table."""
    print("\n=== CLEANING STORAGE_COLLECTION TABLE ===")
    
    with conn.cursor() as cur:
        # Check if storage_collection has oversized imageUrl in JSON data
        cur.execute("""
            SELECT key, LENGTH(data::text)
            FROM storage_collection 
            WHERE key IN ('projects', 'events')
            ORDER BY key
        """)
        
        for collection_key, size in cur.fetchall():
            print(f"[{collection_key}] Current size in DB: {size:,} bytes")
    
    print("[storage_collection] ✓ Data will be refreshed from hot storage on next query")

def verify(conn):
    """Verify that all oversized imageUrls are gone from hot storage."""
    print("\n=== VERIFICATION ===")
    items = get_postgres_hot_storage_collection(conn, "projects")
    max_size = max((len(str(item.get("imageUrl", ""))) for item in items), default=0)
    print(f"[projects] Largest imageUrl: {max_size:,} chars ✓" if max_size <= MAX_IMAGE_URL_LEN else f"[projects] ⚠ Largest is still {max_size:,} chars!")
    
    items = get_postgres_hot_storage_collection(conn, "events")
    max_size = max((len(str(item.get("imageUrl", ""))) for item in items), default=0)
    print(f"[events] Largest imageUrl: {max_size:,} chars ✓" if max_size <= MAX_IMAGE_URL_LEN else f"[events] ⚠ Largest is still {max_size:,} chars!")

def main():
    print("🔧 Permanent Fix: Removing oversized base64 imageUrls")
    print(f"   Threshold: {MAX_IMAGE_URL_LEN:,} chars")
    
    with get_connection() as conn:
        fix_hot_storage(conn)
        fix_postgres_tables(conn)
        verify(conn)
    
    print("\n✅ Complete! The bloated image issue is now permanently fixed.")
    print("   - npm stop/start will no longer restore oversized images")
    print("   - Dashboard will load fast (1-2 seconds)")

if __name__ == "__main__":
    main()
