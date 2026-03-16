import os
import sqlite3
import time
from functools import lru_cache
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from dotenv import load_dotenv

try:
    import psycopg
except ImportError:  # pragma: no cover - optional dependency in local mode
    psycopg = None


BACKEND_DIR = Path(__file__).resolve().parent
APP_DIR = BACKEND_DIR.parent
LOCAL_DB_PATH = BACKEND_DIR / "volcre_storage.db"
POSTGRES_PROBE_CACHE_TTL_SECONDS = 10
_POSTGRES_PROBE_CACHE: dict[str, Any] = {
    "checked_at": 0.0,
    "available": False,
    "error": None,
}


def load_environment() -> None:
    load_dotenv(APP_DIR / ".env")
    load_dotenv(BACKEND_DIR / ".env", override=True)


def _get_connect_timeout() -> int:
    raw_timeout = os.getenv("DB_CONNECT_TIMEOUT", "5").strip()
    try:
        return max(1, int(raw_timeout))
    except ValueError:
        return 5


def _get_probe_cache_ttl() -> int:
    raw_ttl = os.getenv("DB_PROBE_CACHE_TTL_SECONDS", str(POSTGRES_PROBE_CACHE_TTL_SECONDS)).strip()
    try:
        return max(0, int(raw_ttl))
    except ValueError:
        return POSTGRES_PROBE_CACHE_TTL_SECONDS


def _is_truthy(value: str | None) -> bool:
    if value is None:
        return False
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _get_raw_database_url() -> str:
    load_environment()
    return os.getenv("SUPABASE_DB_URL", "").strip()


@lru_cache(maxsize=1)
def _get_sqlite_mode_warning() -> str:
    return "Postgres is not configured. Falling back to SQLite."


def _normalize_database_url(database_url: str) -> str:
    parsed = urlsplit(database_url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query.setdefault("sslmode", "require")
    normalized_query = urlencode(query)
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, normalized_query, parsed.fragment))


def get_configured_db_mode() -> str:
    database_url = _get_raw_database_url()
    if database_url and psycopg is not None:
        return "postgres"
    return "sqlite"


def reset_postgres_probe_cache() -> None:
    _POSTGRES_PROBE_CACHE["checked_at"] = 0.0
    _POSTGRES_PROBE_CACHE["available"] = False
    _POSTGRES_PROBE_CACHE["error"] = None


def get_postgres_status(force_refresh: bool = False) -> tuple[bool, str | None]:
    if get_configured_db_mode() != "postgres":
        return False, _get_sqlite_mode_warning()

    ttl_seconds = _get_probe_cache_ttl()
    now = time.monotonic()
    cache_age = now - float(_POSTGRES_PROBE_CACHE["checked_at"])
    if not force_refresh and cache_age <= ttl_seconds:
        return bool(_POSTGRES_PROBE_CACHE["available"]), _POSTGRES_PROBE_CACHE["error"]

    try:
        with get_postgres_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute("select 1")
                cursor.fetchone()
        available = True
        error = None
    except Exception as exc:
        available = False
        error = str(exc)

    _POSTGRES_PROBE_CACHE["checked_at"] = now
    _POSTGRES_PROBE_CACHE["available"] = available
    _POSTGRES_PROBE_CACHE["error"] = error
    return available, error


def get_db_mode() -> str:
    configured_mode = get_configured_db_mode()
    if configured_mode != "postgres":
        return "sqlite"

    strict_postgres = _is_truthy(os.getenv("DB_STRICT_POSTGRES"))
    postgres_available, _ = get_postgres_status()
    if strict_postgres:
        return "postgres"
    return "postgres" if postgres_available else "sqlite"


def get_postgres_connection():
    database_url = _get_raw_database_url()
    connect_timeout = _get_connect_timeout()
    if not database_url:
        raise RuntimeError("SUPABASE_DB_URL is not set.")
    if psycopg is None:
        raise RuntimeError("psycopg is not installed.")
    return psycopg.connect(_normalize_database_url(database_url), connect_timeout=connect_timeout)


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
