import os
import sqlite3
from pathlib import Path

from dotenv import load_dotenv

try:
    import psycopg
except ImportError:  # pragma: no cover - optional dependency in local mode
    psycopg = None


BACKEND_DIR = Path(__file__).resolve().parent
APP_DIR = BACKEND_DIR.parent
LOCAL_DB_PATH = BACKEND_DIR / "volcre_storage.db"


def load_environment() -> None:
    load_dotenv(APP_DIR / ".env")
    load_dotenv(BACKEND_DIR / ".env")


def get_db_mode() -> str:
    load_environment()
    database_url = os.getenv("SUPABASE_DB_URL", "").strip()
    if database_url and psycopg is not None:
      return "postgres"
    return "sqlite"


def get_postgres_connection():
    load_environment()
    database_url = os.getenv("SUPABASE_DB_URL", "").strip()
    if not database_url:
        raise RuntimeError("SUPABASE_DB_URL is not set.")
    if psycopg is None:
        raise RuntimeError("psycopg is not installed.")
    return psycopg.connect(database_url)


def get_connection():
    return get_postgres_connection()


def get_sqlite_connection() -> sqlite3.Connection:
    connection = sqlite3.connect(LOCAL_DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def ensure_sqlite_storage() -> None:
    with get_sqlite_connection() as connection:
        connection.execute(
            """
            create table if not exists app_storage (
              key text primary key,
              value text,
              updated_at text not null default current_timestamp
            )
            """
        )
        connection.commit()
