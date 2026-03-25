import os
import time
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from dotenv import load_dotenv

try:
    import psycopg
except ImportError:  # pragma: no cover - dependency is required for runtime
    psycopg = None


POSTGRES_PROBE_CACHE_TTL_SECONDS = 10
_POSTGRES_PROBE_CACHE: dict[str, Any] = {
    "checked_at": 0.0,
    "available": False,
    "error": None,
}


def load_environment() -> None:
    from pathlib import Path

    backend_dir = Path(__file__).resolve().parent
    app_dir = backend_dir.parent
    load_dotenv(app_dir / ".env")
    load_dotenv(backend_dir / ".env", override=True)


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


def _get_raw_database_url() -> str:
    load_environment()
    return os.getenv("SUPABASE_DB_URL", "").strip()


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
    return "unconfigured"


def reset_postgres_probe_cache() -> None:
    _POSTGRES_PROBE_CACHE["checked_at"] = 0.0
    _POSTGRES_PROBE_CACHE["available"] = False
    _POSTGRES_PROBE_CACHE["error"] = None


def get_postgres_status(force_refresh: bool = False) -> tuple[bool, str | None]:
    if get_configured_db_mode() != "postgres":
        return False, "Supabase Postgres is not configured for this backend."

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
    postgres_available, _ = get_postgres_status()
    return "postgres" if postgres_available else "unavailable"


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
