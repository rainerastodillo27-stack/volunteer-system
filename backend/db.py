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


# Reads an optional explicit fallback database URL from the environment.
def _get_fallback_database_url() -> str:
    load_environment()
    return os.getenv("SUPABASE_DB_URL_FALLBACK", "").strip()


# Ensures the Postgres connection string includes required query settings.
def _normalize_database_url(database_url: str) -> str:
    parsed = urlsplit(database_url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query.setdefault("sslmode", "require")
    normalized_query = urlencode(query)
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, normalized_query, parsed.fragment))


# Returns whether the configured host looks like a Supabase pooler endpoint.
def _is_supabase_pooler_host(hostname: str) -> bool:
    normalized_host = (hostname or "").strip().lower()
    return normalized_host.endswith(".pooler.supabase.com")


# Builds a Supabase session-pooler URL from a transaction-pooler URL when possible.
def _derive_supabase_session_pooler_url(database_url: str) -> str | None:
    parsed = urlsplit(database_url)
    if not _is_supabase_pooler_host(parsed.hostname or ""):
        return None
    if parsed.port != 6543:
        return None

    hostname = parsed.hostname or ""
    netloc = f"{parsed.netloc.rsplit(':', 1)[0]}:5432" if ":" in parsed.netloc else f"{hostname}:5432"
    return _normalize_database_url(
        urlunsplit((parsed.scheme, netloc, parsed.path, parsed.query, parsed.fragment))
    )


# Builds a direct Supabase database URL from a pooler URL when possible.
def _derive_direct_supabase_url(database_url: str) -> str | None:
    parsed = urlsplit(database_url)
    if not _is_supabase_pooler_host(parsed.hostname or ""):
        return None

    username = parsed.username or ""
    password = parsed.password or ""
    if "." not in username:
        return None

    direct_username, project_ref = username.split(".", 1)
    project_ref = project_ref.strip()
    direct_username = direct_username.strip()
    if not project_ref or not direct_username:
        return None

    password_part = f":{quote(password, safe='')}" if password else ""
    netloc = f"{quote(direct_username, safe='')}{password_part}@db.{project_ref}.supabase.co:5432"
    return _normalize_database_url(
        urlunsplit((parsed.scheme, netloc, parsed.path, parsed.query, parsed.fragment))
    )


# Returns the ordered list of database URLs the backend should try.
def _get_database_connection_candidates() -> list[str]:
    primary_url = _normalize_database_url(_get_raw_database_url())
    if not primary_url:
        return []

    session_pooler_url = _derive_supabase_session_pooler_url(primary_url)

    candidates: list[str] = []
    if _POSTGRES_LAST_SUCCESSFUL_URL:
        candidates.append(_POSTGRES_LAST_SUCCESSFUL_URL)

    if session_pooler_url:
        candidates.append(session_pooler_url)

    candidates.append(primary_url)

    fallback_url = _get_fallback_database_url()
    if fallback_url:
        candidates.append(_normalize_database_url(fallback_url))

    derived_direct_url = _derive_direct_supabase_url(primary_url)
    if derived_direct_url:
        candidates.append(derived_direct_url)

    ordered_candidates: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        if candidate and candidate not in seen:
            ordered_candidates.append(candidate)
            seen.add(candidate)
    return ordered_candidates


# Returns a safe label for logging and diagnostics.
def _get_database_endpoint_label(database_url: str) -> str:
    parsed = urlsplit(database_url)
    host = parsed.hostname or ""
    port = parsed.port or ""
    database = (parsed.path or "").lstrip("/") or "postgres"
    return f"{host}:{port}/{database}"


# Returns whether a failed candidate should be skipped temporarily.
def _should_skip_candidate(database_url: str, now: float) -> bool:
    if database_url == _POSTGRES_LAST_SUCCESSFUL_URL:
        return False

    failure = _POSTGRES_CANDIDATE_FAILURES.get(database_url)
    if not failure:
        return False

    cooldown_seconds = _get_failover_cooldown_seconds()
    failed_at = float(failure.get("failed_at") or 0.0)
    return cooldown_seconds > 0 and (now - failed_at) < cooldown_seconds


# Stores a recent candidate failure so the backend can avoid retrying it immediately.
def _record_candidate_failure(database_url: str, error: str) -> None:
    _POSTGRES_CANDIDATE_FAILURES[database_url] = {
        "failed_at": time.monotonic(),
        "error": error,
    }


# Records the last successful candidate and clears its failure state.
def _record_candidate_success(database_url: str) -> None:
    global _POSTGRES_LAST_SUCCESSFUL_URL
    _POSTGRES_LAST_SUCCESSFUL_URL = database_url
    _POSTGRES_CANDIDATE_FAILURES.pop(database_url, None)


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


# Returns runtime diagnostics about candidate ordering and failover state.
def get_postgres_diagnostics() -> dict[str, Any]:
    now = time.monotonic()
    diagnostics: list[dict[str, Any]] = []

    for candidate_url in _get_database_connection_candidates():
        failure = _POSTGRES_CANDIDATE_FAILURES.get(candidate_url)
        cooldown_remaining = 0
        if failure:
            elapsed = now - float(failure.get("failed_at") or 0.0)
            cooldown_remaining = max(0, _get_failover_cooldown_seconds() - int(elapsed))

        diagnostics.append(
            {
                "endpoint": _get_database_endpoint_label(candidate_url),
                "is_last_successful": candidate_url == _POSTGRES_LAST_SUCCESSFUL_URL,
                "is_temporarily_skipped": _should_skip_candidate(candidate_url, now),
                "cooldown_seconds_remaining": cooldown_remaining,
                "last_error": failure.get("error") if failure else None,
            }
        )

    return {
        "connect_timeout_seconds": _get_connect_timeout(),
        "candidate_connect_timeout_seconds": _get_candidate_connect_timeout(),
        "failover_cooldown_seconds": _get_failover_cooldown_seconds(),
        "selected_endpoint": _get_database_endpoint_label(_POSTGRES_LAST_SUCCESSFUL_URL)
        if _POSTGRES_LAST_SUCCESSFUL_URL
        else None,
        "candidates": diagnostics,
    }


# Creates a direct Psycopg connection to Supabase Postgres.
def get_postgres_connection():
    connect_timeout = _get_connect_timeout()
    candidate_connect_timeout = min(connect_timeout, _get_candidate_connect_timeout())
    candidate_urls = _get_database_connection_candidates()
    if not candidate_urls:
        raise RuntimeError("SUPABASE_DB_URL is not set.")
    if psycopg is None:
        raise RuntimeError("psycopg is not installed.")

    now = time.monotonic()
    active_candidates = [candidate for candidate in candidate_urls if not _should_skip_candidate(candidate, now)]
    if not active_candidates:
        active_candidates = candidate_urls

    errors: list[str] = []
    for candidate_url in active_candidates:
        try:
            connection = psycopg.connect(candidate_url, connect_timeout=candidate_connect_timeout)
            _record_candidate_success(candidate_url)
            return connection
        except Exception as exc:
            error_message = f"{_get_database_endpoint_label(candidate_url)} -> {exc}"
            _record_candidate_failure(candidate_url, str(exc))
            errors.append(error_message)

    combined_errors = " | ".join(dict.fromkeys(errors))
    raise RuntimeError(combined_errors or "Unable to connect to Supabase Postgres.")


# Returns the default backend database connection.
def get_connection():
    return get_postgres_connection()
