import os
import time
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from dotenv import load_dotenv

try:
    import psycopg
    from psycopg_pool import ConnectionPool
except ImportError:  # pragma: no cover - dependency is required for runtime
    psycopg = None
    ConnectionPool = None


POSTGRES_PROBE_CACHE_TTL_SECONDS = 10
_POSTGRES_PROBE_CACHE: dict[str, Any] = {
    "checked_at": 0.0,
    "available": False,
    "error": None,
}

# Connection pool for persistent connections instead of creating new ones per request
_CONNECTION_POOL: ConnectionPool | None = None


"""Shared Postgres connection helpers for the backend API and seed scripts."""


# Loads environment variables from the app and backend `.env` files.
def load_environment() -> None:
    from pathlib import Path

    backend_dir = Path(__file__).resolve().parent
    app_dir = backend_dir.parent
    load_dotenv(app_dir / ".env")
    load_dotenv(backend_dir / ".env", override=True)


# Returns the database connect timeout used for Postgres connections.
def _get_connect_timeout() -> int:
    raw_timeout = os.getenv("DB_CONNECT_TIMEOUT", "5").strip()
    try:
        return max(1, int(raw_timeout))
    except ValueError:
        return 5


# Returns how long Postgres health checks should stay cached.
def _get_probe_cache_ttl() -> int:
    raw_ttl = os.getenv("DB_PROBE_CACHE_TTL_SECONDS", str(POSTGRES_PROBE_CACHE_TTL_SECONDS)).strip()
    try:
        return max(0, int(raw_ttl))
    except ValueError:
        return POSTGRES_PROBE_CACHE_TTL_SECONDS


# Reads the configured Supabase Postgres URL from the environment.
def _get_raw_database_url() -> str:
    load_environment()
    return os.getenv("SUPABASE_DB_URL", "").strip()


# Ensures the Postgres connection string includes required query settings.
def _normalize_database_url(database_url: str) -> str:
    parsed = urlsplit(database_url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query.setdefault("sslmode", "require")
    normalized_query = urlencode(query)
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, normalized_query, parsed.fragment))


# Reports whether a usable Postgres configuration is present.
def get_configured_db_mode() -> str:
    database_url = _get_raw_database_url()
    if database_url and psycopg is not None:
        return "postgres"
    return "unconfigured"


# Clears the cached Postgres health probe result.
def reset_postgres_probe_cache() -> None:
    _POSTGRES_PROBE_CACHE["checked_at"] = 0.0
    _POSTGRES_PROBE_CACHE["available"] = False
    _POSTGRES_PROBE_CACHE["error"] = None


# Checks whether Postgres is reachable and caches the result briefly.
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


# Returns the effective runtime database mode.
def get_db_mode() -> str:
    postgres_available, _ = get_postgres_status()
    return "postgres" if postgres_available else "unavailable"


# Initializes the connection pool for efficient connection reuse.
def _initialize_connection_pool() -> ConnectionPool | None:
    """Creates a connection pool if not already initialized."""
    global _CONNECTION_POOL
    
    if _CONNECTION_POOL is not None:
        return _CONNECTION_POOL
    
    if get_configured_db_mode() != "postgres" or ConnectionPool is None:
        return None
    
    database_url = _get_raw_database_url()
    connect_timeout = _get_connect_timeout()
    
    try:
        _CONNECTION_POOL = ConnectionPool(
            _normalize_database_url(database_url),
            min_size=2,  # Minimum idle connections
            max_size=10,  # Maximum total connections
            timeout=connect_timeout,
        )
        return _CONNECTION_POOL
    except Exception as exc:
        print(f"Failed to initialize connection pool: {exc}")
        return None


# Creates a direct Psycopg connection to Supabase Postgres using connection pool.
def get_postgres_connection():
    database_url = _get_raw_database_url()
    connect_timeout = _get_connect_timeout()
    if not database_url:
        raise RuntimeError("SUPABASE_DB_URL is not set.")
    if psycopg is None:
        raise RuntimeError("psycopg is not installed.")
    
    # Try to use connection pool for better performance
    pool = _initialize_connection_pool()
    if pool:
        return pool.getconn()
    
    # Fallback to direct connection if pooling is unavailable
    return psycopg.connect(_normalize_database_url(database_url), connect_timeout=connect_timeout)


# Closes the connection pool gracefully (should be called at app shutdown).
def close_connection_pool() -> None:
    """Closes the connection pool and all idle connections."""
    global _CONNECTION_POOL
    if _CONNECTION_POOL:
        _CONNECTION_POOL.close()
        _CONNECTION_POOL = None


# Returns the default backend database connection.
def get_connection():
    return get_postgres_connection()
