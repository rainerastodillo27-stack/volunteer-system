import os
import time
from typing import Any
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit

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
_POSTGRES_LAST_SUCCESSFUL_URL: str | None = None
_POSTGRES_CANDIDATE_FAILURES: dict[str, dict[str, Any]] = {}


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


# Returns the per-endpoint timeout used while failing over between candidates.
def _get_candidate_connect_timeout() -> int:
    raw_timeout = os.getenv("DB_CANDIDATE_CONNECT_TIMEOUT", "").strip()
    if raw_timeout:
        try:
            return max(1, int(raw_timeout))
        except ValueError:
            pass
    return min(_get_connect_timeout(), 5)


# Returns how many times backend should retry opening a Postgres connection.
def _get_connect_attempts() -> int:
    raw_attempts = os.getenv("DB_CONNECT_MAX_ATTEMPTS", "3").strip()
    try:
        return max(1, int(raw_attempts))
    except ValueError:
        return 3


# Returns the base delay (milliseconds) used between connection retries.
def _get_connect_retry_base_ms() -> int:
    raw_delay = os.getenv("DB_CONNECT_RETRY_BASE_MS", "400").strip()
    try:
        return max(0, int(raw_delay))
    except ValueError:
        return 400


# Returns how long Postgres health checks should stay cached.
def _get_probe_cache_ttl() -> int:
    raw_ttl = os.getenv("DB_PROBE_CACHE_TTL_SECONDS", str(POSTGRES_PROBE_CACHE_TTL_SECONDS)).strip()
    try:
        return max(0, int(raw_ttl))
    except ValueError:
        return POSTGRES_PROBE_CACHE_TTL_SECONDS


# Returns how long failed database endpoints should be skipped before retrying.
def _get_failover_cooldown_seconds() -> int:
    raw_cooldown = os.getenv("DB_FAILOVER_COOLDOWN_SECONDS", "120").strip()
    try:
        return max(0, int(raw_cooldown))
    except ValueError:
        return 120


# Reads the configured Supabase Postgres URL from the environment.
def _get_raw_database_url() -> str:
    load_environment()
    return os.getenv("SUPABASE_DB_URL", "").strip()


# Returns true when the Supabase Postgres URL points at the pooler endpoint.
def _is_pooler_database_url(database_url: str) -> bool:
    try:
        parsed = urlsplit(database_url)
        return parsed.hostname is not None and parsed.hostname.endswith(".pooler.supabase.com")
    except Exception:
        return False


# Ensures the Postgres connection string includes required query settings.
def _normalize_database_url(database_url: str) -> str:
    parsed = urlsplit(database_url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query.setdefault("sslmode", "require")
    normalized_query = urlencode(query)
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, normalized_query, parsed.fragment))


# Returns true when an exception looks like a transient connection-drop issue.
def _is_retryable_connection_error(error: Exception) -> bool:
    normalized = str(error).lower()
    retryable_markers = [
        "edbhandlerexited",
        "connection to database closed",
        "server closed the connection unexpectedly",
        "connection reset",
        "terminating connection",
        "could not receive data from server",
        "ssl syscall error",
        "broken pipe",
    ]
    return any(marker in normalized for marker in retryable_markers)


# Reports whether a usable Postgres configuration is present.
def get_configured_db_mode() -> str:
    database_url = _get_raw_database_url()
    if database_url and psycopg is not None:
        return "postgres"
    return "unconfigured"


# Clears the cached Postgres health probe result.
def reset_postgres_probe_cache() -> None:
    global _POSTGRES_LAST_SUCCESSFUL_URL
    _POSTGRES_PROBE_CACHE["checked_at"] = 0.0
    _POSTGRES_PROBE_CACHE["available"] = False
    _POSTGRES_PROBE_CACHE["error"] = None
    _POSTGRES_LAST_SUCCESSFUL_URL = None
    _POSTGRES_CANDIDATE_FAILURES.clear()


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


# Returns runtime diagnostics about connection settings and recent health state.
def get_postgres_diagnostics() -> dict[str, Any]:
    return {
        "connect_timeout_seconds": _get_connect_timeout(),
        "connect_attempts": _get_connect_attempts(),
        "retry_base_ms": _get_connect_retry_base_ms(),
        "probe_cache_ttl_seconds": _get_probe_cache_ttl(),
        "last_probe_checked_at": _POSTGRES_PROBE_CACHE["checked_at"],
        "last_probe_available": _POSTGRES_PROBE_CACHE["available"],
        "last_probe_error": _POSTGRES_PROBE_CACHE["error"],
    }


# Creates a direct Psycopg connection to Supabase Postgres.
def get_postgres_connection():
    database_url = _get_raw_database_url()
    connect_timeout = _get_connect_timeout()
    connect_attempts = _get_connect_attempts()
    retry_base_ms = _get_connect_retry_base_ms()

    if not database_url:
        raise RuntimeError("SUPABASE_DB_URL is not set.")
    if psycopg is None:
        raise RuntimeError("psycopg is not installed.")

    normalized_url = _normalize_database_url(database_url)
    pooler_mode = _is_pooler_database_url(normalized_url)

    last_error: Exception | None = None
    for attempt in range(connect_attempts):
        connection = None
        try:
            connect_kwargs: dict[str, Any] = {
                "connect_timeout": connect_timeout,
                "application_name": "volcre-backend",
            }

            # Supabase pooler is PgBouncer-like; prepared statements can fail there.
            if pooler_mode:
                connect_kwargs["prepare_threshold"] = None

            connection = psycopg.connect(normalized_url, **connect_kwargs)
            with connection.cursor() as cursor:
                cursor.execute("select 1")
                cursor.fetchone()
            return connection
        except Exception as exc:
            last_error = exc
            if connection is not None:
                try:
                    connection.close()
                except Exception:
                    pass

            should_retry = attempt < connect_attempts - 1 and _is_retryable_connection_error(exc)
            if not should_retry:
                raise

            delay_seconds = (retry_base_ms * (2 ** attempt)) / 1000.0
            time.sleep(delay_seconds)

    if last_error is not None:
        raise last_error

    raise RuntimeError("Failed to open Supabase Postgres connection.")


# Returns the default backend database connection.
def get_connection():
    return get_postgres_connection()
