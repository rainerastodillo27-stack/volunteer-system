from backend.app_storage_seed import ensure_app_storage_seeded
from dotenv import load_dotenv
import os

load_dotenv()
try:
    ensure_app_storage_seeded()
    print("Seeding successful")
except Exception as e:
    print(f"Seeding failed: {e}")
