import os
from dotenv import load_dotenv
from pathlib import Path

def check_env():
    root_env = Path('.') / '.env'
    print(f"Checking {root_env.absolute()}")
    print(f"Exists: {root_env.exists()}")
    
    load_dotenv(root_env)
    db_url = os.getenv("SUPABASE_DB_URL")
    print(f"SUPABASE_DB_URL: {db_url[:20] if db_url else 'NOT SET'}...")

if __name__ == "__main__":
    check_env()
