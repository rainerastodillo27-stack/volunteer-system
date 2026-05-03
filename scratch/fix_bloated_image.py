"""Strip oversized imageUrl base64 blobs from project records to fix slow dashboard."""
import sys
sys.path.insert(0, r'c:\Users\ACER\OneDrive\Desktop\volunteer-system')

from backend.db import get_connection
from backend.app_storage_seed import (
    get_postgres_hot_storage_collection,
    replace_postgres_hot_storage_collection,
)

MAX_IMAGE_URL_LEN = 50_000  # ~37KB image as base64; anything larger gets nuked

def main():
    with get_connection() as conn:
        for key in ("projects", "events"):
            items = get_postgres_hot_storage_collection(conn, key)
            changed = False
            for item in items:
                url = item.get("imageUrl")
                if isinstance(url, str) and len(url) > MAX_IMAGE_URL_LEN:
                    print(f"[{key}] {item.get('id')}: imageUrl was {len(url):,} chars -> cleared")
                    item["imageUrl"] = None
                    changed = True
            if changed:
                replace_postgres_hot_storage_collection(conn, key, items)
                conn.commit()
                print(f"[{key}] saved updated collection ({len(items)} items)")
            else:
                print(f"[{key}] no oversized imageUrls found")

if __name__ == "__main__":
    main()
