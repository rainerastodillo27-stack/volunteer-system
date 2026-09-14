"""Small, dependency-free signed sessions for the NVC API.

The API is used by both the browser and the Android client, so the session is
returned as a bearer token instead of relying on browser-only cookies. The
token contains no private profile data; it only carries the account id, role,
and expiry and is signed by a server-side secret.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from typing import Any


SESSION_TTL_SECONDS = 12 * 60 * 60
_EPHEMERAL_SECRET: str | None = None


def _session_secret() -> bytes:
    """Return the configured signing secret without ever logging it."""
    global _EPHEMERAL_SECRET

    configured = str(os.getenv("NVC_AUTH_SECRET") or "").strip()
    if configured:
        return configured.encode("utf-8")

    # Local development can still start without another setup step. A missing
    # production secret invalidates all existing sessions after a restart, but
    # it never makes the API accept unsigned requests.
    if _EPHEMERAL_SECRET is None:
        _EPHEMERAL_SECRET = secrets.token_urlsafe(48)
        print("[WARN] NVC_AUTH_SECRET is not configured; using an ephemeral session secret.")
    return _EPHEMERAL_SECRET.encode("utf-8")


def _encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode((value + padding).encode("ascii"))


def create_session_token(user_id: str, role: str) -> str:
    now = int(time.time())
    payload = {
        "sub": str(user_id).strip(),
        "role": str(role).strip().lower(),
        "iat": now,
        "exp": now + SESSION_TTL_SECONDS,
    }
    encoded_payload = _encode(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    signature = hmac.new(
        _session_secret(),
        encoded_payload.encode("ascii"),
        hashlib.sha256,
    ).digest()
    return f"{encoded_payload}.{_encode(signature)}"


def verify_session_token(token: str | None) -> dict[str, Any] | None:
    normalized = str(token or "").strip()
    if not normalized or normalized.count(".") != 1:
        return None

    encoded_payload, encoded_signature = normalized.split(".", 1)
    try:
        supplied_signature = _decode(encoded_signature)
        expected_signature = hmac.new(
            _session_secret(),
            encoded_payload.encode("ascii"),
            hashlib.sha256,
        ).digest()
        if not hmac.compare_digest(supplied_signature, expected_signature):
            return None
        payload = json.loads(_decode(encoded_payload).decode("utf-8"))
    except (ValueError, TypeError, UnicodeDecodeError, json.JSONDecodeError):
        return None

    if not isinstance(payload, dict):
        return None

    try:
        expires_at = int(payload.get("exp") or 0)
    except (TypeError, ValueError):
        return None

    user_id = str(payload.get("sub") or "").strip()
    role = str(payload.get("role") or "").strip().lower()
    if expires_at <= int(time.time()) or not user_id or role not in {"admin", "volunteer", "partner"}:
        return None

    return {
        "sub": user_id,
        "role": role,
        "iat": payload.get("iat"),
        "exp": expires_at,
    }


def extract_bearer_token(authorization_header: str | None) -> str | None:
    value = str(authorization_header or "").strip()
    scheme, separator, token = value.partition(" ")
    if not separator or scheme.lower() != "bearer":
        return None
    return token.strip() or None

