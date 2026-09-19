"""Small PostgreSQL-backed bus for realtime events across API workers.

Each Uvicorn worker has its own in-memory WebSocket registry.  PostgreSQL
LISTEN/NOTIFY keeps those registries in sync without adding a new service or
changing the client protocol.
"""

from __future__ import annotations

import json
import os
import secrets
import threading
import time
from collections.abc import Callable
from typing import Any

from .db import _get_connect_timeout, _get_database_url_candidates

try:
    import psycopg
except ImportError:  # pragma: no cover - required in deployment
    psycopg = None


REALTIME_CHANNEL = "volcre_realtime"
MAX_NOTIFY_BYTES = 7_500
_ORIGIN = secrets.token_urlsafe(12)
_state_lock = threading.Lock()
_publisher_lock = threading.Lock()
_publisher_connection: Any = None
_listener_thread: threading.Thread | None = None
_listener_callback: Callable[[dict[str, Any]], None] | None = None
_stop_event = threading.Event()


def _open_connection() -> Any:
    if psycopg is None:
        return None

    last_error: Exception | None = None
    for database_url in _get_database_url_candidates():
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


def _close_publisher_connection() -> None:
    global _publisher_connection
    connection = _publisher_connection
    _publisher_connection = None
    if connection is not None:
        try:
            connection.close()
        except Exception:
            pass


def publish(event: dict[str, Any]) -> bool:
    """Publish one compact event without blocking the API request path."""
    global _publisher_connection

    envelope = {"origin": _ORIGIN, "event": event}
    payload = json.dumps(envelope, separators=(",", ":"), ensure_ascii=False)
    if len(payload.encode("utf-8")) > MAX_NOTIFY_BYTES:
        return False

    with _publisher_lock:
        try:
            if _publisher_connection is None or _publisher_connection.closed:
                _publisher_connection = _open_connection()
            if _publisher_connection is None:
                return False
            _publisher_connection.execute(
                "select pg_notify('volcre_realtime', %s)",
                (payload,),
            )
            return True
        except Exception as error:  # pragma: no cover - depends on deployment DB
            print(f"[WARN] Realtime publish skipped: {type(error).__name__}: {error}", flush=True)
            _close_publisher_connection()
            return False


def _listen_forever() -> None:
    while not _stop_event.is_set():
        connection = None
        try:
            connection = _open_connection()
            if connection is None:
                _stop_event.wait(5)
                continue

            with connection.cursor() as cursor:
                cursor.execute(f"listen {REALTIME_CHANNEL}")
            print("[OK] Cross-worker realtime listener started.", flush=True)

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
            print(f"[WARN] Cross-worker realtime listener reconnecting: {type(error).__name__}: {error}", flush=True)
            _stop_event.wait(2)
        finally:
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
    _stop_event.set()
    with _publisher_lock:
        _close_publisher_connection()

