"""Small PostgreSQL-backed bus for realtime events across API workers.

Each Uvicorn worker has its own in-memory WebSocket registry.  PostgreSQL
LISTEN/NOTIFY keeps those registries in sync without adding a new service or
changing the client protocol.
"""

from __future__ import annotations

import json
import secrets
import threading
from collections.abc import Callable
from typing import Any

from .db import _get_connect_timeout, _get_session_database_url_candidates, get_connection

try:
    import psycopg
except ImportError:  # pragma: no cover - required in deployment
    psycopg = None


REALTIME_CHANNEL = "volcre_realtime"
MAX_NOTIFY_BYTES = 7_500
_ORIGIN = secrets.token_urlsafe(12)
_state_lock = threading.Lock()
_publisher_lock = threading.Lock()
_listener_thread: threading.Thread | None = None
_listener_connection: Any = None
_listener_callback: Callable[[dict[str, Any]], None] | None = None
_stop_event = threading.Event()


def _open_connection() -> Any:
    if psycopg is None:
        return None

    last_error: Exception | None = None
    # LISTEN subscriptions belong to a session and cannot use a transaction
    # pooler. Only the listener needs its own long-lived database connection.
    for database_url in _get_session_database_url_candidates():
        try:
            return psycopg.connect(
                database_url,
                autocommit=True,
                connect_timeout=_get_connect_timeout(),
                application_name="volcre-realtime",
                prepare_threshold=None,
                keepalives=1,
                keepalives_idle=30,
                keepalives_interval=10,
                keepalives_count=5,
            )
        except Exception as error:  # pragma: no cover - depends on deployment DB
            last_error = error

    if last_error is not None:
        raise last_error
    return None


def publish(event: dict[str, Any]) -> bool:
    """Publish one compact event without blocking the API request path."""
    envelope = {"origin": _ORIGIN, "event": event}
    payload = json.dumps(envelope, separators=(",", ":"), ensure_ascii=False)
    if len(payload.encode("utf-8")) > MAX_NOTIFY_BYTES:
        return False

    with _publisher_lock:
        try:
            # NOTIFY is delivered when the transaction commits. Borrow the
            # bounded API pool so every worker does not pin a second dedicated
            # session solely for publication.
            with get_connection() as connection:
                connection.execute(
                    "select pg_notify('volcre_realtime', %s)",
                    (payload,),
                )
            return True
        except Exception as error:  # pragma: no cover - depends on deployment DB
            print(f"[WARN] Realtime publish skipped: {type(error).__name__}: {error}", flush=True)
            return False


def _listen_forever() -> None:
    global _listener_connection
    while not _stop_event.is_set():
        connection = None
        try:
            connection = _open_connection()
            if connection is None:
                _stop_event.wait(5)
                continue

            with _state_lock:
                if _stop_event.is_set():
                    connection.close()
                    return
                _listener_connection = connection

            with connection.cursor() as cursor:
                cursor.execute(f"listen {REALTIME_CHANNEL}")
            print("[OK] Cross-worker realtime listener started.", flush=True)
            # PostgreSQL cannot replay notifications missed while disconnected.
            # Ask this worker to reconcile caches and clients after subscribing.
            if _listener_callback is not None:
                _listener_callback({"kind": "realtime.connected"})

            # An idle timeout ends the notification iterator, not the LISTEN
            # subscription. Keep this session alive so notifications cannot
            # fall into a gap between closing and reopening DB connections.
            # The bounded wait still lets shutdown stop the listener promptly.
            while not _stop_event.is_set():
                for notification in connection.notifies(timeout=5):
                    if _stop_event.is_set():
                        return
                    try:
                        envelope = json.loads(notification.payload)
                        if not isinstance(envelope, dict) or envelope.get("origin") == _ORIGIN:
                            continue
                        event = envelope.get("event")
                        if isinstance(event, dict) and _listener_callback is not None:
                            _listener_callback(event)
                    except Exception as error:
                        print(f"[WARN] Invalid realtime event ignored: {type(error).__name__}", flush=True)
        except Exception as error:  # pragma: no cover - depends on deployment DB
            if not _stop_event.is_set():
                print(f"[WARN] Cross-worker realtime listener reconnecting: {type(error).__name__}: {error}", flush=True)
                _stop_event.wait(2)
        finally:
            with _state_lock:
                if _listener_connection is connection:
                    _listener_connection = None
            if connection is not None:
                try:
                    connection.close()
                except Exception:
                    pass


def start(callback: Callable[[dict[str, Any]], None]) -> None:
    """Start one listener thread per API worker; repeated calls are harmless."""
    global _listener_callback, _listener_thread
    with _state_lock:
        _listener_callback = callback
        if _listener_thread is not None and _listener_thread.is_alive():
            return
        _stop_event.clear()
        _listener_thread = threading.Thread(
            target=_listen_forever,
            name="volcre-realtime-listener",
            daemon=True,
        )
        _listener_thread.start()


def stop() -> None:
    """Best-effort cleanup for tests and graceful process shutdown."""
    global _listener_thread
    _stop_event.set()
    with _state_lock:
        connection = _listener_connection
        listener_thread = _listener_thread
    if connection is not None:
        try:
            connection.close()
        except Exception:
            pass
    if listener_thread is not None and listener_thread is not threading.current_thread():
        listener_thread.join(timeout=5)
    with _state_lock:
        if _listener_thread is listener_thread and (
            listener_thread is None or not listener_thread.is_alive()
        ):
            _listener_thread = None
