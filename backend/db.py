import os

from dotenv import load_dotenv
import psycopg


def get_connection() -> psycopg.Connection:
    load_dotenv()
    database_url = os.getenv("SUPABASE_DB_URL")
    if not database_url:
        raise RuntimeError("SUPABASE_DB_URL is not set.")

    return psycopg.connect(database_url)
