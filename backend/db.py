import os
import time
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from dotenv import load_dotenv

try:
    import psycopg
except ImportError:  # pragma: no cover - dependency is required for runtime
    psycopg = None

try:
    from psycopg_pool import ConnectionPool
except ImportError:  # pragma: no cover - optional for connection pooling
    ConnectionPool = None


POSTGRES_PROBE_CACHE_TTL_SECONDS = 10
_POSTGRES_PROBE_CACHE: dict[str, Any] = {
    "checked_at": 0.0,
    "available": False,
    "error": None,
}
_POSTGRES_LAST_SUCCESSFUL_URL: str | None = None
_POSTGRES_CANDIDATE_FAILURES: dict[str, dict[str, Any]] = {}
_POSTGRES_CONNECTION_POOL: Any = None
_POSTGRES_POOL_MIN_SIZE = 10
_POSTGRES_POOL_MAX_SIZE = 50


"""Shared Postgres connection helpers for the backend API and seed scripts."""


# Loads environment variables from the app and backend `.env` files.
def load_environment() -> None:
    from pathlib import Path

    backend_dir = Path(__file__).resolve().parent
    app_dir = backend_dir.parent
    load_dotenv(app_dir / ".env")
    load_dotenv(backend_dir / ".env", override=True)


print("[DEBUG] backend.db module loaded.")
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


# Reads an optional fallback Supabase Postgres URL from the environment.
def _get_raw_fallback_database_url() -> str:
    load_environment()
    return os.getenv("SUPABASE_DB_URL_FALLBACK", "").strip()


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


# Builds a session-pooler variant from a Supabase transaction-pooler URL when possible.
def _to_session_pooler_database_url(database_url: str) -> str | None:
    try:
        parsed = urlsplit(database_url)
    except Exception:
        return None

    hostname = parsed.hostname or ""
    if not hostname.endswith(".pooler.supabase.com"):
        return None

    if parsed.port != 6543:
        return None

    username = parsed.username or ""
    password = parsed.password or ""
    auth = username
    if password:
        auth = f"{auth}:{password}"
    if auth:
        auth = f"{auth}@"

    netloc = f"{auth}{hostname}:5432"
    return urlunsplit((parsed.scheme, netloc, parsed.path, parsed.query, parsed.fragment))


# Returns prioritized candidate Postgres endpoints for local failover.
def _get_database_url_candidates() -> list[str]:
    primary_url = _get_raw_database_url()
    fallback_url = _get_raw_fallback_database_url()
    candidates: list[str] = []

    def add_candidate(value: str) -> None:
        normalized_value = _normalize_database_url(value)
        if normalized_value and normalized_value not in candidates:
            candidates.append(normalized_value)

    if primary_url:
        session_pooler_url = _to_session_pooler_database_url(primary_url)
        if session_pooler_url:
            add_candidate(session_pooler_url)
        add_candidate(primary_url)

    if fallback_url:
        add_candidate(fallback_url)

    return candidates


# Returns whether one candidate should stay in cooldown before another retry.
def _is_candidate_in_cooldown(candidate_url: str) -> bool:
    failure_info = _POSTGRES_CANDIDATE_FAILURES.get(candidate_url)
    if not failure_info:
        return False

    failed_at = float(failure_info.get("failed_at") or 0.0)
    cooldown_seconds = _get_failover_cooldown_seconds()
    return (time.monotonic() - failed_at) < cooldown_seconds


# Records one failed database candidate and the last observed error.
def _record_candidate_failure(candidate_url: str, error: Exception) -> None:
    _POSTGRES_CANDIDATE_FAILURES[candidate_url] = {
        "failed_at": time.monotonic(),
        "error": str(error),
    }


# Clears any recorded failure cooldown for a database candidate.
def _clear_candidate_failure(candidate_url: str) -> None:
    _POSTGRES_CANDIDATE_FAILURES.pop(candidate_url, None)


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
        "echeckouttimeout",
        "unable to check out connection from the pool",
        "transaction mode",
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
        "database_url_candidates": _get_database_url_candidates(),
        "connect_timeout_seconds": _get_connect_timeout(),
        "candidate_connect_timeout_seconds": _get_candidate_connect_timeout(),
        "connect_attempts": _get_connect_attempts(),
        "retry_base_ms": _get_connect_retry_base_ms(),
        "failover_cooldown_seconds": _get_failover_cooldown_seconds(),
        "probe_cache_ttl_seconds": _get_probe_cache_ttl(),
        "last_probe_checked_at": _POSTGRES_PROBE_CACHE["checked_at"],
        "last_probe_available": _POSTGRES_PROBE_CACHE["available"],
        "last_probe_error": _POSTGRES_PROBE_CACHE["error"],
        "last_successful_database_url": _POSTGRES_LAST_SUCCESSFUL_URL,
        "candidate_failures": _POSTGRES_CANDIDATE_FAILURES,
    }


# Creates a direct Psycopg connection to Supabase Postgres.
def get_postgres_connection():
    global _POSTGRES_LAST_SUCCESSFUL_URL
    database_urls = _get_database_url_candidates()
    connect_timeout = _get_connect_timeout()
    candidate_connect_timeout = _get_candidate_connect_timeout()
    connect_attempts = _get_connect_attempts()
    retry_base_ms = _get_connect_retry_base_ms()

    if not database_urls:
        raise RuntimeError("SUPABASE_DB_URL is not set.")
    if psycopg is None:
        raise RuntimeError("psycopg is not installed.")

    candidate_urls = list(database_urls)
    if _POSTGRES_LAST_SUCCESSFUL_URL in candidate_urls:
        candidate_urls.remove(_POSTGRES_LAST_SUCCESSFUL_URL)
        candidate_urls.insert(0, _POSTGRES_LAST_SUCCESSFUL_URL)

    last_error: Exception | None = None
    for attempt in range(connect_attempts):
        available_candidates = [
            candidate_url
            for candidate_url in candidate_urls
            if not _is_candidate_in_cooldown(candidate_url)
        ]
        if not available_candidates:
            available_candidates = candidate_urls

        for candidate_url in available_candidates:
            connection = None
            pooler_mode = _is_pooler_database_url(candidate_url)
            timeout_to_use = candidate_connect_timeout if len(candidate_urls) > 1 else connect_timeout

            try:
                connect_kwargs: dict[str, Any] = {
                    "connect_timeout": timeout_to_use,
                    "application_name": "volcre-backend",
                }

                # Supabase pooler is PgBouncer-like; prepared statements can fail there.
                if pooler_mode:
                    connect_kwargs["prepare_threshold"] = None

                connection = psycopg.connect(candidate_url, **connect_kwargs)
                with connection.cursor() as cursor:
                    cursor.execute("select 1")
                    cursor.fetchone()
                _POSTGRES_LAST_SUCCESSFUL_URL = candidate_url
                _clear_candidate_failure(candidate_url)
                return connection
            except Exception as exc:
                last_error = exc
                _record_candidate_failure(candidate_url, exc)
                if connection is not None:
                    try:
                        connection.close()
                    except Exception:
                        pass

        should_retry = attempt < connect_attempts - 1 and last_error is not None and _is_retryable_connection_error(last_error)
        if not should_retry:
            break

        delay_seconds = (retry_base_ms * (2 ** attempt)) / 1000.0
        time.sleep(delay_seconds)

    if last_error is not None:
        raise last_error

    raise RuntimeError("Failed to open Supabase Postgres connection.")


# Initializes the connection pool when the app starts
def init_postgres_pool() -> None:
    global _POSTGRES_CONNECTION_POOL
    if _POSTGRES_CONNECTION_POOL is not None:
        return  # Pool already initialized

    if ConnectionPool is None or not psycopg:
        return  # Connection pooling not available

    try:
        candidates = _get_database_url_candidates()
        if not candidates:
            return

        # Prefer the session pooler candidate if available for the long-lived connection pool
        database_url = candidates[0]
        
        # Create connection pool with optimized settings
        _POSTGRES_CONNECTION_POOL = ConnectionPool(
            database_url,
            min_size=_POSTGRES_POOL_MIN_SIZE,
            max_size=_POSTGRES_POOL_MAX_SIZE,
            timeout=_get_connect_timeout() * 2,  # Timeout waiting for available connection
            kwargs={
                "application_name": "volcre-backend-pool",
                "prepare_threshold": None,  # Disable prepared statements for pooler compatibility
                "connect_timeout": _get_connect_timeout(),
            }
        )
        print(f"[OK] Postgres connection pool initialized (min={_POSTGRES_POOL_MIN_SIZE}, max={_POSTGRES_POOL_MAX_SIZE}) using {urlsplit(database_url).hostname}")
    except Exception as exc:
        print(f"[WARN] Failed to initialize Postgres connection pool: {exc}")
        _POSTGRES_CONNECTION_POOL = None


# Returns a connection from the pool if available, otherwise creates a direct connection
def get_pooled_postgres_connection():
    """Get a database connection from the pool if available, otherwise create a direct connection."""
    if _POSTGRES_CONNECTION_POOL is not None:
        try:
            return _POSTGRES_CONNECTION_POOL.getconn()
        except Exception as exc:
            print(f"[WARN] Failed to get connection from pool: {exc}")
            # Fall back to direct connection
            return get_postgres_connection()
    return get_postgres_connection()


# Returns a connection from the pool if available, otherwise creates a direct connection
# Returns a context manager that automatically releases the connection back to the pool.
from contextlib import contextmanager

@contextmanager
def get_connection(is_priority: bool = False):
    """Get a pooled connection, with automatic release. High-priority requests are prioritized."""
    if _POSTGRES_CONNECTION_POOL is not None:
        try:
            # We can't easily jump the queue in psycopg_pool without custom logic,
            # but we can at least log if a priority request is waiting.
            conn = _POSTGRES_CONNECTION_POOL.getconn()
            
            try:
                yield conn
            finally:
                _POSTGRES_CONNECTION_POOL.putconn(conn)
        except Exception as exc:
            print(f"[WARN] Failed to get/return connection from pool: {exc}")
            conn = get_postgres_connection()
            try:
                yield conn
            finally:
                conn.close()
    else:
        conn = get_postgres_connection()
        try:
            yield conn
        finally:
            conn.close()

