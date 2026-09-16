import os
import base64
import binascii
import json
import asyncio
import io
import math
import shutil
import threading
import time
import secrets
import smtplib
import socket
import subprocess
import tempfile
import traceback
import re
import mimetypes
import hashlib
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, unquote_to_bytes
from urllib.request import Request, urlopen
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr
from datetime import datetime, timezone, timedelta
from typing import Any
from zoneinfo import ZoneInfo
from concurrent.futures import ThreadPoolExecutor, as_completed

from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, HTTPException, Request as FastAPIRequest, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from starlette.middleware.gzip import GZipMiddleware

try:
    import dns.resolver as dns_resolver
except ImportError:  # pragma: no cover - optional locally; required in deployment
    dns_resolver = None

from .app_storage_seed import (
    HOT_STORAGE_TABLES,
    clear_all_postgres_hot_storage,
    clear_postgres_hot_storage_collection,
    get_postgres_hot_storage_collection,
    is_hot_storage_key,
    replace_postgres_hot_storage_collection,
)
from .auth import (
    create_registration_verification_token,
    create_session_token,
    extract_bearer_token,
    verify_registration_verification_token,
    verify_session_token,
)
from .db import (
    get_configured_db_mode,
    get_db_mode,
    get_postgres_connection,
    get_connection,
    get_postgres_status,
    init_postgres_pool,
    _is_retryable_connection_error,
)
from .field_rules import is_valid_email, normalize_comparable_phone, normalize_ph_mobile_phone
from .image_compression import compress_base64_image, get_image_size_kb
from .password_utils import hash_password, is_bcrypt_hash, verify_password
from .relational_mirror import (
    TABLE_SPECS,
    LIGHTWEIGHT_MEDIA_COLUMNS,
    ensure_volunteer_time_logs_table_shape,
    get_relational_item_by_id,
    get_relational_items_by_field,
    upsert_relational_item,
    _primary_key_column,
    _row_to_item,
)
import traceback


load_dotenv()
TRACE_STORAGE = str(os.getenv("VOLCRE_TRACE_STORAGE", "")).strip().lower() in {"1", "true", "yes", "on"}


def _trace(message: str) -> None:
    if TRACE_STORAGE:
        print(message)

# Initialize FastAPI application. The interactive API documentation is
# disabled in production because it exposes the complete route inventory and
# is not needed by the web or Android clients.
app = FastAPI(
    title="NVC CONNECT API",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

PUBLIC_API_PATHS = {
    "/health",
    "/db-health",
    "/auth/login",
    "/auth/google",
    "/auth/check-email",
    "/auth/registration-otp/send",
    "/auth/registration-otp/verify",
    "/auth/register",
    "/auth/password-reset/send",
    "/auth/password-reset/confirm",
}
ADMIN_ONLY_API_PREFIXES = (
    "/admin/",
    "/auth/users/",
    "/auth/approval-email",
    "/auth/send-rejection-email",
)


def _is_public_api_path(path: str) -> bool:
    return path in PUBLIC_API_PATHS or path.startswith("/validation/dswd-accreditation/")


def _apply_security_headers(response, request: FastAPIRequest):
    """Apply response hardening without assuming TLS is already configured."""
    is_attachment_response = request.url.path.startswith("/attachments/")
    if request.url.path.startswith("/auth/") or request.url.path == "/db-health":
        response.headers.setdefault("Cache-Control", "no-store")
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    # Attachment URLs are opaque capability URLs consumed by browser/native
    # media elements. Their preview iframe cannot provide an API Bearer header
    # and must not inherit the app's frame-deny policy. The attachment route is
    # otherwise isolated from application HTML and uses Content-Disposition for
    # non-previewable files.
    if not is_attachment_response:
        response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'none'; base-uri 'none'"
        if is_attachment_response
        else "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    )
    if request.url.scheme == "https":
        response.headers.setdefault(
            "Strict-Transport-Security",
            "max-age=31536000; includeSubDomains",
        )
    return response


@app.middleware("http")
async def require_api_session(request: FastAPIRequest, call_next):
    """Require a signed session for every API route except auth/bootstrap routes."""
    # Browser <img>/<video>/<iframe> elements and React Native's Image/
    # FileSystem loaders cannot attach the Bearer header used by the JSON API.
    # Attachment URLs are already capability URLs: the path contains a
    # cryptographically random per-file id, while the upload endpoint and all
    # message APIs remain protected by the session middleware. Keep only the
    # read path public so these media components can retrieve the file.
    is_attachment_download = (
        request.method in {"GET", "HEAD"}
        and request.url.path.startswith("/attachments/")
    )
    if request.method == "OPTIONS" or _is_public_api_path(request.url.path) or is_attachment_download:
        return _apply_security_headers(await call_next(request), request)

    token = extract_bearer_token(request.headers.get("authorization"))
    session = verify_session_token(token)
    if session is None:
        return _apply_security_headers(JSONResponse(
            status_code=401,
            content={"detail": "Authentication required. Please sign in again."},
            headers={"Cache-Control": "no-store"},
        ), request)

    if request.url.path.startswith(ADMIN_ONLY_API_PREFIXES) and session.get("role") != "admin":
        return _apply_security_headers(JSONResponse(
            status_code=403,
            content={"detail": "Administrator access is required."},
            headers={"Cache-Control": "no-store"},
        ), request)

    request.state.auth_user = session
    response = await call_next(request)
    response.headers.setdefault("Cache-Control", "no-store")
    return _apply_security_headers(response, request)


def _get_session_user(request: FastAPIRequest) -> dict[str, Any]:
    session = getattr(request.state, "auth_user", None)
    if not isinstance(session, dict) or not str(session.get("sub") or "").strip():
        raise HTTPException(status_code=401, detail="Authentication required. Please sign in again.")
    return session


def _require_admin_session(request: FastAPIRequest) -> dict[str, Any]:
    session = _get_session_user(request)
    if session.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Administrator access is required.")
    return session


def _require_same_user_or_admin(request: FastAPIRequest, target_user_id: str) -> dict[str, Any]:
    session = _get_session_user(request)
    if session.get("role") != "admin" and str(session.get("sub")) != str(target_user_id).strip():
        raise HTTPException(status_code=403, detail="You are not allowed to access this account.")
    return session


def _require_session_user(request: FastAPIRequest, target_user_id: str) -> dict[str, Any]:
    session = _get_session_user(request)
    if str(session.get("sub") or "").strip() != str(target_user_id or "").strip():
        raise HTTPException(status_code=403, detail="You can only change your own messages.")
    return session

# Add CORS middleware to allow frontend requests. A wildcard origin cannot be
# combined with credentialed browser requests, so only enable credentials when
# the deployment explicitly supplies a concrete origin list.
configured_cors_origins = [
    origin.strip()
    for origin in os.getenv(
        "ALLOWED_ORIGINS",
        "http://localhost:8081,http://127.0.0.1:8081",
    ).split(",")
    if origin.strip()
]
# Wildcard CORS is disabled by default. It can only be re-enabled explicitly
# for a controlled local test environment, never merely by an old `*` value
# left in a production environment file.
cors_allows_any_origin = (
    "*" in configured_cors_origins
    and os.getenv("ALLOW_WILDCARD_CORS", "false").strip().lower() == "true"
)
if not cors_allows_any_origin:
    configured_cors_origins = [origin for origin in configured_cors_origins if origin != "*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if cors_allows_any_origin else configured_cors_origins,
    allow_credentials=not cors_allows_any_origin,
    allow_methods=["*"],
    allow_headers=["*"],
)
# Compress JSON responses before they leave the API. This reduces client/API
# transfer for large dashboards and reports; media is still excluded from
# lightweight reads below so compression is only the final safety net.
app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=6)

# Simple TTL-based cache for query results to improve performance
class TTLCache:
    """Simple time-to-live cache for function results."""
    def __init__(self, ttl_seconds: int = 5):
        self.cache: dict[str, tuple[Any, float]] = {}
        self.ttl_seconds = ttl_seconds
    
    def get(self, key: str) -> Any | None:
        if key not in self.cache:
            return None
        value, timestamp = self.cache[key]
        if time.time() - timestamp > self.ttl_seconds:
            del self.cache[key]
            return None
        return value
    
    def set(self, key: str, value: Any) -> None:
        self.cache[key] = (value, time.time())
    
    def clear(self) -> None:
        self.cache.clear()

    def delete(self, key: str) -> None:
        self.cache.pop(key, None)


# Cache for projects snapshot.
_projects_snapshot_cache = TTLCache(ttl_seconds=300)
_projects_snapshot_lock = threading.Lock()
_storage_collection_cache = TTLCache(ttl_seconds=120)
# Direct-message writes clear this cache and are also pushed over WebSocket, so
# a longer read TTL removes repeated database work without delaying new data.
_message_query_cache = TTLCache(ttl_seconds=30)
# Typing is a transient event and can arrive several times while one person is
# composing a message. Reusing a recently validated conversation prevents a
# database connection from being opened for every keystroke.
_typing_direct_access_cache = TTLCache(ttl_seconds=60)
_typing_group_recipients_cache = TTLCache(ttl_seconds=30)
_message_query_locks: dict[str, threading.Lock] = {}
_message_query_locks_guard = threading.Lock()
_message_storage_ready = False
_message_storage_lock = threading.Lock()
NON_CACHEABLE_COLLECTION_KEYS = {"programTracks", "programs"}
# These fields can contain base64 images or large attachment payloads. They
# are not needed by collection/list screens and are fetched only by an
# explicit include_images=true detail/preview request.
LIGHTWEIGHT_MEDIA_FIELDS: dict[str, set[str]] = {
    "users": {
        "profilePhoto",
        "validIdPhoto",
        "certificationsOrTrainings",
        "registrationDocuments",
    },
    "volunteers": {
        "validIdPhoto",
        "certificationsOrTrainings",
        "videoBriefingUrl",
    },
    "partners": {"registrationDocuments"},
    "projects": {"imageUrl", "attachments"},
    "events": {"imageUrl", "attachments"},
    "programs": {"imageUrl", "attachments"},
    "programTracks": {"imageUrl"},
    "volunteerTimeLogs": {"attendancePhoto", "completionPhoto"},
    "projectGroupMessages": {"attachments"},
    "partnerProjectApplications": {"attachments"},
    "partnerReports": {"attachments", "mediaFile"},
    "publishedImpactReports": {"attachments", "mediaFile"},
}


def _strip_lightweight_media(key: str, value: Any) -> Any:
    """Remove large media fields from ordinary collection responses.

    The scrubber walks nested JSON because documents are commonly stored in
    user membership sheets and proposalDetails rather than at the top level.
    It preserves the field shape with None/[] so existing UI fallbacks remain
    safe and explicit full-media reads can use the same response schema.
    """
    fields = LIGHTWEIGHT_MEDIA_FIELDS.get(key)
    if not fields:
        return value

    def scrub(node: Any) -> Any:
        if isinstance(node, list):
            return [scrub(item) for item in node]
        if not isinstance(node, dict):
            return node

        result: dict[str, Any] = {}
        for field_name, field_value in node.items():
            if field_name in fields:
                result[field_name] = [] if isinstance(field_value, list) else None
            else:
                result[field_name] = scrub(field_value)
        return result

    return scrub(value)
_DEFAULT_SNAPSHOT_FIELDS = {
    "projects",
    "programs",
    "programTracks",
    "statusUpdates",
    "volunteerProfile",
    "volunteerMatches",
    "timeLogs",
    "partnerApplications",
    "volunteerJoinRecords",
}


def _get_message_query_lock(cache_key: str) -> threading.Lock:
    """Return a per-query lock so identical slow reads never pile up."""
    with _message_query_locks_guard:
        lock = _message_query_locks.get(cache_key)
        if lock is None:
            lock = threading.Lock()
            _message_query_locks[cache_key] = lock
        return lock


def _stable_short_join_record_id(project_id: str, volunteer_id: str) -> str:
    raw_id = f"volunteer-join-{project_id}-{volunteer_id}"
    if len(raw_id) <= 64:
        return raw_id

    hash_value = 2166136261
    for char in raw_id:
        hash_value ^= ord(char)
        hash_value = (hash_value * 16777619) & 0xFFFFFFFF

    return f"voljoin-{project_id[:18]}-{volunteer_id[:18]}-{format(hash_value, 'x')}"

TOP_VOLUNTEER_THRESHOLD = 5


# Request payload for single-key storage writes.
class StoragePayload(BaseModel):
    value: Any


# Request payload for recording an administrator notification as read.
class NotificationReadPayload(BaseModel):
    notificationId: str


# Request payload for batch storage reads.
class StorageBatchPayload(BaseModel):
    keys: list[str]
    include_images: bool = False


# Request payload for email, username alias, or phone login.
class AuthLoginPayload(BaseModel):
    identifier: str
    password: str


# Request payload for Google OAuth login.
class GoogleAuthPayload(BaseModel):
    idToken: str


# Request payload to send a registration OTP.
class RegistrationOtpSendPayload(BaseModel):
    email: str


# Request payload to verify a registration OTP.
class RegistrationOtpVerifyPayload(BaseModel):
    email: str
    otp: str


# Public account-registration payload. The endpoint creates the user and its
# linked profile in one authenticated-by-email, transactional operation.
class RegistrationPayload(BaseModel):
    name: str
    email: str
    password: str
    phone: str | None = None
    role: str
    userType: str = "Student"
    pillarsOfInterest: list[str] = []
    partnerRegistration: dict[str, Any] | None = None
    volunteerMembershipSheet: dict[str, Any] | None = None
    emailVerificationToken: str


# Request payload to start or complete an account password reset.
class PasswordResetRequestPayload(BaseModel):
    email: str


class PasswordResetConfirmPayload(BaseModel):
    email: str
    otp: str
    newPassword: str


# Request payload for approving/rejecting user accounts.
class UserApprovalPayload(BaseModel):
    status: str  # 'approved' or 'rejected'
    rejectionReason: str | None = None


# Request payload for sending application rejection notification emails.
class RejectionEmailPayload(BaseModel):
    recipientEmail: str
    recipientName: str = "Volunteer"
    rejectionReason: str
    role: str = "volunteer"


# Request payload for sending account approval notification emails.
class ApprovalEmailPayload(BaseModel):
    email: str
    name: str = "Volunteer"
    role: str = "volunteer"
    approvedByName: str = "the admin team"


# Request payload for direct project joins.
class ProjectJoinPayload(BaseModel):
    userId: str


# Request payload for starting a volunteer time log.
class VolunteerTimeLogStartPayload(BaseModel):
    projectId: str
    note: str | None = None
    attendancePhoto: str | None = None


class VolunteerTimeLogAttendanceCheckPayload(BaseModel):
    checked: bool = True
    checkedByUserId: str | None = None


# Request payload for ending a volunteer time log.
class VolunteerTimeLogEndPayload(BaseModel):
    projectId: str
    completionReport: str | None = None
    completionPhoto: str | None = None


# Request payload for partner join requests.
class PartnerProjectJoinRequestPayload(BaseModel):
    projectId: str
    programModule: str | None = None
    partnerUserId: str
    partnerName: str
    partnerEmail: str = ""
    proposalDetails: dict[str, Any] | None = None


# Request payload for an administrator editing a pending partner proposal.
class PartnerProjectApplicationUpdatePayload(BaseModel):
    proposalDetails: dict[str, Any]
    updatedBy: str


# Request payload for reviewing a partner join request.
class PartnerProjectApplicationReviewPayload(BaseModel):
    status: str
    reviewedBy: str
    reviewNotes: str | None = None


# Request payload for reviewing a volunteer join request.
class VolunteerMatchReviewPayload(BaseModel):
    status: str
    reviewedBy: str


# Request payload for direct chat messages.
class MessagePayload(BaseModel):
    id: str
    senderId: str
    recipientId: str
    projectId: str | None = None
    content: str
    timestamp: str
    read: bool = False
    attachments: list[str] | None = None


# Uploads are kept outside message rows. The database and realtime payload only
# receive the resulting URL, so a video is transferred once instead of being
# embedded in every chat history response.
class MessageAttachmentUploadPayload(BaseModel):
    dataUri: str
    filename: str | None = None
    mimeType: str | None = None


MESSAGE_ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024
MESSAGE_ATTACHMENT_ROOT = Path(
    os.getenv(
        "VOLCRE_MESSAGE_ATTACHMENT_DIR",
        str(Path(__file__).resolve().parent.parent / "runtime" / "message-attachments"),
    )
).resolve()
MESSAGE_ATTACHMENT_DATA_URI_PATTERN = re.compile(
    r"^data:(?P<mime>[^;,]+)(?P<parameters>(?:;[^,]*)*),(?P<payload>.*)$",
    re.IGNORECASE | re.DOTALL,
)


def _safe_message_attachment_filename(filename: str | None, mime_type: str) -> str:
    raw_name = str(filename or "").strip()
    raw_name = Path(raw_name.replace("\\", "/")).name
    raw_name = re.sub(r"[^A-Za-z0-9._-]+", "_", raw_name).strip("._")

    if not raw_name:
        extension = mimetypes.guess_extension(mime_type) or ".bin"
        raw_name = f"attachment{extension}"
    elif "." not in raw_name:
        extension = mimetypes.guess_extension(mime_type)
        if extension:
            raw_name = f"{raw_name}{extension}"

    return raw_name[:180] or "attachment.bin"


def _parse_message_attachment_data_uri(data_uri: str, declared_mime_type: str | None) -> tuple[str, bytes]:
    match = MESSAGE_ATTACHMENT_DATA_URI_PATTERN.match(str(data_uri or "").strip())
    if not match or ";base64" not in match.group("parameters").lower():
        raise HTTPException(status_code=400, detail="Only Base64 data attachments are supported.")

    mime_type = (declared_mime_type or match.group("mime") or "application/octet-stream").strip().lower()
    if not re.fullmatch(r"[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*", mime_type):
        mime_type = match.group("mime").strip().lower() or "application/octet-stream"

    try:
        content = base64.b64decode(match.group("payload"), validate=True)
    except (ValueError, binascii.Error) as error:
        raise HTTPException(status_code=400, detail="The attachment data is invalid.") from error

    if not content:
        raise HTTPException(status_code=400, detail="The attachment is empty.")
    if len(content) > MESSAGE_ATTACHMENT_MAX_BYTES:
        max_mb = MESSAGE_ATTACHMENT_MAX_BYTES // (1024 * 1024)
        raise HTTPException(status_code=413, detail=f"Attachments must be {max_mb} MB or smaller.")

    return mime_type, content


# Request payload for project group chat messages.
class ProjectGroupMessagePayload(BaseModel):
    id: str
    projectId: str
    senderId: str
    content: str
    timestamp: str
    kind: str | None = None
    needPost: dict[str, Any] | None = None
    scopeProposal: dict[str, Any] | None = None
    responseToMessageId: str | None = None
    responseAction: str | None = None
    responseToTitle: str | None = None
    attachments: list[str] | None = None


# Request payload for one impact-hub or field report submission.
class ReportAttachmentPayload(BaseModel):
    url: str
    type: str
    description: str | None = None


class ReportSubmitPayload(BaseModel):
    id: str | None = None
    projectId: str
    partnerId: str | None = None
    partnerUserId: str | None = None
    partnerName: str | None = None
    submitterUserId: str
    submitterName: str
    submitterRole: str
    title: str | None = None
    reportType: str
    description: str
    impactCount: float | int | None = None
    metrics: dict[str, Any] | None = None
    attachments: list[ReportAttachmentPayload] | None = None
    mediaFile: str | None = None
    sourceReportIds: list[str] | None = None
    createdAt: str | None = None
    status: str | None = None


REPORT_MEDIA_FILE_MAX_LENGTH = 500
APP_TIMEZONE = ZoneInfo("Asia/Manila")
REMINDER_LEAD_DAYS = 3
# Check frequently enough that minute/hour reminders are not missed between
# hourly scheduler runs. The database idempotency record still guarantees that
# each event/volunteer/setting reminder is sent at most once.
REMINDER_CHECK_INTERVAL_SECONDS = 60
_reminder_scheduler_started = False
_reminder_scheduler_lock = threading.Lock()


def _calculate_report_impact_count(metrics: dict[str, Any]) -> int:
    """Return the beneficiary total without mixing in operational metrics."""
    beneficiary_keys = (
        "beneficiariesServed",
        "beneficiaries_served",
        "beneficiaries",
        "beneficiariesAssisted",
        "beneficiaries_assisted",
        "beneficiariesReached",
        "beneficiaries_reached",
    )
    for key in beneficiary_keys:
        value = metrics.get(key)
        if isinstance(value, bool):
            continue
        try:
            numeric_value = float(value)
        except (TypeError, ValueError):
            continue
        if math.isfinite(numeric_value) and numeric_value >= 0:
            return max(int(numeric_value), 0)

    total = 0.0
    for value in metrics.values():
        if isinstance(value, bool):
            continue
        try:
            numeric_value = float(value)
        except (TypeError, ValueError):
            continue
        if math.isfinite(numeric_value):
            total += numeric_value
    return max(int(total), 0)


def _parse_iso_datetime(value: Any) -> datetime | None:
    raw_value = str(value or "").strip()
    if not raw_value:
        return None

    try:
        parsed = datetime.fromisoformat(raw_value.replace("Z", "+00:00"))
    except ValueError:
        return None

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _get_local_date_key(value: Any, tz: ZoneInfo = APP_TIMEZONE) -> str:
    parsed = _parse_iso_datetime(value)
    if parsed is None:
        return ""

    localized = parsed.astimezone(tz)
    return localized.strftime("%Y-%m-%d")


def _event_attendance_window_has_started(project: dict[str, Any], now: datetime | None = None) -> bool:
    if not bool(project.get("isEvent")):
        return True

    start_date = _parse_iso_datetime(project.get("startDate"))
    if start_date is None:
        return True

    current_time = (now or datetime.now(timezone.utc)).astimezone(APP_TIMEZONE)
    attendance_open_time = start_date.astimezone(APP_TIMEZONE).replace(
        hour=9,
        minute=0,
        second=0,
        microsecond=0,
    )
    return current_time >= attendance_open_time


def _event_attendance_window_has_ended(project: dict[str, Any], now: datetime | None = None) -> bool:
    status = str(project.get("status") or "").strip()
    if status in {"Completed", "Cancelled"}:
        return True

    if not bool(project.get("isEvent")):
        return False

    end_date = _parse_iso_datetime(project.get("endDate") or project.get("startDate"))
    if end_date is None:
        return False

    current_time = (now or datetime.now(timezone.utc)).astimezone(APP_TIMEZONE)
    end_of_day = end_date.astimezone(APP_TIMEZONE).replace(hour=23, minute=59, second=59, microsecond=999999)
    return current_time > end_of_day


def _send_email_message(
    recipient_email: str,
    subject: str,
    text_body: str,
    html_body: str | None = None,
) -> None:
    recipient = str(recipient_email or "").strip().lower()

    if not recipient or not is_valid_email(recipient):
        raise ValueError("A valid recipient email address is required.")

    # Keep the existing OTP_* names as a backwards-compatible fallback while
    # allowing notification credentials to be separated later.
    sender_email = (
        os.getenv("NOTIFICATION_GMAIL_SENDER", "").strip()
        or os.getenv("OTP_GMAIL_SENDER", "").strip()
    )
    app_password = (
        os.getenv("NOTIFICATION_GMAIL_APP_PASSWORD", "").strip()
        or os.getenv("OTP_GMAIL_APP_PASSWORD", "").strip()
    )
    # Google displays app passwords in groups separated by spaces. Those
    # separators are presentation-only and must not be sent to SMTP.
    app_password = "".join(app_password.split())

    if not sender_email or not app_password:
        allow_dev_fallback = os.getenv("EMAIL_ALLOW_DEV_FALLBACK", "false").strip().lower() in {
            "1",
            "true",
            "yes",
            "on",
        }
        if allow_dev_fallback:
            print(f"[EMAIL-DEV] Email sender not configured. Would send to {recipient}: {subject}")
            return
        raise RuntimeError(
            "Gmail email delivery is not configured on the backend. "
            "Set OTP_GMAIL_SENDER and OTP_GMAIL_APP_PASSWORD, then restart the backend."
        )

    if not is_valid_email(sender_email):
        raise ValueError("The configured notification sender email is invalid.")

    # Gmail may accept a message and only bounce it much later when the
    # recipient domain has no usable mail route. Catch that common
    # configuration/data error before handing the message to SMTP.
    validate_recipient_domain = os.getenv("NOTIFICATION_VALIDATE_RECIPIENT_DOMAIN", "true").strip().lower()
    if validate_recipient_domain not in {"0", "false", "no", "off"}:
        _validate_recipient_email_domain(recipient)

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    sender_name = os.getenv("NOTIFICATION_SENDER_NAME", "NVC Connect").strip() or "NVC Connect"
    msg["From"] = formataddr((sender_name, sender_email))
    msg["To"] = recipient
    msg.attach(MIMEText(text_body, "plain"))
    if html_body:
        msg.attach(MIMEText(html_body, "html"))

    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
        server.login(sender_email, app_password)
        rejected_recipients = server.sendmail(sender_email, [recipient], msg.as_string())
        if rejected_recipients:
            raise RuntimeError("Gmail rejected the recipient address.")


def _validate_recipient_email_domain(recipient: str) -> None:
    domain = recipient.rsplit("@", 1)[1]

    if dns_resolver is not None:
        try:
            mx_answers = dns_resolver.resolve(domain, "MX")
            mx_hosts = [str(answer.exchange).rstrip(".").strip() for answer in mx_answers]
            if any(host and host not in {"~", "."} for host in mx_hosts):
                return
            if mx_hosts:
                raise ValueError(
                    f"Recipient email domain '{domain}' has no usable mail exchanger. "
                    "Check the email address before retrying."
                )
        except dns_resolver.NXDOMAIN as error:
            raise ValueError(
                f"Recipient email domain '{domain}' does not exist. "
                "Check the email address before retrying."
            ) from error
        except dns_resolver.NoAnswer:
            # Some domains rely on the RFC fallback to their A/AAAA address.
            pass
        except (dns_resolver.NoNameservers, dns_resolver.LifetimeTimeout):
            # Let the address fallback below decide whether the domain exists
            # when the configured DNS resolver is temporarily unavailable.
            pass

    try:
        socket.getaddrinfo(domain, None)
    except socket.gaierror as error:
        raise ValueError(
            f"Recipient email domain '{domain}' could not be resolved. "
            "Check the email address before retrying."
        ) from error


def _send_rejection_email(
    recipient_email: str,
    recipient_name: str,
    rejection_reason: str,
    role: str = "volunteer",
) -> None:
    name = str(recipient_name or "Volunteer").strip() or "Volunteer"
    reason = str(rejection_reason or "Application did not meet current requirements.").strip()
    role_label = "partner organization" if role == "partner" else "volunteer"
    subject = f"Update regarding your Negrense Volunteers for Change {role_label} application"

    text_body = (
        f"Dear {name},\n\n"
        f"Thank you for your interest in joining Negrense Volunteers for Change (NVC).\n\n"
        f"We have reviewed your {role_label} application. At this time, we are unable to approve your application for the following reason:\n\n"
        f"\"{reason}\"\n\n"
        f"If you have any questions or would like to submit updated information for reconsideration, please feel free to reach out to us.\n\n"
        f"Thank you for your understanding and dedication to community service.\n\n"
        f"Warm regards,\n"
        f"Negrense Volunteers for Change Foundation\n"
    )

    html_body = f"""
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
      <div style="background-color: #166534; padding: 24px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 20px; font-weight: 800; letter-spacing: 0.5px;">Negrense Volunteers for Change</h1>
        <p style="color: #bbf7d0; margin: 4px 0 0 0; font-size: 13px;">Application Status Update</p>
      </div>

      <div style="padding: 28px 24px;">
        <p style="color: #334155; font-size: 15px; margin-top: 0;">Dear <strong>{name}</strong>,</p>

        <p style="color: #334155; font-size: 14px; line-height: 1.6;">
          Thank you for taking the time to apply to <strong>Negrense Volunteers for Change (NVC)</strong>. We deeply appreciate your desire to contribute your time and skills to our mission.
        </p>

        <p style="color: #334155; font-size: 14px; line-height: 1.6;">
          After careful review of your {role_label} application, we regret to inform you that we are unable to accept your application at this time.
        </p>

        <div style="background-color: #fef2f2; border-left: 4px solid #dc2626; border-radius: 6px; padding: 16px; margin: 20px 0;">
          <p style="color: #991b1b; font-size: 13px; font-weight: 700; margin: 0 0 6px 0; text-transform: uppercase; letter-spacing: 0.5px;">Reason for Decision</p>
          <p style="color: #b91c1c; font-size: 14px; margin: 0; line-height: 1.5; font-style: italic;">
            "{reason}"
          </p>
        </div>

        <p style="color: #334155; font-size: 14px; line-height: 1.6;">
          If you believe there has been a misunderstanding or if you wish to provide additional information, you are welcome to contact our administration team.
        </p>

        <p style="color: #64748b; font-size: 13px; margin-top: 24px; border-top: 1px solid #f1f5f9; padding-top: 16px;">
          Warm regards,<br/>
          <strong style="color: #0f172a;">Negrense Volunteers for Change Foundation</strong>
        </p>
      </div>

      <div style="background-color: #f8fafc; padding: 16px; text-align: center; border-top: 1px solid #e2e8f0;">
        <p style="color: #94a3b8; font-size: 11px; margin: 0;">
          This is an automated notification from NVC Connect.
        </p>
      </div>
    </div>
    """

    _send_email_message(recipient_email, subject, text_body, html_body)


def _send_approval_email(
    recipient_email: str,
    recipient_name: str,
    role: str,
    approved_by_name: str,
) -> None:
    name = str(recipient_name or "Volunteer").strip() or "Volunteer"
    approver = str(approved_by_name or "the admin team").strip() or "the admin team"
    role_label = "partner organization" if role == "partner" else "volunteer"
    subject = f"Your NVC Connect {role_label} account has been approved"

    text_body = (
        f"Dear {name},\n\n"
        f"Good news! Your NVC Connect {role_label} account has been approved by {approver}.\n\n"
        "You can now sign in and access the features available for your account.\n\n"
        "Warm regards,\n"
        "Negrense Volunteers for Change Foundation\n"
    )

    html_body = f"""
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:28px;background:#f8fafc;border-radius:12px;">
      <div style="background:#166534;padding:22px;border-radius:10px 10px 0 0;">
        <h1 style="color:#ffffff;margin:0;font-size:21px;">NVC Connect</h1>
        <p style="color:#bbf7d0;margin:6px 0 0;font-size:13px;">Account approval</p>
      </div>
      <div style="background:#ffffff;padding:24px;border-radius:0 0 10px 10px;">
        <p style="color:#334155;">Dear <strong>{name}</strong>,</p>
        <p style="color:#334155;line-height:1.6;">Your {role_label} account has been approved by <strong>{approver}</strong>.</p>
        <p style="color:#334155;line-height:1.6;">You can now sign in to NVC Connect and start using your account.</p>
        <p style="color:#64748b;font-size:13px;margin-top:24px;">Warm regards,<br/><strong>Negrense Volunteers for Change Foundation</strong></p>
      </div>
    </div>
    """

    _send_email_message(recipient_email, subject, text_body, html_body)


def _ensure_reminder_tables(connection: Any) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            create table if not exists public.event_email_reminders (
              reminder_id text primary key,
              event_id text not null,
              volunteer_id text not null,
              volunteer_email text not null,
              reminder_type text not null,
              sent_at text not null
            )
            """
        )


def _get_reminder_email_for_volunteer(volunteer: dict[str, Any], users_by_id: dict[str, dict[str, Any]]) -> str:
    email = str(volunteer.get("email") or "").strip().lower()
    if email:
        return email
    user_id = str(volunteer.get("userId") or "").strip()
    if user_id and user_id in users_by_id:
        return str(users_by_id[user_id].get("email") or "").strip().lower()
    return ""


def _get_event_reminder_recipients(
    event: dict[str, Any],
    join_records: list[dict[str, Any]],
    volunteers_by_id: dict[str, dict[str, Any]],
    volunteers_by_user_id: dict[str, dict[str, Any]],
    users_by_id: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Resolve the active volunteers who joined an event to email recipients.

    Newer records are stored in volunteerProjectJoins, while older events may
    only have volunteers[]/joinedUserIds[]. Use the join records first so a
    completed/removed membership is not emailed, then retain the arrays as a
    backwards-compatible fallback for legacy event data.
    """
    event_id = str(event.get("id") or "").strip()
    event_records = [
        record
        for record in join_records
        if isinstance(record, dict) and str(record.get("projectId") or "").strip() == event_id
    ]
    active_records = [
        record
        for record in event_records
        if str(record.get("participationStatus") or "Active").strip() == "Active"
    ]
    inactive_identifiers = {
        str(record.get(field) or "").strip()
        for record in event_records
        if str(record.get("participationStatus") or "Active").strip() != "Active"
        for field in ("volunteerId", "volunteerUserId", "volunteerEmail")
        if str(record.get(field) or "").strip()
    }

    recipients: dict[str, dict[str, Any]] = {}

    def add_recipient(candidate: dict[str, Any], fallback_identifier: str = "") -> None:
        volunteer_id = str(candidate.get("id") or candidate.get("volunteerId") or "").strip()
        user_id = str(candidate.get("userId") or candidate.get("volunteerUserId") or "").strip()
        email = str(candidate.get("email") or candidate.get("volunteerEmail") or "").strip().lower()

        if not email and user_id:
            email = str(users_by_id.get(user_id, {}).get("email") or "").strip().lower()
        if not email:
            return

        identifier = volunteer_id or user_id or email or fallback_identifier
        if not identifier:
            return

        key = volunteer_id or user_id or email
        existing = recipients.get(key)
        next_recipient = {
            "id": volunteer_id or user_id or email,
            "userId": user_id,
            "name": str(candidate.get("name") or candidate.get("volunteerName") or "Volunteer").strip() or "Volunteer",
            "email": email,
        }
        if existing:
            if not existing.get("email") and email:
                existing["email"] = email
            if existing.get("name") == "Volunteer" and next_recipient["name"] != "Volunteer":
                existing["name"] = next_recipient["name"]
        else:
            recipients[key] = next_recipient

    # Join records are authoritative for current memberships and also carry
    # an email snapshot, which keeps delivery working if a profile is stale.
    for record in active_records:
        volunteer_id = str(record.get("volunteerId") or "").strip()
        user_id = str(record.get("volunteerUserId") or "").strip()
        profile = (
            volunteers_by_id.get(volunteer_id)
            or volunteers_by_user_id.get(user_id)
            or users_by_id.get(user_id)
            or {}
        )
        add_recipient({**record, **profile}, volunteer_id or user_id)

    # Legacy fallback: some events were saved before join records became the
    # canonical membership store.
    array_identifiers = [
        *(str(value or "").strip() for value in (event.get("volunteers") or [])),
        *(str(value or "").strip() for value in (event.get("joinedUserIds") or [])),
    ]
    for identifier in array_identifiers:
        if not identifier or identifier in inactive_identifiers or identifier.lower() in {
            value.lower() for value in inactive_identifiers
        }:
            continue
        profile = (
            volunteers_by_id.get(identifier)
            or volunteers_by_user_id.get(identifier)
            or users_by_id.get(identifier)
        )
        if profile:
            add_recipient(profile, identifier)

    return list(recipients.values())


def _event_starts_in_reminder_window(event: dict[str, Any], now: datetime) -> bool:
    start_date = _parse_iso_datetime(event.get("startDate"))
    if start_date is None:
        return False
    local_now = now.astimezone(APP_TIMEZONE)
    local_start = start_date.astimezone(APP_TIMEZONE)
    return local_start.date() == (local_now.date() + timedelta(days=REMINDER_LEAD_DAYS))


def _notification_lead_delta(setting: dict[str, Any]) -> timedelta | None:
    try:
        value = int(str(setting.get("value") or "").strip())
    except ValueError:
        return None
    if value <= 0:
        return None
    unit = str(setting.get("unit") or "minutes").strip().lower()
    if unit == "days":
        return timedelta(days=value)
    if unit == "hours":
        return timedelta(hours=value)
    return timedelta(minutes=value)


def _get_event_email_reminder_settings(event: dict[str, Any]) -> list[dict[str, Any]]:
    raw_settings = event.get("notificationSettings")
    if not isinstance(raw_settings, list):
        raw_settings = []
    settings = [
        setting
        for setting in raw_settings
        if isinstance(setting, dict)
        and str(setting.get("type") or "").strip().lower() == "email"
        and _notification_lead_delta(setting) is not None
    ]
    if settings:
        return settings
    return [{"type": "Email", "value": str(REMINDER_LEAD_DAYS), "unit": "days"}]


def _event_reminder_setting_is_due(event: dict[str, Any], setting: dict[str, Any], now: datetime) -> bool:
    start_date = _parse_iso_datetime(event.get("startDate"))
    lead_delta = _notification_lead_delta(setting)
    if start_date is None or lead_delta is None:
        return False
    local_now = now.astimezone(APP_TIMEZONE)
    local_start = start_date.astimezone(APP_TIMEZONE)
    send_at = local_start - lead_delta
    return send_at <= local_now < local_start


def _get_reminder_type(setting: dict[str, Any]) -> str:
    value = str(setting.get("value") or "").strip()
    unit = str(setting.get("unit") or "minutes").strip().lower()
    return f"event-email:{value}{unit}"


def _get_reminder_label(setting: dict[str, Any]) -> str:
    value = str(setting.get("value") or "").strip()
    unit = str(setting.get("unit") or "minutes").strip().lower()
    return f"{value} {unit}"


def _send_event_reminder_email(
    volunteer: dict[str, Any],
    event: dict[str, Any],
    recipient_email: str,
    reminder_label: str,
) -> None:
    volunteer_name = str(volunteer.get("name") or "Volunteer").strip() or "Volunteer"
    activity_type = "event" if bool(event.get("isEvent")) else "project"
    event_title = str(event.get("title") or f"your joined {activity_type}").strip()
    start_date = _parse_iso_datetime(event.get("startDate"))
    date_label = start_date.astimezone(APP_TIMEZONE).strftime("%B %d, %Y at %I:%M %p") if start_date else "soon"
    location = event.get("location") if isinstance(event.get("location"), dict) else {}
    location_text = str(event.get("locationVenue") or location.get("address") or "").strip()
    meet_url = str(event.get("googleMeetUrl") or event.get("meetUrl") or event.get("zoomLink") or "").strip()
    subject = f"Reminder: {event_title} is in {reminder_label}"
    text_body = (
        f"Hi {volunteer_name},\n\n"
        f"This is a reminder that you joined the {activity_type}: {event_title}.\n"
        f"Schedule: {date_label}\n"
        f"{f'Location: {location_text}\n' if location_text else ''}"
        f"{f'Google Meet: {meet_url}\n' if meet_url else ''}"
        f"\nPlease check NVC Connect for the latest event details."
    )
    html_body = f"""
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:28px;background:#f8fafc;border-radius:12px;">
      <h2 style="color:#15803d;margin:0 0 12px;">Event Reminder</h2>
      <p style="color:#334155;">Hi {volunteer_name},</p>
      <p style="color:#334155;">You joined the {activity_type} <strong>{event_title}</strong>. It is scheduled in {reminder_label}.</p>
      <p style="color:#0f172a;"><strong>Schedule:</strong> {date_label}</p>
      {f'<p style="color:#0f172a;"><strong>Location:</strong> {location_text}</p>' if location_text else ''}
      {f'<p style="margin:20px 0;"><a href="{meet_url}" style="display:inline-block;background:#166534;color:#ffffff;text-decoration:none;font-weight:bold;border-radius:8px;padding:12px 18px;">Join Google Meet</a></p>' if meet_url else ''}
      <p style="color:#64748b;font-size:13px;">Please check NVC Connect for the latest event details.</p>
    </div>
    """
    _send_email_message(recipient_email, subject, text_body, html_body)


def run_event_reminder_check() -> dict[str, Any]:
    _require_postgres()
    sent_count = 0
    skipped_count = 0
    now = datetime.now(timezone.utc)

    with get_connection() as connection:
        _ensure_reminder_tables(connection)
        upcoming_items = [
            item for item in (
                get_postgres_hot_storage_collection(connection, "events") +
                get_postgres_hot_storage_collection(connection, "projects")
            )
            if isinstance(item, dict)
            and str(item.get("status") or "") not in {"Completed", "Cancelled"}
        ]
        volunteers = get_postgres_hot_storage_collection(connection, "volunteers")
        users = get_postgres_hot_storage_collection(connection, "users")
        join_records = get_postgres_hot_storage_collection(connection, "volunteerProjectJoins")
        users_by_id = {str(user.get("id") or ""): user for user in users if isinstance(user, dict)}
        volunteers_by_id = {str(volunteer.get("id") or ""): volunteer for volunteer in volunteers if isinstance(volunteer, dict)}
        volunteers_by_user_id = {
            str(volunteer.get("userId") or ""): volunteer
            for volunteer in volunteers
            if isinstance(volunteer, dict) and str(volunteer.get("userId") or "").strip()
        }

        with connection.cursor() as cursor:
            for event in upcoming_items:
                event_id = str(event.get("id") or "").strip()
                event_recipients = _get_event_reminder_recipients(
                    event,
                    join_records,
                    volunteers_by_id,
                    volunteers_by_user_id,
                    users_by_id,
                )

                for setting in _get_event_email_reminder_settings(event):
                    if not _event_reminder_setting_is_due(event, setting, now):
                        skipped_count += len(event_recipients)
                        continue

                    reminder_type = _get_reminder_type(setting)
                    reminder_label = _get_reminder_label(setting)

                    for volunteer in event_recipients:
                        volunteer_id = str(volunteer.get("id") or volunteer.get("userId") or volunteer.get("email") or "").strip()
                        recipient_email = str(volunteer.get("email") or "").strip().lower()
                        if not volunteer_id or not recipient_email:
                            skipped_count += 1
                            continue

                        reminder_id = f"{reminder_type}:{event_id}:{volunteer_id}"
                        cursor.execute(
                            "select reminder_id from public.event_email_reminders where reminder_id = %s",
                            (reminder_id,),
                        )
                        if cursor.fetchone():
                            skipped_count += 1
                            continue

                        try:
                            _send_event_reminder_email(volunteer, event, recipient_email, reminder_label)
                        except Exception as error:
                            print(f"[REMINDER] Failed to send event reminder to {recipient_email}: {error}")
                            skipped_count += 1
                            continue

                        cursor.execute(
                            """
                            insert into public.event_email_reminders (
                              reminder_id, event_id, volunteer_id, volunteer_email, reminder_type, sent_at
                            )
                            values (%s, %s, %s, %s, %s, %s)
                            """,
                            (
                                reminder_id,
                                event_id,
                                volunteer_id,
                                recipient_email,
                                reminder_type,
                                datetime.now(timezone.utc).isoformat(),
                            ),
                        )
                        sent_count += 1

        connection.commit()

    return {"sent": sent_count, "skipped": skipped_count}


def _event_reminder_scheduler_loop() -> None:
    while True:
        try:
            result = run_event_reminder_check()
            if result.get("sent"):
                print(f"[REMINDER] Sent {result['sent']} event reminder email(s).")
        except Exception as error:
            print(f"[REMINDER] Reminder check skipped: {error}")
        time.sleep(REMINDER_CHECK_INTERVAL_SECONDS)


def _start_event_reminder_scheduler() -> None:
    global _reminder_scheduler_started
    with _reminder_scheduler_lock:
        if _reminder_scheduler_started:
            return
        _reminder_scheduler_started = True
    threading.Thread(target=_event_reminder_scheduler_loop, daemon=True).start()


def _normalize_partner_proposal_date(value: Any, fallback: str) -> str:
    raw_value = str(value or "").strip()
    if not raw_value:
        return fallback

    try:
        parsed = datetime.fromisoformat(raw_value.replace("Z", "+00:00"))
    except ValueError:
        return fallback

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.isoformat()


def _normalize_partner_proposal_details(
    details: dict[str, Any] | None,
    requested_program_module: str,
    fallback_project: dict[str, Any] | None = None,
) -> dict[str, Any]:
    fallback_project = fallback_project or {}
    fallback_location = fallback_project.get("location") or {}
    fallback_now = datetime.now(timezone.utc).isoformat()
    fallback_title = str(fallback_project.get("title") or "").strip()
    fallback_description = str(fallback_project.get("description") or "").strip()
    fallback_address = str(fallback_location.get("address") or "").strip()
    fallback_module = str(
        fallback_project.get("programModule")
        or fallback_project.get("category")
        or requested_program_module
        or ""
    ).strip()

    payload = details if isinstance(details, dict) else {}
    raw_volunteers_needed = payload.get("proposedVolunteersNeeded")
    try:
        proposed_volunteers_needed = max(int(raw_volunteers_needed), 0)
    except (TypeError, ValueError):
        proposed_volunteers_needed = max(int(fallback_project.get("volunteersNeeded") or 0), 0)

    return {
        "targetProjectId": str(payload.get("targetProjectId") or fallback_project.get("id") or "").strip() or None,
        "targetProjectTitle": str(payload.get("targetProjectTitle") or fallback_title).strip() or None,
        "targetProjectDescription": str(payload.get("targetProjectDescription") or fallback_description).strip() or None,
        "targetProjectAddress": str(payload.get("targetProjectAddress") or fallback_address).strip() or None,
        "requestedProgramModule": str(payload.get("requestedProgramModule") or fallback_module).strip() or None,
        "proposedTitle": str(payload.get("proposedTitle") or fallback_title).strip(),
        "proposedDescription": str(payload.get("proposedDescription") or fallback_description).strip(),
        "proposedStartDate": _normalize_partner_proposal_date(payload.get("proposedStartDate"), fallback_now),
        "proposedEndDate": _normalize_partner_proposal_date(payload.get("proposedEndDate"), fallback_now),
        "proposedLocation": str(payload.get("proposedLocation") or fallback_address).strip(),
        "proposedVolunteersNeeded": proposed_volunteers_needed,
        "skillsNeeded": payload.get("skillsNeeded") or [],
        "communityNeed": str(payload.get("communityNeed") or "").strip(),
        "expectedDeliverables": str(payload.get("expectedDeliverables") or "").strip(),
        "attachments": payload.get("attachments") or [],
    }


def _normalize_proposal_parent_project_id(value: Any) -> str:
    parent_project_id = str(value or "").strip()
    if not parent_project_id or parent_project_id == "new":
        return ""
    if parent_project_id.startswith("project-proposal-"):
        return ""
    if parent_project_id.startswith("program:") and "::" in parent_project_id:
        return parent_project_id.split("::", 1)[0].strip()
    return parent_project_id


def _proposal_parent_project_id_from_application(application: dict[str, Any]) -> str:
    proposal_details = application.get("proposalDetails")
    if not isinstance(proposal_details, dict):
        proposal_details = {}

    return _normalize_proposal_parent_project_id(
        proposal_details.get("targetProjectId")
        or proposal_details.get("targetProgramId")
        or proposal_details.get("programId")
        or application.get("targetProjectId")
        or application.get("projectId")
    )


def _attach_proposal_parent_project_ids(
    projects: list[dict[str, Any]],
    partner_applications: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    parent_by_project_id: dict[str, str] = {}
    approved_parent_by_module: dict[str, str] = {}
    for application in partner_applications:
        if str(application.get("status") or "").strip() != "Approved":
            continue

        project_id = str(application.get("projectId") or "").strip()
        parent_project_id = _proposal_parent_project_id_from_application(application)
        proposal_details = application.get("proposalDetails")
        requested_module = ""
        if isinstance(proposal_details, dict):
            requested_module = str(proposal_details.get("requestedProgramModule") or "").strip()
        if parent_project_id and requested_module:
            approved_parent_by_module[requested_module] = parent_project_id

        if not project_id.startswith("project-proposal-"):
            continue

        if parent_project_id:
            parent_by_project_id[project_id] = parent_project_id

    if not parent_by_project_id and not approved_parent_by_module:
        return projects

    updated_projects: list[dict[str, Any]] = []
    for project in projects:
        project_id = str(project.get("id") or "").strip()
        project_module = str(project.get("programModule") or project.get("category") or "").strip()
        parent_project_id = parent_by_project_id.get(project_id)
        if not parent_project_id and project_id.startswith("project-proposal-"):
            parent_project_id = approved_parent_by_module.get(project_module)
        if (
            parent_project_id
            and not str(project.get("parentProjectId") or "").strip()
            and not bool(project.get("isEvent"))
        ):
            updated_projects.append({
                **project,
                "parentProjectId": parent_project_id,
            })
        else:
            updated_projects.append(project)
    return updated_projects


def _normalize_project_category(value: Any) -> str:
    normalized = str(value or "").strip()
    return normalized if normalized in {"Nutrition", "Education", "Livelihood", "Disaster"} else "Education"


# Tracks active websocket clients for messages and shared storage updates.
class ConnectionManager:
    # Initializes the in-memory websocket connection registries.
    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = {}
        self._storage_connections: set[WebSocket] = set()

    # Registers a websocket for a specific user id.
    async def connect(self, user_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections.setdefault(user_id, set()).add(websocket)

    # Registers a websocket that listens for shared storage changes.
    async def connect_storage(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self._storage_connections.add(websocket)

    # Removes a user-specific websocket connection.
    def disconnect(self, user_id: str, websocket: WebSocket) -> None:
        sockets = self._connections.get(user_id)
        if not sockets:
            return
        sockets.discard(websocket)
        if not sockets:
            self._connections.pop(user_id, None)

    # Removes a shared-storage websocket connection.
    def disconnect_storage(self, websocket: WebSocket) -> None:
        self._storage_connections.discard(websocket)

    # Sends one event payload to all active sockets for a user.
    async def send_user_event(self, user_id: str, payload: dict[str, Any]) -> None:
        sockets = list(self._connections.get(user_id, set()))
        if not sockets:
            return

        async def send_to_socket(socket: WebSocket) -> WebSocket | None:
            try:
                await asyncio.wait_for(socket.send_json(payload), timeout=3)
            except Exception:
                return socket
            return None

        # Send to all web/mobile tabs at once. A stale tab must not delay the
        # live update for an active conversation in another client.
        stale = [
            socket
            for socket in await asyncio.gather(*(send_to_socket(socket) for socket in sockets))
            if socket is not None
        ]
        for socket in stale:
            self.disconnect(user_id, socket)

    # Broadcasts a direct-message change to both sender and recipient.
    async def broadcast_message_event(self, message: dict[str, Any]) -> None:
        payload = {"type": "message.changed", "message": message}
        recipients = {message["senderId"], message["recipientId"]}
        await asyncio.gather(*(self.send_user_event(user_id, payload) for user_id in recipients))

    # Broadcasts a direct-message deletion to both participants.
    async def broadcast_message_deleted_event(
        self,
        message_ids: list[str],
        sender_id: str,
        recipient_id: str,
    ) -> None:
        if not message_ids:
            return
        payload = {
            "type": "message.deleted",
            "messageIds": message_ids,
            "senderId": sender_id,
            "recipientId": recipient_id,
        }
        recipients = {sender_id, recipient_id}
        await asyncio.gather(*(self.send_user_event(user_id, payload) for user_id in recipients))

    # Relays a transient typing state without writing it to message storage.
    async def broadcast_typing_event(
        self,
        sender_id: str,
        recipient_id: str | None = None,
        project_id: str | None = None,
        is_typing: bool = False,
    ) -> None:
        sender_id = str(sender_id or '').strip()
        recipient_id = str(recipient_id or '').strip()
        project_id = str(project_id or '').strip()
        if not sender_id or (not recipient_id and not project_id):
            return

        if project_id:
            group_access_key = f"{project_id}:{sender_id}"
            cached_recipients = _typing_group_recipients_cache.get(group_access_key)
            if cached_recipients is not None:
                recipients = set(cached_recipients)
            else:
                with get_connection() as connection:
                    _assert_project_group_chat_access(connection, project_id, sender_id)
                    recipients = _get_project_chat_participant_user_ids(connection, project_id)
                _typing_group_recipients_cache.set(group_access_key, set(recipients))
            recipients.discard(sender_id)
        else:
            direct_access_key = f"{sender_id}:{recipient_id}"
            if _typing_direct_access_cache.get(direct_access_key) is None:
                with get_connection() as connection:
                    _assert_direct_message_access(connection, sender_id, recipient_id)
            recipients = {recipient_id}

        payload = {
            "type": "typing",
            "senderId": sender_id,
            "recipientId": recipient_id or None,
            "projectId": project_id or None,
            "isTyping": bool(is_typing),
        }
        await asyncio.gather(*(self.send_user_event(user_id, payload) for user_id in recipients))

    # Broadcasts a project-group message to all eligible project chat participants.
    async def broadcast_project_group_message_event(
        self, project_id: str, message: dict[str, Any]
    ) -> None:
        payload = {"type": "project-group-message.changed", "message": message}
        with get_connection() as connection:
            recipients = _get_project_chat_participant_user_ids(connection, project_id)
        recipients.add(message["senderId"])
        await asyncio.gather(*(self.send_user_event(user_id, payload) for user_id in recipients))

    # Broadcasts a project-group message deletion to every eligible participant.
    async def broadcast_project_group_message_deleted_event(
        self,
        project_id: str,
        message_ids: list[str],
    ) -> None:
        if not message_ids:
            return
        payload = {
            "type": "project-group-message.deleted",
            "projectId": project_id,
            "messageIds": message_ids,
        }
        with get_connection() as connection:
            recipients = _get_project_chat_participant_user_ids(connection, project_id)
        await asyncio.gather(*(self.send_user_event(user_id, payload) for user_id in recipients))

    # Broadcasts a shared-storage change notification to all listeners.
    async def broadcast_storage_event(self, keys: list[str]) -> None:
        if not keys:
            return

        payload = {"type": "storage.changed", "keys": keys}
        sockets = list(self._storage_connections)
        if not sockets:
            return

        async def send_to_socket(socket: WebSocket) -> WebSocket | None:
            try:
                await asyncio.wait_for(socket.send_json(payload), timeout=3)
            except Exception:
                return socket
            return None

        stale = [
            socket
            for socket in await asyncio.gather(*(send_to_socket(socket) for socket in sockets))
            if socket is not None
        ]

        for socket in stale:
            self.disconnect_storage(socket)


connection_manager = ConnectionManager()


# Ensures the direct-message table exists before message APIs are used.
def ensure_message_storage() -> None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            # First, try to drop and recreate the table if it has wrong schema in public schema
            cursor.execute("""
                SELECT column_name FROM information_schema.columns 
                WHERE table_schema = 'public' AND table_name = 'messages' AND column_name IN ('topic', 'extension', 'private')
            """)
            has_wrong_schema = cursor.fetchone() is not None
            
            if has_wrong_schema:
                _trace("[SCHEMA] Fixing corrupted messages table...")
                try:
                    cursor.execute("DROP TABLE public.messages CASCADE")
                except:
                    pass
            
            cursor.execute(
                """
                create table if not exists public.messages (
                  messages_id text primary key,
                  sender_id text not null,
                  recipient_id text not null,
                  project_id text,
                  content text not null,
                  timestamp timestamptz not null,
                  read boolean not null default false,
                  attachments text not null default '[]'
                )
                """
            )
            # Indexes for fast message lookups by participant and timestamp
            cursor.execute(
                "create index if not exists messages_sender_id_idx on public.messages (sender_id)"
            )
            cursor.execute(
                "create index if not exists messages_recipient_id_idx on public.messages (recipient_id)"
            )
            cursor.execute(
                "create index if not exists messages_pair_idx on public.messages (sender_id, recipient_id, timestamp asc)"
            )
            cursor.execute(
                "create index if not exists messages_pair_rev_idx on public.messages (recipient_id, sender_id, timestamp asc)"
            )
            cursor.execute(
                "create index if not exists messages_timestamp_idx on public.messages (timestamp desc)"
            )
            cursor.execute(
                "create index if not exists messages_read_recipient_idx on public.messages (recipient_id, read) where read = false"
            )
            # These indexes match the two independent branches used by the
            # inbox and conversation reads.  They avoid a full table scan for
            # the common `sender OR recipient` pattern.
            cursor.execute(
                "create index if not exists messages_sender_recent_idx on public.messages (sender_id, timestamp desc, messages_id desc)"
            )
            cursor.execute(
                "create index if not exists messages_recipient_recent_idx on public.messages (recipient_id, timestamp desc, messages_id desc)"
            )
            cursor.execute(
                "create index if not exists messages_pair_recent_idx on public.messages (sender_id, recipient_id, timestamp desc, messages_id desc)"
            )
        connection.commit()


def ensure_message_storage_once() -> None:
    global _message_storage_ready
    if _message_storage_ready:
        return
    with _message_storage_lock:
        if _message_storage_ready:
            return
        ensure_message_storage()
        _migrate_legacy_admin_messages()
        _message_storage_ready = True


# Ensures the project group message table exists before group chat APIs are used.
def ensure_project_group_message_storage() -> None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                create table if not exists project_group_messages (
                  project_group_messages_id text primary key,
                  project_id text not null,
                  sender_id text not null references users(id) on delete cascade,
                  content text not null,
                  timestamp timestamptz not null,
                  kind text not null default 'message',
                  need_post text,
                  scope_proposal text,
                  response_to_message_id text,
                  response_action text,
                  response_to_title text,
                  attachments text not null default '[]'
                )
                """
            )
            # Older local databases created this table with `id`, while the
            # relational mirror and the deployed schema use the canonical
            # `project_group_messages_id` column. Normalize that legacy name
            # before any group-chat read/write touches the table.
            cursor.execute(
                """
                select column_name
                from information_schema.columns
                where table_schema = 'public'
                  and table_name = 'project_group_messages'
                """
            )
            message_columns = {row[0] for row in cursor.fetchall()}
            if "project_group_messages_id" not in message_columns and "id" in message_columns:
                cursor.execute(
                    """
                    alter table public.project_group_messages
                    rename column id to project_group_messages_id
                    """
                )
            cursor.execute(
                "alter table project_group_messages add column if not exists kind text not null default 'message'"
            )
            cursor.execute(
                "alter table project_group_messages add column if not exists need_post text"
            )
            cursor.execute(
                "alter table project_group_messages add column if not exists scope_proposal text"
            )
            cursor.execute(
                "alter table project_group_messages add column if not exists response_to_message_id text"
            )
            cursor.execute(
                "alter table project_group_messages add column if not exists response_action text"
            )
            cursor.execute(
                "alter table project_group_messages add column if not exists response_to_title text"
            )
            cursor.execute(
                "update project_group_messages set kind = 'message' where kind is null"
            )
            # Index for fast group message lookups by project
            cursor.execute(
                "create index if not exists pgm_project_id_timestamp_idx on project_group_messages (project_id, timestamp asc)"
            )
        connection.commit()


# Converts a database message row into the API shape returned to clients.
def _parse_message_attachments(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except Exception:
            return []
        return parsed if isinstance(parsed, list) else []
    return []


def _sanitize_proposal_content_payload(content: Any) -> str:
    raw_content = str(content or "")
    if not raw_content.startswith(_PROPOSAL_CARD_PREFIX):
        return raw_content
    try:
        data = json.loads(raw_content[len(_PROPOSAL_CARD_PREFIX):])
        if not isinstance(data, dict):
            return raw_content
        
        modified = False

        # New proposal images are compressed before persistence.  Keep those
        # compact data URIs so web and mobile can preview/download them, while
        # still preventing legacy multi-megabyte attachments from making every
        # message response slow.
        def sanitize_attachment(attachment: Any) -> Any:
            nonlocal modified
            if not isinstance(attachment, dict):
                return attachment
            attachment_url = attachment.get("url")
            if (
                isinstance(attachment_url, str)
                and attachment_url.startswith("data:")
                and len(attachment_url) > 100_000
            ):
                modified = True
                return {**attachment, "url": "[IMAGE_ATTACHMENT]"}
            return attachment

        if "attachments" in data and isinstance(data["attachments"], list):
            data["attachments"] = [sanitize_attachment(att) for att in data["attachments"]]

        details = data.get("proposalDetails")
        if isinstance(details, dict) and "attachments" in details and isinstance(details["attachments"], list):
            details["attachments"] = [sanitize_attachment(att) for att in details["attachments"]]
            data["proposalDetails"] = details

        if modified:
            return f"{_PROPOSAL_CARD_PREFIX}{json.dumps(data)}"
        return raw_content
    except Exception:
        return raw_content


def serialize_message_row(row: Any) -> dict[str, Any]:
    if row is None:
        raise HTTPException(status_code=404, detail="Message not found.")

    attachments = _parse_message_attachments(row["attachments"])
    content = _sanitize_proposal_content_payload(row["content"])

    return {
        "id": row.get("messages_id") or row.get("id"),
        "senderId": row["sender_id"],
        "recipientId": row["recipient_id"],
        "projectId": row["project_id"],
        "content": content,
        "timestamp": row["timestamp"].isoformat() if hasattr(row["timestamp"], "isoformat") else row["timestamp"],
        "read": bool(row["read"]),
        "attachments": attachments,
    }


# Converts a database project-group message row into the API response shape.
def serialize_project_group_message_row(row: Any) -> dict[str, Any]:
    if row is None:
        raise HTTPException(status_code=404, detail="Project group message not found.")

    attachments = _parse_message_attachments(row["attachments"])
    need_post = row.get("need_post")
    if isinstance(need_post, str):
        need_post = json.loads(need_post)
    scope_proposal = row.get("scope_proposal")
    if isinstance(scope_proposal, str):
        scope_proposal = json.loads(scope_proposal)

    return {
        "id": row.get("project_group_messages_id") or row.get("id"),
        "projectId": row["project_id"],
        "senderId": row["sender_id"],
        "content": row["content"],
        "timestamp": row["timestamp"].isoformat() if hasattr(row["timestamp"], "isoformat") else row["timestamp"],
        "kind": row.get("kind") or "message",
        "needPost": need_post,
        "scopeProposal": scope_proposal,
        "responseToMessageId": row.get("response_to_message_id"),
        "responseAction": row.get("response_action"),
        "responseToTitle": row.get("response_to_title"),
        "attachments": attachments,
    }


SPECIAL_STORAGE_KEYS = {"messages", "projectGroupMessages", "programTracks"}

# Define collection keys that return lists instead of single objects
# This includes all HOT_STORAGE_TABLES and SPECIAL_STORAGE_KEYS
COLLECTION_KEYS = set(HOT_STORAGE_TABLES.keys()) | SPECIAL_STORAGE_KEYS


def _validate_storage_items(key: str, value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        raise HTTPException(status_code=400, detail=f"Storage key '{key}' expects a list payload.")

    normalized_items: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not item.get("id"):
            raise HTTPException(status_code=400, detail=f"Storage key '{key}' expects object items with ids.")
        normalized_items.append(item)
    return normalized_items


def _get_special_storage_collection(connection: Any, key: str) -> list[dict[str, Any]]:
    if key == "programTracks":
        programs = get_postgres_hot_storage_collection(connection, "programs") or []
        tracks: list[dict[str, Any]] = []
        for p in programs:
            p_id = str(p.get("id") or "").strip()
            if p_id and not p.get("parentProjectId") and not p.get("isEvent"):
                tracks.append({
                    "id": p_id,
                    "title": p.get("title", ""),
                    "description": p.get("description", ""),
                    "icon": p.get("icon", "folder"),
                    "color": p.get("color", "#666666"),
                    "imageUrl": p.get("imageUrl", ""),
                    "sortOrder": 0,
                    "isActive": True,
                    "createdAt": p.get("createdAt"),
                    "updatedAt": p.get("updatedAt"),
                })
        return tracks

    ensure_message_storage_once()
    ensure_project_group_message_storage()
    from psycopg.rows import dict_row

    with connection.cursor(row_factory=dict_row) as cursor:
        if key == "messages":
            cursor.execute(
                """
                SELECT messages_id, sender_id, recipient_id, project_id, content, timestamp, read, attachments
                FROM public.messages
                ORDER BY timestamp ASC, messages_id ASC
                """
            )
            return [serialize_message_row(row) for row in cursor.fetchall()]

        if key == "projectGroupMessages":
            cursor.execute(
                """
                select
                  project_group_messages_id,
                  project_id,
                  sender_id,
                  content,
                  timestamp,
                  kind,
                  need_post,
                  scope_proposal,
                  response_to_message_id,
                  response_action,
                  response_to_title,
                  attachments
                from public.project_group_messages
                order by timestamp asc, project_group_messages_id asc
                """
            )
            return [serialize_project_group_message_row(row) for row in cursor.fetchall()]

    raise HTTPException(status_code=400, detail=f"Unsupported storage key '{key}'.")


def _replace_special_storage_collection(connection: Any, key: str, value: Any) -> None:
    items = _validate_storage_items(key, value)
    ensure_message_storage_once()
    ensure_project_group_message_storage()

    with connection.cursor() as cursor:
        if key == "messages":
            cursor.execute("DELETE FROM public.messages")
            for item in items:
                cursor.execute(
                    """
                    INSERT INTO public.messages (
                      messages_id, sender_id, recipient_id, project_id, content, timestamp, read, attachments
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        item["id"],
                        item.get("senderId"),
                        item.get("recipientId"),
                        item.get("projectId"),
                        item.get("content") or "",
                        item.get("timestamp"),
                        bool(item.get("read")),
                        json.dumps(item.get("attachments") or []),
                    ),
                )
            return

        if key == "projectGroupMessages":
            cursor.execute("delete from project_group_messages")
            for item in items:
                cursor.execute(
                    """
                    insert into project_group_messages (
                      id,
                      project_id,
                      sender_id,
                      content,
                      timestamp,
                      kind,
                      need_post,
                      scope_proposal,
                      response_to_message_id,
                      response_action,
                      response_to_title,
                      attachments
                    )
                    values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        item["id"],
                        item.get("projectId"),
                        item.get("senderId"),
                        item.get("content") or "",
                        item.get("timestamp"),
                        item.get("kind") or "message",
                        json.dumps(item.get("needPost")) if item.get("needPost") is not None else None,
                        json.dumps(item.get("scopeProposal")) if item.get("scopeProposal") is not None else None,
                        item.get("responseToMessageId"),
                        item.get("responseAction"),
                        item.get("responseToTitle"),
                        json.dumps(item.get("attachments") or []),
                    ),
                )
            return

    raise HTTPException(status_code=400, detail=f"Unsupported storage key '{key}'.")


def _clear_special_storage_collection(connection: Any, key: str) -> None:
    ensure_message_storage_once()
    ensure_project_group_message_storage()
    with connection.cursor() as cursor:
        if key == "messages":
            cursor.execute("DELETE FROM public.messages")
            return
        if key == "projectGroupMessages":
            cursor.execute("delete from project_group_messages")
            return

    raise HTTPException(status_code=400, detail=f"Unsupported storage key '{key}'.")


PROJECT_REFERENCE_STORAGE_KEYS = [
    "statusUpdates",
    "partnerProjectApplications",
    "partnerReports",
    "publishedImpactReports",
    "volunteerProjectJoins",
    "volunteerMatches",
    "volunteerTimeLogs",
]


def _project_id_from_item(item: dict[str, Any]) -> str:
    return str(item.get("projectId") or item.get("project_id") or "").strip()


def _filter_project_references(items: list[dict[str, Any]], related_project_ids: set[str]) -> list[dict[str, Any]]:
    related_project_keys = {project_id.lower() for project_id in related_project_ids}
    return [
        item
        for item in items
        if _project_id_from_item(item).lower() not in related_project_keys
    ]


def _delete_rows_by_known_field_values(
    connection: Any,
    table_name: str,
    possible_columns: list[str],
    values: set[str],
) -> int:
    normalized_values = {
        str(value or "").strip().lower()
        for value in values
        if str(value or "").strip()
    }
    if not normalized_values:
        return 0

    deleted_count = 0
    with connection.cursor() as cursor:
        cursor.execute(
            """
            select column_name
            from information_schema.columns
            where table_schema = 'public'
              and table_name = %s
              and column_name = any(%s)
            """,
            (table_name, possible_columns),
        )
        existing_columns = [str(row[0]) for row in cursor.fetchall()]
        for column_name in existing_columns:
            cursor.execute(
                f"delete from {table_name} where lower(trim(coalesce({column_name}::text, ''))) = any(%s)",
                (list(normalized_values),),
            )
            deleted_count += cursor.rowcount or 0
    return deleted_count


def _cascade_delete_project_references(connection: Any, related_project_ids: set[str]) -> list[str]:
    related_ids = [str(pid or "").strip() for pid in related_project_ids if str(pid or "").strip()]
    if not related_ids:
        return []

    with connection.cursor() as cursor:
        try:
            cursor.execute(
                """
                with requested_ids(id) as (
                    select unnest(%s::text[])
                ),
                child_ids(id) as (
                    select distinct events_id
                    from events
                    where parent_project_id in (select id from requested_ids)
                       or events_id in (select id from requested_ids)
                ),
                all_ids(id) as (
                    select id from requested_ids
                    union
                    select id from child_ids
                ),
                deleted_events as (
                    delete from events
                    where events_id in (select id from all_ids)
                       or parent_project_id in (select id from all_ids)
                    returning 1
                ),
                deleted_projects as (
                    delete from projects
                    where projects_id in (select id from all_ids)
                    returning 1
                ),
                deleted_time_logs as (
                    delete from volunteer_time_logs
                    where project_id in (select id from all_ids)
                    returning 1
                ),
                deleted_matches as (
                    delete from volunteer_matches
                    where project_id in (select id from all_ids)
                    returning 1
                ),
                deleted_joins as (
                    delete from volunteer_event_joins
                    where project_id in (select id from all_ids)
                    returning 1
                ),
                deleted_applications as (
                    delete from partner_project_applications
                    where project_id in (select id from all_ids)
                    returning 1
                ),
                deleted_status_updates as (
                    delete from status_updates
                    where project_id in (select id from all_ids)
                    returning 1
                ),
                deleted_reports as (
                    delete from reports
                    where project_id in (select id from all_ids)
                    returning 1
                ),
                deleted_group_messages as (
                    delete from project_group_messages
                    where project_id in (select id from all_ids)
                    returning 1
                )
                select
                    (select count(*) from deleted_events),
                    (select count(*) from deleted_projects),
                    (select count(*) from deleted_time_logs),
                    (select count(*) from deleted_matches),
                    (select count(*) from deleted_joins),
                    (select count(*) from deleted_applications),
                    (select count(*) from deleted_status_updates),
                    (select count(*) from deleted_reports),
                    (select count(*) from deleted_group_messages)
                """,
                (related_ids,),
            )
            counts = cursor.fetchone() or (0,) * 9
        except Exception:
            try:
                connection.rollback()
            except Exception:
                pass
            return []

    changed_keys: list[str] = []
    for count, key in zip(
        counts,
        (
            "events",
            "projects",
            "volunteerTimeLogs",
            "volunteerMatches",
            "volunteerProjectJoins",
            "partnerProjectApplications",
            "statusUpdates",
            "partnerReports",
            "projectGroupMessages",
        ),
    ):
        if count:
            changed_keys.append(key)
    return changed_keys


def _remove_volunteer_assignments_from_project(
    project: dict[str, Any],
    volunteer_ids: set[str],
    volunteer_user_ids: set[str],
) -> tuple[dict[str, Any], bool]:
    remove_volunteer_ids = {str(value or "").strip() for value in volunteer_ids if str(value or "").strip()}
    remove_user_ids = {str(value or "").strip() for value in volunteer_user_ids if str(value or "").strip()}
    # Tasks may have been saved with either the volunteer profile id or the
    # linked user id.  Removing a volunteer must clear both forms everywhere.
    remove_assignment_ids = remove_volunteer_ids | remove_user_ids

    volunteers = list(project.get("volunteers") or [])
    joined_user_ids = list(project.get("joinedUserIds") or [])
    next_volunteers = [
        volunteer_id
        for volunteer_id in volunteers
        if str(volunteer_id or "").strip() not in remove_volunteer_ids
    ]
    next_joined_user_ids = [
        user_id
        for user_id in joined_user_ids
        if str(user_id or "").strip() not in remove_user_ids
    ]

    internal_tasks = project.get("internalTasks") or []
    next_internal_tasks: list[Any] = []
    tasks_changed = False
    for task in internal_tasks:
        if not isinstance(task, dict):
            next_internal_tasks.append(task)
            continue

        task_changed = False
        next_task = dict(task)

        assigned_volunteer_id = str(next_task.get("assignedVolunteerId") or "").strip()
        if assigned_volunteer_id and assigned_volunteer_id in remove_assignment_ids:
            next_task.pop("assignedVolunteerId", None)
            next_task.pop("assignedVolunteerName", None)
            task_changed = True

        assigned_volunteer_ids = list(next_task.get("assignedVolunteerIds") or [])
        next_assigned_volunteer_ids = [
            assigned_id
            for assigned_id in assigned_volunteer_ids
            if str(assigned_id or "").strip() not in remove_assignment_ids
        ]
        if len(next_assigned_volunteer_ids) != len(assigned_volunteer_ids):
            next_task["assignedVolunteerIds"] = next_assigned_volunteer_ids
            assigned_names = list(next_task.get("assignedVolunteerNames") or [])
            next_task["assignedVolunteerNames"] = [
                assigned_names[index]
                for index, assigned_id in enumerate(assigned_volunteer_ids)
                if str(assigned_id or "").strip() not in remove_assignment_ids and index < len(assigned_names)
            ]
            task_changed = True

        # Keep the legacy singular fields aligned with the remaining array
        # assignment. This matters when the removed volunteer was the first
        # assignee but other volunteers are still on the task.
        if task_changed and not next_task.get("assignedVolunteerId") and next_assigned_volunteer_ids:
            next_task["assignedVolunteerId"] = next_assigned_volunteer_ids[0]
            remaining_names = list(next_task.get("assignedVolunteerNames") or [])
            next_task["assignedVolunteerName"] = remaining_names[0] if remaining_names else None

        if task_changed and not next_task.get("assignedVolunteerId") and not next_task.get("assignedVolunteerIds"):
            next_task["status"] = "Unassigned"

        tasks_changed = tasks_changed or task_changed
        next_internal_tasks.append(next_task)

    changed = (
        len(next_volunteers) != len(volunteers)
        or len(next_joined_user_ids) != len(joined_user_ids)
        or tasks_changed
    )
    if not changed:
        return project, False

    updated_project = {
        **project,
        "volunteers": next_volunteers,
        "joinedUserIds": next_joined_user_ids,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }
    if tasks_changed:
        updated_project["internalTasks"] = next_internal_tasks
    return updated_project, True


def _update_project_assignments_after_volunteer_delete(
    connection: Any,
    removed_volunteer_ids: set[str],
    removed_volunteer_user_ids: set[str],
) -> list[str]:
    """Remove deleted volunteer references without replacing media-bearing rows."""
    from psycopg.rows import dict_row

    changed_keys: list[str] = []
    for table_name, id_column, storage_key in (
        ("projects", "projects_id", "projects"),
        ("events", "events_id", "events"),
    ):
        assignment_ids = list(removed_volunteer_ids | removed_volunteer_user_ids)
        task_patterns = [f"%{assignment_id}%" for assignment_id in assignment_ids]
        # Only fetch assignment fields. In particular, image_url and
        # attachments never cross this update path.
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                f"""
                select {id_column}, volunteers, joined_user_ids, internal_tasks
                from public.{table_name}
                where volunteers && %s::text[]
                   or joined_user_ids && %s::text[]
                   or internal_tasks::text like any(%s)
                """,
                (assignment_ids, assignment_ids, task_patterns),
            )
            rows = cursor.fetchall()

            updates: list[tuple[Any, Any, Any, str]] = []
            for row in rows:
                raw_tasks = row.get("internal_tasks")
                parsed_tasks = raw_tasks
                tasks_are_serialized = isinstance(raw_tasks, str)
                if tasks_are_serialized:
                    try:
                        parsed_tasks = json.loads(raw_tasks or "[]")
                    except (TypeError, ValueError):
                        parsed_tasks = None

                assignment_item = {
                    "id": row.get(id_column),
                    "volunteers": row.get("volunteers") or [],
                    "joinedUserIds": row.get("joined_user_ids") or [],
                    "internalTasks": parsed_tasks if isinstance(parsed_tasks, list) else [],
                }
                updated_item, item_changed = _remove_volunteer_assignments_from_project(
                    assignment_item,
                    removed_volunteer_ids,
                    removed_volunteer_user_ids,
                )
                if not item_changed:
                    continue

                # If legacy task JSON is malformed, preserve it while still
                # clearing the safe array references.
                updated_tasks = (
                    json.dumps(updated_item.get("internalTasks") or [])
                    if isinstance(parsed_tasks, list)
                    else raw_tasks
                )
                updates.append(
                    (
                        updated_item.get("volunteers") or [],
                        updated_item.get("joinedUserIds") or [],
                        updated_tasks,
                        datetime.now(timezone.utc).isoformat(),
                        str(row.get(id_column) or ""),
                    )
                )

            for volunteers, joined_user_ids, internal_tasks, updated_at, item_id in updates:
                cursor.execute(
                    f"""
                    update public.{table_name}
                    set volunteers = %s,
                        joined_user_ids = %s,
                        internal_tasks = %s,
                        updated_at = %s
                    where {id_column} = %s
                    """,
                    (volunteers, joined_user_ids, internal_tasks, updated_at, item_id),
                )

        if updates:
            changed_keys.append(storage_key)

    return changed_keys


# Returns the user ids that should have access to a project's group chat.
def _get_project_chat_participant_user_ids(connection: Any, project_id: str) -> set[str]:
    project, _ = _postgres_get_project_like_item_by_id(connection, project_id)
    if project is None:
        return set()

    participant_user_ids = {
        user_id
        for user_id in project.get("joinedUserIds") or []
        if isinstance(user_id, str) and user_id
    }

    join_records = _postgres_get_hot_items_by_field(connection, "volunteerProjectJoins", "projectId", project_id)
    for record in join_records:
        volunteer_user_id = record.get("volunteerUserId")
        if isinstance(volunteer_user_id, str) and volunteer_user_id:
            participant_user_ids.add(volunteer_user_id)

    # OPTIMIZED: Get volunteer user IDs (may already be user IDs in some cases)
    volunteer_ids = [
        volunteer_id for volunteer_id in project.get("volunteers") or []
        if isinstance(volunteer_id, str) and volunteer_id
    ]
    # Volunteer IDs in the project.volunteers array are typically user IDs already
    # Add them directly to participants
    for volunteer_id in volunteer_ids:
        if isinstance(volunteer_id, str) and volunteer_id:
            participant_user_ids.add(volunteer_id)

    approved_project_ids = {project_id}
    parent_project_id = project.get("parentProjectId")
    if isinstance(parent_project_id, str) and parent_project_id:
        approved_project_ids.add(parent_project_id)

    # OPTIMIZED: Filter applications in SQL instead of loading all
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT partner_user_id FROM partner_project_applications
            WHERE status = 'Approved'
            AND project_id = ANY(%s)
            """,
            (list(approved_project_ids),)
        )
        for row in cursor.fetchall():
            partner_user_id = str(row[0] or "") if row else ""
            if partner_user_id:
                participant_user_ids.add(partner_user_id)

    return participant_user_ids


# Returns whether a direct-message pair is allowed based on the users' roles.
def _is_direct_message_pair_allowed(sender_role: str, recipient_role: str) -> bool:
    normalized_sender_role = str(sender_role or "").strip()
    normalized_recipient_role = str(recipient_role or "").strip()
    role_pair = {normalized_sender_role, normalized_recipient_role}

    if "admin" in role_pair:
        return True

    if "volunteer" in role_pair:
        return False

    return True


# Raises an error if the requesting users cannot use direct messaging.
def _assert_direct_message_access(
    connection: Any,
    sender_id: str,
    recipient_id: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    sender_user = _get_user_by_id(sender_id, connection)
    if sender_user is None:
        raise HTTPException(status_code=404, detail="Sender not found.")

    recipient_user = _get_user_by_id(recipient_id, connection)
    if recipient_user is None:
        raise HTTPException(status_code=404, detail="Recipient not found.")

    if not _is_direct_message_pair_allowed(
        str(sender_user.get("role") or ""),
        str(recipient_user.get("role") or ""),
    ):
        raise HTTPException(
            status_code=403,
            detail="Volunteer direct messages are limited to admin contacts.",
        )

    _typing_direct_access_cache.set(
        f"{sender_id}:{recipient_id}",
        True,
    )
    _typing_direct_access_cache.set(
        f"{recipient_id}:{sender_id}",
        True,
    )
    return sender_user, recipient_user


# Raises an error if the requesting user cannot access the project group chat.
def _assert_project_group_chat_access(
    connection: Any, project_id: str, user_id: str
) -> dict[str, Any]:
    project, _ = _postgres_get_project_like_item_by_id(connection, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found.")

    if not bool(project.get("isEvent")):
        raise HTTPException(
            status_code=403,
            detail="Group chat is only available for event workspaces.",
        )

    if bool(project.get("groupChatDisabled")):
        raise HTTPException(
            status_code=404,
            detail="This group chat has been removed from the system.",
        )

    user = _postgres_get_hot_item_by_id(connection, "users", user_id)
    role = str(user.get("role") or "") if user else ""
    if role == "admin":
        return project

    participant_user_ids = _get_project_chat_participant_user_ids(connection, project_id)
    if role not in {"volunteer", "partner"} or user_id not in participant_user_ids:
        raise HTTPException(
            status_code=403,
            detail="Only admins, approved partner organizations, and joined volunteers can open this group chat.",
        )

    return project


# Blocks routes when Postgres is not available.
def _require_postgres() -> None:
    if get_db_mode() != "postgres":
        raise HTTPException(status_code=503, detail="Supabase Postgres backend is unavailable.")


# Ensures the per-admin notification read-state table exists. This is kept
# separate from the general storage mirror because notification reads are
# user-specific metadata, not application records visible to other users.
def _ensure_notification_reads_table(connection: Any) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            create table if not exists public.notification_reads (
              notification_reads_id text primary key,
              user_id text not null,
              notification_id text not null,
              seen_at timestamptz not null default now(),
              unique (user_id, notification_id)
            )
            """
        )
        cursor.execute(
            """
            create index if not exists notification_reads_user_seen_idx
            on public.notification_reads (user_id, seen_at desc)
            """
        )


# Sorts dictionaries by an ISO timestamp field in descending order.
def _sort_iso_desc(items: list[dict[str, Any]], field: str) -> list[dict[str, Any]]:
    return sorted(items, key=lambda item: str(item.get(field) or ""), reverse=True)


def _to_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _decode_json_object(value: Any) -> dict[str, Any]:
    """Decode a JSON-backed object column returned by PostgreSQL.

    The relational mirror stores JSON fields as text so it can work across the
    supported database modes.  Snapshot queries return those columns directly,
    therefore decode them before sending the storage payload to the client.
    """
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            decoded = json.loads(value)
        except (TypeError, ValueError):
            return {}
        return decoded if isinstance(decoded, dict) else {}
    return {}


def _extract_beneficiaries_from_description(description: Any) -> int | None:
    """Recover beneficiary totals from legacy volunteer report narratives."""
    match = re.search(
        r"\bbeneficiaries\s+(?:reached|served|assisted)\s*:\s*(\d+(?:\.\d+)?)",
        str(description or ""),
        flags=re.IGNORECASE,
    )
    if not match:
        return None
    try:
        value = float(match.group(1))
    except (TypeError, ValueError):
        return None
    return int(value) if math.isfinite(value) and value >= 0 else None


# Maps hot-storage keys to their backing table names.
def _hot_table_name(key: str) -> str:
    table_name = HOT_STORAGE_TABLES.get(key)
    if not table_name:
        raise HTTPException(status_code=400, detail=f"Unsupported hot storage key '{key}'.")
    return table_name


def _collection_cache_key(key: str) -> str:
    return f"collection:{key}"


def _invalidate_collection_cache(keys: list[str] | set[str] | tuple[str, ...] | None = None) -> None:
    if keys is None:
        _storage_collection_cache.clear()
        _admin_dashboard_cache.clear()
        return
    for key in keys:
        _storage_collection_cache.delete(_collection_cache_key(str(key)))
        _storage_collection_cache.delete(f"collection:media:{key}:0")
        _storage_collection_cache.delete(f"collection:media:{key}:1")
        _storage_collection_cache.delete(f"collection:{key}:images:0")
        _storage_collection_cache.delete(f"collection:{key}:images:1")
    if "messages" in keys:
        _message_query_cache.clear()
    elif "users" in keys:
        _message_query_cache.delete("users:directory")
    # Invalidate admin dashboard cache whenever any of its constituent keys change.
    if any(k in _ADMIN_DASHBOARD_KEYS for k in keys):
        _admin_dashboard_cache.delete(_ADMIN_DASHBOARD_CACHE_KEY)


def _get_cached_collection(
    connection: Any,
    key: str,
    include_images: bool = True,
) -> Any:
    if key in NON_CACHEABLE_COLLECTION_KEYS:
        if is_hot_storage_key(key):
            if key == "volunteerTimeLogs":
                value = _get_admin_dashboard_collection(
                    connection,
                    key,
                    include_images=include_images,
                )
            else:
                value = get_postgres_hot_storage_collection(
                    connection,
                    key,
                    include_images=include_images,
                )
            return value if include_images else _strip_lightweight_media(key, value)
        if key in SPECIAL_STORAGE_KEYS:
            value = _get_special_storage_collection(connection, key)
            return value if include_images else _strip_lightweight_media(key, value)
        return None

    # Keep image-bearing and lightweight responses in separate caches. A full
    # detail read must never populate the cache used by list screens, and a
    # lightweight read must never be returned to an explicit preview request.
    cache_key = f"collection:{key}:images:{1 if include_images else 0}"
    cached = _storage_collection_cache.get(cache_key)
    if cached is not None:
        return cached

    if is_hot_storage_key(key):
        if key == "volunteerTimeLogs":
            value = _get_admin_dashboard_collection(connection, key, include_images=include_images)
        else:
            value = get_postgres_hot_storage_collection(
                connection,
                key,
                include_images=include_images,
            )
    elif key in SPECIAL_STORAGE_KEYS:
        value = _get_special_storage_collection(connection, key)
    else:
        value = None

    if not include_images:
        value = _strip_lightweight_media(key, value)
    _storage_collection_cache.set(cache_key, value)
    return value


def _json_text_field_expression(column_name: str, field_name: str) -> str:
    return f"({column_name}::jsonb ->> '{field_name}')"


def _safe_json_object(**values: Any) -> dict[str, Any]:
    return {key: value for key, value in values.items() if value not in (None, "")}


def _get_partner_application_parent_repair_records(connection: Any) -> list[dict[str, Any]]:
    from psycopg.rows import dict_row

    pk_column = _primary_key_column("partnerProjectApplications")
    try:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                f"""
                select
                  {pk_column} as id,
                  project_id,
                  status,
                  {_json_text_field_expression("proposal_details", "targetProjectId")} as target_project_id,
                  {_json_text_field_expression("proposal_details", "targetProgramId")} as target_program_id,
                  {_json_text_field_expression("proposal_details", "programId")} as program_id,
                  {_json_text_field_expression("proposal_details", "requestedProgramModule")} as requested_program_module
                from partner_project_applications
                where status = 'Approved'
                order by id asc
                """
            )
            rows = cursor.fetchall()
    except Exception as error:
        print(f"[WARN] Parent repair application summary failed: {type(error).__name__}: {error}")
        try:
            connection.rollback()
        except Exception:
            pass
        return get_postgres_hot_storage_collection(connection, "partnerProjectApplications")

    return [
        {
            "id": row["id"],
            "projectId": row["project_id"],
            "status": row["status"],
            "proposalDetails": _safe_json_object(
                targetProjectId=row["target_project_id"],
                targetProgramId=row["target_program_id"],
                programId=row["program_id"],
                requestedProgramModule=row["requested_program_module"],
            ),
        }
        for row in rows
    ]


def _get_admin_dashboard_collection(
    connection: Any,
    key: str,
    include_images: bool = True,
) -> Any:
    from psycopg.rows import dict_row

    if key in {"projects", "events", "programs"}:
        # The dashboard list does not render full-size media. Keep its payload
        # small; detail screens request the real uploaded image separately.
        return _get_cached_media_light_collection(connection, key, include_images=False)

    if key == "volunteerTimeLogs":
        pk_column = _primary_key_column(key)
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                f"""
                select {pk_column} as id, volunteer_id, project_id, time_in, time_out, note,
                       {"attendance_photo" if include_images else "null::text as attendance_photo"},
                       attendance_confirmed_at, attendance_checked_at,
                       attendance_checked_by, attendance_checked_by_name,
                       {"completion_photo" if include_images else "null::text as completion_photo"}, completion_report
                from volunteer_time_logs
                order by {pk_column} asc
                """
            )
            items = [
                {
                    "id": row["id"],
                    "volunteerId": row["volunteer_id"],
                    "projectId": row["project_id"],
                    "timeIn": row["time_in"],
                    "timeOut": row["time_out"],
                    "note": row["note"],
                    "attendancePhoto": row["attendance_photo"],
                    "attendanceConfirmedAt": row["attendance_confirmed_at"],
                    "attendanceCheckedAt": row["attendance_checked_at"],
                    "attendanceCheckedBy": row["attendance_checked_by"],
                    "attendanceCheckedByName": row["attendance_checked_by_name"],
                    "completionPhoto": row["completion_photo"],
                    "completionReport": row["completion_report"],
                }
                for row in cursor.fetchall()
            ]
            if include_images:
                # Older attendance records may predate upload-time image
                # compression. Compress them on read so reports do not send
                # multi-megabyte base64 payloads over mobile connections.
                for item in items:
                    item["attendancePhoto"] = _compress_image_data_uri(item.get("attendancePhoto"))
                    item["completionPhoto"] = _compress_image_data_uri(item.get("completionPhoto"))
            return items

    if key == "partnerReports":
        pk_column = _primary_key_column(key)
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                f"""
                select {pk_column} as id, project_id, partner_id, partner_user_id, partner_name,
                       submitter_user_id, submitter_name, submitter_role, title,
                       report_type, description, impact_count, metrics, created_at, status,
                       reviewed_at, reviewed_by, source_report_ids
                from reports
                order by {pk_column} asc
                """
            )
            return [
                {
                    "id": row["id"],
                    "projectId": row["project_id"],
                    "partnerId": row["partner_id"],
                    "partnerUserId": row["partner_user_id"],
                    "partnerName": row["partner_name"],
                    "submitterUserId": row["submitter_user_id"],
                    "submitterName": row["submitter_name"],
                    "submitterRole": row["submitter_role"],
                    "title": row["title"],
                    "reportType": row["report_type"],
                    "description": row["description"],
                    "impactCount": row["impact_count"],
                    "metrics": _decode_json_object(row["metrics"]),
                    "createdAt": row["created_at"],
                    "status": row["status"],
                    "reviewedAt": row["reviewed_at"],
                    "reviewedBy": row["reviewed_by"],
                    "sourceReportIds": row["source_report_ids"] or [],
                }
                for row in cursor.fetchall()
            ]

    if key == "partnerProjectApplications":
        pk_column = _primary_key_column(key)
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                f"""
                select
                  {pk_column} as id,
                  project_id,
                  partner_user_id,
                  partner_name,
                  partner_email,
                  status,
                  requested_at,
                  reviewed_at,
                  reviewed_by,
                  {_json_text_field_expression("proposal_details", "proposedTitle")} as proposed_title,
                  {_json_text_field_expression("proposal_details", "targetProjectTitle")} as target_project_title,
                  {_json_text_field_expression("proposal_details", "targetProjectId")} as target_project_id,
                  {_json_text_field_expression("proposal_details", "targetProgramId")} as target_program_id,
                  {_json_text_field_expression("proposal_details", "programId")} as program_id,
                  {_json_text_field_expression("proposal_details", "requestedProgramModule")} as requested_program_module,
                  {_json_text_field_expression("proposal_details", "proposedLocation")} as proposed_location,
                  {_json_text_field_expression("proposal_details", "proposedStartDate")} as proposed_start_date,
                  {_json_text_field_expression("proposal_details", "proposedEndDate")} as proposed_end_date
                from partner_project_applications
                order by {pk_column} asc
                """
            )
            return [
                {
                    "id": row["id"],
                    "projectId": row["project_id"],
                    "partnerUserId": row["partner_user_id"],
                    "partnerName": row["partner_name"],
                    "partnerEmail": row["partner_email"],
                    "status": row["status"],
                    "requestedAt": row["requested_at"],
                    "reviewedAt": row["reviewed_at"],
                    "reviewedBy": row["reviewed_by"],
                    "proposalDetails": _safe_json_object(
                        proposedTitle=row["proposed_title"],
                        targetProjectTitle=row["target_project_title"],
                        targetProjectId=row["target_project_id"],
                        targetProgramId=row["target_program_id"],
                        programId=row["program_id"],
                        requestedProgramModule=row["requested_program_module"],
                        proposedLocation=row["proposed_location"],
                        proposedStartDate=row["proposed_start_date"],
                        proposedEndDate=row["proposed_end_date"],
                    ),
                }
                for row in cursor.fetchall()
            ]

    return _get_cached_collection(connection, key, include_images=include_images)


def _compress_image_data_uri(value: Any) -> Any:
    if not isinstance(value, str) or len(value) <= 80_000:
        return value

    prefix = ""
    body = value
    if "," in value and value[:50].lower().startswith("data:"):
        prefix, body = value.split(",", 1)
        prefix = f"{prefix},"

    compressed = compress_base64_image(body, max_size_bytes=60_000, max_width=800)
    return f"{prefix}{compressed}" if compressed else value


def _get_media_light_collection(connection: Any, key: str, include_images: bool = True) -> list[dict[str, Any]]:
    from psycopg.rows import dict_row

    spec = TABLE_SPECS[key]
    column_names = [column_name for column_name, _ in spec["columns"]]
    media_columns = LIGHTWEIGHT_MEDIA_COLUMNS.get(key, set())
    select_columns = [
        (f"null::text as {column_name}" if not include_images and column_name in media_columns else column_name)
        for column_name in column_names
    ]
    pk_column = _primary_key_column(key)

    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            f"""
            select {', '.join(select_columns)}
            from {spec["table"]}
            order by {pk_column} asc
            """
        )
        rows = cursor.fetchall()

    items = [_row_to_item(key, row) for row in rows]
    if include_images:
        for item in items:
            item["imageUrl"] = _compress_image_data_uri(item.get("imageUrl"))
    return items


def _get_cached_media_light_collection(
    connection: Any,
    key: str,
    include_images: bool = True,
) -> list[dict[str, Any]]:
    cache_key = f"collection:media:{key}:{1 if include_images else 0}"
    cached = _storage_collection_cache.get(cache_key)
    if cached is not None:
        return cached

    value = _get_media_light_collection(connection, key, include_images=include_images)
    _storage_collection_cache.set(cache_key, value)
    return value


# Fetches a single hot-storage row by item id.
def _postgres_get_hot_item_by_id(
    connection: Any,
    key: str,
    item_id: str,
    *,
    include_password: bool = False,
    for_update: bool = False,
) -> dict[str, Any] | None:
    try:
        return get_relational_item_by_id(
            connection,
            key,
            item_id,
            include_password=include_password,
            for_update=for_update,
        )
    except KeyError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


# Reads hot-storage items filtered by one field value.
def _postgres_get_hot_items_by_field(
    connection: Any,
    key: str,
    field_name: str,
    field_value: str,
    *,
    include_media: bool = True,
) -> list[dict[str, Any]]:
    try:
        return get_relational_items_by_field(
            connection,
            key,
            field_name,
            field_value,
            include_media=include_media,
        )
    except KeyError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


# Prevents public storage writes from creating a new administrator or
# promoting a non-admin account. Existing administrator profile edits remain
# supported; new administrator accounts must be provisioned from the terminal.
def _require_terminal_admin_provisioning(connection: Any, key: str, item: dict[str, Any]) -> None:
    if key != "users" or str(item.get("role") or "").strip().lower() != "admin":
        return

    item_id = str(item.get("id") or "").strip()
    existing_role = None
    if item_id:
        with connection.cursor() as cursor:
            cursor.execute(
                "select role from public.users where users_id = %s",
                (item_id,),
            )
            existing_row = cursor.fetchone()
        existing_role = str(existing_row[0] or "").strip().lower() if existing_row else None

    if existing_role != "admin":
        raise ValueError("Admin accounts can only be created from the backend terminal.")


def _normalize_event_duplicate_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip().casefold()


def _event_duplicate_date(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date().isoformat()
    except ValueError:
        match = re.match(r"^(\d{4}-\d{2}-\d{2})", text)
        return match.group(1) if match else _normalize_event_duplicate_text(text)


def _event_duplicate_signature(item: dict[str, Any]) -> tuple[str, str, str] | None:
    title = _normalize_event_duplicate_text(item.get("title"))
    start_date = _event_duplicate_date(item.get("startDate"))
    location_value = item.get("location")
    if isinstance(location_value, dict):
        location_value = (
            location_value.get("address")
            or location_value.get("venue")
            or item.get("locationVenue")
        )
    location = _normalize_event_duplicate_text(location_value)
    if not title or not start_date or not location:
        return None
    return title, start_date, location


def _raise_duplicate_event_error(item: dict[str, Any], existing: dict[str, Any]) -> None:
    title = str(item.get("title") or existing.get("title") or "Untitled event").strip()
    date = _event_duplicate_date(item.get("startDate")) or "the same date"
    location_value = item.get("location")
    if isinstance(location_value, dict):
        location_value = location_value.get("address") or location_value.get("venue")
    location = str(location_value or "the same location").strip()
    raise HTTPException(
        status_code=409,
        detail=(
            f'A matching event already exists: "{title}" on {date} at {location}. '
            "Edit the existing event instead of creating another one."
        ),
    )


def _reject_duplicate_event_writes(
    connection: Any,
    items: list[Any],
) -> None:
    """Reject semantic event duplicates while allowing updates to the same id."""
    existing_by_signature: dict[tuple[str, str, str], dict[str, Any]] = {}
    for existing in get_postgres_hot_storage_collection(connection, "events"):
        if not isinstance(existing, dict):
            continue
        signature = _event_duplicate_signature(existing)
        if signature:
            existing_by_signature.setdefault(signature, existing)

    incoming_by_signature: dict[tuple[str, str, str], dict[str, Any]] = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        signature = _event_duplicate_signature(item)
        if not signature:
            continue
        item_id = str(item.get("id") or "").strip()
        existing = existing_by_signature.get(signature)
        if existing and str(existing.get("id") or "").strip() != item_id:
            _raise_duplicate_event_error(item, existing)
        previous = incoming_by_signature.get(signature)
        if previous and str(previous.get("id") or "").strip() != item_id:
            _raise_duplicate_event_error(item, previous)
        incoming_by_signature[signature] = item


def _normalize_named_duplicate_text(value: Any) -> str:
    """Normalize names for case-insensitive, whitespace-insensitive checks."""
    return re.sub(r"\s+", " ", str(value or "")).strip().casefold()


def _named_duplicate_signature(
    key: str,
    item: dict[str, Any],
) -> tuple[str, str] | None:
    """Return the duplicate-check scope and normalized title for a record."""
    title = _normalize_named_duplicate_text(item.get("title"))
    if not title:
        return None

    if key == "programs":
        # Programs are top-level records. Ignore compatibility rows that may
        # have been copied into this collection as projects or events.
        if item.get("isEvent") or item.get("parentProjectId"):
            return None
        return "program", title

    if key == "projects":
        # A project name is unique within its parent program. An empty parent
        # is one shared top-level scope for projects without a program.
        if item.get("isEvent"):
            return None
        parent_id = _normalize_named_duplicate_text(item.get("parentProjectId"))
        return f"project:{parent_id}", title

    return None


def _raise_duplicate_named_item_error(
    key: str,
    item: dict[str, Any],
    existing: dict[str, Any],
) -> None:
    title = str(item.get("title") or existing.get("title") or "Untitled").strip()
    if key == "programs":
        raise HTTPException(
            status_code=409,
            detail=(
                f'A program named "{title}" already exists. '
                "Choose a different program name or edit the existing program."
            ),
        )

    raise HTTPException(
        status_code=409,
        detail=(
            f'A project named "{title}" already exists in this program. '
            "Choose a different project name or edit the existing project."
        ),
    )


def _reject_duplicate_named_writes(
    connection: Any,
    key: str,
    items: list[Any],
    *,
    replacing_collection: bool = False,
) -> None:
    """Reject duplicate program/project names while allowing same-ID updates."""
    if key not in {"programs", "projects"}:
        return

    incoming_records = [item for item in items if isinstance(item, dict)]
    incoming_ids = {
        str(item.get("id") or "").strip()
        for item in incoming_records
        if str(item.get("id") or "").strip()
    }
    existing_by_signature: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for existing in get_postgres_hot_storage_collection(connection, key):
        if not isinstance(existing, dict):
            continue
        existing_id = str(existing.get("id") or "").strip()
        # A full collection replacement removes IDs omitted from the payload,
        # so those records must not block a valid replacement record.
        if replacing_collection and existing_id not in incoming_ids:
            continue
        signature = _named_duplicate_signature(key, existing)
        if signature:
            existing_by_signature.setdefault(signature, []).append(existing)

    incoming_by_signature: dict[tuple[str, str], dict[str, Any]] = {}
    for item in incoming_records:
        signature = _named_duplicate_signature(key, item)
        if not signature:
            continue
        item_id = str(item.get("id") or "").strip()
        existing_matches = existing_by_signature.get(signature, [])
        if existing_matches and not any(
            str(existing.get("id") or "").strip() == item_id
            for existing in existing_matches
        ):
            _raise_duplicate_named_item_error(key, item, existing_matches[0])

        previous = incoming_by_signature.get(signature)
        if previous and str(previous.get("id") or "").strip() != item_id:
            _raise_duplicate_named_item_error(key, item, previous)
        incoming_by_signature[signature] = item


_MAX_MEDIA_SCAN_BYTES = 15 * 1024 * 1024
_CLAMAV_SCAN_TIMEOUT_SECONDS = 20
_EXECUTABLE_MEDIA_SIGNATURES = (
    (b"MZ", "Windows executable"),
    (b"\x7fELF", "ELF executable"),
    (b"#!", "script"),
)


def _iter_data_uri_media(value: Any, path: str = "upload"):
    """Yield data-URI uploads nested anywhere inside a storage item."""
    if isinstance(value, dict):
        for field_name, nested_value in value.items():
            yield from _iter_data_uri_media(nested_value, f"{path}.{field_name}")
    elif isinstance(value, list):
        for index, nested_value in enumerate(value):
            yield from _iter_data_uri_media(nested_value, f"{path}[{index}]")
    elif isinstance(value, str) and value.lstrip().lower().startswith("data:"):
        yield value.strip(), path


def _security_scan_data_uri(value: str, label: str) -> None:
    """Validate an uploaded data URI and run ClamAV when it is installed."""
    if len(value) > _MAX_MEDIA_SCAN_BYTES * 2:
        raise ValueError(f"The uploaded {label} is too large to scan safely.")

    match = re.match(r"^data:([^,]+),(.*)$", value, flags=re.IGNORECASE | re.DOTALL)
    if not match:
        raise ValueError(f"The uploaded {label} could not be read by the security scanner.")

    metadata = match.group(1)
    encoded_payload = match.group(2)
    mime_type = metadata.split(";", 1)[0].strip().lower()
    try:
        if "base64" in metadata.lower().split(";"):
            payload = base64.b64decode(encoded_payload, validate=True)
        else:
            payload = unquote_to_bytes(encoded_payload)
    except (binascii.Error, ValueError, TypeError) as error:
        raise ValueError(f"The uploaded {label} could not be read by the security scanner.") from error

    if len(payload) > _MAX_MEDIA_SCAN_BYTES:
        raise ValueError(f"The uploaded {label} is too large to scan safely.")

    for signature, signature_name in _EXECUTABLE_MEDIA_SIGNATURES:
        if payload.startswith(signature):
            raise ValueError(f"The uploaded {label} was rejected because it is an unsafe {signature_name}.")

    if mime_type.startswith("image/"):
        try:
            from PIL import Image

            with Image.open(io.BytesIO(payload)) as image:
                image.verify()
        except Exception as error:
            raise ValueError(f"The uploaded {label} is not a valid image file.") from error

    clamscan_path = shutil.which("clamscan")
    require_clamav = os.getenv("MEDIA_SCAN_REQUIRE_CLAMAV", "false").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    if not clamscan_path:
        if require_clamav:
            raise ValueError("The virus scanner is not available. Please contact the administrator.")
        return

    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(prefix="nvc-upload-", suffix=".bin", delete=False) as temporary_file:
            temporary_file.write(payload)
            temporary_path = temporary_file.name

        result = subprocess.run(
            [clamscan_path, "--no-summary", temporary_path],
            capture_output=True,
            text=True,
            timeout=_CLAMAV_SCAN_TIMEOUT_SECONDS,
            check=False,
        )
        if result.returncode == 1:
            raise ValueError(f"The uploaded {label} was rejected by the virus scanner.")
        if result.returncode != 0:
            raise ValueError("The virus scanner could not complete the upload check.")
    except subprocess.TimeoutExpired as error:
        raise ValueError("The virus scanner timed out while checking the upload.") from error
    finally:
        if temporary_path:
            try:
                os.unlink(temporary_path)
            except OSError:
                pass


def _scan_storage_item_media(key: str, item: dict[str, Any]) -> None:
    """Scan all embedded data-URI media before a storage item is persisted."""
    for media_value, path in _iter_data_uri_media(item, key):
        label = path.replace(".", " ").replace("[", " ").replace("]", "")
        _security_scan_data_uri(media_value, label)


# Inserts or updates one hot-storage item row.
def _postgres_upsert_hot_item(connection: Any, key: str, item: dict[str, Any]) -> dict[str, Any]:
    try:
        _require_terminal_admin_provisioning(connection, key, item)
        _scan_storage_item_media(key, item)

        # Automatic compression of oversized images on ingest
        if key in {"projects", "events", "programs"} and isinstance(item.get("imageUrl"), str):
            url = item["imageUrl"]
            if len(url) > 80_000:
                prefix = ""
                if "," in url and ("data:image" in url[:50] or "data:application" in url[:50]):
                    prefix, b64 = url.split(",", 1)
                    prefix += ","
                else:
                    b64 = url
                compressed = compress_base64_image(b64, max_size_bytes=60_000, max_width=800)
                if compressed:
                    item = dict(item)
                    item["imageUrl"] = f"{prefix}{compressed}" if prefix else compressed
        elif key == "users" and isinstance(item.get("profilePhoto"), str):
            # Profile photos are captured as native base64 data URIs. Keep
            # them small enough for mobile writes and directory responses.
            profile_photo = item["profilePhoto"]
            compressed_profile_photo = _compress_image_data_uri(profile_photo)
            if compressed_profile_photo != profile_photo:
                item = dict(item)
                item["profilePhoto"] = compressed_profile_photo
        elif key == "partnerProjectApplications" and isinstance(item.get("proposalDetails"), dict):
            details = item["proposalDetails"]
            attachments = details.get("attachments")
            if isinstance(attachments, list):
                new_attachments = []
                changed = False
                for att in attachments:
                    if isinstance(att, dict):
                        att_url = att.get("url") or att.get("uri") or att.get("data")
                        if isinstance(att_url, str) and len(att_url) > 80_000:
                            prefix = ""
                            if "," in att_url and ("data:image" in att_url[:50] or "data:application" in att_url[:50]):
                                prefix, b64 = att_url.split(",", 1)
                                prefix += ","
                            else:
                                b64 = att_url
                            comp = compress_base64_image(b64, max_size_bytes=60_000, max_width=800)
                            if comp:
                                new_att = dict(att)
                                if "url" in new_att: new_att["url"] = f"{prefix}{comp}" if prefix else comp
                                elif "uri" in new_att: new_att["uri"] = f"{prefix}{comp}" if prefix else comp
                                elif "data" in new_att: new_att["data"] = f"{prefix}{comp}" if prefix else comp
                                new_attachments.append(new_att)
                                changed = True
                            else:
                                new_attachments.append(att)
                        else:
                            new_attachments.append(att)
                    elif isinstance(att, str) and len(att) > 80_000:
                        prefix = ""
                        if "," in att and ("data:image" in att[:50] or "data:application" in att[:50]):
                            prefix, b64 = att.split(",", 1)
                            prefix += ","
                        else:
                            b64 = att
                        comp = compress_base64_image(b64, max_size_bytes=60_000, max_width=800)
                        if comp:
                            new_attachments.append(f"{prefix}{comp}" if prefix else comp)
                            changed = True
                        else:
                            new_attachments.append(att)
                    else:
                        new_attachments.append(att)
                if changed:
                    item = dict(item)
                    item["proposalDetails"] = dict(details, attachments=new_attachments)

        result = upsert_relational_item(connection, key, item)
        _invalidate_collection_cache([key])
        # Only clear snapshot cache for keys that affect the snapshot
        if key in {"projects", "events", "volunteers", "programTracks", "statusUpdates", 
                   "volunteerMatches", "volunteerProjectJoins", "partnerProjectApplications"}:
            _projects_snapshot_cache.clear()
        return result
    except KeyError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


def _postgres_get_project_like_item_by_id(
    connection: Any, item_id: str
) -> tuple[dict[str, Any] | None, str | None]:
    project = _postgres_get_hot_item_by_id(connection, "projects", item_id)
    if project is not None:
        return project, "projects"

    event = _postgres_get_hot_item_by_id(connection, "events", item_id)
    if event is not None:
        return event, "events"

    program = _postgres_get_hot_item_by_id(connection, "programs", item_id)
    if program is not None:
        return program, "programs"

    return None, None


# Finds the volunteer profile tied to a specific user id.
def _postgres_get_volunteer_by_user_id(
    connection: Any,
    user_id: str,
    *,
    include_media: bool = True,
) -> dict[str, Any] | None:
    volunteers = _postgres_get_hot_items_by_field(
        connection,
        "volunteers",
        "userId",
        user_id,
        include_media=include_media,
    )
    return volunteers[0] if volunteers else None


def _get_volunteer_joined_event_scope(
    connection: Any,
    user_id: str,
) -> tuple[set[str], set[str]]:
    """Return the identifiers and event ids a volunteer actually joined.

    Requested/matched records are intentionally excluded. Active and
    Completed join records represent membership, while the participant arrays
    preserve compatibility with older event rows created before join records
    existed.
    """
    normalized_user_id = str(user_id or "").strip()
    volunteer = _postgres_get_volunteer_by_user_id(
        connection,
        normalized_user_id,
        include_media=False,
    )
    volunteer_identifiers = {
        value
        for value in (
            normalized_user_id,
            str((volunteer or {}).get("id") or "").strip(),
            str((volunteer or {}).get("userId") or "").strip(),
        )
        if value
    }
    if not volunteer_identifiers:
        return set(), set()

    joined_event_ids: set[str] = set()
    join_records = get_postgres_hot_storage_collection(connection, "volunteerProjectJoins")
    for record in join_records:
        status = str(record.get("participationStatus") or "Active").strip()
        record_identifiers = {
            str(record.get(field) or "").strip()
            for field in ("volunteerId", "volunteerUserId")
            if str(record.get(field) or "").strip()
        }
        project_id = str(record.get("projectId") or "").strip()
        if status in {"Active", "Completed"} and project_id and record_identifiers & volunteer_identifiers:
            joined_event_ids.add(project_id)

    event_records = (
        get_postgres_hot_storage_collection(connection, "events")
        + get_postgres_hot_storage_collection(connection, "projects")
    )
    known_event_ids = {
        str(event.get("id") or "").strip()
        for event in event_records
        if bool(event.get("isEvent")) and str(event.get("id") or "").strip()
    }
    for event in event_records:
        if not bool(event.get("isEvent")):
            continue
        event_id = str(event.get("id") or "").strip()
        if not event_id:
            continue
        participant_ids = {
            str(value or "").strip()
            for field in ("volunteers", "joinedUserIds")
            for value in (event.get(field) or [])
            if str(value or "").strip()
        }
        if participant_ids & volunteer_identifiers:
            joined_event_ids.add(event_id)

    # A legacy history entry is accepted only when it points to an event; a
    # parent program must never become a report/photo access grant.
    joined_event_ids.update(
        str(project_id or "").strip()
        for project_id in (volunteer or {}).get("pastProjects") or []
        if str(project_id or "").strip() in known_event_ids
    )

    return volunteer_identifiers, joined_event_ids & known_event_ids


def _scope_volunteer_storage_collection(
    connection: Any,
    key: str,
    value: Any,
    session: dict[str, Any],
) -> Any:
    """Prevent volunteer sessions from receiving unrelated report media."""
    if str(session.get("role") or "").strip().lower() != "volunteer":
        return value

    scoped_keys = {
        "partnerReports",
        "publishedImpactReports",
        "volunteerTimeLogs",
        "volunteerProjectJoins",
    }
    if key not in scoped_keys:
        return value

    volunteer_identifiers, joined_event_ids = _get_volunteer_joined_event_scope(
        connection,
        str(session.get("sub") or "").strip(),
    )
    session_user_id = str(session.get("sub") or "").strip()
    items = value if isinstance(value, list) else []

    if key in {"partnerReports", "publishedImpactReports"}:
        return [
            item
            for item in items
            if isinstance(item, dict)
            and str(item.get("projectId") or "").strip() in joined_event_ids
            and session_user_id
            in {
                str(item.get("submitterUserId") or "").strip(),
                str(item.get("submittedBy") or "").strip(),
                str(item.get("partnerUserId") or "").strip(),
            }
        ]

    if key == "volunteerTimeLogs":
        return [
            item
            for item in items
            if isinstance(item, dict)
            and str(item.get("projectId") or "").strip() in joined_event_ids
            and str(item.get("volunteerId") or "").strip() in volunteer_identifiers
        ]

    return [
        item
        for item in items
        if isinstance(item, dict)
        and str(item.get("projectId") or "").strip() in joined_event_ids
        and (
            str(item.get("volunteerId") or "").strip() in volunteer_identifiers
            or str(item.get("volunteerUserId") or "").strip() in volunteer_identifiers
        )
        and str(item.get("participationStatus") or "Active").strip()
        in {"Active", "Completed"}
    ]


def _volunteer_has_time_in_for_project(connection: Any, volunteer_id: str, project_id: str) -> bool:
    time_logs = _postgres_get_volunteer_time_logs(connection, volunteer_id)
    return any(
        str(log.get("projectId") or "").strip() == project_id
        and bool(str(log.get("timeIn") or "").strip())
        for log in time_logs
    )


def _volunteer_is_assigned_to_event_task(
    connection: Any,
    volunteer_id: str,
    project_id: str,
) -> bool:
    project, _ = _postgres_get_project_like_item_by_id(connection, project_id)
    if not project or not bool(project.get("isEvent")):
        return True

    tasks = project.get("internalTasks") or []
    return any(
        str(task.get("assignedVolunteerId") or "").strip() == volunteer_id
        or volunteer_id in [
            str(value or "").strip()
            for value in (task.get("assignedVolunteerIds") or [])
            if str(value or "").strip()
        ]
        for task in tasks
    )


def _volunteer_is_field_officer_for_event(
    connection: Any,
    volunteer_id: str,
    project_id: str,
) -> bool:
    project, _ = _postgres_get_project_like_item_by_id(connection, project_id)
    if not project or not bool(project.get("isEvent")):
        return False

    tasks = project.get("internalTasks") or []
    return any(
        (
            str(task.get("assignedVolunteerId") or "").strip() == volunteer_id
            or volunteer_id in [
                str(value or "").strip()
                for value in (task.get("assignedVolunteerIds") or [])
                if str(value or "").strip()
            ]
        )
        and bool(task.get("isFieldOfficer"))
        for task in tasks
    )


def _user_is_field_officer_for_event(
    connection: Any,
    user_id: str,
    project_id: str,
) -> bool:
    normalized_user_id = str(user_id or "").strip()
    if not normalized_user_id:
        return False

    project, _ = _postgres_get_project_like_item_by_id(connection, project_id)
    if not project or not bool(project.get("isEvent")):
        return False

    tasks = project.get("internalTasks") or []
    for task in tasks:
        if not bool(task.get("isFieldOfficer")):
            continue

        assigned_ids = [
            str(task.get("assignedVolunteerId") or "").strip(),
            *[
                str(value or "").strip()
                for value in (task.get("assignedVolunteerIds") or [])
                if str(value or "").strip()
            ],
        ]
        normalized_assigned_ids = [value for value in assigned_ids if value]
        if normalized_user_id in normalized_assigned_ids:
            return True

        for assigned_id in normalized_assigned_ids:
            volunteer = _postgres_get_hot_item_by_id(connection, "volunteers", assigned_id)
            if volunteer is None:
                continue
            if str(volunteer.get("userId") or "").strip() == normalized_user_id:
                return True

    linked_volunteer = _postgres_get_volunteer_by_user_id(connection, normalized_user_id)
    if linked_volunteer is None:
        return False

    return _volunteer_is_field_officer_for_event(
        connection,
        str(linked_volunteer.get("id") or "").strip(),
        project_id,
    )


# Computes joined-program count and top-volunteer recognition state.
def _postgres_get_volunteer_recognition_status(
    connection: Any,
    volunteer_id: str,
) -> dict[str, Any]:
    volunteer = _postgres_get_hot_item_by_id(connection, "volunteers", volunteer_id)
    if volunteer is None:
        raise HTTPException(status_code=404, detail="Volunteer not found.")

    with connection.cursor() as cursor:
        cursor.execute(
            """
            with joined_projects as (
                select distinct project_id
                from volunteer_event_joins
                where volunteer_id = %s
                  and project_id is not null
                  and project_id <> ''
            ),
            past_projects as (
                select distinct unnest(
                    coalesce(past_projects, '{}'::text[])
                ) as project_id
                from volunteers
                where volunteers_id = %s
            )
            select count(distinct project_id)
            from (
                select project_id from joined_projects
                union
                select project_id from past_projects
            ) all_projects
            """,
            (volunteer_id, volunteer_id),
        )
        row = cursor.fetchone()

    joined_program_count = int(row[0] or 0) if row is not None else 0
    return {
        "joinedProgramCount": joined_program_count,
        "isTopVolunteer": joined_program_count >= TOP_VOLUNTEER_THRESHOLD,
    }


# Returns project applications submitted by one partner user.
def _postgres_get_partner_project_applications_by_user(
    connection: Any,
    partner_user_id: str,
) -> list[dict[str, Any]]:
    applications = _postgres_get_hot_items_by_field(
        connection,
        "partnerProjectApplications",
        "partnerUserId",
        partner_user_id,
    )
    return _sort_iso_desc(applications, "requestedAt")


# Returns all saved time logs for one volunteer profile.
def _postgres_get_volunteer_time_logs(
    connection: Any,
    volunteer_id: str,
    *,
    include_media: bool = True,
) -> list[dict[str, Any]]:
    logs = _postgres_get_hot_items_by_field(
        connection,
        "volunteerTimeLogs",
        "volunteerId",
        volunteer_id,
        include_media=include_media,
    )
    if include_media:
        for log in logs:
            log["attendancePhoto"] = _compress_image_data_uri(log.get("attendancePhoto"))
            log["completionPhoto"] = _compress_image_data_uri(log.get("completionPhoto"))
    return _sort_iso_desc(logs, "timeIn")


def _postgres_reset_stale_daily_time_logs(
    connection: Any,
    volunteer_id: str,
    now: datetime | None = None,
    *,
    include_media: bool = True,
) -> list[dict[str, Any]]:
    return _sort_iso_desc(
        _postgres_get_volunteer_time_logs(
            connection,
            volunteer_id,
            include_media=include_media,
        ),
        "timeIn",
    )


# Ensures a volunteer-project join record exists after approval or assignment.
def _postgres_ensure_volunteer_project_join_record(
    connection: Any,
    project_id: str,
    volunteer: dict[str, Any],
    source: str,
) -> None:
    project, _ = _postgres_get_project_like_item_by_id(connection, project_id)
    if project is None or not bool(project.get("isEvent")):
        return

    existing_records = _postgres_get_hot_items_by_field(
        connection,
        "volunteerProjectJoins",
        "volunteerId",
        volunteer["id"],
    )
    for existing_record in existing_records:
        if existing_record.get("projectId") == project_id:
            return

    record = {
        "id": _stable_short_join_record_id(project_id, str(volunteer["id"])),
        "projectId": project_id,
        "volunteerId": volunteer["id"],
        "volunteerUserId": volunteer.get("userId", ""),
        "volunteerName": volunteer.get("name", ""),
        "volunteerEmail": volunteer.get("email", ""),
        "joinedAt": datetime.now(timezone.utc).isoformat(),
        "source": source,
        "participationStatus": "Active",
    }
    _postgres_upsert_hot_item(connection, "volunteerProjectJoins", record)


# Keeps volunteer engagement status aligned with active project work.
def _postgres_sync_volunteer_engagement_status(
    connection: Any,
    volunteer_id: str,
) -> dict[str, Any] | None:
    volunteer = _postgres_get_hot_item_by_id(connection, "volunteers", volunteer_id)
    if volunteer is None:
        return None

    volunteer_user_id = str(volunteer.get("userId") or "").strip()
    volunteer_identifiers = {str(volunteer_id).strip()}
    if volunteer_user_id:
        volunteer_identifiers.add(volunteer_user_id)
    join_records = [
        record
        for record in get_postgres_hot_storage_collection(connection, "volunteerProjectJoins")
        if str(record.get("volunteerId") or "").strip() in volunteer_identifiers
        or str(record.get("volunteerUserId") or "").strip() in volunteer_identifiers
    ]

    has_active_participation = any(
        (record.get("participationStatus") or "Active") == "Active"
        and bool((_postgres_get_project_like_item_by_id(connection, str(record.get("projectId") or ""))[0] or {}).get("isEvent"))
        for record in join_records
    )

    # A request or match is not an event membership.  Busy is reserved for a
    # volunteer with an active joined-event record.
    next_status = "Busy" if has_active_participation else "Open to Volunteer"
    if volunteer.get("engagementStatus") == next_status:
        return volunteer

    updated_volunteer = {**volunteer, "engagementStatus": next_status}
    return _postgres_upsert_hot_item(connection, "volunteers", updated_volunteer)


# Adds hours from a completed time log into the volunteer profile total.
def _postgres_add_logged_hours_to_volunteer(
    connection: Any,
    volunteer_id: str,
    log: dict[str, Any],
) -> dict[str, Any] | None:
    volunteer = _postgres_get_hot_item_by_id(connection, "volunteers", volunteer_id)
    if volunteer is None:
        return None

    time_out = log.get("timeOut")
    time_in = log.get("timeIn")
    if not time_in or not time_out:
        return volunteer

    duration_hours = max(
        0,
        (datetime.fromisoformat(time_out).timestamp() - datetime.fromisoformat(time_in).timestamp()) / 3600,
    )

    updated_volunteer = {
        **volunteer,
        "totalHoursContributed": round(float(volunteer.get("totalHoursContributed") or 0) + duration_hours, 1),
    }
    return _postgres_upsert_hot_item(connection, "volunteers", updated_volunteer)


def _postgres_mark_volunteer_match_completed(
    connection: Any,
    project_id: str,
    volunteer_id: str,
    completed_by: str,
) -> None:
    matches = _postgres_get_hot_items_by_field(connection, "volunteerMatches", "volunteerId", volunteer_id)
    now_iso = datetime.now(timezone.utc).isoformat()

    for match in matches:
        if str(match.get("projectId") or "") != project_id:
            continue

        if str(match.get("status") or "") == "Completed":
            continue

        _postgres_upsert_hot_item(
            connection,
            "volunteerMatches",
            {
                **match,
                "status": "Completed",
                "reviewedAt": now_iso,
                "reviewedBy": completed_by,
            },
        )


def _postgres_complete_volunteer_participation(
    connection: Any,
    project_id: str,
    volunteer_id: str,
    completed_by: str,
) -> dict[str, Any] | None:
    project, _ = _postgres_get_project_like_item_by_id(connection, project_id)
    if project is None or not bool(project.get("isEvent")):
        return None

    volunteer = _postgres_get_hot_item_by_id(connection, "volunteers", volunteer_id)
    if volunteer is None:
        return None

    _postgres_ensure_volunteer_project_join_record(connection, project_id, volunteer, "VolunteerJoin")
    join_records = _postgres_get_hot_items_by_field(connection, "volunteerProjectJoins", "volunteerId", volunteer_id)
    target_record = next(
        (record for record in join_records if str(record.get("projectId") or "") == project_id),
        None,
    )

    now_iso = datetime.now(timezone.utc).isoformat()
    updated_record: dict[str, Any] | None = None
    if target_record is not None:
        updated_record = {
            **target_record,
            "participationStatus": "Completed",
            "completedAt": now_iso,
            "completedBy": completed_by,
        }
        _postgres_upsert_hot_item(connection, "volunteerProjectJoins", updated_record)

    _postgres_mark_volunteer_match_completed(connection, project_id, volunteer_id, completed_by)

    past_projects = [
        str(item).strip()
        for item in (volunteer.get("pastProjects") or [])
        if str(item).strip()
    ]
    if project_id not in past_projects:
        _postgres_upsert_hot_item(
            connection,
            "volunteers",
            {
                **volunteer,
                "pastProjects": [*past_projects, project_id],
            },
        )

    _postgres_sync_volunteer_engagement_status(connection, volunteer_id)
    return updated_record


# Normalizes optional snapshot field filters from query strings.
def _normalize_snapshot_fields(raw_fields: str | None) -> set[str] | None:
    if not raw_fields:
        return None

    alias_map = {
        "partnerProjectApplications": "partnerApplications",
        "volunteerProjectJoins": "volunteerJoinRecords",
        "volunteerTimeLogs": "timeLogs",
        "programCatalog": "programTracks",
    }
    normalized_fields: set[str] = set()
    for raw_field in raw_fields.split(","):
        field = raw_field.strip()
        if not field:
            continue
        normalized_fields.add(alias_map.get(field, field))

    return normalized_fields or None


# Builds the project snapshot payload consumed by frontend project screens.
# OPTIMIZED: Selective loading to minimize egress while ensuring data availability.
# Core collections fetched immediately, supplemental data can be loaded on-demand.
def _build_projects_snapshot(
    connection: Any,
    user_id: str | None,
    role: str | None,
    requested_fields: set[str] | None = None,
    include_images: bool = False,
) -> dict[str, Any]:
    import time as _time
    t0 = _time.perf_counter()
    _trace(f"[TRACE] _build_projects_snapshot: starting optimized hot storage reads at {_time.perf_counter():.3f}")

    includes = requested_fields if requested_fields is not None else _DEFAULT_SNAPSHOT_FIELDS
    include_projects = "projects" in includes
    include_programs = "programs" in includes
    include_status_updates = "statusUpdates" in includes
    include_program_tracks = "programTracks" in includes
    include_volunteer_profile = "volunteerProfile" in includes
    include_volunteer_matches = "volunteerMatches" in includes
    include_time_logs = "timeLogs" in includes
    include_partner_applications = "partnerApplications" in includes
    include_join_records = "volunteerJoinRecords" in includes

    raw_projects: list[dict[str, Any]] = []
    raw_events: list[dict[str, Any]] = []
    raw_status_updates: list[dict[str, Any]] = []
    raw_program_tracks: list[dict[str, Any]] = []
    raw_programs_table: list[dict[str, Any]] = []

    # CORE LOAD: Only fetch the collections requested by the screen.
    if include_projects or include_join_records:
        try:
            raw_projects = _get_cached_media_light_collection(
                connection, "projects", include_images=include_images
            )
        except Exception as e:
            print(f"[ERROR] Failed to fetch projects: {type(e).__name__}: {e}", flush=True)
            raw_projects = []
        
        try:
            raw_events = _get_cached_media_light_collection(
                connection, "events", include_images=include_images
            )
        except Exception as e:
            print(f"[ERROR] Failed to fetch events: {type(e).__name__}: {e}", flush=True)
            raw_events = []

    if include_status_updates:
        try:
            raw_status_updates = _get_cached_collection(connection, "statusUpdates")
        except Exception as e:
            print(f"[ERROR] Failed to fetch statusUpdates: {type(e).__name__}: {e}", flush=True)
            raw_status_updates = []

    # Fetch programs table if needed for projects, program rows, or programTrack compatibility.
    if include_projects or include_programs or include_program_tracks:
        try:
            raw_programs_table = _get_cached_media_light_collection(
                connection, "programs", include_images=include_images
            ) or []
        except Exception as e:
            print(f"[ERROR] Failed to fetch programs: {type(e).__name__}: {e}", flush=True)
            raw_programs_table = []

    if include_program_tracks:
        # Convert programs table records to ProgramTrack format
        # Filter for top-level programs only (no parentProjectId, not events)
        for p in raw_programs_table:
            p_id = str(p.get("id") or "").strip()
            # Only include top-level programs (not sub-projects or events)
            if p_id and not p.get("parentProjectId") and not p.get("isEvent"):
                # Convert Project format to ProgramTrack format
                program_track = {
                    "id": p_id,
                    "title": p.get("title", ""),
                    "description": p.get("description", ""),
                    "icon": p.get("icon", "folder"),
                    "color": p.get("color", "#666666"),
                    "imageUrl": p.get("imageUrl", ""),
                    "sortOrder": 0,
                    "isActive": True,
                    "createdAt": p.get("createdAt"),
                    "updatedAt": p.get("updatedAt"),
                }
                raw_program_tracks.append(program_track)

    _trace(f"[TRACE] _build_projects_snapshot: read core collections after {_time.perf_counter() - t0:.3f}s")
    t1 = _time.perf_counter()

    # Create a set of event project IDs for O(1) lookup when needed.
    event_project_ids = (
        {event.get("id") for event in raw_events if event.get("isEvent")}
        if include_join_records
        else set()
    )

    projects: list[dict[str, Any]] = []
    if include_projects:
        # Include programs from the projects table
        programs_from_projects_table = [project for project in raw_projects if not bool(project.get("isEvent"))]
        # Include programs from the programs table (top-level programs, not events, not sub-projects)
        programs_from_programs_table = [p for p in raw_programs_table if not bool(p.get("isEvent")) and not p.get("parentProjectId")]
        projects = [*programs_from_projects_table, *programs_from_programs_table, *raw_events]
        partner_applications_for_parent_repair = _get_partner_application_parent_repair_records(connection)
        projects = _attach_proposal_parent_project_ids(projects, partner_applications_for_parent_repair)

    _trace(f"[TRACE] _build_projects_snapshot: processed projects after {_time.perf_counter() - t1:.3f}s")

    # Build snapshot with core data
    snapshot: dict[str, Any] = {
        "projects": projects,
        "programs": [
            program
            for program in raw_programs_table
            if not bool(program.get("isEvent")) and not program.get("parentProjectId")
        ],
        "programTracks": sorted(
            raw_program_tracks,
            key=lambda item: (_to_int(item.get("sortOrder")), str(item.get("title") or str(item.get("id") or ""))),
        ),
        "statusUpdates": raw_status_updates,
        "volunteerProfile": None,
        "volunteerMatches": [],
        "timeLogs": [],
        "partnerApplications": [],
        "volunteerJoinRecords": [],
    }

    if not user_id or not role:
        return snapshot

    if role == "volunteer":
        if not any(
            (
                include_volunteer_profile,
                include_volunteer_matches,
                include_time_logs,
                include_join_records,
            )
        ):
            return snapshot

        volunteer = _postgres_get_volunteer_by_user_id(
            connection,
            user_id,
            include_media=include_images,
        )
        if include_volunteer_profile:
            snapshot["volunteerProfile"] = (
                volunteer
                if include_images
                else _strip_lightweight_media("volunteers", volunteer)
            )
        if volunteer is not None:
            if include_volunteer_matches:
                snapshot["volunteerMatches"] = _sort_iso_desc(
                    _postgres_get_hot_items_by_field(
                        connection,
                        "volunteerMatches",
                        "volunteerId",
                        volunteer["id"],
                    ),
                    "matchedAt",
                )
            if include_time_logs:
                time_logs = _postgres_reset_stale_daily_time_logs(
                    connection,
                    volunteer["id"],
                    include_media=include_images,
                )
                snapshot["timeLogs"] = (
                    time_logs
                    if include_images
                    else _strip_lightweight_media("volunteerTimeLogs", time_logs)
                )
            if include_join_records:
                volunteer_join_records = _postgres_get_hot_items_by_field(
                    connection,
                    "volunteerProjectJoins",
                    "volunteerId",
                    volunteer["id"],
                )
                snapshot["volunteerJoinRecords"] = _sort_iso_desc(
                    [
                        record
                        for record in volunteer_join_records
                        if record.get("projectId") in event_project_ids
                    ],
                    "joinedAt",
                )
        return snapshot

    if role == "partner" and include_partner_applications:
        snapshot["partnerApplications"] = _postgres_get_partner_project_applications_by_user(connection, user_id)
    elif role == "admin":
        if include_partner_applications:
            snapshot["partnerApplications"] = _sort_iso_desc(
                get_postgres_hot_storage_collection(connection, "partnerProjectApplications"),
                "requestedAt",
            )
        # Admin users should see ALL volunteer join records for the mapping view
        if include_join_records:
            all_join_records = get_postgres_hot_storage_collection(connection, "volunteerProjectJoins")
            snapshot["volunteerJoinRecords"] = _sort_iso_desc(
                [
                    record
                    for record in all_join_records
                    if record.get("projectId") in event_project_ids
                ],
                "joinedAt",
            )

    return snapshot


def _reconcile_event_volunteer_arrays(connection: Any) -> None:
    """Backfill event.volunteers[] and event.joinedUserIds[] from volunteerProjectJoins.

    This fixes events that have join records in volunteerProjectJoins but whose
    volunteers/joinedUserIds arrays were never updated (e.g. seeded records or
    records created via older code paths).
    """
    try:
        join_records = get_postgres_hot_storage_collection(connection, "volunteerProjectJoins")
        if not join_records:
            return

        # Build a map: projectId -> {volunteer_ids, user_ids}
        from collections import defaultdict
        project_volunteer_ids: dict[str, set] = defaultdict(set)
        project_user_ids: dict[str, set] = defaultdict(set)
        for record in join_records:
            pid = str(record.get("projectId") or "").strip()
            vid = str(record.get("volunteerId") or "").strip()
            uid = str(record.get("volunteerUserId") or "").strip()
            if pid and vid:
                project_volunteer_ids[pid].add(vid)
            if pid and uid:
                project_user_ids[pid].add(uid)

        changed_keys: list[str] = []
        for storage_key in ("events", "projects"):
            items = get_postgres_hot_storage_collection(connection, storage_key)
            updated = False
            for item in items:
                if not bool(item.get("isEvent")):
                    continue
                pid = str(item.get("id") or "").strip()
                if pid not in project_volunteer_ids:
                    continue

                existing_vids = set(item.get("volunteers") or [])
                existing_uids = set(item.get("joinedUserIds") or [])
                new_vids = project_volunteer_ids[pid]
                new_uids = project_user_ids[pid]

                if new_vids.issubset(existing_vids) and new_uids.issubset(existing_uids):
                    continue  # already in sync

                merged_vids = sorted(existing_vids | new_vids)
                merged_uids = sorted(existing_uids | new_uids)
                _postgres_upsert_hot_item(
                    connection,
                    storage_key,
                    {**item, "volunteers": merged_vids, "joinedUserIds": merged_uids},
                )
                updated = True

            if updated:
                changed_keys.append(storage_key)

        if changed_keys:
            connection.commit()
            _invalidate_collection_cache(changed_keys)
            print(f"[OK] Reconciled event volunteer arrays for: {changed_keys}")
        else:
            print("[OK] Event volunteer arrays already in sync.")
    except Exception as error:
        print(f"[WARN] Event volunteer array reconciliation skipped: {type(error).__name__}: {error}")


def _reconcile_tasks_against_existing_volunteers(connection: Any) -> None:
    """Cleans up deleted/orphan volunteer IDs from internalTasks across events and projects."""
    try:
        volunteers = get_postgres_hot_storage_collection(connection, "volunteers") or []
        users = get_postgres_hot_storage_collection(connection, "users") or []

        valid_vol_ids = {str(v.get("id") or "").strip() for v in volunteers if str(v.get("id") or "").strip()}
        valid_user_ids = {str(v.get("userId") or "").strip() for v in volunteers if str(v.get("userId") or "").strip()}
        valid_user_ids.update({str(u.get("id") or "").strip() for u in users if str(u.get("id") or "").strip()})

        vol_name_map = {
            str(v.get("id") or "").strip(): str(v.get("name") or "").strip()
            for v in volunteers
            if str(v.get("id") or "").strip()
        }
        for v in volunteers:
            uid = str(v.get("userId") or "").strip()
            if uid and uid not in vol_name_map:
                vol_name_map[uid] = str(v.get("name") or "").strip()

        changed_keys: list[str] = []
        for storage_key in ("events", "projects"):
            items = get_postgres_hot_storage_collection(connection, storage_key) or []
            updated = False
            for item in items:
                tasks = item.get("internalTasks") or []
                if not tasks or not isinstance(tasks, list):
                    continue

                tasks_changed = False
                cleaned_tasks = []
                for task in tasks:
                    if not isinstance(task, dict):
                        cleaned_tasks.append(task)
                        continue

                    task_copy = dict(task)
                    raw_assigned_ids = list(task_copy.get("assignedVolunteerIds") or [])
                    single_assigned_id = str(task_copy.get("assignedVolunteerId") or "").strip()

                    all_ids = []
                    if single_assigned_id:
                        all_ids.append(single_assigned_id)
                    for aid in raw_assigned_ids:
                        aid_str = str(aid or "").strip()
                        if aid_str and aid_str not in all_ids:
                            all_ids.append(aid_str)

                    # Filter to only existing valid volunteer/user IDs
                    valid_assigned_ids = [
                        aid for aid in all_ids
                        if aid in valid_vol_ids or aid in valid_user_ids
                    ]

                    # Filter assignedVolunteerNames
                    valid_assigned_names = [
                        vol_name_map.get(aid) or aid
                        for aid in valid_assigned_ids
                    ]

                    if len(valid_assigned_ids) != len(all_ids) or set(raw_assigned_ids) != set(valid_assigned_ids):
                        task_copy["assignedVolunteerIds"] = valid_assigned_ids
                        task_copy["assignedVolunteerNames"] = valid_assigned_names
                        task_copy["assignedVolunteerId"] = valid_assigned_ids[0] if valid_assigned_ids else None
                        task_copy["assignedVolunteerName"] = valid_assigned_names[0] if valid_assigned_names else None
                        if not valid_assigned_ids:
                            task_copy["status"] = "Planned"
                        tasks_changed = True

                    cleaned_tasks.append(task_copy)

                if tasks_changed:
                    _postgres_upsert_hot_item(
                        connection,
                        storage_key,
                        {**item, "internalTasks": cleaned_tasks},
                    )
                    updated = True

            if updated:
                changed_keys.append(storage_key)

        if changed_keys:
            connection.commit()
            _invalidate_collection_cache(changed_keys)
            print(f"[OK] Reconciled tasks against existing volunteers for: {changed_keys}")
    except Exception as error:
        print(f"[WARN] Task volunteer reconciliation skipped: {type(error).__name__}: {error}")


def _ensure_core_programs_exist() -> None:
    """Core programs initialization disabled - programs are now created manually by admins."""
    pass


@app.on_event("startup")
# Prepares storage tables when the FastAPI app starts.
def startup() -> None:
    # Keep startup non-blocking. Supabase schema maintenance can occasionally
    # take longer than the browser request timeout, so do it after Uvicorn is
    # already listening.
    def _initialize_postgres_background() -> None:
        try:
            init_postgres_pool()
        except Exception as error:
            print(f"[WARN] Postgres pool initialization skipped: {error}")

        try:
            with get_connection() as connection:
                _ensure_notification_reads_table(connection)
                _ensure_registration_otp_table(connection)
                _ensure_password_reset_otp_table(connection)
                ensure_volunteer_time_logs_table_shape(connection)
                _ensure_reminder_tables(connection)
                connection.commit()
            print("[OK] Notification read-state, email OTP, volunteer time logs, and integration schemas ensured.")
        except Exception as error:
            print(f"[WARN] Schema ensure skipped: {error}")

        # Ensure message tables and indexes exist at startup
        try:
            ensure_message_storage_once()
            print("[OK] Message storage indexes ensured.")
        except Exception as error:
            print(f"[WARN] Message storage ensure skipped: {error}")

        try:
            ensure_project_group_message_storage()
            print("[OK] Group message storage indexes ensured.")
        except Exception as error:
            print(f"[WARN] Group message storage ensure skipped: {error}")

        # Reconcile event volunteer arrays from join records (fixes stale/seeded data)
        try:
            with get_connection() as connection:
                _reconcile_event_volunteer_arrays(connection)
                _reconcile_tasks_against_existing_volunteers(connection)
        except Exception as error:
            print(f"[WARN] Event volunteer reconciliation skipped: {error}")

        # Ensure core programs exist
        try:
            _ensure_core_programs_exist()
        except Exception as error:
            print(f"[WARN] Core programs initialization skipped: {error}")

    threading.Thread(target=_initialize_postgres_background, daemon=True).start()
    _start_event_reminder_scheduler()

    # Auto-cleanup: Compress oversized base64 images to prevent slow API responses
    # TEMPORARILY DISABLED - was causing backend to hang on startup
    # def _cleanup_oversized_images() -> None:
    #     try:
    #         with get_connection() as connection:
    #             MAX_IMAGE_URL_LEN = 200_000  # ~150KB as base64
    #             for key in ("projects", "events"):
    #                 items = get_postgres_hot_storage_collection(connection, key)
    #                 changed = False
    #                 for item in items:
    #                     url = item.get("imageUrl")
    #                     if isinstance(url, str) and len(url) > MAX_IMAGE_URL_LEN:
    #                         original_size = get_image_size_kb(url)
    #                         compressed = compress_base64_image(url)
    #                         if compressed:
    #                             compressed_size = get_image_size_kb(compressed)
    #                             print(f"[CLEANUP] {key}/{item.get('id')}: Compressed image {original_size:.1f}KB → {compressed_size:.1f}KB")
    #                             item["imageUrl"] = compressed
    #                             changed = True
    #                         else:
    #                             print(f"[CLEANUP] {key}/{item.get('id')}: Could not compress, removing oversized image ({original_size:.1f}KB)")
    #                             item["imageUrl"] = None
    #                             changed = True
    #                 if changed:
    #                     replace_postgres_hot_storage_collection(connection, key, items)
    #                     connection.commit()
    #                     print(f"[CLEANUP] ✓ Updated {key} collection")
    #     except Exception as error:
    #         print(f"[WARN] Image cleanup failed: {error}")

    # Run cleanup before warming cache
    # threading.Thread(target=_cleanup_oversized_images, daemon=True).start()

    # Warm the most frequently used snapshot cache in the background so first client load is faster.
    def _warm_projects_snapshot_cache() -> None:
        try:
            with get_connection() as connection:
                full_snapshot = _build_projects_snapshot(connection, None, None, None, True)
                _projects_snapshot_cache.set("snapshot:images-v4:None:None:*:1", full_snapshot)
                _projects_snapshot_cache.set(
                    "snapshot:images-v4:None:None:projects:0",
                    _build_projects_snapshot(connection, None, None, {"projects"}, False),
                )
                lightweight_snapshot = _build_projects_snapshot(
                    connection,
                    None,
                    None,
                    {"projects", "statusUpdates"},
                    False,
                )
                _projects_snapshot_cache.set(
                    "snapshot:images-v4:None:None:projects,statusUpdates:0",
                    {
                        "projects": lightweight_snapshot.get("projects", []),
                        "statusUpdates": lightweight_snapshot.get("statusUpdates", []),
                        "volunteerProfile": None,
                        "volunteerMatches": [],
                        "timeLogs": [],
                        "partnerApplications": [],
                        "volunteerJoinRecords": [],
                    },
                )
                print("[OK] Warmed projects snapshot cache.")

                # Pre-warm admin dashboard collections in parallel. Each
                # worker gets its own connection so the first dashboard load
                # does not wait for eleven sequential collection queries.
                def _warm_dashboard_key(key: str) -> tuple[str, Any]:
                    try:
                        with get_connection() as dashboard_connection:
                            return key, _get_admin_dashboard_collection(
                                dashboard_connection,
                                key,
                                include_images=False,
                            )
                    except Exception:
                        return key, []

                items: dict[str, Any] = {}
                with ThreadPoolExecutor(
                    # The project snapshot above still owns the warm-up
                    # connection, so leave one pool slot available.
                    max_workers=min(len(_ADMIN_DASHBOARD_KEYS), 9)
                ) as executor:
                    futures = {
                        executor.submit(_warm_dashboard_key, key): key
                        for key in _ADMIN_DASHBOARD_KEYS
                    }
                    for future in as_completed(futures):
                        key, value = future.result()
                        items[key] = value
                _admin_dashboard_cache.set(_ADMIN_DASHBOARD_CACHE_KEY, {"items": items})
                print("[OK] Warmed admin dashboard snapshot cache.")
        except Exception as error:
            print(f"[WARN] Cache warmup skipped: {error}")

    # Run warmup in a background thread to avoid blocking server startup
    threading.Thread(target=_warm_projects_snapshot_cache, daemon=True).start()
    print("[INFO] Cache warming enabled - warming snapshots in the background")




@app.get("/health", response_model=None)
# Returns a lightweight service summary.
def health():
    configured_mode = get_configured_db_mode()
    timestamp = datetime.now(timezone.utc).isoformat()

    if configured_mode != "postgres":
        return JSONResponse(
            status_code=503,
            content={
                "status": "error",
                "configured_mode": configured_mode,
                "detail": "Supabase Postgres is not configured for this backend.",
                "timestamp": timestamp,
            },
        )

    # This endpoint is used by startup scripts and frontend readiness checks.
    # Keep it process-local; /db-health performs the live database probe.
    return {
        "status": "ok",
        "configured_mode": configured_mode,
        "mode": "postgres",
        "timestamp": timestamp,
    }


@app.get("/db-health", response_model=None)
# Returns only non-sensitive database status for readiness checks.
def db_health(force: bool = False):
    configured_mode = get_configured_db_mode()
    available, error = get_postgres_status(force_refresh=force)
    timestamp = datetime.now(timezone.utc).isoformat()

    status_code = 200 if available else 503
    payload = {
        "status": "ok" if available else "error",
        "configured_mode": configured_mode,
        "mode": get_db_mode(),
        "available": available,
        # Never return database URLs, usernames, passwords, candidate hosts,
        # or raw driver errors from a public readiness endpoint.
        "error": "Database unavailable." if not available else None,
        "timestamp": timestamp,
    }

    return JSONResponse(status_code=status_code, content=payload)


@app.post("/admin/reminders/run")
def run_reminders_now() -> dict[str, Any]:
    return run_event_reminder_check()


# Returns the email username part when an identifier is not a full email or phone.
def _get_email_username_alias(identifier: str) -> str:
    normalized_identifier = str(identifier or "").strip().lower()
    if not normalized_identifier or "@" in normalized_identifier:
        return ""

    phone_like_identifier = (
        normalized_identifier
        .replace("+", "")
        .replace("-", "")
        .replace("(", "")
        .replace(")", "")
        .replace(" ", "")
    )
    if phone_like_identifier.isdigit():
        return ""

    return normalized_identifier


def _get_identifier_error_message(identifier: str) -> str:
    return "User not found"


# Verifies a Google ID token through Google's token introspection endpoint.
def _verify_google_id_token(id_token: str) -> dict[str, Any]:
    normalized_token = str(id_token or "").strip()
    if not normalized_token:
        raise HTTPException(status_code=401, detail="Google sign-in did not return a valid identity token.")

    token_info_url = "https://oauth2.googleapis.com/tokeninfo?" + urlencode({"id_token": normalized_token})
    request = Request(
        token_info_url,
        headers={
            "Accept": "application/json",
            "User-Agent": "NVC-Connect/1.0",
        },
    )

    try:
        with urlopen(request, timeout=10) as response:
            token_info = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, ValueError, json.JSONDecodeError) as error:
        print(f"[WARN] Google ID token verification failed: {type(error).__name__}: {error}")
        raise HTTPException(status_code=401, detail="Google sign-in could not be verified. Please try again.") from error

    if not isinstance(token_info, dict):
        raise HTTPException(status_code=401, detail="Google sign-in could not be verified. Please try again.")

    issuer = str(token_info.get("iss") or "").strip()
    if issuer not in {"accounts.google.com", "https://accounts.google.com"}:
        raise HTTPException(status_code=401, detail="Google sign-in could not be verified. Please try again.")

    email = str(token_info.get("email") or "").strip().lower()
    email_verified = str(token_info.get("email_verified") or "").strip().lower() == "true"
    if not email or not email_verified:
        raise HTTPException(status_code=401, detail="Your Google email must be verified before signing in.")

    try:
        expires_at = int(str(token_info.get("exp") or "0"))
    except (TypeError, ValueError):
        expires_at = 0
    if expires_at <= int(time.time()):
        raise HTTPException(status_code=401, detail="Your Google sign-in session has expired. Please try again.")

    configured_client_ids = {
        value.strip()
        for value in str(os.getenv("GOOGLE_OAUTH_CLIENT_IDS") or "").split(",")
        if value.strip()
    }
    token_audience = str(token_info.get("aud") or "").strip()
    if configured_client_ids and token_audience not in configured_client_ids:
        raise HTTPException(status_code=401, detail="This Google sign-in client is not authorized for NVC Connect.")

    return token_info


# Finds a user by email, email username alias, or normalized phone identifier.
def _get_user_by_identifier(identifier: str, connection: Any | None = None) -> dict[str, Any] | None:
    normalized_identifier = identifier.strip().lower()
    username_alias = _get_email_username_alias(identifier)
    comparable_phone = normalize_comparable_phone(identifier)
    raw_digits = "".join(character for character in str(identifier or "") if character.isdigit())
    _require_postgres()

    def query_user(active_connection: Any) -> dict[str, Any] | None:
        with active_connection.cursor() as cursor:
            cursor.execute(
                """
                select users_id
                from users
                where lower(coalesce(email, '')) = %s
                   or split_part(lower(coalesce(email, '')), '@', 1) = %s
                   or (%s <> '' and regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') = %s)
                   or (%s <> '' and regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') = %s)
                order by created_at asc nulls last, users_id asc
                """,
                (
                    normalized_identifier,
                    username_alias,
                    comparable_phone,
                    comparable_phone,
                    raw_digits,
                    raw_digits,
                ),
            )
            row = cursor.fetchone()
        if row is None:
            return None
        # Authentication is the only backend path that needs the stored hash.
        # It is never returned by the normal user/storage APIs.
        return _postgres_get_hot_item_by_id(
            active_connection,
            "users",
            row[0],
            include_password=True,
        )

    if connection is not None:
        return query_user(connection)

    with get_connection() as active_connection:
        return query_user(active_connection)


# Retrieves a user by their ID.
def _get_user_by_id(user_id: str, connection: Any) -> dict[str, Any] | None:
    _require_postgres()
    return _postgres_get_hot_item_by_id(connection, "users", user_id)


def _resolve_admin_message_user_id(connection: Any, preferred_user_id: str | None = None) -> str:
    preferred_id = str(preferred_user_id or "").strip()
    if preferred_id:
        preferred_user = _get_user_by_id(preferred_id, connection)
        if preferred_user and str(preferred_user.get("role") or "") == "admin":
            return preferred_id

    with connection.cursor() as cursor:
        cursor.execute(
            """
            select users_id
            from users
            where role = 'admin'
            order by
              case
                when lower(trim(coalesce(name, ''))) = 'nvc administrator' then 0
                when lower(trim(coalesce(name, ''))) not in ('nvc', 'nvc admin account')
                  and lower(trim(coalesce(email, ''))) not in ('nvc@gmail.com', 'admin@nvc.org') then 1
                else 2
              end,
              created_at desc nulls last,
              users_id asc
            limit 1
            """
        )
        row = cursor.fetchone()

    if row is not None and row[0]:
        return str(row[0])

    return preferred_id or "user-1788285740560"


def _migrate_legacy_admin_messages() -> None:
    """Move messages from the retired NVC admin identity to NVC Administrator.

    The old account remains available for historical audit references, but it
    must no longer create a separate direct-message conversation. This update
    is idempotent and runs once when direct-message storage is initialized.
    """
    with get_connection() as connection:
        canonical_admin_id = _resolve_admin_message_user_id(connection)
        if not canonical_admin_id:
            return

        with connection.cursor() as cursor:
            cursor.execute(
                """
                select users_id
                from users
                where role = 'admin'
                  and users_id <> %s
                  and (
                    lower(trim(coalesce(name, ''))) in ('nvc', 'nvc admin account')
                    or lower(trim(coalesce(email, ''))) in ('nvc@gmail.com', 'admin@nvc.org')
                  )
                """,
                (canonical_admin_id,),
            )
            legacy_admin_ids = [str(row[0]) for row in cursor.fetchall() if row and row[0]]
            if not legacy_admin_ids:
                return

            cursor.execute(
                """
                update public.messages
                set sender_id = %s
                where sender_id = any(%s)
                """,
                (canonical_admin_id, legacy_admin_ids),
            )
            moved_from_sender = cursor.rowcount
            cursor.execute(
                """
                update public.messages
                set recipient_id = %s
                where recipient_id = any(%s)
                """,
                (canonical_admin_id, legacy_admin_ids),
            )
            moved_from_recipient = cursor.rowcount
        connection.commit()

    _message_query_cache.clear()
    if moved_from_sender or moved_from_recipient:
        print(
            f"[MESSAGES] Migrated {moved_from_sender + moved_from_recipient} "
            f"legacy NVC admin message participant reference(s) to {canonical_admin_id}."
        )


_PROPOSAL_CARD_PREFIX = "___PROPOSAL_CARD___:"


async def _create_proposal_submission_message(
    application: dict[str, Any],
    sender_id: str,
) -> None:
    """Persist and publish a proposal card without blocking the submit response."""
    def persist_message() -> dict[str, Any]:
        ensure_message_storage_once()
        from uuid import uuid4

        proposal_message_id = f"msg-proposal-{uuid4()}"
        proposal_timestamp = datetime.now(timezone.utc).isoformat()
        proposal_content = f"{_PROPOSAL_CARD_PREFIX}{json.dumps(application)}"

        with get_connection() as connection:
            admin_id = _resolve_admin_message_user_id(connection)
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO public.messages (
                      messages_id, sender_id, recipient_id, project_id, content, timestamp, read, attachments
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        proposal_message_id,
                        sender_id,
                        admin_id,
                        None,
                        proposal_content,
                        proposal_timestamp,
                        False,
                        json.dumps([]),
                    ),
                )
            connection.commit()

        return {
            "id": proposal_message_id,
            "senderId": sender_id,
            "recipientId": admin_id,
            "projectId": None,
            "content": proposal_content,
            "timestamp": proposal_timestamp,
            "read": False,
            "attachments": [],
        }

    try:
        message_data = await asyncio.to_thread(persist_message)
        _invalidate_collection_cache(["messages"])
        await connection_manager.broadcast_message_event(message_data)
    except Exception as error:
        print(f"[ERROR] Error creating proposal message: {error}")


def _proposal_card_payload(content: Any) -> dict[str, Any] | None:
    raw_content = str(content or "")
    if not raw_content.startswith(_PROPOSAL_CARD_PREFIX):
        return None
    try:
        payload = json.loads(raw_content[len(_PROPOSAL_CARD_PREFIX) :])
    except (TypeError, ValueError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def _proposal_card_application_id(card: dict[str, Any]) -> str:
    nested_application = card.get("application")
    return str(
        card.get("applicationId")
        or card.get("id")
        or (nested_application.get("id") if isinstance(nested_application, dict) else "")
        or ""
    ).strip()


def _proposal_card_message_timestamp(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return datetime.min.replace(tzinfo=timezone.utc)


def _reconcile_partner_proposal_submission_cards(
    connection: Any, application_id: str | None = None
) -> int:
    """Finalize proposal submission cards that already have a review-result card."""
    from psycopg.rows import dict_row

    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """
            select messages_id, sender_id, recipient_id, content, timestamp
            from public.messages
            where content like '___PROPOSAL_CARD___:%%'
            order by timestamp asc, messages_id asc
            """
        )
        rows = cursor.fetchall()

        parsed_rows: list[dict[str, Any]] = []
        for row in rows:
            card = _proposal_card_payload(row.get("content"))
            if card is None:
                continue
            card_application_id = _proposal_card_application_id(card)
            if not card_application_id or (application_id and card_application_id != application_id):
                continue
            parsed_rows.append({**row, "card": card, "application_id": card_application_id})

        submission_rows = [
            row for row in parsed_rows if not str(row["messages_id"]).startswith("review-card-")
        ]
        review_rows = [
            row
            for row in parsed_rows
            if str(row["messages_id"]).startswith("review-card-")
            and str(row["card"].get("status") or "") in {"Approved", "Rejected"}
        ]

        reconciled = 0
        canonical_admin_id = _resolve_admin_message_user_id(connection)
        assigned_submission_ids: set[str] = set()
        for review_row in sorted(
            review_rows, key=lambda row: _proposal_card_message_timestamp(row.get("timestamp"))
        ):
            review_card = review_row["card"]
            review_timestamp = _proposal_card_message_timestamp(review_row.get("timestamp"))
            review_sender_id = str(review_row.get("sender_id") or "")
            expected_admin_ids = {review_sender_id, canonical_admin_id}
            candidates = [
                row
                for row in submission_rows
                if row["application_id"] == review_row["application_id"]
                and str(row["messages_id"]) not in assigned_submission_ids
                and str(row.get("sender_id") or "") == str(review_row.get("recipient_id") or "")
                and str(row.get("recipient_id") or "") in expected_admin_ids
                and _proposal_card_message_timestamp(row.get("timestamp")) <= review_timestamp
            ]
            if not candidates:
                continue

            # A legacy client could emit a duplicate card after a submission.
            # Prefer the canonical API-generated submission, then the newest
            # eligible message, and never assign one submission to two reviews.
            submission_row = max(
                candidates,
                key=lambda row: (
                    str(row["messages_id"]).startswith("msg-proposal-"),
                    _proposal_card_message_timestamp(row.get("timestamp")),
                ),
            )
            submission_card = submission_row["card"]
            reconciled_card = {
                **submission_card,
                "status": review_card["status"],
                "reviewedBy": review_card.get("reviewedBy"),
                "reviewedAt": review_card.get("reviewedAt") or review_timestamp.isoformat(),
                "reviewNotes": review_card.get("reviewNotes"),
            }
            if review_card.get("approvedProjectId"):
                reconciled_card["approvedProjectId"] = review_card["approvedProjectId"]
            if review_card.get("approvedProjectTitle"):
                reconciled_card["approvedProjectTitle"] = review_card["approvedProjectTitle"]

            cursor.execute(
                "update public.messages set content = %s where messages_id = %s",
                (
                    f"{_PROPOSAL_CARD_PREFIX}{json.dumps(reconciled_card)}",
                    submission_row["messages_id"],
                ),
            )
            submission_row["card"] = reconciled_card
            assigned_submission_ids.add(str(submission_row["messages_id"]))
            reconciled += 1

    return reconciled


# Retrieves all users from storage.
def _get_all_users_from_storage(connection: Any) -> list[dict[str, Any]]:
    _require_postgres()
    return get_postgres_hot_storage_collection(connection, "users")


# Saves a user to storage.
def _save_user_to_storage(user: dict[str, Any], connection: Any) -> None:
    _require_postgres()
    _postgres_upsert_hot_item(connection, "users", user)
    connection.commit()


def _ensure_volunteer_profile_for_user(connection: Any, user: dict[str, Any]) -> bool:
    """Ensure every volunteer account has a pending/approved management profile."""
    if str(user.get("role") or "").strip().lower() != "volunteer":
        return False

    user_id = str(user.get("id") or "").strip()
    if not user_id:
        return False

    # Volunteer registration details are shown from the linked volunteer
    # profile in Volunteer Management.  User rows deliberately do not retain
    # the full membership sheet, so copy any supplied member-owned fields to
    # that profile whenever the account is saved.  This also repairs profiles
    # created before document fields (such as a valid ID photo) existed.
    membership_sheet = user.get("volunteerMembershipSheet")
    membership_fields = (
        "gender",
        "dateOfBirth",
        "civilStatus",
        "homeAddress",
        "homeAddressRegion",
        "homeAddressCityMunicipality",
        "homeAddressBarangay",
        "occupation",
        "workplaceOrSchool",
        "collegeCourse",
        "certificationsOrTrainings",
        "validIdPhoto",
        "hobbiesAndInterests",
        "specialSkills",
        "skills",
        "affiliations",
    )
    membership_updates = {
        field: membership_sheet[field]
        for field in membership_fields
        if isinstance(membership_sheet, dict)
        and field in membership_sheet
        and membership_sheet[field] is not None
    }

    email = str(user.get("email") or "").strip().lower()
    phone = _normalize_comparable_phone(user.get("phone"))
    volunteers = get_postgres_hot_storage_collection(connection, "volunteers")
    linked_volunteer = next(
        (
            volunteer
            for volunteer in volunteers
            if str(volunteer.get("userId") or "").strip() == user_id
            or (
                email
                and str(volunteer.get("email") or "").strip().lower() == email
            )
            or (
                phone
                and _normalize_comparable_phone(volunteer.get("phone")) == phone
            )
        ),
        None,
    )

    if linked_volunteer is not None:
        # Link legacy profiles that were previously matched only by email or
        # phone, so Volunteer Management can always find the account by user id.
        updated_volunteer = dict(linked_volunteer)
        has_changes = False
        if str(linked_volunteer.get("userId") or "").strip() != user_id:
            updated_volunteer.update(
                {
                    "userId": user_id,
                    "name": str(user.get("name") or linked_volunteer.get("name") or "").strip(),
                    "email": email or linked_volunteer.get("email") or "",
                    "phone": user.get("phone") or linked_volunteer.get("phone") or "",
                }
            )
            has_changes = True

        for field, value in membership_updates.items():
            if updated_volunteer.get(field) != value:
                updated_volunteer[field] = value
                has_changes = True

        if has_changes:
            _postgres_upsert_hot_item(connection, "volunteers", updated_volunteer)
            return True
        return False

    created_at = str(user.get("createdAt") or datetime.now(timezone.utc).isoformat())
    approval_status = str(user.get("approvalStatus") or "").strip().lower()
    volunteer_profile = {
        "id": f"volunteer-{user_id}",
        "userId": user_id,
        "name": str(user.get("name") or "").strip(),
        "email": email,
        "phone": user.get("phone") or "",
        "skills": [],
        "skillsDescription": "",
        "availability": {
            "daysPerWeek": 0,
            "hoursPerWeek": 0,
            "availableDays": [],
        },
        "pastProjects": [],
        "totalHoursContributed": 0,
        "rating": 0,
        "engagementStatus": "Open to Volunteer",
        "background": "",
        "gender": "",
        "dateOfBirth": "",
        "civilStatus": "",
        "homeAddress": "",
        "homeAddressRegion": "",
        "homeAddressCityMunicipality": "",
        "homeAddressBarangay": "",
        "occupation": "",
        "workplaceOrSchool": "",
        "collegeCourse": "",
        "certificationsOrTrainings": "",
        "validIdPhoto": "",
        "videoBriefingUrl": "",
        "affiliations": [],
        "registrationStatus": "Pending" if approval_status == "pending" else "Approved",
        "createdAt": created_at,
    }
    volunteer_profile.update(membership_updates)
    _postgres_upsert_hot_item(connection, "volunteers", volunteer_profile)
    return True


def _normalize_comparable_phone(value: Any) -> str:
    return normalize_comparable_phone(value)



# Returns the login restriction message for partner accounts that are not yet approved.
def _get_partner_login_block_reason(connection: Any, user: dict[str, Any]) -> str | None:
    if str(user.get("role") or "") != "partner":
        return None

    user_id = str(user.get("id") or "").strip()
    user_email = str(user.get("email") or "").strip().lower()
    user_phone = _normalize_comparable_phone(user.get("phone"))
    partners = get_postgres_hot_storage_collection(connection, "partners")

    owned_partners: list[dict[str, Any]] = []
    for partner in partners:
        owner_user_id = str(partner.get("ownerUserId") or "").strip()
        partner_email = str(partner.get("contactEmail") or "").strip().lower()
        partner_phone = _normalize_comparable_phone(partner.get("contactPhone"))

        if owner_user_id and user_id and owner_user_id == user_id:
            owned_partners.append(partner)
            continue

        if user_email and partner_email and partner_email == user_email:
            owned_partners.append(partner)
            continue

        if user_phone and partner_phone and partner_phone == user_phone:
            owned_partners.append(partner)

    if any(str(partner.get("status") or "") == "Approved" for partner in owned_partners):
        return None

    if any(str(partner.get("status") or "") == "Rejected" for partner in owned_partners):
        return "Your organization application was rejected. Please contact the admin team."

    if owned_partners:
        return "Your organization application is still pending admin approval."

    return "No organization application is linked to this partner account yet."


# Returns the login restriction message for volunteer accounts that are not yet approved.
def _get_volunteer_login_block_reason(connection: Any, user: dict[str, Any]) -> str | None:
    if str(user.get("role") or "") != "volunteer":
        return None

    user_id = str(user.get("id") or "").strip()
    user_email = str(user.get("email") or "").strip().lower()
    user_phone = _normalize_comparable_phone(user.get("phone"))
    volunteers = get_postgres_hot_storage_collection(connection, "volunteers")

    owned_volunteers: list[dict[str, Any]] = []
    for volunteer in volunteers:
        volunteer_user_id = str(volunteer.get("userId") or "").strip()
        volunteer_email = str(volunteer.get("email") or "").strip().lower()
        volunteer_phone = _normalize_comparable_phone(volunteer.get("phone"))

        if volunteer_user_id and user_id and volunteer_user_id == user_id:
            owned_volunteers.append(volunteer)
            continue

        if user_email and volunteer_email and volunteer_email == user_email:
            owned_volunteers.append(volunteer)
            continue

        if user_phone and volunteer_phone and volunteer_phone == user_phone:
            owned_volunteers.append(volunteer)

    if any(str(volunteer.get("registrationStatus") or "Approved") == "Approved" for volunteer in owned_volunteers):
        return None

    if any(str(volunteer.get("registrationStatus") or "") == "Rejected" for volunteer in owned_volunteers):
        return "Your volunteer account was rejected. Please contact the admin team."

    if owned_volunteers:
        return "Your volunteer account is still pending approval."

    return "No volunteer profile is linked to this account yet."


@app.get("/users/lookup")
# API endpoint that looks up a user by email or phone.
def lookup_user(request: FastAPIRequest, identifier: str) -> dict[str, Any]:
    session = _get_session_user(request)
    user = _get_user_by_identifier(identifier)
    if user is not None:
        user = dict(user)
        user.pop("password", None)
        # A user may resolve an identity for messaging, but only the account
        # owner or an administrator may receive the complete profile record.
        if session.get("role") != "admin" and str(user.get("id") or "") != str(session.get("sub") or ""):
            user = {
                "id": user.get("id"),
                "name": user.get("name") or "NVC Member",
                "role": user.get("role"),
            }
    return {"user": user}


@app.get("/users/directory")
# API endpoint used by messaging to resolve sender names and profile photos.
def get_user_directory(request: FastAPIRequest) -> dict[str, list[dict[str, Any]]]:
    session = _get_session_user(request)
    cached = _message_query_cache.get("users:directory")
    if cached is not None:
        if session.get("role") == "admin":
            return cached
        return {
            "users": [
                {
                    key: value
                    for key, value in user.items()
                    if key not in {"email", "phone"}
                }
                for user in cached.get("users", [])
            ]
        }

    _require_postgres()
    with get_connection() as connection:
        users = get_postgres_hot_storage_collection(
            connection,
            "users",
            include_images=True,
        )

    directory = [
        {
            "id": user.get("id"),
            "name": user.get("name") or "NVC Member",
            "role": user.get("role"),
            "profilePhoto": _compress_image_data_uri(user.get("profilePhoto")),
        }
        for user in users
        if isinstance(user, dict) and str(user.get("id") or "").strip()
    ]
    result = {"users": directory}
    _message_query_cache.set("users:directory", result)
    return result


# Demo accounts for offline/development mode
DEMO_ACCOUNTS = []

def _normalize_phone(phone: str) -> str:
    """Normalize phone for comparison"""
    return "".join(c for c in str(phone or "") if c.isdigit())

def _get_demo_account(identifier: str) -> dict[str, Any] | None:
    """Find a demo account by email, email username alias, or phone."""
    normalized_identifier = identifier.strip().lower()
    username_alias = _get_email_username_alias(identifier)
    normalized_phone = _normalize_phone(identifier)
    
    for account in DEMO_ACCOUNTS:
        account_email = str(account.get("email") or "").lower()
        # Check email match
        if account_email == normalized_identifier:
            return account
        # Check email username alias match
        if username_alias and account_email.split("@", 1)[0] == username_alias:
            return account
        # Check phone match
        if normalized_phone and _normalize_phone(account.get("phone", "")) == normalized_phone:
            return account
    return None


REGISTRATION_OTP_TTL_SECONDS = 300
_registration_otp_schema_lock = threading.Lock()
_registration_otp_schema_ready = False
_password_reset_otp_schema_lock = threading.Lock()
_password_reset_otp_schema_ready = False
PASSWORD_RESET_OTP_TTL_SECONDS = 300


def _ensure_registration_otp_table(connection: Any) -> None:
    """Ensure registration OTPs are shared across workers and restarts."""
    global _registration_otp_schema_ready

    if _registration_otp_schema_ready:
        return

    with _registration_otp_schema_lock:
        if _registration_otp_schema_ready:
            return

        with connection.cursor() as cursor:
            cursor.execute(
                """
                create table if not exists public.registration_email_otps (
                  email text primary key,
                  otp_digest text not null,
                  otp_salt text not null,
                  issued_at timestamptz not null,
                  expires_at timestamptz not null
                )
                """
            )
            cursor.execute(
                """
                create index if not exists registration_email_otps_expires_idx
                on public.registration_email_otps (expires_at)
                """
            )
        connection.commit()
        _registration_otp_schema_ready = True


def _registration_otp_digest(email: str, otp: str, salt: bytes) -> str:
    """Derive a verification digest without storing the six-digit code."""
    return hashlib.pbkdf2_hmac(
        "sha256",
        f"{email}:{otp}".encode("utf-8"),
        salt,
        100_000,
    ).hex()


def _ensure_password_reset_otp_table(connection: Any) -> None:
    """Ensure password-reset OTPs are shared across workers and restarts."""
    global _password_reset_otp_schema_ready

    if _password_reset_otp_schema_ready:
        return

    with _password_reset_otp_schema_lock:
        if _password_reset_otp_schema_ready:
            return

        with connection.cursor() as cursor:
            cursor.execute(
                """
                create table if not exists public.password_reset_email_otps (
                  email text primary key,
                  otp_digest text not null,
                  otp_salt text not null,
                  issued_at timestamptz not null,
                  expires_at timestamptz not null,
                  attempts integer not null default 0
                )
                """
            )
            cursor.execute(
                """
                create index if not exists password_reset_email_otps_expires_idx
                on public.password_reset_email_otps (expires_at)
                """
            )
        connection.commit()
        _password_reset_otp_schema_ready = True


def _password_reset_otp_digest(email: str, otp: str, salt: bytes) -> str:
    """Derive a reset-code digest without storing the six-digit code."""
    return hashlib.pbkdf2_hmac(
        "sha256",
        f"{email}:{otp}".encode("utf-8"),
        salt,
        100_000,
    ).hex()


def _purge_expired_registration_otps(connection: Any) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            "delete from public.registration_email_otps where expires_at <= now()"
        )


def _send_registration_otp_email(recipient_email: str, otp: str) -> None:
    text_body = f"Your NVC Connect registration code is: {otp}\n\nThis code expires in 5 minutes."
    html_body = f"""
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#f8fafc;border-radius:12px;">
      <h2 style="color:#15803d;margin-bottom:8px;">NVC Connect</h2>
      <p style="color:#334155;font-size:15px;">Your registration verification code is:</p>
      <div style="font-size:40px;font-weight:900;letter-spacing:12px;color:#0f172a;margin:24px 0;">{otp}</div>
      <p style="color:#64748b;font-size:13px;">This code expires in <strong>5 minutes</strong>.</p>
    </div>
    """
    _send_email_message(recipient_email, "Your NVC Connect Registration Code", text_body, html_body)


def _send_password_reset_otp_email(recipient_email: str, otp: str) -> None:
    text_body = f"Your NVC Connect password reset code is: {otp}\n\nThis code expires in 5 minutes."
    html_body = f"""
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#f8fafc;border-radius:12px;">
      <h2 style="color:#15803d;margin-bottom:8px;">NVC Connect</h2>
      <p style="color:#334155;font-size:15px;">Use this code to reset your account password:</p>
      <div style="font-size:40px;font-weight:900;letter-spacing:12px;color:#0f172a;margin:24px 0;">{otp}</div>
      <p style="color:#64748b;font-size:13px;">This code expires in <strong>5 minutes</strong>. If you did not request this, you can ignore this email.</p>
    </div>
    """
    _send_email_message(recipient_email, "Your NVC Connect Password Reset Code", text_body, html_body)


def _purge_expired_password_reset_otps(connection: Any) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            "delete from public.password_reset_email_otps where expires_at <= now()"
        )


def _is_email_already_registered(email: str, connection: Any | None = None) -> bool:
    """Checks whether an email belongs to a canonical account."""
    normalized = str(email or "").strip().lower()
    if not normalized or "@" not in normalized:
        return False
    # Check demo accounts first
    if _get_demo_account(normalized) is not None:
        return True

    def _check_db(conn: Any) -> bool:
        # Only the users table represents a login account. Volunteer profiles
        # and partner contact rows can remain after a failed/removed account;
        # treating those profile rows as registered accounts traps the email
        # without giving the person a usable login.
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "select 1 from users where lower(trim(coalesce(email, ''))) = %s limit 1",
                    (normalized,),
                )
                if cur.fetchone() is not None:
                    return True
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
        # Fallback: scan the canonical users collection only.
        try:
            for item in get_postgres_hot_storage_collection(conn, "users"):
                if str(item.get("email") or "").strip().lower() == normalized:
                    return True
        except Exception:
            pass
        return False

    if connection is not None:
        return _check_db(connection)
    try:
        with get_connection() as conn:
            return _check_db(conn)
    except Exception:
        return False


@app.get("/auth/check-email")
def auth_check_email(email: str = "") -> dict[str, Any]:
    """Returns whether the given email is already registered."""
    normalized = str(email or "").strip().lower()
    if not normalized or "@" not in normalized:
        return {"exists": False, "email": normalized}
    exists = _is_email_already_registered(normalized)
    return {
        "exists": exists,
        "email": normalized,
        "message": "An account with this email already exists." if exists else "Email is available.",
    }


@app.post("/auth/registration-otp/send")
def auth_registration_otp_send(payload: RegistrationOtpSendPayload) -> dict[str, Any]:
    email = str(payload.email or "").strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="A valid email address is required.")

    # Block if email is already registered
    if _is_email_already_registered(email):
        raise HTTPException(
            status_code=409,
            detail="An account with this email already exists.",
        )

    otp = "".join(str(secrets.randbelow(10)) for _ in range(6))
    now = datetime.now(timezone.utc)
    salt = secrets.token_bytes(16)
    otp_digest = _registration_otp_digest(email, otp, salt)

    with get_connection() as connection:
        _ensure_registration_otp_table(connection)
        _purge_expired_registration_otps(connection)
        with connection.cursor() as cursor:
            cursor.execute(
                """
                select issued_at
                from public.registration_email_otps
                where email = %s
                for update
                """,
                (email,),
            )
            existing = cursor.fetchone()
            if existing:
                issued_at = existing[0]
                if issued_at.tzinfo is None:
                    issued_at = issued_at.replace(tzinfo=timezone.utc)
                time_since = (now - issued_at).total_seconds()
                if time_since < 60:
                    wait = max(1, int(60 - time_since))
                    raise HTTPException(
                        status_code=429,
                        detail=f"Please wait {wait} seconds before requesting a new code.",
                    )

            cursor.execute(
                """
                insert into public.registration_email_otps
                  (email, otp_digest, otp_salt, issued_at, expires_at)
                values (%s, %s, %s, %s, %s)
                on conflict (email) do update set
                  otp_digest = excluded.otp_digest,
                  otp_salt = excluded.otp_salt,
                  issued_at = excluded.issued_at,
                  expires_at = excluded.expires_at
                """,
                (
                    email,
                    otp_digest,
                    salt.hex(),
                    now,
                    now + timedelta(seconds=REGISTRATION_OTP_TTL_SECONDS),
                ),
            )
        connection.commit()

    try:
        _send_registration_otp_email(email, otp)
    except Exception as smtp_error:
        try:
            with get_connection() as connection:
                _ensure_registration_otp_table(connection)
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        delete from public.registration_email_otps
                        where email = %s and otp_digest = %s
                        """,
                        (email, otp_digest),
                    )
                connection.commit()
        except Exception as cleanup_error:
            print(f"[REGISTRATION-OTP] Failed to clean up undelivered code: {cleanup_error}")
        print(f"[REGISTRATION-OTP] SMTP unavailable ({smtp_error}).")
        raise HTTPException(
            status_code=503,
            detail="We could not send the verification code to that email address. Please try again.",
        ) from smtp_error

    return {
        "message": "Verification code sent. Check your email inbox.",
        "email": email,
        "expires_in": REGISTRATION_OTP_TTL_SECONDS,
    }


@app.post("/auth/registration-otp/verify")
def auth_registration_otp_verify(payload: RegistrationOtpVerifyPayload) -> dict[str, Any]:
    email = str(payload.email or "").strip().lower()
    otp = str(payload.otp or "").strip()

    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="A valid email address is required.")
    if not otp or len(otp) != 6 or not otp.isdigit():
        raise HTTPException(status_code=400, detail="Please enter the 6-digit code sent to your email.")

    verification_error: HTTPException | None = None
    with get_connection() as connection:
        _ensure_registration_otp_table(connection)
        with connection.cursor() as cursor:
            cursor.execute(
                """
                select otp_digest, otp_salt, expires_at
                from public.registration_email_otps
                where email = %s
                for update
                """,
                (email,),
            )
            stored = cursor.fetchone()
            if stored is None:
                verification_error = HTTPException(
                    status_code=401,
                    detail="No verification code found. Please request a new one.",
                )
            else:
                stored_digest, stored_salt, expires_at = stored
                if expires_at.tzinfo is None:
                    expires_at = expires_at.replace(tzinfo=timezone.utc)
                if datetime.now(timezone.utc) >= expires_at:
                    cursor.execute(
                        "delete from public.registration_email_otps where email = %s",
                        (email,),
                    )
                    verification_error = HTTPException(
                        status_code=401,
                        detail="Your verification code has expired. Please request a new one.",
                    )
                else:
                    try:
                        salt = bytes.fromhex(str(stored_salt))
                        supplied_digest = _registration_otp_digest(email, otp, salt)
                    except (TypeError, ValueError):
                        supplied_digest = ""

                    if not secrets.compare_digest(str(stored_digest), supplied_digest):
                        verification_error = HTTPException(
                            status_code=401,
                            detail="Incorrect code. Please try again.",
                        )
                    else:
                        cursor.execute(
                            "delete from public.registration_email_otps where email = %s",
                            (email,),
                        )
        connection.commit()

    if verification_error is not None:
        raise verification_error

    return {
        "verified": True,
        "email": email,
        "message": "Email verified.",
        "verificationToken": create_registration_verification_token(email),
    }


def _is_phone_already_registered(phone: str, connection: Any) -> bool:
    normalized_phone = _normalize_comparable_phone(phone)
    if not normalized_phone:
        return False

    for key, field_name in (
        ("users", "phone"),
        ("volunteers", "phone"),
        ("partners", "contactPhone"),
    ):
        for item in get_postgres_hot_storage_collection(connection, key):
            if _normalize_comparable_phone(item.get(field_name)) == normalized_phone:
                return True
    return False


def _registration_partner_category(advocacy_focus: list[str]) -> str:
    for category in ("Disaster", "Education", "Livelihood", "Nutrition"):
        if category in advocacy_focus:
            return category
    return "Disaster"


@app.post("/auth/register")
def auth_register(
    payload: RegistrationPayload,
    background_tasks: BackgroundTasks,
) -> dict[str, Any]:
    """Create a volunteer or partner account without opening storage writes publicly."""
    email = str(payload.email or "").strip().lower()
    name = str(payload.name or "").strip()
    password = str(payload.password or "").strip()
    role = str(payload.role or "").strip().lower()
    raw_phone = str(payload.phone or "").strip()
    phone = normalize_ph_mobile_phone(raw_phone) if raw_phone else None

    if role not in {"volunteer", "partner"}:
        raise HTTPException(status_code=400, detail="Only volunteer and partner registration is available.")
    if not name or len(name) < 2:
        raise HTTPException(status_code=400, detail="Full name must be at least 2 characters long.")
    if not is_valid_email(email):
        raise HTTPException(status_code=400, detail="A valid email address is required.")
    if raw_phone and not phone:
        raise HTTPException(
            status_code=400,
            detail="Use a valid 11-digit Philippine mobile number (for example, 09171234567).",
        )
    if len(password) < 8 or not any(character.isupper() for character in password):
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters and include an uppercase letter.")
    if not any(character.islower() for character in password):
        raise HTTPException(status_code=400, detail="Password must include at least one lowercase letter.")
    if not any(character.isdigit() for character in password):
        raise HTTPException(status_code=400, detail="Password must include at least one number.")
    if not verify_registration_verification_token(payload.emailVerificationToken, email):
        raise HTTPException(
            status_code=401,
            detail="Your email verification has expired. Please verify your email again before registering.",
        )

    volunteer_membership = dict(payload.volunteerMembershipSheet or {})
    partner_registration = dict(payload.partnerRegistration or {})
    if role == "volunteer":
        required_membership_fields = (
            "gender",
            "dateOfBirth",
            "civilStatus",
            "homeAddress",
            "homeAddressRegion",
            "homeAddressCityMunicipality",
            "homeAddressBarangay",
            "occupation",
            "workplaceOrSchool",
        )
        if any(not str(volunteer_membership.get(field) or "").strip() for field in required_membership_fields):
            raise HTTPException(
                status_code=400,
                detail="Complete the volunteer membership information sheet before creating the account.",
            )
    else:
        organization_name = str(partner_registration.get("organizationName") or "").strip()
        registration_documents = [
            str(document).strip()
            for document in (partner_registration.get("registrationDocuments") or [])
            if str(document).strip()
        ]
        advocacy_focus = [
            str(focus).strip()
            for focus in (partner_registration.get("advocacyFocus") or [])
            if str(focus).strip()
        ]
        sector_type = str(partner_registration.get("sectorType") or "").strip()
        if not organization_name or not registration_documents or not advocacy_focus:
            raise HTTPException(status_code=400, detail="Complete the organization application details before submitting.")
        if sector_type not in {"NGO", "Hospital", "Institution", "Private"}:
            raise HTTPException(status_code=400, detail="Select a valid partner sector.")

    with get_connection() as connection:
        # A mobile client can lose the response after the database commit and
        # retry the same registration. Treat that exact, verified replay as a
        # successful submission so the user sees confirmation instead of a
        # misleading duplicate-email error. A different password or role is
        # still rejected normally.
        existing_user = _get_user_by_identifier(email, connection)
        if existing_user is not None:
            is_same_verified_submission = (
                _get_demo_account(email) is None
                and str(existing_user.get("role") or "").strip().lower() == role
                and verify_password(password, existing_user.get("password"))
            )
            if not is_same_verified_submission:
                raise HTTPException(status_code=409, detail="An account with this email already exists.")

            saved_user = dict(existing_user)
            # Keep the response shape used by the original successful
            # registration so the mobile client can finish its confirmation
            # flow without exposing the stored bcrypt hash.
            saved_user["password"] = password
            saved_user["hasPassword"] = True
            replay_source = {
                **saved_user,
                "volunteerMembershipSheet": volunteer_membership,
            }
            if role == "volunteer" and _ensure_volunteer_profile_for_user(connection, replay_source):
                connection.commit()
                _invalidate_collection_cache(["users", "volunteers"])
                background_tasks.add_task(
                    connection_manager.broadcast_storage_event,
                    ["users", "volunteers"],
                )
            return {
                "user": saved_user,
                "message": "Registration was already submitted successfully. An administrator must approve the account before login is unlocked.",
            }
        if phone and _is_phone_already_registered(phone, connection):
            raise HTTPException(status_code=409, detail="An account with this phone number already exists.")

        created_at = datetime.now(timezone.utc).isoformat()
        user_id = f"user-{secrets.token_hex(16)}"
        user = {
            "id": user_id,
            "name": name,
            "email": email,
            "password": password,
            "phone": phone,
            "role": role,
            "userType": str(payload.userType or "Student").strip() or "Student",
            "pillarsOfInterest": [
                str(pillar).strip()
                for pillar in (payload.pillarsOfInterest or [])
                if str(pillar).strip()
            ],
            "approvalStatus": "pending",
            "createdAt": created_at,
        }
        if role == "volunteer":
            user["volunteerMembershipSheet"] = volunteer_membership

        try:
            saved_user = _postgres_upsert_hot_item(connection, "users", user)
            changed_keys = ["users"]
            if role == "volunteer":
                if _ensure_volunteer_profile_for_user(connection, user):
                    changed_keys.append("volunteers")
            else:
                advocacy_focus = [
                    str(focus).strip()
                    for focus in (partner_registration.get("advocacyFocus") or [])
                    if str(focus).strip()
                ]
                partner = {
                    "id": f"partner-{user_id}",
                    "ownerUserId": user_id,
                    "name": str(partner_registration.get("organizationName") or "").strip(),
                    "stakeholderName": name,
                    "description": f"{', '.join(advocacy_focus)} partnership application",
                    "category": _registration_partner_category(advocacy_focus),
                    "sectorType": str(partner_registration.get("sectorType") or "").strip(),
                    "dswdAccreditationNo": str(partner_registration.get("dswdAccreditationNo") or "").strip().upper(),
                    "secRegistrationNo": str(partner_registration.get("secRegistrationNo") or "").strip().upper(),
                    "registrationDocuments": [
                        str(document).strip()
                        for document in (partner_registration.get("registrationDocuments") or [])
                        if str(document).strip()
                    ],
                    "advocacyFocus": advocacy_focus,
                    "contactEmail": email,
                    "contactPhone": phone,
                    "status": "Pending",
                    "verificationStatus": "Pending",
                    "createdAt": created_at,
                }
                _postgres_upsert_hot_item(connection, "partners", partner)
                changed_keys.append("partners")
            connection.commit()
        except HTTPException:
            connection.rollback()
            raise
        except ValueError as error:
            connection.rollback()
            raise HTTPException(status_code=400, detail=str(error)) from error
        except Exception as error:
            connection.rollback()
            print(f"[REGISTRATION] Account creation failed: {type(error).__name__}")
            raise HTTPException(
                status_code=500,
                detail="The account could not be created. Please try again.",
            ) from error

    _invalidate_collection_cache(changed_keys)
    # FastAPI runs this synchronous endpoint in a worker thread. Use its
    # background-task runner instead of asyncio.create_task(), which has no
    # running event loop in that worker thread and could silently skip the
    # realtime notification after the database commit.
    background_tasks.add_task(
        connection_manager.broadcast_storage_event,
        changed_keys,
    )
    saved_user["hasPassword"] = True
    return {
        "user": saved_user,
        "message": "Registration submitted successfully. An administrator must approve the account before login is unlocked.",
    }


@app.post("/auth/password-reset/send")
def auth_password_reset_send(payload: PasswordResetRequestPayload) -> dict[str, Any]:
    """Send a one-time password reset code to an existing account email."""

    email = str(payload.email or "").strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="A valid email address is required.")

    # Keep the response generic for unknown emails so this endpoint cannot be
    # used to enumerate registered accounts.
    try:
        with get_connection() as connection:
            _ensure_password_reset_otp_table(connection)
            _purge_expired_password_reset_otps(connection)
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    select issued_at
                    from public.password_reset_email_otps
                    where email = %s
                    for update
                    """,
                    (email,),
                )
                existing = cursor.fetchone()
                if existing:
                    issued_at = existing[0]
                    if issued_at.tzinfo is None:
                        issued_at = issued_at.replace(tzinfo=timezone.utc)
                    time_since = (datetime.now(timezone.utc) - issued_at).total_seconds()
                    if time_since < 60:
                        wait = max(1, int(60 - time_since))
                        raise HTTPException(
                            status_code=429,
                            detail=f"Please wait {wait} seconds before requesting a new code.",
                        )
            user = _get_user_by_identifier(email, connection)
    except Exception as database_error:
        if isinstance(database_error, HTTPException):
            raise
        print(f"[PASSWORD-RESET] Account lookup failed: {type(database_error).__name__}: {database_error}")
        raise HTTPException(
            status_code=503,
            detail="The account service is temporarily unavailable. Please try again.",
        ) from database_error

    if user is None:
        return {
            "message": "If an account exists for that email, a password reset code has been sent.",
            "email": email,
            "expires_in": PASSWORD_RESET_OTP_TTL_SECONDS,
        }

    otp = "".join(str(secrets.randbelow(10)) for _ in range(6))
    now = datetime.now(timezone.utc)
    salt = secrets.token_bytes(16)
    otp_digest = _password_reset_otp_digest(email, otp, salt)

    with get_connection() as connection:
        _ensure_password_reset_otp_table(connection)
        with connection.cursor() as cursor:
            cursor.execute(
                """
                insert into public.password_reset_email_otps
                  (email, otp_digest, otp_salt, issued_at, expires_at, attempts)
                values (%s, %s, %s, %s, %s, 0)
                on conflict (email) do update set
                  otp_digest = excluded.otp_digest,
                  otp_salt = excluded.otp_salt,
                  issued_at = excluded.issued_at,
                  expires_at = excluded.expires_at,
                  attempts = 0
                """,
                (
                    email,
                    otp_digest,
                    salt.hex(),
                    now,
                    now + timedelta(seconds=PASSWORD_RESET_OTP_TTL_SECONDS),
                ),
            )
        connection.commit()

    try:
        _send_password_reset_otp_email(email, otp)
    except Exception as smtp_error:
        try:
            with get_connection() as connection:
                _ensure_password_reset_otp_table(connection)
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        delete from public.password_reset_email_otps
                        where email = %s and otp_digest = %s
                        """,
                        (email, otp_digest),
                    )
                connection.commit()
        except Exception as cleanup_error:
            print(f"[PASSWORD-RESET] Failed to clean up undelivered code: {cleanup_error}")
        print(f"[PASSWORD-RESET] SMTP unavailable ({smtp_error}).")
        raise HTTPException(
            status_code=503,
            detail="We could not send the reset code to that email address. Please try again.",
        ) from smtp_error

    return {
        "message": "If an account exists for that email, a password reset code has been sent.",
        "email": email,
        "expires_in": PASSWORD_RESET_OTP_TTL_SECONDS,
    }


@app.post("/auth/password-reset/confirm")
def auth_password_reset_confirm(payload: PasswordResetConfirmPayload) -> dict[str, Any]:
    """Verify a reset code and replace the account password with a bcrypt hash."""

    email = str(payload.email or "").strip().lower()
    otp = str(payload.otp or "").strip()
    new_password = str(payload.newPassword or "").strip()

    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="A valid email address is required.")
    if not otp or len(otp) != 6 or not otp.isdigit():
        raise HTTPException(status_code=400, detail="Please enter the 6-digit code sent to your email.")
    if len(new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters long.")
    if not any(character.isupper() for character in new_password):
        raise HTTPException(status_code=400, detail="Password must include at least one uppercase letter.")
    if not any(character.islower() for character in new_password):
        raise HTTPException(status_code=400, detail="Password must include at least one lowercase letter.")
    if not any(character.isdigit() for character in new_password):
        raise HTTPException(status_code=400, detail="Password must include at least one number.")

    with get_connection() as connection:
        _ensure_password_reset_otp_table(connection)
        _purge_expired_password_reset_otps(connection)
        with connection.cursor() as cursor:
            cursor.execute(
                """
                select otp_digest, otp_salt, expires_at, attempts
                from public.password_reset_email_otps
                where email = %s
                for update
                """,
                (email,),
            )
            stored = cursor.fetchone()
            if stored is None:
                raise HTTPException(status_code=401, detail="No reset code found. Please request a new one.")

            stored_digest, stored_salt, expires_at, attempts = stored
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) >= expires_at:
                cursor.execute(
                    "delete from public.password_reset_email_otps where email = %s",
                    (email,),
                )
                connection.commit()
                raise HTTPException(status_code=401, detail="Your reset code has expired. Please request a new one.")

            try:
                salt = bytes.fromhex(str(stored_salt))
                supplied_digest = _password_reset_otp_digest(email, otp, salt)
            except (TypeError, ValueError):
                supplied_digest = ""

            if not secrets.compare_digest(str(stored_digest), supplied_digest):
                next_attempts = int(attempts or 0) + 1
                if next_attempts >= 5:
                    cursor.execute(
                        "delete from public.password_reset_email_otps where email = %s",
                        (email,),
                    )
                    connection.commit()
                    raise HTTPException(status_code=429, detail="Too many incorrect codes. Please request a new one.")

                cursor.execute(
                    "update public.password_reset_email_otps set attempts = %s where email = %s",
                    (next_attempts, email),
                )
                connection.commit()
                raise HTTPException(status_code=401, detail="Incorrect code. Please try again.")

            user = _get_user_by_identifier(email, connection)
            if user is None:
                cursor.execute(
                    "delete from public.password_reset_email_otps where email = %s",
                    (email,),
                )
                connection.commit()
                raise HTTPException(status_code=404, detail="Account not found.")

            cursor.execute(
                "update users set password = %s where users_id = %s",
                (hash_password(new_password), user.get("id")),
            )
            cursor.execute(
                "delete from public.password_reset_email_otps where email = %s",
                (email,),
            )
        connection.commit()

    _invalidate_collection_cache(["users"])
    return {"message": "Your password has been reset successfully.", "email": email}

@app.post("/auth/login")
# API endpoint that validates login credentials.
def auth_login(payload: AuthLoginPayload) -> dict[str, Any]:
    # Try demo account first (fast path)
    user = _get_demo_account(payload.identifier)
    is_demo_account = user is not None
    
    # If demo account not found, try the shared database directly.
    if user is None:
        try:
            with get_connection() as connection:
                user = _get_user_by_identifier(payload.identifier, connection)
        except Exception as db_error:
            print(f"[WARN] Database lookup failed during login: {type(db_error).__name__}")
            raise HTTPException(
                status_code=503,
                detail="Database unavailable while checking your account. Please try again."
            )
    
    if user is None:
        raise HTTPException(
            status_code=401,
            detail=_get_identifier_error_message(payload.identifier),
        )

    submitted_password = str(payload.password or "").strip()
    stored_password = user.get("password")
    if not verify_password(submitted_password, stored_password):
        raise HTTPException(status_code=401, detail="Incorrect password")

    # Upgrade any legacy plaintext value immediately if startup migration did
    # not already handle it. This keeps the compatibility window short.
    if not is_demo_account and isinstance(stored_password, str) and not is_bcrypt_hash(stored_password):
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "update users set password = %s where users_id = %s",
                    (hash_password(submitted_password), user.get("id")),
                )
            connection.commit()

    # For demo mode (most of the time), skip approval checks
    if user.get("id", "").endswith("1") or user.get("id", "").startswith(("admin", "volunteer", "partner")):
        # This is a demo account, skip database checks
        pass
    else:
        # Real account from database - do approval checks
        try:
            with get_connection() as connection:
                block_reason = (
                    _get_volunteer_login_block_reason(connection, user)
                    or _get_partner_login_block_reason(connection, user)
                )
            if block_reason:
                raise HTTPException(status_code=403, detail=block_reason)
        except HTTPException:
            raise
        except Exception as error:
            print(f"[WARN] Error during approval check: {type(error).__name__}")

    public_user = dict(user)
    public_user["hasPassword"] = bool(str(user.get("password") or "").strip())
    public_user.pop("password", None)
    return {
        "user": public_user,
        "sessionToken": create_session_token(str(public_user.get("id") or ""), str(public_user.get("role") or "")),
        "message": "Login successful",
    }


@app.post("/auth/google")
# Authenticates only Google emails that already belong to registered accounts.
def auth_google(payload: GoogleAuthPayload) -> dict[str, Any]:
    token_info = _verify_google_id_token(payload.idToken)
    email = str(token_info.get("email") or "").strip().lower()

    try:
        with get_connection() as connection:
            user = _get_user_by_identifier(email, connection)
            if user is None:
                raise HTTPException(
                    status_code=403,
                    detail="This Google email is not registered in NVC Connect. Please register first.",
                )

            block_reason = (
                _get_volunteer_login_block_reason(connection, user)
                or _get_partner_login_block_reason(connection, user)
            )
            if block_reason:
                raise HTTPException(status_code=403, detail=block_reason)
    except HTTPException:
        raise
    except Exception as error:
        print(f"[WARN] Google account lookup failed: {type(error).__name__}: {error}")
        raise HTTPException(
            status_code=503,
            detail="Database unavailable while checking your Google account. Please try again.",
        ) from error

    public_user = dict(user)
    public_user["hasPassword"] = bool(str(user.get("password") or "").strip())
    public_user.pop("password", None)
    return {
        "user": public_user,
        "sessionToken": create_session_token(str(public_user.get("id") or ""), str(public_user.get("role") or "")),
        "message": "Google login successful",
    }


@app.post("/auth/send-rejection-email")
# API endpoint for sending an application rejection explanation email.
def send_rejection_email_endpoint(payload: RejectionEmailPayload) -> dict[str, Any]:
    try:
        _send_rejection_email(
            recipient_email=payload.recipientEmail,
            recipient_name=payload.recipientName,
            rejection_reason=payload.rejectionReason,
            role=payload.role,
        )
        return {"success": True, "message": "Rejection email sent successfully."}
    except Exception as error:
        print(f"[REJECTION-EMAIL-ERROR] Failed to send rejection email: {type(error).__name__}")
        return {"success": False, "message": "Email sending failed. Please try again."}


@app.post("/auth/approval-email")
# API endpoint for sending an account approval notification email.
def send_approval_email_endpoint(payload: ApprovalEmailPayload) -> dict[str, Any]:
    try:
        _send_approval_email(
            recipient_email=payload.email,
            recipient_name=payload.name,
            role=payload.role,
            approved_by_name=payload.approvedByName,
        )
        return {"success": True, "message": "Approval email sent successfully."}
    except Exception as error:
        print(f"[APPROVAL-EMAIL-ERROR] Failed to send approval email: {type(error).__name__}")
        return {"success": False, "message": "Email sending failed. Please try again."}


@app.post("/auth/users/{user_id}/approve")
# API endpoint for admin to approve a pending user account and linked records.
async def approve_user(user_id: str, payload: UserApprovalPayload, admin_id: str) -> dict[str, Any]:
    with get_connection() as connection:
        user = _postgres_get_hot_item_by_id(connection, "users", user_id)
        if user is None:
            raise HTTPException(status_code=404, detail="User not found.")
        user = dict(user)

        approved_at = datetime.now(timezone.utc).isoformat()

        if payload.status == "approved":
            user["approvalStatus"] = "approved"
            user["approvedBy"] = admin_id
            user["approvedAt"] = approved_at
            # Remove rejection reason if it was previously rejected
            user.pop("rejectionReason", None)
            _postgres_upsert_hot_item(connection, "users", user)
            changed_keys = ["users"]

            if user.get("role") == "volunteer":
                normalized_user_email = str(user.get("email") or "").strip().lower()
                normalized_user_phone = _normalize_comparable_phone(user.get("phone"))
                linked_volunteers = _postgres_get_hot_items_by_field(connection, "volunteers", "userId", user_id)
                if not linked_volunteers:
                    linked_volunteers = get_postgres_hot_storage_collection(connection, "volunteers")
                for volunteer in linked_volunteers:
                    if (
                        str(volunteer.get("userId") or "") == user_id
                        or (
                            normalized_user_email
                            and str(volunteer.get("email") or "").strip().lower() == normalized_user_email
                        )
                        or (
                            normalized_user_phone
                            and _normalize_comparable_phone(volunteer.get("phone")) == normalized_user_phone
                        )
                    ):
                        volunteer["registrationStatus"] = "Approved"
                        volunteer["reviewedBy"] = admin_id
                        volunteer["reviewedAt"] = approved_at
                        volunteer["credentialsUnlockedAt"] = approved_at
                        _postgres_upsert_hot_item(connection, "volunteers", volunteer)
                if linked_volunteers:
                    changed_keys.append("volunteers")

            if user.get("role") == "partner":
                normalized_user_email = str(user.get("email") or "").strip().lower()
                normalized_user_phone = _normalize_comparable_phone(user.get("phone"))
                linked_partners = _postgres_get_hot_items_by_field(connection, "partners", "ownerUserId", user_id)
                if not linked_partners:
                    linked_partners = get_postgres_hot_storage_collection(connection, "partners")
                for partner in linked_partners:
                    if (
                        str(partner.get("ownerUserId") or "") == user_id
                        or (
                            normalized_user_email
                            and str(partner.get("contactEmail") or "").strip().lower() == normalized_user_email
                        )
                        or (
                            normalized_user_phone
                            and _normalize_comparable_phone(partner.get("contactPhone")) == normalized_user_phone
                        )
                    ):
                        partner["status"] = "Approved"
                        partner["validatedBy"] = admin_id
                        partner["validatedAt"] = approved_at
                        partner["credentialsUnlockedAt"] = approved_at
                        _postgres_upsert_hot_item(connection, "partners", partner)
                if linked_partners:
                    changed_keys.append("partners")

            from uuid import uuid4
            notification = {
                "id": f"msg-{uuid4()}",
                "senderId": admin_id,
                "recipientId": user_id,
                "projectId": None,
                "content": (
                    "Your partner organization account has been approved. You can now log in and access the partner portal."
                    if user.get("role") == "partner"
                    else "Your volunteer account has been approved. You can now log in and start volunteering."
                ),
                "timestamp": approved_at,
                "read": False,
                "attachments": []
            }
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    insert into public.messages (
                      messages_id, sender_id, recipient_id, project_id, content, timestamp, read, attachments
                    )
                    values (%s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        notification["id"],
                        notification["senderId"],
                        notification["recipientId"],
                        notification["projectId"],
                        notification["content"],
                        notification["timestamp"],
                        notification["read"],
                        json.dumps(notification["attachments"]),
                    ),
                )
            connection.commit()
            changed_keys.append("messages")
            _invalidate_collection_cache(changed_keys)
            _projects_snapshot_cache.clear()
            asyncio.create_task(connection_manager.broadcast_storage_event(changed_keys))

            return {"user": user, "message": "User account and linked records approved successfully."}
        elif payload.status == "rejected":
            user_email = str(user.get("email") or "").strip()
            user_name = str(user.get("name") or "Volunteer").strip()
            rejection_reason = payload.rejectionReason or "Application did not meet requirements."
            changed_keys = _delete_user_account_records(connection, user_id)
            connection.commit()
            _invalidate_collection_cache(changed_keys)
            _projects_snapshot_cache.clear()
            asyncio.create_task(connection_manager.broadcast_storage_event(changed_keys))
            if user_email:
                asyncio.create_task(asyncio.to_thread(
                    _send_rejection_email,
                    recipient_email=user_email,
                    recipient_name=user_name,
                    rejection_reason=rejection_reason,
                    role=str(user.get("role") or "volunteer"),
                ))
            return {
                "deletedUserId": user_id,
                "message": payload.rejectionReason or "User account rejected and email sent.",
            }
        else:
            raise HTTPException(status_code=400, detail="Invalid approval status. Use 'approved' or 'rejected'.")


@app.get("/auth/users/pending")
# API endpoint to get all pending user approvals (admin only).
def get_pending_users(request: FastAPIRequest) -> dict[str, Any]:
    _require_admin_session(request)
    with get_connection() as connection:
        all_users = _get_all_users_from_storage(connection)
        volunteers = get_postgres_hot_storage_collection(connection, "volunteers")
        partners = get_postgres_hot_storage_collection(connection, "partners")

        def user_matches_linked_record(
            user: dict[str, Any],
            *,
            linked_user_id: Any = None,
            linked_email: Any = None,
            linked_phone: Any = None,
        ) -> bool:
            user_id = str(user.get("id") or "").strip()
            user_email = str(user.get("email") or "").strip().lower()
            user_phone = _normalize_comparable_phone(user.get("phone"))

            candidate_user_id = str(linked_user_id or "").strip()
            candidate_email = str(linked_email or "").strip().lower()
            candidate_phone = _normalize_comparable_phone(linked_phone)

            if candidate_user_id and user_id and candidate_user_id == user_id:
                return True

            if candidate_email and user_email and candidate_email == user_email:
                return True

            if candidate_phone and user_phone and candidate_phone == user_phone:
                return True

            return False

        pending_users: list[dict[str, Any]] = []
        for user in all_users:
            if str(user.get("role") or "") == "admin":
                continue

            approval_status = str(user.get("approvalStatus") or "").strip().lower()
            if approval_status == "pending":
                pending_users.append(user)
                continue

            if approval_status in {"approved", "rejected"}:
                continue

            role = str(user.get("role") or "").strip().lower()
            if role == "volunteer":
                has_pending_volunteer = any(
                    user_matches_linked_record(
                        user,
                        linked_user_id=volunteer.get("userId"),
                        linked_email=volunteer.get("email"),
                        linked_phone=volunteer.get("phone"),
                    )
                    and str(volunteer.get("registrationStatus") or "Pending").strip().lower() == "pending"
                    for volunteer in volunteers
                )
                if has_pending_volunteer:
                    pending_users.append({**user, "approvalStatus": "pending"})
                continue

            if role == "partner":
                has_pending_partner = any(
                    user_matches_linked_record(
                        user,
                        linked_user_id=partner.get("ownerUserId"),
                        linked_email=partner.get("contactEmail"),
                        linked_phone=partner.get("contactPhone"),
                    )
                    and str(partner.get("status") or "Pending").strip().lower() == "pending"
                    for partner in partners
                )
                if has_pending_partner:
                    pending_users.append({**user, "approvalStatus": "pending"})

        return {
            "pendingUsers": pending_users,
            "count": len(pending_users)
        }


def _delete_user_account_records(connection: Any, user_id: str) -> list[str]:
    # Account deletion used to read and replace every media-bearing collection.
    # Keep this path relational and targeted: only rows that reference the
    # account are read or changed, and project/event media columns are never
    # included in the assignment cleanup updates below.
    from psycopg.rows import dict_row

    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """
            select users_id, email, phone
            from public.users
            where users_id = %s
            for update
            """,
            (user_id,),
        )
        user = cursor.fetchone()
        if user is None:
            raise HTTPException(status_code=404, detail="User not found.")

        normalized_deleted_email = str(user.get("email") or "").strip().lower()
        raw_deleted_phone = str(user.get("phone") or "").strip()
        normalized_deleted_phone = _normalize_comparable_phone(raw_deleted_phone)
        phone_values = {
            value
            for value in (
                raw_deleted_phone,
                normalized_deleted_phone,
                (
                    f"0{normalized_deleted_phone[2:]}"
                    if normalized_deleted_phone.startswith("63")
                    else ""
                ),
            )
            if value
        }

        cursor.execute(
            """
            select volunteers_id, user_id, email, phone
            from public.volunteers
            where volunteers_id = %s
               or user_id = %s
               or lower(coalesce(email, '')) = %s
               or phone = any(%s)
            """,
            (user_id, user_id, normalized_deleted_email, list(phone_values)),
        )
        volunteer_rows = cursor.fetchall()

        cursor.execute(
            """
            select partners_id, owner_user_id, contact_email, contact_phone
            from public.partners
            where owner_user_id = %s
               or lower(coalesce(contact_email, '')) = %s
               or contact_phone = any(%s)
            """,
            (user_id, normalized_deleted_email, list(phone_values)),
        )
        partner_rows = cursor.fetchall()

        removed_volunteer_ids = {
            str(row.get("volunteers_id") or "").strip()
            for row in volunteer_rows
            if str(row.get("volunteers_id") or "").strip()
        }
        removed_volunteer_user_ids = {user_id}
        removed_volunteer_emails = {
            normalized_deleted_email
        } if normalized_deleted_email else set()
        for row in volunteer_rows:
            linked_user_id = str(row.get("user_id") or "").strip()
            linked_email = str(row.get("email") or "").strip().lower()
            if linked_user_id:
                removed_volunteer_user_ids.add(linked_user_id)
            if linked_email:
                removed_volunteer_emails.add(linked_email)

        removed_partner_ids = {
            str(row.get("partners_id") or "").strip()
            for row in partner_rows
            if str(row.get("partners_id") or "").strip()
        }

        if removed_volunteer_ids:
            cursor.execute(
                "delete from public.volunteers where volunteers_id = any(%s)",
                (list(removed_volunteer_ids),),
            )
        if removed_partner_ids:
            cursor.execute(
                "delete from public.partners where partners_id = any(%s)",
                (list(removed_partner_ids),),
            )

        cursor.execute(
            "delete from public.users where users_id = %s",
            (user_id,),
        )

        if removed_volunteer_ids or removed_volunteer_user_ids:
            cursor.execute(
                """
                delete from public.volunteer_event_joins
                where volunteer_id = any(%s)
                   or volunteer_user_id = any(%s)
                   or lower(coalesce(volunteer_email, '')) = any(%s)
                """,
                (
                    list(removed_volunteer_ids),
                    list(removed_volunteer_user_ids),
                    list(removed_volunteer_emails),
                ),
            )
            cursor.execute(
                "delete from public.volunteer_matches where volunteer_id = any(%s)",
                (list(removed_volunteer_ids),),
            )
            cursor.execute(
                "delete from public.volunteer_time_logs where volunteer_id = any(%s)",
                (list(removed_volunteer_ids),),
            )

    changed_keys = ["users", "volunteers", "partners"]
    if removed_volunteer_ids or removed_volunteer_user_ids:
        changed_keys.extend(
            _update_project_assignments_after_volunteer_delete(
                connection,
                removed_volunteer_ids,
                removed_volunteer_user_ids,
            )
        )
        changed_keys.extend(
            key
            for key in ("volunteerProjectJoins", "volunteerMatches", "volunteerTimeLogs")
            if key not in changed_keys
        )
    return list(dict.fromkeys(changed_keys))


@app.delete("/auth/users/{user_id}")
# API endpoint that deletes one user and linked profile records in one transaction.
async def delete_user_account(user_id: str) -> dict[str, Any]:
    _require_postgres()

    with get_connection() as connection:
        changed_keys = _delete_user_account_records(connection, user_id)
        connection.commit()

    _invalidate_collection_cache(changed_keys)
    _projects_snapshot_cache.clear()
    asyncio.create_task(connection_manager.broadcast_storage_event(changed_keys))
    return {
        "status": "ok",
        "deletedUserId": user_id,
        # Let the caller invalidate only collections that actually changed.
        "changedKeys": changed_keys,
    }


@app.get("/validation/dswd-accreditation/{accreditation_no}")
# API endpoint that validates if a DSWD accreditation number is valid and unassigned.
def validate_dswd_accreditation(accreditation_no: str) -> dict[str, Any]:
    # Basic format validation
    normalized_value = str(accreditation_no or "").strip().upper()
    # This field is optional. Only validate format and assignment when a
    # partner actually supplies an accreditation number.
    if not normalized_value:
        return {"valid": True}
    if len(normalized_value) > 60 or not normalized_value[0].isalnum():
        return {"valid": False, "reason": "Invalid format"}

    # Check regex pattern
    if not re.match(r'^[A-Z0-9][A-Z0-9\-\/]{5,}$', normalized_value):
        return {"valid": False, "reason": "Invalid format"}

    try:
        _require_postgres()
        # Check against database only after the input has passed validation.
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT is_assigned
                    FROM dswd_accreditation_numbers
                    WHERE accreditation_no = %s
                    """,
                    (normalized_value,),
                )

                result = cursor.fetchone()
                if not result:
                    return {"valid": False, "reason": "Accreditation number not found in database"}

                if bool(result[0]):
                    return {"valid": False, "reason": "Accreditation number already assigned"}

                return {"valid": True}
    except Exception as error:
        print(f"[WARN] DSWD accreditation validation unavailable: {type(error).__name__}", flush=True)
        raise HTTPException(
            status_code=503,
            detail="Accreditation validation is temporarily unavailable. Please try again.",
        ) from error


@app.get("/projects/snapshot")
# API endpoint that returns the projects screen snapshot.
def get_projects_snapshot(
    request: FastAPIRequest,
    user_id: str | None = None,
    role: str | None = None,
    fields: str | None = None,
    limit: int | None = None,
    offset: int = 0,
    include_images: bool = False,
) -> dict[str, Any]:
    """Return the project snapshot used by web and native project screens."""
    session = _get_session_user(request)
    session_user_id = str(session.get("sub") or "").strip()
    session_role = str(session.get("role") or "").strip().lower()
    requested_user_id = str(user_id or "").strip()
    requested_role = str(role or "").strip().lower()
    if session_role != "admin":
        if requested_user_id and requested_user_id != session_user_id:
            raise HTTPException(status_code=403, detail="You are not allowed to access another user's project snapshot.")
        user_id = session_user_id
        role = session_role
    elif requested_role and requested_role != "admin" and not requested_user_id:
        raise HTTPException(status_code=400, detail="A user id is required for a scoped snapshot.")

    try:
        _require_postgres()

        requested_fields = _normalize_snapshot_fields(fields)

        # Build a stable cache key from the request parameters
        fields_key = ",".join(sorted(requested_fields)) if requested_fields else "*"
        cache_key = f"snapshot:images-v4:{user_id}:{role}:{fields_key}:{1 if include_images else 0}"

        # Check the snapshot cache first (avoids DB round-trips on warm requests)
        cached_snapshot = _projects_snapshot_cache.get(cache_key)
        if cached_snapshot is not None:
            snapshot = cached_snapshot
        else:
            with get_connection() as connection:
                snapshot = _build_projects_snapshot(
                    connection,
                    user_id,
                    role,
                    requested_fields,
                    include_images,
                )
            _projects_snapshot_cache.set(cache_key, snapshot)

        # Apply pagination to projects if limit is specified
        all_projects = snapshot.get("projects", [])
        if limit is not None and limit > 0:
            paginated_snapshot = dict(snapshot)
            paginated_snapshot["projects"] = all_projects[offset:offset + limit]
            paginated_snapshot["totalProjects"] = len(all_projects)
            paginated_snapshot["hasMore"] = (offset + limit) < len(all_projects)
            paginated_snapshot["events"] = [
                p for p in paginated_snapshot["projects"] if bool(p.get("isEvent"))
            ]
            return paginated_snapshot

        result = dict(snapshot)
        result["totalProjects"] = len(all_projects)
        result["hasMore"] = False
        result["events"] = [
            project
            for project in all_projects
            if bool(project.get("isEvent"))
        ]
        return result
    except Exception as error:
        import sys
        import traceback
        print(f"[ERROR] Snapshot failed: {type(error).__name__}: {error}", flush=True)
        traceback.print_exc()
        print(f"[ERROR] Snapshot failed: {type(error).__name__}: {error}", file=sys.stderr, flush=True)
        # Return valid empty response
        return {
            "projects": [],
            "events": [],
            "statusUpdates": [],
            "programTracks": [],
            "volunteerProfile": None,
            "volunteerMatches": [],
            "timeLogs": [],
            "partnerApplications": [],
            "volunteerJoinRecords": [],
            "totalProjects": 0,
            "hasMore": False,
        }


@app.get("/volunteers/by-user/{user_id}")
# API endpoint that returns a volunteer profile by user id.
def get_volunteer_by_user(request: FastAPIRequest, user_id: str) -> dict[str, Any]:
    _require_same_user_or_admin(request, user_id)
    _require_postgres()
    with get_connection() as connection:
        volunteer = _postgres_get_volunteer_by_user_id(connection, user_id)
        if volunteer is not None:
            volunteer = _postgres_sync_volunteer_engagement_status(
                connection,
                str(volunteer.get("id") or "").strip(),
            ) or volunteer
            connection.commit()
    return {"volunteer": volunteer}


@app.get("/volunteers/{volunteer_id}/recognition")
# API endpoint that returns volunteer recognition metrics.
def get_volunteer_recognition_status(request: FastAPIRequest, volunteer_id: str) -> dict[str, Any]:
    session = _get_session_user(request)
    _require_postgres()
    with get_connection() as connection:
        volunteer = _postgres_get_hot_item_by_id(connection, "volunteers", volunteer_id)
        if volunteer is None:
            raise HTTPException(status_code=404, detail="Volunteer not found.")
        owner_user_id = str(volunteer.get("userId") or "").strip()
        if session.get("role") != "admin" and owner_user_id != str(session.get("sub") or ""):
            raise HTTPException(status_code=403, detail="You are not allowed to access this volunteer record.")
        recognition = _postgres_get_volunteer_recognition_status(connection, volunteer_id)
    return {"recognition": recognition}


@app.get("/volunteers/{volunteer_id}/time-logs")
# API endpoint that returns a volunteer's time logs.
def get_volunteer_logs(request: FastAPIRequest, volunteer_id: str) -> dict[str, Any]:
    session = _get_session_user(request)
    _require_postgres()
    with get_connection() as connection:
        volunteer = _postgres_get_hot_item_by_id(connection, "volunteers", volunteer_id)
        if volunteer is None:
            raise HTTPException(status_code=404, detail="Volunteer not found.")
        owner_user_id = str(volunteer.get("userId") or "").strip()
        if session.get("role") != "admin" and owner_user_id != str(session.get("sub") or ""):
            raise HTTPException(status_code=403, detail="You are not allowed to access these attendance logs.")
        logs = _postgres_reset_stale_daily_time_logs(connection, volunteer_id)
        if session.get("role") == "volunteer":
            _, joined_event_ids = _get_volunteer_joined_event_scope(
                connection,
                str(session.get("sub") or "").strip(),
            )
            logs = [
                log
                for log in logs
                if str(log.get("projectId") or "").strip() in joined_event_ids
            ]
    return {"logs": logs}


@app.post("/volunteers/{volunteer_id}/time-logs/start")
# API endpoint that starts a volunteer time log.
async def start_volunteer_log(
    request: FastAPIRequest,
    volunteer_id: str,
    payload: VolunteerTimeLogStartPayload,
) -> dict[str, Any]:
    session = _get_session_user(request)
    _require_postgres()
    with get_connection() as connection:
        volunteer = _postgres_get_hot_item_by_id(connection, "volunteers", volunteer_id)
        if volunteer is None:
            raise HTTPException(status_code=404, detail="Volunteer not found.")
        if session.get("role") != "admin" and str(volunteer.get("userId") or "").strip() != str(session.get("sub") or ""):
            raise HTTPException(status_code=403, detail="You can only start your own attendance log.")

        project, _ = _postgres_get_project_like_item_by_id(connection, payload.projectId)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found.")

        now = datetime.now(timezone.utc)

        if bool(project.get("isEvent")):
            _, joined_event_ids = _get_volunteer_joined_event_scope(
                connection,
                str(session.get("sub") or "").strip(),
            )
            if payload.projectId not in joined_event_ids:
                raise HTTPException(
                    status_code=403,
                    detail="You must join this event before uploading attendance photos.",
                )

        if bool(project.get("isEvent")) and not _volunteer_is_assigned_to_event_task(
            connection,
            volunteer_id,
            payload.projectId,
        ):
            raise HTTPException(
                status_code=403,
                detail="You must be assigned to an event task before timing in.",
            )

        if bool(project.get("isEvent")) and not _event_attendance_window_has_started(project, now):
            raise HTTPException(
                status_code=400,
                detail="This event has not started yet.",
            )

        if bool(project.get("isEvent")) and _event_attendance_window_has_ended(project, now):
            raise HTTPException(
                status_code=400,
                detail="This event attendance window has already ended.",
            )

        attendance_photo = str(payload.attendancePhoto or "").strip()
        if not attendance_photo:
            raise HTTPException(
                status_code=400,
                detail="Upload an attendance photo to confirm you are on site.",
            )
        try:
            if "," in attendance_photo:
                header, b64_body = attendance_photo.split(",", 1)
                compressed = compress_base64_image(b64_body, max_size_bytes=60_000, max_width=640)
                if compressed:
                    attendance_photo = f"{header},{compressed}"
            else:
                compressed = compress_base64_image(attendance_photo, max_size_bytes=60_000, max_width=640)
                if compressed:
                    attendance_photo = compressed
        except Exception:
            pass

        existing_logs = _postgres_reset_stale_daily_time_logs(connection, volunteer_id, now)
        today_log = next(
            (
                log
                for log in existing_logs
                if log.get("projectId") == payload.projectId
                and _get_local_date_key(log.get("timeIn")) == _get_local_date_key(now.isoformat())
            ),
            None,
        )
        if today_log is not None:
            # A slow client may retry after the first request already committed.
            # Return the canonical log so the retry is safe and the client can
            # immediately render the confirmed state instead of showing an
            # error for an attendance record that actually exists.
            return {"log": today_log}

        new_log = {
            "id": f"timelog-{int(datetime.now(timezone.utc).timestamp() * 1000)}",
            "volunteerId": volunteer_id,
            "projectId": payload.projectId,
            "timeIn": now.isoformat(),
            "attendanceConfirmedAt": now.isoformat(),
            "attendancePhoto": attendance_photo,
            "completionPhoto": attendance_photo,
            "note": payload.note,
        }
        _postgres_upsert_hot_item(connection, "volunteerTimeLogs", new_log)
        connection.commit()
    _invalidate_collection_cache(["volunteerTimeLogs"])
    _projects_snapshot_cache.clear()
    asyncio.create_task(connection_manager.broadcast_storage_event(["volunteerTimeLogs"]))
    return {"log": new_log}


@app.post("/volunteer-time-logs/{log_id}/attendance-check")
async def set_volunteer_attendance_check(
    request: FastAPIRequest,
    log_id: str,
    payload: VolunteerTimeLogAttendanceCheckPayload,
) -> dict[str, Any]:
    session = _get_session_user(request)
    _require_postgres()
    with get_connection() as connection:
        log = _postgres_get_hot_item_by_id(connection, "volunteerTimeLogs", log_id)
        if log is None:
            raise HTTPException(status_code=404, detail="Attendance record not found.")

        if payload.checked and not str(log.get("attendanceConfirmedAt") or "").strip():
            raise HTTPException(
                status_code=400,
                detail="The volunteer must confirm attendance before it can be verified.",
            )

        checked_by_user_id = str(payload.checkedByUserId or "").strip()
        if session.get("role") != "admin":
            if checked_by_user_id and checked_by_user_id != str(session.get("sub") or ""):
                raise HTTPException(status_code=403, detail="You cannot mark attendance for another account.")
            checked_by_user_id = str(session.get("sub") or "")
        checked_by_name = None
        if checked_by_user_id:
            checked_by_user = _postgres_get_hot_item_by_id(connection, "users", checked_by_user_id)
            if checked_by_user is None:
                raise HTTPException(status_code=404, detail="Field officer account not found.")
            checked_by_volunteer = _postgres_get_volunteer_by_user_id(connection, checked_by_user_id)
            is_admin_user = str(checked_by_user.get("role") or "").strip().lower() == "admin"
            if not is_admin_user and not _user_is_field_officer_for_event(
                connection,
                checked_by_user_id,
                str(log.get("projectId") or "").strip(),
            ):
                raise HTTPException(
                    status_code=403,
                    detail="Only the assigned field officer for this event can mark attendance.",
                )
            checked_by_name = (
                str((checked_by_volunteer or {}).get("name") or "").strip()
                or str(checked_by_user.get("name") or "").strip()
                or "Field Officer"
            )

        updated_log = {
            **log,
            "attendanceCheckedAt": datetime.now(timezone.utc).isoformat() if payload.checked else None,
            "attendanceCheckedBy": checked_by_user_id if payload.checked else None,
            "attendanceCheckedByName": checked_by_name if payload.checked else None,
        }
        _postgres_upsert_hot_item(connection, "volunteerTimeLogs", updated_log)
        connection.commit()
    _invalidate_collection_cache(["volunteerTimeLogs"])
    _projects_snapshot_cache.clear()
    asyncio.create_task(connection_manager.broadcast_storage_event(["volunteerTimeLogs"]))
    return {"log": updated_log}


@app.post("/volunteers/{volunteer_id}/time-logs/end")
# API endpoint that ends a volunteer time log.
async def end_volunteer_log(
    request: FastAPIRequest,
    volunteer_id: str,
    payload: VolunteerTimeLogEndPayload,
) -> dict[str, Any]:
    session = _get_session_user(request)
    _require_postgres()
    with get_connection() as connection:
        volunteer = _postgres_get_hot_item_by_id(connection, "volunteers", volunteer_id)
        if volunteer is None:
            raise HTTPException(status_code=404, detail="Volunteer not found.")
        if session.get("role") != "admin" and str(volunteer.get("userId") or "").strip() != str(session.get("sub") or ""):
            raise HTTPException(status_code=403, detail="You can only end your own attendance log.")
        project, _ = _postgres_get_project_like_item_by_id(connection, payload.projectId)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found.")
        if session.get("role") == "volunteer" and bool(project.get("isEvent")):
            _, joined_event_ids = _get_volunteer_joined_event_scope(
                connection,
                str(session.get("sub") or "").strip(),
            )
            if payload.projectId not in joined_event_ids:
                raise HTTPException(
                    status_code=403,
                    detail="You must join this event before accessing its attendance record.",
                )
        existing_logs = _postgres_reset_stale_daily_time_logs(connection, volunteer_id)
        active_log = next(
            (
                log
                for log in existing_logs
                if log.get("projectId") == payload.projectId and not log.get("timeOut")
            ),
            None,
        )
        if active_log is None:
            # Treat a retry after a successful sign-out as idempotent. Without
            # this, the first request can commit while the response is lost,
            # then the retry reports a false "confirm attendance" error.
            completed_log = max(
                (
                    log
                    for log in existing_logs
                    if log.get("projectId") == payload.projectId
                    and log.get("timeOut")
                    and (log.get("completionReport") or log.get("completionPhoto"))
                ),
                key=lambda log: str(log.get("timeOut") or ""),
                default=None,
            )
            if completed_log is not None:
                volunteer = _postgres_get_hot_item_by_id(connection, "volunteers", volunteer_id)
                return {"log": completed_log, "volunteerProfile": volunteer}
            raise HTTPException(
                status_code=400,
                detail="You must confirm attendance before you can complete sign-out.",
            )

        completion_report = str(payload.completionReport or "").strip()
        completion_photo = str(payload.completionPhoto or "").strip()
        if completion_photo:
            try:
                if "," in completion_photo:
                    header, b64_body = completion_photo.split(",", 1)
                    compressed = compress_base64_image(b64_body, max_size_bytes=60_000, max_width=640)
                    if compressed:
                        completion_photo = f"{header},{compressed}"
                else:
                    compressed = compress_base64_image(completion_photo, max_size_bytes=60_000, max_width=640)
                    if compressed:
                        completion_photo = compressed
            except Exception:
                pass

        if not completion_report:
            raise HTTPException(
                status_code=400,
                detail="Submit a completion report before timing out.",
            )

        updated_log = {
            **active_log,
            "timeOut": datetime.now(timezone.utc).isoformat(),
            "completionReport": completion_report or None,
            "completionPhoto": completion_photo or None,
        }
        _postgres_upsert_hot_item(connection, "volunteerTimeLogs", updated_log)
        volunteer = _postgres_add_logged_hours_to_volunteer(connection, volunteer_id, updated_log)
        connection.commit()
    _invalidate_collection_cache(["volunteerTimeLogs", "volunteers"])
    _projects_snapshot_cache.clear()
    asyncio.create_task(
        connection_manager.broadcast_storage_event(["volunteerTimeLogs", "volunteers"])
    )
    return {"log": updated_log, "volunteerProfile": volunteer}


@app.get("/partner-project-applications/by-user/{partner_user_id}")
# API endpoint that returns partner applications by partner user id.
def get_partner_applications_by_user(partner_user_id: str) -> dict[str, Any]:
    _require_postgres()
    with get_connection() as connection:
        applications = _postgres_get_partner_project_applications_by_user(connection, partner_user_id)
    return {"applications": applications}


@app.post("/partner-project-applications/request")
# API endpoint that creates a partner program proposal for admin review.
async def request_partner_project_join(payload: PartnerProjectJoinRequestPayload) -> dict[str, Any]:
    _require_postgres()
    print(f"\n{'='*60}")
    print("[PROPOSAL] REQUEST RECEIVED")
    print(f"  Partner User ID: {payload.partnerUserId}")
    print(f"  Partner Name: {payload.partnerName}")
    print(f"  Project ID: {payload.projectId}")
    print(f"  Program Module: {payload.programModule}")
    print(f"{'='*60}\n")
    
    requested_program_module = str(payload.programModule or "").strip()
    requested_project_id = str(payload.projectId or "").strip()
    proposal_project_id = (
        requested_project_id
        if requested_project_id and requested_project_id != "new"
        else f"program:{requested_program_module}::{int(datetime.now(timezone.utc).timestamp() * 1000)}"
        if requested_program_module
        else requested_project_id
    )

    with get_connection() as connection:
        target_project: dict[str, Any] | None = None
        target_project_id = str((payload.proposalDetails or {}).get("targetProjectId") or "").strip()
        if target_project_id:
            target_project, _ = _postgres_get_project_like_item_by_id(connection, target_project_id)

        if not requested_program_module:
            project = target_project
            if project is None:
                project, _ = _postgres_get_project_like_item_by_id(connection, payload.projectId)
            if project is None:
                raise HTTPException(status_code=404, detail="Project not found.")
            target_project = project

        # New submissions are always independent, even when they target the
        # same program.  Only an explicit rejected-proposal revision updates an
        # existing application.  This avoids an expensive scan of every prior
        # proposal and lets a partner submit another proposal whenever needed.
        incoming_details = payload.proposalDetails if isinstance(payload.proposalDetails, dict) else {}
        previous_application_id = str(incoming_details.get("previousApplicationId") or "").strip()
        if previous_application_id:
            existing_application = _postgres_get_hot_item_by_id(
                connection,
                "partnerProjectApplications",
                previous_application_id,
            )
            if existing_application is not None:
                owner_id = str(existing_application.get("partnerUserId") or "").strip()
                if owner_id and owner_id != str(payload.partnerUserId or "").strip():
                    raise HTTPException(status_code=403, detail="You cannot revise another partner's proposal.")

                existing_status = str(existing_application.get("status") or "").strip()
                if existing_status == "Rejected":
                    try:
                        previous_revision_number = int(existing_application.get("revisionNumber") or 0)
                    except (TypeError, ValueError):
                        previous_revision_number = 0
                    resubmitted_at = datetime.now(timezone.utc).isoformat()
                    refreshed_application = {
                        **existing_application,
                        "projectId": str(existing_application.get("projectId") or proposal_project_id),
                        "partnerUserId": payload.partnerUserId,
                        "partnerName": payload.partnerName,
                        "partnerEmail": payload.partnerEmail,
                        "proposalDetails": _normalize_partner_proposal_details(
                            payload.proposalDetails,
                            requested_program_module,
                            target_project,
                        ),
                        "status": "Pending",
                        "requestedAt": resubmitted_at,
                        "resubmittedAt": resubmitted_at,
                        "revisionNumber": previous_revision_number + 1,
                        "reviewedAt": None,
                        "reviewedBy": None,
                        "reviewNotes": None,
                    }
                    # Keep the response and the background proposal card on the
                    # same compressed attachment payload stored in the database.
                    refreshed_application = _postgres_upsert_hot_item(
                        connection,
                        "partnerProjectApplications",
                        refreshed_application,
                    )
                    connection.commit()
                    _invalidate_collection_cache(["partnerProjectApplications"])
                    _projects_snapshot_cache.clear()
                    asyncio.create_task(connection_manager.broadcast_storage_event(["partnerProjectApplications"]))
                    asyncio.create_task(
                        _create_proposal_submission_message(refreshed_application, payload.partnerUserId)
                    )
                    return {"application": refreshed_application}

        application = {
            "id": f"partner-application-{int(datetime.now(timezone.utc).timestamp() * 1000)}-{secrets.token_hex(4)}",
            "projectId": proposal_project_id,
            "partnerUserId": payload.partnerUserId,
            "partnerName": payload.partnerName,
            "partnerEmail": payload.partnerEmail,
            "proposalDetails": _normalize_partner_proposal_details(
                payload.proposalDetails,
                requested_program_module,
                target_project,
            ),
            "status": "Pending",
            "requestedAt": datetime.now(timezone.utc).isoformat(),
            "revisionNumber": 0,
        }
        # Use the normalized stored record below.  Previously the async card
        # writer received the original photo data and duplicated large images
        # into the messages table.
        application = _postgres_upsert_hot_item(
            connection,
            "partnerProjectApplications",
            application,
        )
        connection.commit()

    _invalidate_collection_cache(["partnerProjectApplications"])
    _projects_snapshot_cache.clear()
    
    asyncio.create_task(connection_manager.broadcast_storage_event(["partnerProjectApplications"]))
    asyncio.create_task(
        _create_proposal_submission_message(application, payload.partnerUserId)
    )
    
    return {"application": application}


@app.patch("/partner-project-applications/{application_id}/details")
# API endpoint that lets an administrator save edits to a pending proposal
# without creating a new submission or changing its review status.
async def update_partner_project_application_details(
    application_id: str, payload: PartnerProjectApplicationUpdatePayload
) -> dict[str, Any]:
    _require_postgres()

    updated_by = str(payload.updatedBy or "").strip()
    if not updated_by:
        raise HTTPException(status_code=400, detail="An administrator id is required.")

    now_iso = datetime.now(timezone.utc).isoformat()
    broadcast_keys = ["partnerProjectApplications"]
    changed_message_events: list[dict[str, Any]] = []
    ensure_message_storage_once()
    from psycopg.rows import dict_row

    with get_connection() as connection:
        application = _postgres_get_hot_item_by_id(
            connection,
            "partnerProjectApplications",
            application_id,
            for_update=True,
        )
        if application is None:
            raise HTTPException(status_code=404, detail="Application not found.")

        if str(application.get("status") or "").strip() != "Pending":
            raise HTTPException(status_code=409, detail="Only pending proposals can be edited.")

        existing_details = application.get("proposalDetails")
        existing_details = existing_details if isinstance(existing_details, dict) else {}
        incoming_details = payload.proposalDetails if isinstance(payload.proposalDetails, dict) else {}
        merged_details = {**existing_details, **incoming_details}

        fallback_project = None
        target_project_id = str(merged_details.get("targetProjectId") or "").strip()
        if target_project_id:
            fallback_project, _ = _postgres_get_project_like_item_by_id(connection, target_project_id)

        requested_program_module = str(
            merged_details.get("requestedProgramModule")
            or existing_details.get("requestedProgramModule")
            or ""
        ).strip()
        normalized_details = _normalize_partner_proposal_details(
            merged_details,
            requested_program_module,
            fallback_project,
        )
        updated_application = {
            **application,
            "proposalDetails": normalized_details,
            "updatedAt": now_iso,
            "updatedBy": updated_by,
        }
        _postgres_upsert_hot_item(connection, "partnerProjectApplications", updated_application)

        # Keep the current submission card in sync for every participant. Review
        # cards remain historical snapshots and are intentionally left unchanged.
        # Proposal submission cards always originate from the partner. Filter
        # by that indexed participant first instead of scanning every saved
        # message just to find this application's card.
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                select messages_id, sender_id, recipient_id, project_id, content,
                       timestamp, read, attachments
                from public.messages
                where sender_id = %s
                  and content like '___PROPOSAL_CARD___:%%'
                order by timestamp desc, messages_id desc
                """,
                (str(application.get("partnerUserId") or ""),),
            )
            proposal_messages = cursor.fetchall()
            for proposal_message in proposal_messages:
                message_id = str(proposal_message.get("messages_id") or "")
                content = proposal_message.get("content")
                if not isinstance(content, str) or not content.startswith("___PROPOSAL_CARD___:"):
                    continue
                try:
                    card = json.loads(content[len("___PROPOSAL_CARD___:"):])
                except (TypeError, ValueError, json.JSONDecodeError):
                    continue
                card_application_id = str(card.get("applicationId") or card.get("id") or "").strip()
                if card_application_id != application_id or str(message_id).startswith("review-card-"):
                    continue
                updated_card = {
                    **card,
                    **normalized_details,
                    "proposalDetails": normalized_details,
                    "status": updated_application.get("status"),
                    "applicationId": application_id,
                    "id": application_id,
                    "projectId": updated_application.get("projectId"),
                    "updatedAt": now_iso,
                    "updatedBy": updated_by,
                }
                cursor.execute(
                    """
                    update public.messages
                    set content = %s
                    where messages_id = %s
                    returning messages_id, sender_id, recipient_id, project_id,
                              content, timestamp, read, attachments
                    """,
                    (f'___PROPOSAL_CARD___:{json.dumps(updated_card)}', message_id),
                )
                updated_message = cursor.fetchone()
                if updated_message is not None:
                    changed_message_events.append(serialize_message_row(updated_message))
                    broadcast_keys.append("messages")

        connection.commit()

    _invalidate_collection_cache(broadcast_keys)
    asyncio.create_task(connection_manager.broadcast_storage_event(broadcast_keys))
    for changed_message in changed_message_events:
        asyncio.create_task(connection_manager.broadcast_message_event(changed_message))
    return {"application": updated_application}


@app.post("/partner-project-applications/{application_id}/review")
# API endpoint that approves or rejects a partner proposal/join request.
# Approved partner program proposals automatically create a new project in the program management suite.
async def review_partner_project_application(
    application_id: str, payload: PartnerProjectApplicationReviewPayload
) -> dict[str, Any]:
    _require_postgres()
    next_status = str(payload.status or "").strip()
    if next_status not in {"Approved", "Rejected"}:
        raise HTTPException(status_code=400, detail="Partner application review must approve or reject the request.")

    reviewed_by = str(payload.reviewedBy or "").strip()
    if not reviewed_by:
        raise HTTPException(status_code=400, detail="A reviewer id is required.")
    review_notes = str(payload.reviewNotes or "").strip()

    broadcast_keys = ["partnerProjectApplications"]
    generated_project: dict[str, Any] | None = None
    review_message_data: dict[str, Any] | None = None
    ensure_message_storage_once()
    from psycopg.rows import dict_row
    with get_connection() as connection:
        application = _postgres_get_hot_item_by_id(
            connection,
            "partnerProjectApplications",
            application_id,
            for_update=True,
        )
        if application is None:
            raise HTTPException(status_code=404, detail="Application not found.")

        current_status = str(application.get("status") or "Pending").strip()
        if current_status != "Pending":
            raise HTTPException(
                status_code=409,
                detail=f"This proposal has already been {current_status.lower()} and cannot be reviewed again.",
            )

        next_project_id = str(application.get("projectId") or "")
        raw_proposal_details = application.get("proposalDetails")
        has_project_proposal_details = isinstance(raw_proposal_details, dict) and any(
            str(raw_proposal_details.get(key) or "").strip()
            for key in (
                "proposedTitle",
                "proposedDescription",
                "proposedStartDate",
                "proposedLocation",
                "communityNeed",
                "expectedDeliverables",
            )
        )
        should_create_program_project = (
            next_status == "Approved"
            and not next_project_id.startswith("project-proposal-")
            and (next_project_id.startswith("program:") or has_project_proposal_details)
        )

        if should_create_program_project:
            fallback_project = None
            if next_project_id and not next_project_id.startswith("program:"):
                fallback_project, _fallback_project_storage_key = _postgres_get_project_like_item_by_id(
                    connection,
                    next_project_id,
                )
            proposal_details = _normalize_partner_proposal_details(
                raw_proposal_details if isinstance(raw_proposal_details, dict) else {},
                "",
                fallback_project,
            )
            fallback_program_module = next_project_id.split(":", 1)[1] if ":" in next_project_id else ""
            requested_program_module = str(
                proposal_details.get("requestedProgramModule")
                or fallback_program_module.split("::", 1)[0]
            ).strip()
            if not requested_program_module:
                raise HTTPException(status_code=400, detail="Program module is required to approve this proposal.")

            now_iso = datetime.now(timezone.utc).isoformat()
            partner_user_id = str(application.get("partnerUserId") or "")
            partner_email = str(application.get("partnerEmail") or "").strip().lower()
            partner_name = str(application.get("partnerName") or "Partner").strip() or "Partner"

            partner_records = _postgres_get_hot_items_by_field(connection, "partners", "owner_user_id", partner_user_id)
            if not partner_records and partner_email:
                all_partners = get_postgres_hot_storage_collection(connection, "partners")
                partner_records = [
                    candidate
                    for candidate in all_partners
                    if str(candidate.get("contactEmail") or "").strip().lower() == partner_email
                ]

            partner_id = str(partner_records[0].get("id") or "") if partner_records else ""
            created_project_id = f"project-proposal-{int(datetime.now(timezone.utc).timestamp() * 1000)}"
            parent_project_id = _normalize_proposal_parent_project_id(
                proposal_details.get("targetProjectId")
                or proposal_details.get("targetProgramId")
                or proposal_details.get("programId")
                or next_project_id
            )
            generated_start_date = _normalize_partner_proposal_date(
                proposal_details.get("proposedStartDate"),
                now_iso,
            )
            generated_end_date = _normalize_partner_proposal_date(
                proposal_details.get("proposedEndDate"),
                generated_start_date,
            )
            if datetime.fromisoformat(generated_end_date) < datetime.fromisoformat(generated_start_date):
                generated_end_date = generated_start_date

            generated_project = {
                "id": created_project_id,
                "title": str(proposal_details.get("proposedTitle") or "").strip()
                or f"{requested_program_module} Partner Program - {partner_name}",
                "description": str(proposal_details.get("proposedDescription") or "").strip()
                or f"Partner-initiated {requested_program_module} program approved by admin.",
                "partnerId": partner_id,
                "imageUrl": next(
                    (
                        str(attachment.get("url") or "").strip()
                        for attachment in (proposal_details.get("attachments") or [])
                        if isinstance(attachment, dict)
                        and str(attachment.get("type") or "").strip() == "image"
                        and str(attachment.get("url") or "").strip()
                    ),
                    None,
                ),
                "imageHidden": not any(
                    isinstance(attachment, dict)
                    and str(attachment.get("type") or "").strip() == "image"
                    and str(attachment.get("url") or "").strip()
                    for attachment in (proposal_details.get("attachments") or [])
                ),
                "parentProjectId": parent_project_id or None,
                # Keep the explicit program link in sync with the parent link so
                # list, analytics, and program-detail views classify the project
                # consistently even when they do not traverse parentProjectId.
                "program_id": parent_project_id or None,
                "programModule": requested_program_module,
                "statusMode": "System",
                "manualStatus": None,
                "status": "Planning",
                "category": _normalize_project_category(requested_program_module),
                "startDate": generated_start_date,
                "endDate": generated_end_date,
                "location": {
                    "latitude": None,
                    "longitude": None,
                    "address": str(proposal_details.get("proposedLocation") or "").strip()
                    or str(proposal_details.get("targetProjectAddress") or "").strip()
                    or "Location to be finalized",
                },
                "volunteersNeeded": max(int(proposal_details.get("proposedVolunteersNeeded") or 0), 0),
                "skillsNeeded": proposal_details.get("skillsNeeded") or [],
                "communityNeed": str(proposal_details.get("communityNeed") or "").strip(),
                "expectedDeliverables": str(proposal_details.get("expectedDeliverables") or "").strip(),
                "attachments": proposal_details.get("attachments") or [],
                "volunteers": [],
                "joinedUserIds": [],
                "createdAt": now_iso,
                "updatedAt": now_iso,
                "statusUpdates": [],
                "internalTasks": [],
            }
            _postgres_upsert_hot_item(connection, "projects", generated_project)
            next_project_id = created_project_id
            broadcast_keys.append("projects")

        reviewed_at = datetime.now(timezone.utc).isoformat()
        updated_application = {
            **application,
            "projectId": next_project_id,
            "status": next_status,
            "reviewedAt": reviewed_at,
            "reviewedBy": reviewed_by,
            "reviewNotes": review_notes if next_status == "Rejected" else None,
        }
        _postgres_upsert_hot_item(connection, "partnerProjectApplications", updated_application)

        if next_status in {"Rejected", "Approved"}:
            broadcast_keys.append("messages")
            message_sender_id = _resolve_admin_message_user_id(connection, reviewed_by)
            message_recipient_id = str(updated_application.get("partnerUserId") or "")
            # Create unique message IDs that include the application ID to ensure they don't conflict
            message_id = f"review-card-{next_status.lower()}-{updated_application.get('id')}-{int(datetime.now(timezone.utc).timestamp() * 1000)}"
            proposal_details = updated_application.get("proposalDetails")
            if not isinstance(proposal_details, dict):
                proposal_details = {}
            returned_card = {
                **proposal_details,
                "status": next_status,
                "proposedById": updated_application.get("partnerUserId"),
                "proposedByName": updated_application.get("partnerName"),
                "partnerEmail": updated_application.get("partnerEmail"),
                "applicationId": updated_application.get("id"),
                "id": updated_application.get("id"),  # Keep application ID for tracking
                "projectId": updated_application.get("projectId"),
                "reviewedBy": reviewed_by,
                "reviewedAt": reviewed_at,
                "reviewNotes": review_notes or None,
                "revisionNumber": updated_application.get("revisionNumber") or 0,
                "timestamp": reviewed_at,
            }
            if next_status == "Approved" and generated_project is not None:
                returned_card["approvedProjectTitle"] = str(generated_project.get("title") or "")
                returned_card["approvedProjectId"] = next_project_id
            with connection.cursor(row_factory=dict_row) as cursor:
                cursor.execute(
                    """
                    insert into public.messages (
                      messages_id, sender_id, recipient_id, project_id, content, timestamp, read, attachments
                    )
                    values (%s, %s, %s, %s, %s, %s, %s, %s)
                    on conflict (messages_id) do nothing
                    returning messages_id, sender_id, recipient_id, project_id,
                              content, timestamp, read, attachments
                    """,
                    (
                        message_id,
                        message_sender_id,
                        message_recipient_id,
                        None,
                        _sanitize_proposal_content_payload(f"___PROPOSAL_CARD___:{json.dumps(returned_card)}"),
                        reviewed_at,
                        False,
                        "[]",
                    ),
                )
                review_message_row = cursor.fetchone()

            # Use the canonical serialized database row for WebSocket and
            # response delivery. It applies image-size safeguards before the
            # card reaches a slower mobile client.
            if review_message_row is not None:
                review_message_data = serialize_message_row(review_message_row)
            # DO NOT reconcile submission cards - keep them separate for conversation history
            # _reconcile_partner_proposal_submission_cards(connection, application_id)

        connection.commit()
        _invalidate_collection_cache(broadcast_keys)
        _projects_snapshot_cache.clear()

    # Deliver the card itself first. A storage notification is only a backup
    # for surrounding lists; the direct-message event renders the result now.
    if review_message_data is not None:
        try:
            await asyncio.wait_for(
                connection_manager.broadcast_message_event(review_message_data),
                timeout=1,
            )
        except asyncio.TimeoutError:
            # Do not let an unresponsive old tab slow the review action. The
            # reconnecting client will receive the event on the retry path.
            asyncio.create_task(connection_manager.broadcast_message_event(review_message_data))

    asyncio.create_task(connection_manager.broadcast_storage_event(broadcast_keys))
    response: dict[str, Any] = {"application": updated_application}
    if generated_project is not None:
        response["project"] = generated_project
    if review_message_data is not None:
        response["reviewMessage"] = review_message_data
    return response


@app.post("/volunteer-matches/{match_id}/review")
# API endpoint that approves or rejects a volunteer join request.
async def review_volunteer_match(match_id: str, payload: VolunteerMatchReviewPayload) -> dict[str, Any]:
    _require_postgres()
    next_status = str(payload.status or "").strip()
    if next_status not in {"Matched", "Rejected"}:
        raise HTTPException(status_code=400, detail="Volunteer request review must match or reject the request.")

    reviewed_by = str(payload.reviewedBy or "").strip()
    if not reviewed_by:
        raise HTTPException(status_code=400, detail="A reviewer id is required.")

    broadcast_keys = ["volunteerMatches"]
    with get_connection() as connection:
        match = _postgres_get_hot_item_by_id(connection, "volunteerMatches", match_id)
        if match is None:
            raise HTTPException(status_code=404, detail="Volunteer request not found.")

        volunteer_id = str(match.get("volunteerId") or "")
        volunteer = _postgres_get_hot_item_by_id(connection, "volunteers", volunteer_id)
        if volunteer is None:
            raise HTTPException(status_code=404, detail="Volunteer not found.")

        project_id = str(match.get("projectId") or "")
        project, project_storage_key = _postgres_get_project_like_item_by_id(connection, project_id)
        if project is None or project_storage_key is None:
            raise HTTPException(status_code=404, detail="Project not found.")
        if not bool(project.get("isEvent")):
            raise HTTPException(status_code=400, detail="Volunteers can only join events.")

        updated_match = {
            **match,
            "status": next_status,
            "requestedAt": str(match.get("requestedAt") or match.get("matchedAt") or ""),
            "matchedAt": datetime.now(timezone.utc).isoformat(),
            "reviewedAt": datetime.now(timezone.utc).isoformat(),
            "reviewedBy": reviewed_by,
        }
        _postgres_upsert_hot_item(connection, "volunteerMatches", updated_match)

        if next_status == "Matched":
            joined_user_ids = list(project.get("joinedUserIds") or [])
            volunteer_ids = list(project.get("volunteers") or [])
            volunteer_user_id = str(volunteer.get("userId") or "")

            _postgres_upsert_hot_item(
                connection,
                project_storage_key,
                {
                    **project,
                    "joinedUserIds": joined_user_ids
                    if volunteer_user_id in joined_user_ids
                    else [*joined_user_ids, volunteer_user_id],
                    "volunteers": volunteer_ids
                    if volunteer_id in volunteer_ids
                    else [*volunteer_ids, volunteer_id],
                    "updatedAt": datetime.now(timezone.utc).isoformat(),
                },
            )
            _postgres_ensure_volunteer_project_join_record(connection, project_id, volunteer, "VolunteerJoin")
            broadcast_keys.extend([project_storage_key, "volunteerProjectJoins"])

        updated_volunteer = _postgres_sync_volunteer_engagement_status(connection, volunteer_id)
        if updated_volunteer is not None:
            broadcast_keys.append("volunteers")

        connection.commit()

    # Broadcast is best-effort and should not block the reviewer response when
    # a stale websocket takes a while to time out.
    asyncio.create_task(
        connection_manager.broadcast_storage_event(list(dict.fromkeys(broadcast_keys)))
    )
    return {"match": updated_match}


@app.post("/projects/{project_id}/join")
# API endpoint that joins a user directly to a project or event.
async def join_project(project_id: str, payload: ProjectJoinPayload) -> dict[str, Any]:
    _require_postgres()
    with get_connection() as connection:
        project, project_storage_key = _postgres_get_project_like_item_by_id(connection, project_id)
        if project is None or project_storage_key is None:
            raise HTTPException(status_code=404, detail="Project not found.")
        if not bool(project.get("isEvent")):
            raise HTTPException(status_code=400, detail="Volunteers can only join events.")

        volunteer = _postgres_get_volunteer_by_user_id(connection, payload.userId)
        joined_user_ids = list(project.get("joinedUserIds") or [])
        if payload.userId not in joined_user_ids:
            joined_user_ids.append(payload.userId)

        volunteer_ids = list(project.get("volunteers") or [])
        volunteer_id = volunteer.get("id") if volunteer is not None else None
        if isinstance(volunteer_id, str) and volunteer_id not in volunteer_ids:
            volunteer_ids.append(volunteer_id)

        updated_project = {
            **project,
            "joinedUserIds": joined_user_ids,
            "volunteers": volunteer_ids,
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        }
        _postgres_upsert_hot_item(connection, project_storage_key, updated_project)

        volunteer_profile = volunteer
        if volunteer is not None:
            _postgres_ensure_volunteer_project_join_record(connection, project_id, volunteer, "VolunteerJoin")
            volunteer_profile = _postgres_sync_volunteer_engagement_status(connection, volunteer["id"]) or volunteer

        connection.commit()

    asyncio.create_task(
        connection_manager.broadcast_storage_event([project_storage_key, "volunteerProjectJoins", "volunteers"])
    )
    return {"project": updated_project, "volunteerProfile": volunteer_profile}


@app.delete("/projects/{project_id}/volunteers/{volunteer_id}")
# API endpoint that removes a volunteer from a project/event.
async def remove_volunteer_from_project(project_id: str, volunteer_id: str) -> dict[str, Any]:
    _require_postgres()
    with get_connection() as connection:
        project, project_storage_key = _postgres_get_project_like_item_by_id(connection, project_id)
        if project is None or project_storage_key is None:
            raise HTTPException(status_code=404, detail="Project not found.")
        if not bool(project.get("isEvent")):
            raise HTTPException(status_code=400, detail="Can only remove volunteers from events.")

        volunteer = _postgres_get_hot_item_by_id(connection, "volunteers", volunteer_id)
        if volunteer is None:
            # Older clients may send the linked account id instead of the
            # volunteer profile id. Resolve it before cleaning task aliases,
            # join records, and the derived engagement status.
            volunteer = _postgres_get_volunteer_by_user_id(connection, volunteer_id)

        volunteer_ids_to_remove = {
            str(value or "").strip()
            for value in (volunteer_id, volunteer.get("id") if volunteer else None)
            if str(value or "").strip()
        }
        volunteer_user_ids_to_remove: set[str] = set()
        if volunteer is not None:
            volunteer_user_id = str(volunteer.get("userId") or "").strip()
            if volunteer_user_id:
                volunteer_user_ids_to_remove.add(volunteer_user_id)

        all_join_records = get_postgres_hot_storage_collection(connection, "volunteerProjectJoins")
        matching_join_records = [
            record
            for record in all_join_records
            if str(record.get("projectId") or "") == project_id
            and str(record.get("volunteerId") or "").strip() == volunteer_id
        ]
        for record in matching_join_records:
            record_user_id = str(record.get("volunteerUserId") or "").strip()
            if record_user_id:
                volunteer_user_ids_to_remove.add(record_user_id)

        updated_project, _ = _remove_volunteer_assignments_from_project(
            project,
            volunteer_ids_to_remove,
            volunteer_user_ids_to_remove,
        )
        _postgres_upsert_hot_item(connection, project_storage_key, updated_project)

        updated_join_records = [
            record
            for record in all_join_records
            if not (
                str(record.get("projectId") or "") == project_id
                and (
                    str(record.get("volunteerId") or "").strip() in volunteer_ids_to_remove
                    or str(record.get("volunteerUserId") or "").strip() in volunteer_user_ids_to_remove
                )
            )
        ]
        if len(updated_join_records) != len(all_join_records):
            replace_postgres_hot_storage_collection(connection, "volunteerProjectJoins", updated_join_records)

        all_matches = get_postgres_hot_storage_collection(connection, "volunteerMatches")
        updated_matches = [
            match
            for match in all_matches
            if not (
                str(match.get("projectId") or "") == project_id
                and str(match.get("volunteerId") or "").strip() in volunteer_ids_to_remove
            )
        ]
        if len(updated_matches) != len(all_matches):
            replace_postgres_hot_storage_collection(connection, "volunteerMatches", updated_matches)

        updated_volunteer = (
            _postgres_sync_volunteer_engagement_status(connection, volunteer_id)
            if volunteer is not None
            else None
        )

        connection.commit()

    changed_keys = [
        project_storage_key,
        "volunteerProjectJoins",
        "volunteerMatches",
        "volunteers"
    ]
    _invalidate_collection_cache(changed_keys)
    _projects_snapshot_cache.clear()
    await connection_manager.broadcast_storage_event(changed_keys)
    return {"success": True, "project": updated_project, "volunteerProfile": updated_volunteer}


def _compact_proposal_message_content(content: Any) -> str:
    """Remove media from a proposal card while retaining its display data."""
    raw_content = str(content or "")
    if not raw_content.startswith(_PROPOSAL_CARD_PREFIX):
        return raw_content[:280]

    try:
        data = json.loads(raw_content[len(_PROPOSAL_CARD_PREFIX):])
        if not isinstance(data, dict):
            return f"{_PROPOSAL_CARD_PREFIX}{json.dumps({'compact': True})}"

        media_keys = {
            "attachments",
            "photoAttachment",
            "documentAttachment",
            "imageUrl",
            "profilePhoto",
        }

        def remove_media(value: Any) -> Any:
            if isinstance(value, dict):
                return {
                    key: remove_media(item)
                    for key, item in value.items()
                    if key not in media_keys
                }
            if isinstance(value, list):
                return [remove_media(item) for item in value]
            return value

        compact_data = remove_media(data)
        serialized = json.dumps(compact_data, separators=(",", ":"))
        # Legacy cards can contain arbitrary extra fields. Keep a small,
        # display-complete fallback if stripping media is still too large.
        if len(serialized) > 16000:
            details = data.get("proposalDetails")
            details = details if isinstance(details, dict) else data
            compact_data = {
                key: data.get(key)
                for key in (
                    "id",
                    "applicationId",
                    "projectId",
                    "targetProjectId",
                    "status",
                    "revisionNumber",
                    "partnerUserId",
                    "partnerName",
                    "partnerEmail",
                    "reviewNotes",
                )
                if data.get(key) not in (None, "")
            }
            compact_data["proposalDetails"] = {
                key: details.get(key)
                for key in (
                    "proposedTitle",
                    "proposedDescription",
                    "proposedStartDate",
                    "proposedEndDate",
                    "proposedLocation",
                    "proposedVolunteersNeeded",
                    "requestedProgramModule",
                )
                if details.get(key) not in (None, "")
            }
            serialized = json.dumps(compact_data, separators=(",", ":"))

        return f"{_PROPOSAL_CARD_PREFIX}{serialized}"
    except Exception:
        return f"{_PROPOSAL_CARD_PREFIX}{json.dumps({'compact': True})}"


@app.get("/messages")
# API endpoint that returns all direct messages for one user.
def get_messages(
    user_id: str,
    limit: int = 120,
    compact: bool = False,
) -> dict[str, list[dict[str, Any]]]:
    import time
    ensure_message_storage_once()
    limit_val = max(1, min(int(limit), 100 if compact else 120))
    cache_key = f"messages:{user_id}:{limit_val}:{'compact' if compact else 'full'}"
    cached = _message_query_cache.get(cache_key)
    if cached is not None:
        return cached

    # Multiple browser tabs and the former polling fallback can request this
    # exact inbox at once.  One query populates the cache; the rest reuse it.
    with _get_message_query_lock(cache_key):
        cached = _message_query_cache.get(cache_key)
        if cached is not None:
            return cached

        request_start = time.time()
        from psycopg.rows import dict_row

        # The compact inbox powers the account/contact list and the first paint
        # of an opened conversation. Keep proposal text/status/details, but
        # remove media fields so cards can render before their photos/files
        # arrive from the richer conversation request.
        content_expression = (
            "case when content like '___PROPOSAL_CARD___:%%' "
            "then content else left(content, 280) end as content"
            if compact
            else "content"
        )
        attachments_expression = "'[]'::text" if compact else "attachments"

        with get_connection() as connection:
            current_user = _get_user_by_id(user_id, connection)
            current_role = str(current_user.get("role") or "") if current_user else ""

            query_start = time.time()
            with connection.cursor(row_factory=dict_row) as cursor:
                # UNION ALL lets Postgres use the sender and recipient indexes
                # independently instead of scanning the full messages table for
                # an `OR` condition.
                cursor.execute(
                    f"""
                    select messages_id, sender_id, recipient_id, project_id, content, timestamp, read, attachments
                    from (
                      select messages_id, sender_id, recipient_id, project_id, {content_expression}, timestamp, read,
                             {attachments_expression} as attachments
                      from public.messages
                      where sender_id = %s
                      union all
                      select messages_id, sender_id, recipient_id, project_id, {content_expression}, timestamp, read,
                             {attachments_expression} as attachments
                      from public.messages
                      where recipient_id = %s
                    ) as user_messages
                    order by timestamp desc, messages_id desc
                    limit %s
                    """,
                    (user_id, user_id, limit_val),
                )
                rows = cursor.fetchall()
            query_time = time.time() - query_start

            if compact:
                for row in rows:
                    row["content"] = _compact_proposal_message_content(row.get("content"))

            if current_role and rows:
                # Batch-fetch all other-user IDs in one query instead of N+1 lookups.
                batch_start = time.time()
                other_user_ids = list({
                    (row["recipient_id"] if row["sender_id"] == user_id else row["sender_id"])
                    for row in rows
                })
                with connection.cursor(row_factory=dict_row) as cursor:
                    cursor.execute(
                        "SELECT users_id AS id, role FROM users WHERE users_id = ANY(%s)",
                        (other_user_ids,),
                    )
                    role_by_id = {r["id"]: str(r["role"] or "") for r in cursor.fetchall()}
                canonical_admin_id = _resolve_admin_message_user_id(connection)
                if canonical_admin_id:
                    role_by_id[canonical_admin_id] = "admin"
                    for row in rows:
                        content = str(row.get("content") or "")
                        if not content.startswith("___PROPOSAL_CARD___:"):
                            continue
                        other_user_id = (
                            row["recipient_id"] if row["sender_id"] == user_id else row["sender_id"]
                        )
                        if role_by_id.get(other_user_id, ""):
                            continue
                        if row["recipient_id"] == user_id:
                            row["sender_id"] = canonical_admin_id
                        elif row["sender_id"] == user_id:
                            row["recipient_id"] = canonical_admin_id
                batch_time = time.time() - batch_start

                filter_start = time.time()
                rows = [
                    row for row in rows
                    if _is_direct_message_pair_allowed(
                        current_role,
                        role_by_id.get(
                            row["recipient_id"] if row["sender_id"] == user_id else row["sender_id"],
                            ""
                        )
                    )
                ]
                filter_time = time.time() - filter_start
                total_time = time.time() - request_start
                if total_time > 2.0:
                    print(
                        f"[PERF] /messages ({'compact' if compact else 'full'}) for {user_id}: "
                        f"query={query_time:.1f}s, batch={batch_time:.1f}s, "
                        f"filter={filter_time:.1f}s, total={total_time:.1f}s, found {len(rows)} messages"
                    )
            elif time.time() - request_start > 2.0:
                print(
                    f"[PERF] /messages ({'compact' if compact else 'full'}) for {user_id}: "
                    f"query={query_time:.1f}s, total={time.time() - request_start:.1f}s, found {len(rows)} messages"
                )

        result = {"messages": [serialize_message_row(row) for row in rows]}
        _message_query_cache.set(cache_key, result)
        return result


@app.get("/messages/unread")
def get_unread_messages(user_id: str, limit: int = 100) -> dict[str, list[dict[str, Any]]]:
    ensure_message_storage_once()
    limit_val = max(1, min(int(limit), 100))
    cache_key = f"messages:unread:{user_id}:{limit_val}"
    cached = _message_query_cache.get(cache_key)
    if cached is not None:
        return cached

    with _get_message_query_lock(cache_key):
        cached = _message_query_cache.get(cache_key)
        if cached is not None:
            return cached

        from psycopg.rows import dict_row

        with get_connection() as connection:
            with connection.cursor(row_factory=dict_row) as cursor:
                cursor.execute(
                    """
                    select messages_id,
                           sender_id,
                           recipient_id,
                           project_id,
                           left(content, 1000) as content,
                           timestamp,
                           read,
                           '[]'::text as attachments
                    from public.messages
                    where recipient_id = %s and read = false
                    order by timestamp desc, messages_id desc
                    limit %s
                    """,
                    (user_id, limit_val),
                )
                rows = cursor.fetchall()

        result = {"messages": [serialize_message_row(row) for row in rows]}
        _message_query_cache.set(cache_key, result)
        return result


@app.get("/messages/conversation")
# API endpoint that returns the direct-message history between two users.
def get_conversation(user1: str, user2: str, limit: int = 120) -> dict[str, list[dict[str, Any]]]:
    import time
    ensure_message_storage_once()
    limit_val = max(1, min(int(limit), 120))
    cache_key = f"conversation:{min(user1, user2)}:{max(user1, user2)}:{limit_val}"
    cached = _message_query_cache.get(cache_key)
    if cached is not None:
        return cached

    with _get_message_query_lock(cache_key):
        cached = _message_query_cache.get(cache_key)
        if cached is not None:
            return cached

        request_start = time.time()
        from psycopg.rows import dict_row

        with get_connection() as connection:
            _assert_direct_message_access(connection, user1, user2)
            canonical_admin_id = _resolve_admin_message_user_id(connection)

            partner_user_id = ""
            if user1 == canonical_admin_id:
                partner_user_id = user2
            elif user2 == canonical_admin_id:
                partner_user_id = user1

            query_start = time.time()
            with connection.cursor(row_factory=dict_row) as cursor:
                if partner_user_id:
                    # Each branch can use a narrow participant index.  The old
                    # four-way OR made Postgres inspect every large proposal
                    # card just to find messages for one partner.
                    cursor.execute(
                        """
                        with candidate_messages as (
                          select messages_id, sender_id, recipient_id, project_id, content, timestamp, read, attachments
                          from public.messages
                          where sender_id = %s and recipient_id = %s
                          union all
                          select messages_id, sender_id, recipient_id, project_id, content, timestamp, read, attachments
                          from public.messages
                          where sender_id = %s and recipient_id = %s
                          union all
                          select messages_id, sender_id, recipient_id, project_id, content, timestamp, read, attachments
                          from public.messages
                          where recipient_id = %s and content like '___PROPOSAL_CARD___:%%'
                          union all
                          select messages_id, sender_id, recipient_id, project_id, content, timestamp, read, attachments
                          from public.messages
                          where sender_id = %s and content like '___PROPOSAL_CARD___:%%'
                        ),
                        deduplicated_messages as (
                          select distinct on (messages_id)
                            messages_id, sender_id, recipient_id, project_id, content, timestamp, read, attachments
                          from candidate_messages
                          order by messages_id, timestamp desc
                        )
                        select messages_id, sender_id, recipient_id, project_id, content, timestamp, read, attachments
                        from deduplicated_messages
                        order by timestamp asc, messages_id asc
                        limit %s
                        """,
                        (user1, user2, user2, user1, partner_user_id, partner_user_id, limit_val),
                    )
                else:
                    cursor.execute(
                        """
                        select messages_id, sender_id, recipient_id, project_id, content, timestamp, read, attachments
                        from (
                          select messages_id, sender_id, recipient_id, project_id, content, timestamp, read, attachments
                          from public.messages
                          where sender_id = %s and recipient_id = %s
                          union all
                          select messages_id, sender_id, recipient_id, project_id, content, timestamp, read, attachments
                          from public.messages
                          where sender_id = %s and recipient_id = %s
                        ) as conversation_messages
                        order by timestamp asc, messages_id asc
                        limit %s
                        """,
                        (user1, user2, user2, user1, limit_val),
                    )
                rows = cursor.fetchall()
                if canonical_admin_id and partner_user_id:
                    for row in rows:
                        if row["recipient_id"] == partner_user_id and row["sender_id"] != partner_user_id:
                            row["sender_id"] = canonical_admin_id
                        elif row["sender_id"] == partner_user_id and row["recipient_id"] != partner_user_id:
                            row["recipient_id"] = canonical_admin_id
            query_time = time.time() - query_start
            total_time = time.time() - request_start
            if total_time > 2.0:
                print(
                    f"[PERF] /messages/conversation between {user1} and {user2}: "
                    f"query={query_time:.1f}s, total={total_time:.1f}s, found {len(rows)} messages"
                )

        result = {"messages": [serialize_message_row(row) for row in rows]}
        _message_query_cache.set(cache_key, result)
        return result


@app.delete("/messages/conversation")
# API endpoint that deletes the direct-message history for both participants.
async def delete_conversation(
    user1: str,
    user2: str,
    requester_id: str,
    request: FastAPIRequest,
) -> dict[str, Any]:
    ensure_message_storage_once()
    requester_id = str(requester_id or "").strip()
    _require_session_user(request, requester_id)
    if requester_id not in {user1, user2}:
        raise HTTPException(status_code=403, detail="You cannot delete this conversation.")

    with get_connection() as connection:
        _assert_direct_message_access(connection, user1, user2)
        with connection.cursor() as cursor:
            cursor.execute(
                """
                delete from public.messages
                where (sender_id = %s and recipient_id = %s)
                   or (sender_id = %s and recipient_id = %s)
                returning messages_id
                """,
                (user1, user2, user2, user1),
            )
            deleted_ids = [str(row[0]) for row in cursor.fetchall()]
        connection.commit()

    if deleted_ids:
        _invalidate_collection_cache(["messages"])
        await connection_manager.broadcast_message_deleted_event(
            deleted_ids,
            user1,
            user2,
        )
        await connection_manager.broadcast_storage_event(["messages"])

    return {"deletedCount": len(deleted_ids), "deletedIds": deleted_ids}

@app.get("/projects/{project_id}/group-messages")
# API endpoint that returns project group chat messages for an authorized user.
def get_project_group_messages(
    project_id: str,
    user_id: str,
    limit: int = 200,
    compact: bool = False,
) -> dict[str, list[dict[str, Any]]]:
    ensure_project_group_message_storage()
    from psycopg.rows import dict_row

    query_limit = 1 if compact else max(1, min(limit, 200))
    order_direction = "desc" if compact else "asc"
    attachments_expression = "'[]'::text" if compact else "attachments"

    with get_connection() as connection:
        _assert_project_group_chat_access(connection, project_id, user_id)
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                f"""
                select
                  project_group_messages_id,
                  project_id,
                  sender_id,
                  content,
                  timestamp,
                  kind,
                  need_post,
                  scope_proposal,
                  response_to_message_id,
                  response_action,
                  response_to_title,
                  {attachments_expression} as attachments
                from project_group_messages
                where project_id = %s
                order by timestamp {order_direction}, project_group_messages_id {order_direction}
                limit %s
                """,
                (project_id, query_limit),
            )
            rows = cursor.fetchall()
    if compact:
        rows.reverse()
    return {"messages": [serialize_project_group_message_row(row) for row in rows]}


# Uploads one message attachment to the API's persistent file directory and
# returns a small URL that can safely be stored in a message row.
@app.post("/attachments")
async def upload_message_attachment(payload: MessageAttachmentUploadPayload) -> dict[str, Any]:
    mime_type, content = _parse_message_attachment_data_uri(payload.dataUri, payload.mimeType)
    safe_filename = _safe_message_attachment_filename(payload.filename, mime_type)
    attachment_id = secrets.token_urlsafe(18)
    attachment_directory = MESSAGE_ATTACHMENT_ROOT / attachment_id
    attachment_path = attachment_directory / safe_filename

    try:
        attachment_directory.mkdir(parents=True, exist_ok=False)
        attachment_path.write_bytes(content)
    except OSError as error:
        shutil.rmtree(attachment_directory, ignore_errors=True)
        print(f"[ERROR] Failed to persist message attachment: {error}")
        raise HTTPException(status_code=500, detail="The attachment could not be saved.") from error

    return {
        "url": f"/attachments/{attachment_id}/{safe_filename}",
        "filename": safe_filename,
        "mimeType": mime_type,
        "size": len(content),
    }


@app.get("/attachments/{attachment_id}/{filename}")
def get_message_attachment(attachment_id: str, filename: str) -> FileResponse:
    if not re.fullmatch(r"[A-Za-z0-9_-]{12,64}", attachment_id):
        raise HTTPException(status_code=404, detail="Attachment not found.")

    safe_filename = Path(filename.replace("\\", "/")).name
    if safe_filename != filename or not safe_filename:
        raise HTTPException(status_code=404, detail="Attachment not found.")

    attachment_path = MESSAGE_ATTACHMENT_ROOT / attachment_id / safe_filename
    if not attachment_path.is_file():
        raise HTTPException(status_code=404, detail="Attachment not found.")

    mime_type = mimetypes.guess_type(safe_filename)[0] or "application/octet-stream"
    can_preview_inline = (
        mime_type.startswith("image/")
        or mime_type.startswith("video/")
        or mime_type.startswith("audio/")
        or mime_type == "application/pdf"
    )
    disposition = "inline" if can_preview_inline else "attachment"
    return FileResponse(
        attachment_path,
        media_type=mime_type,
        headers={
            "Content-Disposition": f'{disposition}; filename="{safe_filename}"',
            "Cache-Control": "private, max-age=3600",
            "X-Content-Type-Options": "nosniff",
        },
    )


@app.post("/messages")
# API endpoint that creates a direct message.
async def create_message(payload: MessagePayload) -> dict[str, Any]:
    ensure_message_storage_once()
    attachments = payload.attachments or []
    from psycopg.rows import dict_row

    with get_connection() as connection:
        _assert_direct_message_access(connection, payload.senderId, payload.recipientId)
        with connection.cursor(row_factory=dict_row) as cursor:
            # Check if message already exists
            cursor.execute(
                "SELECT messages_id, sender_id, recipient_id, project_id, content, timestamp, read, attachments FROM public.messages WHERE messages_id = %s",
                (payload.id,),
            )
            row = cursor.fetchone()
            
            # If new message, insert it
            if row is None:
                cursor.execute(
                    """
                    INSERT INTO public.messages (
                      messages_id, sender_id, recipient_id, project_id, content, timestamp, read, attachments
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING messages_id, sender_id, recipient_id, project_id, content, timestamp, read, attachments
                    """,
                    (
                        payload.id,
                        payload.senderId,
                        payload.recipientId,
                        payload.projectId,
                        payload.content,
                        payload.timestamp,
                        payload.read,
                        json.dumps(attachments),
                    ),
                )
                row = cursor.fetchone()
                _trace(f"[INSERT] Message {payload.id} inserted and committed")
        # IMPORTANT: Commit happens when exiting 'with connection.cursor' block
        connection.commit()
        _trace(f"[COMMIT] Message {payload.id} transaction committed")

    _invalidate_collection_cache(["messages"])
    message = serialize_message_row(row)
    # The database write above is the source of truth. Do not make the HTTP
    # response wait for a possibly stale websocket client; otherwise the
    # sender's composer can remain in its loading state even though the
    # message was already committed successfully.
    asyncio.create_task(connection_manager.broadcast_message_event(message))
    return message


@app.delete("/messages/{message_id}")
# API endpoint that unsends one direct message from its original sender.
async def delete_message(
    message_id: str,
    sender_id: str,
    request: FastAPIRequest,
) -> dict[str, Any]:
    ensure_message_storage_once()
    from psycopg.rows import dict_row

    sender_id = str(sender_id or "").strip()
    _require_session_user(request, sender_id)
    with get_connection() as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                select messages_id, sender_id, recipient_id, project_id,
                       content, timestamp, read, attachments
                from public.messages
                where messages_id = %s
                """,
                (message_id,),
            )
            existing_row = cursor.fetchone()
            if existing_row is None:
                raise HTTPException(status_code=404, detail="Message not found.")
            if str(existing_row["sender_id"] or "") != sender_id:
                raise HTTPException(
                    status_code=403,
                    detail="You can only unsend your own messages.",
                )

            _assert_direct_message_access(
                connection,
                sender_id,
                str(existing_row["recipient_id"] or ""),
            )
            cursor.execute(
                """
                delete from public.messages
                where messages_id = %s and sender_id = %s
                returning messages_id, sender_id, recipient_id, project_id,
                          content, timestamp, read, attachments
                """,
                (message_id, sender_id),
            )
            deleted_row = cursor.fetchone()
        connection.commit()

    if deleted_row is None:
        raise HTTPException(status_code=404, detail="Message not found.")

    _invalidate_collection_cache(["messages"])
    deleted_message = serialize_message_row(deleted_row)
    await connection_manager.broadcast_message_deleted_event(
        [str(deleted_message["id"])],
        str(deleted_message["senderId"]),
        str(deleted_message["recipientId"]),
    )
    await connection_manager.broadcast_storage_event(["messages"])
    return {"deleted": deleted_message}


@app.post("/projects/{project_id}/group-messages")
# API endpoint that creates a project group chat message.
async def create_project_group_message(
    project_id: str, payload: ProjectGroupMessagePayload
) -> dict[str, Any]:
    try:
        ensure_project_group_message_storage()
        attachments = payload.attachments or []
        message_kind = str(payload.kind or "message").strip() or "message"
        if message_kind not in {"message", "need-post", "need-response", "scope-proposal"}:
            raise HTTPException(status_code=400, detail="Unsupported project group message type.")
        from psycopg.rows import dict_row

        if payload.projectId != project_id:
            raise HTTPException(status_code=400, detail="Project message payload does not match route.")

        with get_connection() as connection:
            _assert_project_group_chat_access(connection, project_id, payload.senderId)
            sender_user = _postgres_get_hot_item_by_id(connection, "users", payload.senderId)
            sender_role = str(sender_user.get("role") or "") if sender_user else ""
            if message_kind == "need-post":
                if sender_role not in {"admin", "partner", "volunteer"}:
                    raise HTTPException(
                        status_code=403,
                        detail="Only joined project participants can post structured needs in group chats.",
                    )
                if payload.needPost is None:
                    raise HTTPException(
                        status_code=400,
                        detail="A structured need post is required for need-post messages.",
                    )
            if message_kind == "need-response":
                if not str(payload.responseToMessageId or "").strip():
                    raise HTTPException(
                        status_code=400,
                        detail="A linked need is required for need responses.",
                    )
                if not str(payload.responseAction or "").strip():
                    raise HTTPException(
                        status_code=400,
                        detail="A response action is required for need responses.",
                    )
            if message_kind == "scope-proposal" and payload.scopeProposal is None:
                raise HTTPException(
                    status_code=400,
                    detail="A structured scope proposal is required for scope-proposal messages.",
                )
            if _get_user_by_id(payload.senderId, connection) is None:
                raise HTTPException(status_code=404, detail="Sender not found.")
            with connection.cursor(row_factory=dict_row) as cursor:
                cursor.execute(
                    """
                    insert into project_group_messages (
                      project_group_messages_id,
                      project_id,
                      sender_id,
                      content,
                      timestamp,
                      kind,
                      need_post,
                      scope_proposal,
                      response_to_message_id,
                      response_action,
                      response_to_title,
                      attachments
                    )
                    values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    returning
                      project_group_messages_id,
                      project_id,
                      sender_id,
                      content,
                      timestamp,
                      kind,
                      need_post,
                      scope_proposal,
                      response_to_message_id,
                      response_action,
                      response_to_title,
                      attachments
                    """,
                    (
                        payload.id,
                        project_id,
                        payload.senderId,
                        payload.content,
                        payload.timestamp,
                        message_kind,
                        json.dumps(payload.needPost) if payload.needPost is not None else None,
                        json.dumps(payload.scopeProposal) if payload.scopeProposal is not None else None,
                        payload.responseToMessageId,
                        payload.responseAction,
                        payload.responseToTitle,
                        json.dumps(attachments),
                    ),
                )
                row = cursor.fetchone()
                if row is None:
                    raise HTTPException(status_code=500, detail="Failed to create message - no row returned from insert.")
            connection.commit()

        _invalidate_collection_cache(["projectGroupMessages"])
        message = serialize_project_group_message_row(row)
        # Realtime delivery is best-effort and must not delay a successful
        # send response when one of the connected clients is unresponsive.
        asyncio.create_task(
            connection_manager.broadcast_project_group_message_event(project_id, message)
        )
        return message
    except HTTPException:
        raise
    except Exception as error:
        print(f"[ERROR] Error creating project group message: {type(error).__name__}")
        raise HTTPException(
            status_code=500,
            detail="The message could not be created. Please try again.",
        ) from error


@app.delete("/projects/{project_id}/group-messages")
# API endpoint that removes all messages for one project group chat.
async def delete_project_group_messages(
    project_id: str,
    user_id: str,
    request: FastAPIRequest,
) -> dict[str, Any]:
    ensure_project_group_message_storage()
    _require_session_user(request, user_id)

    with get_connection() as connection:
        _assert_project_group_chat_access(connection, project_id, user_id)

        with connection.cursor() as cursor:
            cursor.execute(
                "select project_group_messages_id from project_group_messages where project_id = %s",
                (project_id,),
            )
            deleted_ids = [str(row[0]) for row in cursor.fetchall()]
            cursor.execute(
                "delete from project_group_messages where project_id = %s",
                (project_id,),
            )
        connection.commit()

    _invalidate_collection_cache(["projectGroupMessages"])
    await connection_manager.broadcast_project_group_message_deleted_event(
        project_id,
        deleted_ids,
    )
    await connection_manager.broadcast_storage_event(["projectGroupMessages", "projects", "events"])
    return {"deletedCount": len(deleted_ids), "deletedIds": deleted_ids}


@app.delete("/projects/{project_id}/group-messages/{message_id}")
# API endpoint that unsends one project-group message from its original sender.
async def delete_project_group_message(
    project_id: str,
    message_id: str,
    sender_id: str,
    request: FastAPIRequest,
) -> dict[str, Any]:
    ensure_project_group_message_storage()
    from psycopg.rows import dict_row

    _require_session_user(request, sender_id)
    with get_connection() as connection:
        _assert_project_group_chat_access(connection, project_id, sender_id)
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                delete from project_group_messages
                where project_group_messages_id = %s
                  and project_id = %s
                  and sender_id = %s
                returning
                  project_group_messages_id,
                  project_id,
                  sender_id,
                  content,
                  timestamp,
                  kind,
                  need_post,
                  scope_proposal,
                  response_to_message_id,
                  response_action,
                  response_to_title,
                  attachments
                """,
                (message_id, project_id, sender_id),
            )
            deleted_row = cursor.fetchone()
        connection.commit()

    if deleted_row is None:
        raise HTTPException(
            status_code=404,
            detail="Message not found or it was not sent by this account.",
        )

    _invalidate_collection_cache(["projectGroupMessages"])
    deleted_message = serialize_project_group_message_row(deleted_row)
    await connection_manager.broadcast_project_group_message_deleted_event(
        project_id,
        [str(deleted_message["id"])],
    )
    await connection_manager.broadcast_storage_event(["projectGroupMessages"])
    return {"deleted": deleted_message}


@app.patch("/messages/{message_id}/read")
# API endpoint that marks one direct message as read.
async def mark_message_read(message_id: str) -> dict[str, Any]:
    ensure_message_storage_once()
    from psycopg.rows import dict_row

    with get_connection() as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                update public.messages
                set read = true
                where messages_id = %s
                returning messages_id, sender_id, recipient_id, project_id, content, timestamp, read, attachments
                """,
                (message_id,),
            )
            row = cursor.fetchone()
        connection.commit()

    _invalidate_collection_cache(["messages"])
    message = serialize_message_row(row)
    await connection_manager.broadcast_message_event(message)
    return message


@app.websocket("/ws/messages/{user_id}")
# Websocket endpoint that streams message events to one user.
async def messages_websocket(websocket: WebSocket, user_id: str) -> None:
    session = verify_session_token(websocket.query_params.get("token"))
    if session is None:
        await websocket.close(code=1008, reason="Authentication required")
        return
    if session.get("role") != "admin" and str(session.get("sub")) != str(user_id).strip():
        await websocket.close(code=1008, reason="You are not allowed to open this channel")
        return

    await connection_manager.connect(user_id, websocket)
    try:
        while True:
            raw_message = await websocket.receive_text()
            if raw_message == 'ping':
                continue

            try:
                payload = json.loads(raw_message)
            except (TypeError, ValueError):
                continue

            if not isinstance(payload, dict) or payload.get('type') != 'typing':
                continue

            try:
                await connection_manager.broadcast_typing_event(
                    sender_id=user_id,
                    recipient_id=payload.get('recipientId'),
                    project_id=payload.get('projectId'),
                    is_typing=bool(payload.get('isTyping')),
                )
            except HTTPException:
                # Ignore typing events for conversations the account cannot access.
                continue
            except Exception as error:
                print(f"[WARN] Typing indicator relay failed: {error}")
    except WebSocketDisconnect:
        connection_manager.disconnect(user_id, websocket)
    except Exception:
        connection_manager.disconnect(user_id, websocket)


@app.websocket("/ws/storage")
# Websocket endpoint that streams shared storage changes to all listeners.
async def storage_websocket(websocket: WebSocket) -> None:
    if verify_session_token(websocket.query_params.get("token")) is None:
        await websocket.close(code=1008, reason="Authentication required")
        return

    await connection_manager.connect_storage(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        connection_manager.disconnect_storage(websocket)
    except Exception:
        connection_manager.disconnect_storage(websocket)


# Reads notification ids already opened by the signed-in administrator.
@app.get("/notifications/read")
def get_admin_notification_reads(request: FastAPIRequest) -> dict[str, list[str]]:
    _require_admin_session(request)
    _require_postgres()
    admin_user_id = str(_get_session_user(request).get("sub") or "").strip()
    with get_connection() as connection:
        _ensure_notification_reads_table(connection)
        with connection.cursor() as cursor:
            cursor.execute(
                """
                select notification_id
                from public.notification_reads
                where user_id = %s
                order by seen_at desc
                limit 2000
                """,
                (admin_user_id,),
            )
            notification_ids = [str(row[0]) for row in cursor.fetchall() if row[0]]
    return {"notificationIds": notification_ids}


# Persists one notification as read for the signed-in administrator.
@app.post("/notifications/read")
def mark_admin_notification_read(
    request: FastAPIRequest,
    payload: NotificationReadPayload,
) -> dict[str, str]:
    _require_admin_session(request)
    _require_postgres()
    admin_user_id = str(_get_session_user(request).get("sub") or "").strip()
    notification_id = str(payload.notificationId or "").strip()
    if not notification_id:
        raise HTTPException(status_code=400, detail="Notification id is required.")
    if len(notification_id) > 512:
        raise HTTPException(status_code=400, detail="Notification id is too long.")

    with get_connection() as connection:
        _ensure_notification_reads_table(connection)
        with connection.cursor() as cursor:
            cursor.execute(
                """
                insert into public.notification_reads (
                  notification_reads_id, user_id, notification_id, seen_at
                )
                values (%s, %s, %s, now())
                on conflict (user_id, notification_id) do update
                  set seen_at = excluded.seen_at
                """,
                (
                    secrets.token_urlsafe(24),
                    admin_user_id,
                    notification_id,
                ),
            )
        connection.commit()
    return {"status": "ok"}


@app.get("/storage/{key}")
# API endpoint that reads one storage key from app storage or hot storage.
def get_storage_item(
    request: FastAPIRequest,
    key: str,
    include_images: bool = False,
) -> dict[str, Any]:
    _require_postgres()
    session = _get_session_user(request)
    if not is_hot_storage_key(key) and key not in SPECIAL_STORAGE_KEYS:
        return {"key": key, "value": None}
    try:
        with get_connection() as connection:
            if key in {"projects", "events", "programs"}:
                value = _get_cached_media_light_collection(
                    connection, key, include_images=include_images
                )
            else:
                value = _get_cached_collection(connection, key, include_images=include_images)
            value = _scope_volunteer_storage_collection(connection, key, value, session)
            return {"key": key, "value": value}
    except Exception as error:
        print(f"[ERROR] Failed to get storage key '{key}': {type(error).__name__}: {error}")
        # Return empty list/object instead of 500 error to keep UI responsive
        if key in COLLECTION_KEYS:
            return {"key": key, "value": []}
        return {"key": key, "value": {}}


@app.post("/admin/cache/clear")
def clear_backend_caches() -> dict[str, str]:
    _projects_snapshot_cache.clear()
    _storage_collection_cache.clear()
    _admin_dashboard_cache.clear()
    return {"status": "ok", "message": "All backend caches cleared"}


@app.delete("/program-tracks/{track_id:path}")
# API endpoint that deletes one program track and records linked to it.
async def delete_program_track(track_id: str) -> dict[str, Any]:
    _require_postgres()
    normalized_track_id = str(track_id or "").strip()
    if not normalized_track_id:
        raise HTTPException(status_code=400, detail="Program track id is required.")
    normalized_track_key = normalized_track_id.lower()

    def get_existing_column(
        connection: Any,
        table_name: str,
        possible_columns: list[str],
    ) -> str | None:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                select column_name
                from information_schema.columns
                where table_schema = 'public'
                  and table_name = %s
                  and column_name = any(%s)
                """,
                (table_name, possible_columns),
            )
            existing_columns = {str(row[0]) for row in cursor.fetchall()}
        return next((column for column in possible_columns if column in existing_columns), None)

    def select_program_related_ids(
        connection: Any,
        table_name: str,
        possible_id_columns: list[str],
        include_parent_ids: set[str] | None = None,
    ) -> set[str]:
        id_column = get_existing_column(connection, table_name, possible_id_columns)
        if not id_column:
            return set()

        parent_ids = {
            str(value or '').strip().lower()
            for value in (include_parent_ids or set())
            if str(value or '').strip()
        }
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                select {id_column}
                from {table_name}
                where lower(trim(coalesce({id_column}::text, ''))) = %s
                   or lower(trim(coalesce(program_id::text, ''))) = %s
                   or lower(trim(coalesce(program_module::text, ''))) = %s
                   or lower(trim(coalesce(category::text, ''))) = %s
                   or lower(trim(coalesce(parent_project_id::text, ''))) = %s
                """,
                (
                    normalized_track_key,
                    normalized_track_key,
                    normalized_track_key,
                    normalized_track_key,
                    normalized_track_key,
                ),
            )
            related_ids = {
                str(row[0]).strip()
                for row in cursor.fetchall()
                if row[0] is not None and str(row[0]).strip()
            }

        if not parent_ids:
            return related_ids

        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                select {id_column}
                from {table_name}
                where lower(trim(coalesce(parent_project_id::text, ''))) = any(%s)
                """,
                (list(parent_ids),),
            )
            related_ids.update(
                str(row[0]).strip()
                for row in cursor.fetchall()
                if row[0] is not None and str(row[0]).strip()
            )
        return related_ids

    with get_connection() as connection:
        deleted_project_ids = select_program_related_ids(
            connection,
            "projects",
            ["projects_id", "id"],
        )
        deleted_event_ids = select_program_related_ids(
            connection,
            "events",
            ["events_id", "id"],
            include_parent_ids=deleted_project_ids,
        )
        related_project_ids = {
            item_id
            for item_id in [*deleted_project_ids, *deleted_event_ids, normalized_track_id]
            if item_id
        }
        related_project_ids.add(f"program:{normalized_track_id}")

        changed_keys = ["programTracks", "programs"]
        if deleted_project_ids:
            changed_keys.append("projects")
        if deleted_event_ids:
            changed_keys.append("events")
        for changed_key in _cascade_delete_project_references(connection, related_project_ids):
            if changed_key not in changed_keys:
                changed_keys.append(changed_key)

        # Applications and published impact reports share relational tables with
        # their normal collections. Invalidate both views when the cascade hits
        # the underlying rows.
        if "partnerReports" in changed_keys and "publishedImpactReports" not in changed_keys:
            changed_keys.append("publishedImpactReports")

        deleted_catalog_count = 0
        with connection.cursor() as cursor:
            cursor.execute(
                """
                select column_name
                from information_schema.columns
                where table_schema = 'public'
                  and table_name = 'programs'
                  and column_name = any(%s)
                """,
                (["programs_id", "id"],),
            )
            catalog_id_columns = [str(row[0]) for row in cursor.fetchall()]
            for column_name in catalog_id_columns:
                cursor.execute(
                    f"delete from programs where lower(trim(coalesce({column_name}::text, ''))) = %s",
                    (normalized_track_key,),
                )
                deleted_catalog_count += cursor.rowcount or 0

        connection.commit()

    changed_keys = list(dict.fromkeys(changed_keys))
    _invalidate_collection_cache(changed_keys)
    _projects_snapshot_cache.clear()
    _storage_collection_cache.clear()
    if not deleted_catalog_count and not deleted_project_ids and not deleted_event_ids:
        return {
            "status": "ok",
            "deletedTrackId": normalized_track_id,
            "deletedProjectCount": 0,
            "deletedEventCount": 0,
            "alreadyDeleted": True,
        }
    # Broadcast after the response path; deletion itself is already committed.
    asyncio.create_task(connection_manager.broadcast_storage_event(changed_keys))
    return {
        "status": "ok",
        "deletedTrackId": normalized_track_id,
        "deletedProjectCount": len(deleted_project_ids),
        "deletedEventCount": len(deleted_event_ids),
    }


@app.post("/storage/batch")
# API endpoint that reads multiple storage keys in a single request.
# OPTIMIZED: Fetch keys in parallel using separate connections to avoid sequential DB queries.
def get_storage_items_batch(
    request: FastAPIRequest,
    payload: StorageBatchPayload,
) -> dict[str, dict[str, Any]]:
    import time
    request_start = time.time()
    session = _get_session_user(request)
    try:
        keys = [key for key in payload.keys if key]
        items: dict[str, Any] = {key: None for key in keys}

        if not keys:
            return {"items": items}

        # Fetch keys in parallel using thread pool
        def _fetch_collection(key: str) -> tuple[str, Any]:
            try:
                fetch_start = time.time()
                with get_connection() as connection:
                    conn_time = time.time() - fetch_start
                    if key in {"projects", "events", "programs"}:
                        value = _get_cached_media_light_collection(
                            connection, key, include_images=payload.include_images
                        )
                    else:
                        value = _get_cached_collection(
                            connection,
                            key,
                            include_images=payload.include_images,
                        )
                    value = _scope_volunteer_storage_collection(connection, key, value, session)
                    query_time = time.time() - fetch_start - conn_time
                    if conn_time > 1.0 or query_time > 1.0:
                        print(f"[PERF] Key '{key}': connection={conn_time:.1f}s, query={query_time:.1f}s")
                return key, value
            except Exception as e:
                print(f"[WARN] Failed to fetch key '{key}': {type(e).__name__}: {e}")
                return key, [] if key in COLLECTION_KEYS else {}

        # Use ThreadPoolExecutor to parallelize database queries
        # Limit to number of keys to avoid excessive connections
        # Keep one batch within the pool while allowing the second wave of
        # collections to start quickly on a cold cache.
        max_workers = min(len(keys), 8)
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {executor.submit(_fetch_collection, key): key for key in keys}
            for future in as_completed(futures):
                try:
                    key, value = future.result()
                    items[key] = value
                except Exception as e:
                    key = futures[future]
                    print(f"[WARN] Exception fetching key '{key}': {type(e).__name__}: {e}")
                    items[key] = [] if key in COLLECTION_KEYS else {}

        total_time = time.time() - request_start
        if total_time > 5.0:
            print(f"[PERF] /storage/batch completed in {total_time:.1f}s for {len(keys)} keys")
        
        return {"items": items}
    except Exception as error:
        print(f"[ERROR] Batch storage request failed: {type(error).__name__}: {error}")
        # Return empty items instead of 500 error
        return {"items": {k: ([] if k in COLLECTION_KEYS else {}) for k in (payload.keys or [])}}


# Keys returned by the admin dashboard snapshot endpoint.
_ADMIN_DASHBOARD_KEYS = [
    "users",
    "projects",
    "programs",
    "programTracks",
    "events",
    "partners",
    "volunteers",
    "statusUpdates",
    "volunteerMatches",
    "volunteerProjectJoins",
    "partnerProjectApplications",
    "partnerReports",
]

# Cache key for the admin dashboard snapshot.
_ADMIN_DASHBOARD_CACHE_KEY = "admin:dashboard:snapshot"
_admin_dashboard_cache = TTLCache(ttl_seconds=60)


@app.get("/admin/dashboard-snapshot")
# Optimized endpoint that returns all admin dashboard collections.
# Uses parallel worker connections and TTLCache for fast sub-second responses.
def get_admin_dashboard_snapshot(request: FastAPIRequest) -> dict[str, Any]:
    """Return all collections needed by the admin dashboard in one request."""
    _require_admin_session(request)
    try:
        _require_postgres()

        cached = _admin_dashboard_cache.get(_ADMIN_DASHBOARD_CACHE_KEY)
        if cached is not None:
            return cached

        items: dict[str, Any] = {}

        def _fetch_admin_key(key: str) -> tuple[str, Any]:
            try:
                with get_connection() as connection:
                    return key, _get_admin_dashboard_collection(
                        connection,
                        key,
                        include_images=False,
                    )
            except Exception as e:
                print(f"[WARN] admin dashboard: failed to fetch '{key}': {type(e).__name__}: {e}")
                return key, []

        # The pool supports ten connections; fetching the dashboard in up to
        # ten parallel reads avoids the multi-wave delay on a cold start.
        max_workers = min(len(_ADMIN_DASHBOARD_KEYS), 10)
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {executor.submit(_fetch_admin_key, key): key for key in _ADMIN_DASHBOARD_KEYS}
            for future in as_completed(futures):
                try:
                    key, value = future.result()
                    items[key] = value
                except Exception as e:
                    key = futures[future]
                    items[key] = []

        result = {"items": items}
        _admin_dashboard_cache.set(_ADMIN_DASHBOARD_CACHE_KEY, result)
        return result
    except Exception as error:
        print(f"[ERROR] Admin dashboard snapshot failed: {type(error).__name__}: {error}")
        return {"items": {k: [] for k in _ADMIN_DASHBOARD_KEYS}}


def _validate_internal_task_assignment_limits(items: list[Any]) -> None:
    """Reject project writes where a task has more assignees than its estimate."""
    for item in items:
        if not isinstance(item, dict):
            continue

        for task in item.get("internalTasks") or []:
            if not isinstance(task, dict):
                continue

            raw_limit = task.get("volunteersNeeded")
            if raw_limit is None or str(raw_limit).strip() == "":
                # Preserve older field-officer/task records that predate the
                # per-task estimate field. New task writes always provide it.
                continue

            try:
                parsed_limit = float(raw_limit)
            except (TypeError, ValueError) as error:
                raise ValueError("Each task's estimated volunteer count must be a whole number of at least 1.") from error

            if not parsed_limit.is_integer() or parsed_limit < 1:
                raise ValueError("Each task's estimated volunteer count must be a whole number of at least 1.")

            assigned_ids = {
                str(task.get("assignedVolunteerId") or "").strip(),
                *[
                    str(value or "").strip()
                    for value in (task.get("assignedVolunteerIds") or [])
                ],
            }
            assigned_ids.discard("")
            if len(assigned_ids) > int(parsed_limit):
                task_title = str(task.get("title") or "Untitled task").strip()
                raise ValueError(
                    f"Task '{task_title}' allows at most {int(parsed_limit)} volunteer"
                    f"{'s' if int(parsed_limit) != 1 else ''} to be assigned."
                )


# Updates one relational storage record without reading and replacing the full collection.
# This is used by high-frequency actions such as approvals, task assignment, and
# project/event edits. The existing collection endpoint remains available for
# bulk imports and backwards compatibility.
@app.get("/project-records/{item_id}")
def get_project_record_by_id(item_id: str) -> dict[str, Any]:
    """Read one project, event, or program without loading all media collections."""
    _require_postgres()
    normalized_item_id = str(item_id or "").strip()
    if not normalized_item_id:
        raise HTTPException(status_code=400, detail="Project id is required.")

    with get_connection() as connection:
        item, key = _postgres_get_project_like_item_by_id(connection, normalized_item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Project record not found.")
    return {"key": key, "item": item}


@app.get("/storage/{key}/items/{item_id}")
def get_storage_item_by_id(
    request: FastAPIRequest,
    key: str,
    item_id: str,
) -> dict[str, Any]:
    """Read one full relational record for an explicit detail/preview view."""
    _require_postgres()
    session = _get_session_user(request)
    if not is_hot_storage_key(key):
        raise HTTPException(status_code=400, detail=f"Unsupported storage key '{key}'.")

    normalized_item_id = str(item_id or "").strip()
    if not normalized_item_id:
        raise HTTPException(status_code=400, detail="Item id is required.")

    try:
        with get_connection() as connection:
            item = _postgres_get_hot_item_by_id(connection, key, normalized_item_id)
            if item is not None:
                scoped_items = _scope_volunteer_storage_collection(connection, key, [item], session)
            else:
                scoped_items = []
        if item is None:
            raise HTTPException(status_code=404, detail="Storage item not found.")
        if not scoped_items:
            raise HTTPException(status_code=404, detail="Storage item not found.")
        return {"key": key, "item": item}
    except HTTPException:
        raise
    except Exception as error:
        print(f"[ERROR] Storage item read failed: {type(error).__name__}")
        raise HTTPException(
            status_code=500,
            detail="The storage item could not be read. Please try again.",
        ) from error


@app.put("/storage/{key}/items/{item_id}")
async def put_storage_item_by_id(
    key: str,
    item_id: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    _require_postgres()
    if not is_hot_storage_key(key):
        raise HTTPException(status_code=400, detail=f"Unsupported storage key '{key}'.")

    normalized_item_id = str(item_id or "").strip()
    if not normalized_item_id:
        raise HTTPException(status_code=400, detail="Item id is required.")

    item = dict(payload or {})
    payload_item_id = str(item.get("id") or "").strip()
    if payload_item_id and payload_item_id != normalized_item_id:
        raise HTTPException(status_code=400, detail="Item id does not match the route.")
    item["id"] = normalized_item_id

    if key in {"projects", "events"}:
        try:
            _validate_internal_task_assignment_limits([item])
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error

    try:
        with get_connection() as connection:
            if key == "events":
                _reject_duplicate_event_writes(connection, [item])
            elif key in {"programs", "projects"}:
                _reject_duplicate_named_writes(connection, key, [item])
            saved_item = _postgres_upsert_hot_item(connection, key, item)
            changed_keys = [key]
            if key == "users" and _ensure_volunteer_profile_for_user(connection, item):
                changed_keys.append("volunteers")
            connection.commit()
    except HTTPException:
        raise
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        print(f"[ERROR] Storage item write failed: {type(error).__name__}")
        raise HTTPException(
            status_code=500,
            detail="The storage item could not be saved. Please try again.",
        ) from error

    _invalidate_collection_cache(changed_keys)
    if any(
        changed_key in {
            "projects",
            "events",
            "programs",
            "volunteers",
            "volunteerMatches",
            "volunteerProjectJoins",
            "partnerProjectApplications",
        }
        for changed_key in changed_keys
    ):
        _projects_snapshot_cache.clear()
    asyncio.create_task(connection_manager.broadcast_storage_event(changed_keys))
    return {"status": "ok", "item": saved_item, "changedKeys": changed_keys}


@app.put("/storage/{key}")
# API endpoint that writes one storage key and broadcasts the change.
async def put_storage_item(key: str, payload: StoragePayload) -> dict[str, str]:
    # Supabase pooler connections can be closed while a large relational mirror
    # write is flushing.  Retry the complete idempotent replacement with a fresh
    # connection before returning a 500 to the client.
    for attempt in range(3):
        try:
            return await _put_storage_item_once(key, payload)
        except HTTPException as exc:
            if attempt >= 2 or not _is_retryable_connection_error(exc):
                raise
            print(
                f"[WARN] Retrying storage write key={key} after transient database error "
                f"(attempt {attempt + 2}/3): {exc.detail}",
                flush=True,
            )
            await asyncio.sleep(0.5 * (attempt + 1))

    raise HTTPException(status_code=500, detail=f"Storage write failed for '{key}'.")


async def _put_storage_item_once(key: str, payload: StoragePayload) -> dict[str, str]:
    _require_postgres()
    if is_hot_storage_key(key):
        if not isinstance(payload.value, list):
            raise HTTPException(status_code=400, detail=f"Storage key '{key}' expects a list payload.")

        try:
            for item in payload.value:
                if isinstance(item, dict):
                    _scan_storage_item_media(key, item)
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error

        if key in {"projects", "events"}:
            try:
                _validate_internal_task_assignment_limits(payload.value)
            except ValueError as error:
                raise HTTPException(status_code=400, detail=str(error)) from error

        changed_keys = [key]
        with get_connection() as connection:
            try:
                if key == "users":
                    for item in payload.value:
                        if isinstance(item, dict):
                            _require_terminal_admin_provisioning(connection, key, item)

                removed_project_ids: set[str] = set()
                if key in {"projects", "programs", "events"}:
                    current_items = get_postgres_hot_storage_collection(connection, key)
                    current_ids = {
                        str(item.get("id") or "").strip()
                        for item in current_items
                        if str(item.get("id") or "").strip()
                    }
                    next_ids = {
                        str(item.get("id") or "").strip()
                        for item in payload.value
                        if isinstance(item, dict) and str(item.get("id") or "").strip()
                    }
                    removed_project_ids = current_ids - next_ids

                if key == "events":
                    _reject_duplicate_event_writes(connection, payload.value)
                elif key in {"programs", "projects"}:
                    _reject_duplicate_named_writes(
                        connection,
                        key,
                        payload.value,
                        replacing_collection=True,
                    )

                volunteer_identifiers_to_sync: set[str] = set()
                if key == "volunteerProjectJoins":
                    current_join_records = get_postgres_hot_storage_collection(
                        connection,
                        "volunteerProjectJoins",
                    )
                    for record in [*current_join_records, *payload.value]:
                        if not isinstance(record, dict):
                            continue
                        for field_name in ("volunteerId", "volunteerUserId"):
                            identifier = str(record.get(field_name) or "").strip()
                            if identifier:
                                volunteer_identifiers_to_sync.add(identifier)

                replace_postgres_hot_storage_collection(connection, key, payload.value)
                if key == "users":
                    for item in payload.value:
                        if (
                            isinstance(item, dict)
                            and _ensure_volunteer_profile_for_user(connection, item)
                            and "volunteers" not in changed_keys
                        ):
                            changed_keys.append("volunteers")
                if removed_project_ids:
                    changed_keys.extend(
                        changed_key
                        for changed_key in _cascade_delete_project_references(
                            connection,
                            removed_project_ids,
                        )
                        if changed_key not in changed_keys
                    )
                    if key == "projects":
                        _delete_rows_by_known_field_values(
                            connection,
                            "projects",
                            ["projects_id", "id"],
                            removed_project_ids,
                        )
                        _delete_rows_by_known_field_values(
                            connection,
                            "events",
                            ["events_id", "id", "parent_project_id"],
                            removed_project_ids,
                        )
                    elif key == "events":
                        _delete_rows_by_known_field_values(
                            connection,
                            "events",
                            ["events_id", "id"],
                            removed_project_ids,
                        )
                if volunteer_identifiers_to_sync:
                    for identifier in volunteer_identifiers_to_sync:
                        volunteer = _postgres_get_hot_item_by_id(connection, "volunteers", identifier)
                        if volunteer is None:
                            volunteer = _postgres_get_volunteer_by_user_id(connection, identifier)
                        if volunteer is None:
                            continue
                        previous_status = volunteer.get("engagementStatus")
                        updated_volunteer = _postgres_sync_volunteer_engagement_status(
                            connection,
                            str(volunteer.get("id") or "").strip(),
                        )
                        if (
                            updated_volunteer is not None
                            and updated_volunteer.get("engagementStatus") != previous_status
                            and "volunteers" not in changed_keys
                        ):
                            changed_keys.append("volunteers")
                connection.commit()
            except Exception as e:
                print(f"[ERROR] put_storage_item failed for key={key}: {type(e).__name__}", flush=True)
                try:
                    connection.rollback()
                except Exception:
                    pass
                if isinstance(e, ValueError):
                    raise HTTPException(status_code=400, detail=str(e))
                raise HTTPException(
                    status_code=500,
                    detail="The storage data could not be saved. Please try again.",
                ) from e
        
        _invalidate_collection_cache(changed_keys)
        _projects_snapshot_cache.clear()
        await connection_manager.broadcast_storage_event(changed_keys)
        return {"status": "ok"}
    if key in SPECIAL_STORAGE_KEYS:
        with get_connection() as connection:
            _replace_special_storage_collection(connection, key, payload.value)
            connection.commit()
        
        _invalidate_collection_cache([key])
        _projects_snapshot_cache.clear()
        await connection_manager.broadcast_storage_event([key])
        return {"status": "ok"}
    raise HTTPException(status_code=400, detail=f"Unsupported storage key '{key}'.")


def _resolve_existing_relational_id(
    connection: Any,
    table_name: str,
    id_column: str,
    requested_id: str,
) -> str:
    """Resolve legacy case/whitespace variants before indexed deletes."""
    with connection.cursor() as cursor:
        cursor.execute(
            f"select {id_column} from public.{table_name} where {id_column} = %s limit 1",
            (requested_id,),
        )
        row = cursor.fetchone()
        if row and row[0]:
            return str(row[0])

        # This compatibility fallback runs only when the indexed exact lookup
        # misses. The normal path uses the primary-key index.
        cursor.execute(
            f"""
            select {id_column}
            from public.{table_name}
            where lower(trim(coalesce({id_column}::text, ''))) = %s
            limit 1
            """,
            (requested_id.lower(),),
        )
        row = cursor.fetchone()
    return str(row[0]) if row and row[0] else requested_id


@app.delete("/projects/{project_id}")
async def delete_project_record(project_id: str) -> dict[str, Any]:
    _require_postgres()
    normalized_project_id = str(project_id or "").strip()
    if not normalized_project_id:
        raise HTTPException(status_code=400, detail="Project id is required.")

    with get_connection() as connection:
        resolved_project_id = _resolve_existing_relational_id(
            connection,
            "projects",
            "projects_id",
            normalized_project_id,
        )
        changed_keys = _cascade_delete_project_references(connection, {resolved_project_id})
        with connection.cursor() as cursor:
            try:
                cursor.execute(
                    "delete from projects where projects_id = %s",
                    (resolved_project_id,),
                )
                if cursor.rowcount:
                    if "projects" not in changed_keys:
                        changed_keys.append("projects")
            except Exception:
                try:
                    connection.rollback()
                except Exception:
                    pass

        connection.commit()

    if changed_keys:
        _invalidate_collection_cache(changed_keys)
        _projects_snapshot_cache.clear()
        _storage_collection_cache.clear()
        asyncio.create_task(connection_manager.broadcast_storage_event(changed_keys))

    return {
        "status": "ok",
        "deletedProjectId": resolved_project_id,
        "alreadyDeleted": not changed_keys,
    }


@app.delete("/events/{event_id}")
async def delete_event_record(event_id: str) -> dict[str, Any]:
    _require_postgres()
    normalized_event_id = str(event_id or "").strip()
    if not normalized_event_id:
        raise HTTPException(status_code=400, detail="Event id is required.")

    with get_connection() as connection:
        resolved_event_id = _resolve_existing_relational_id(
            connection,
            "events",
            "events_id",
            normalized_event_id,
        )
        changed_keys = _cascade_delete_project_references(connection, {resolved_event_id})
        with connection.cursor() as cursor:
            try:
                cursor.execute(
                    "delete from events where events_id = %s",
                    (resolved_event_id,),
                )
                if cursor.rowcount:
                    if "events" not in changed_keys:
                        changed_keys.append("events")
            except Exception:
                try:
                    connection.rollback()
                except Exception:
                    pass

            try:
                cursor.execute(
                    "delete from projects where projects_id = %s and is_event = true",
                    (resolved_event_id,),
                )
                if cursor.rowcount:
                    if "projects" not in changed_keys:
                        changed_keys.append("projects")
            except Exception:
                try:
                    connection.rollback()
                except Exception:
                    pass

        connection.commit()

    if changed_keys:
        _invalidate_collection_cache(changed_keys)
        _projects_snapshot_cache.clear()
        _storage_collection_cache.clear()
        asyncio.create_task(connection_manager.broadcast_storage_event(changed_keys))

    return {
        "status": "ok",
        "deletedEventId": resolved_event_id,
        "alreadyDeleted": not changed_keys,
    }


@app.options("/reports")
async def reports_options():
    """Keep a compatibility route; CORSMiddleware supplies the allow-list headers."""
    return JSONResponse(content={"status": "ok"})


@app.post("/reports")
# API endpoint that inserts or updates one submitted report row directly.
async def submit_report(request: FastAPIRequest, payload: ReportSubmitPayload) -> dict[str, Any]:
    _require_postgres()

    now = datetime.now(timezone.utc).isoformat()
    project_id = str(payload.projectId).strip()
    submitter_user_id = str(payload.submitterUserId).strip()
    submitter_role = str(payload.submitterRole).strip().lower()
    session = _get_session_user(request)
    if session.get("role") != "admin" and submitter_user_id != str(session.get("sub") or ""):
        raise HTTPException(status_code=403, detail="You can only submit reports for your own account.")
    if submitter_role and session.get("role") != "admin" and submitter_role != session.get("role"):
        raise HTTPException(status_code=403, detail="The report role does not match your account.")
    metrics = dict(payload.metrics) if isinstance(payload.metrics, dict) else {}
    report_type = str(payload.reportType or "").strip()
    if (
        submitter_role == "volunteer"
        and report_type == "field_report"
        and not any(
            key in metrics
            for key in (
                "beneficiariesServed",
                "beneficiaries_served",
                "beneficiaries",
                "beneficiariesAssisted",
                "beneficiaries_assisted",
                "beneficiariesReached",
                "beneficiaries_reached",
            )
        )
    ):
        narrative_value = _extract_beneficiaries_from_description(payload.description)
        if narrative_value is not None:
            metrics["beneficiariesServed"] = narrative_value
    attachments = [
        {
            "url": str(attachment.url).strip(),
            "type": str(attachment.type or "image").strip() or "image",
            "description": str(attachment.description or "").strip() or None,
        }
        for attachment in (payload.attachments or [])
        if str(attachment.url or "").strip()
    ]
    media_file = str(payload.mediaFile or "").strip() or None
    if media_file and len(media_file) > REPORT_MEDIA_FILE_MAX_LENGTH:
        if not any(str(attachment.get("url") or "") == media_file for attachment in attachments):
            attachments.insert(
                0,
                {
                    "url": media_file,
                    "type": "image",
                    "description": "Uploaded report photo",
                },
            )
        media_file = None
    impact_count = payload.impactCount
    if impact_count is None:
        impact_count = _calculate_report_impact_count(metrics)

    report = {
        "id": str(payload.id or f"impact-report-{int(datetime.now(timezone.utc).timestamp() * 1000)}"),
        "projectId": project_id,
        "partnerId": str(payload.partnerId or "").strip() or None,
        "partnerUserId": str(payload.partnerUserId or "").strip() or None,
        "partnerName": str(payload.partnerName or "").strip() or None,
        "submitterUserId": submitter_user_id,
        "submitterName": str(payload.submitterName).strip(),
        "submitterRole": submitter_role,
        "title": str(payload.title or "").strip() or None,
        "reportType": str(payload.reportType).strip(),
        "description": str(payload.description or "").strip(),
        "impactCount": max(int(impact_count or 0), 0),
        "metrics": metrics,
        "attachments": attachments,
        "mediaFile": media_file,
        "sourceReportIds": [
            str(report_id).strip()
            for report_id in (payload.sourceReportIds or [])
            if str(report_id).strip()
        ],
        "createdAt": str(payload.createdAt or now).strip() or now,
        # Reports are available immediately after submission; there is no
        # pending review state in the report workflow.
        "status": "Submitted",
        "reviewedAt": None,
        "reviewedBy": None,
    }

    try:
        broadcast_keys = ["partnerReports"]
        with get_connection() as connection:
            if submitter_role == "volunteer":
                project, _ = _postgres_get_project_like_item_by_id(connection, project_id)
                if project is None:
                    raise HTTPException(status_code=404, detail="Project not found.")

                volunteer = _postgres_get_volunteer_by_user_id(connection, submitter_user_id)
                if volunteer is None:
                    raise HTTPException(
                        status_code=400,
                        detail="Volunteer profile not found. You must complete your volunteer profile first.",
                    )

                if bool(project.get("isEvent")):
                    _, joined_event_ids = _get_volunteer_joined_event_scope(
                        connection,
                        submitter_user_id,
                    )
                    if project_id not in joined_event_ids:
                        raise HTTPException(
                            status_code=403,
                            detail="You must join this event before submitting a report.",
                        )

                if not _volunteer_has_time_in_for_project(connection, str(volunteer.get("id") or ""), project_id):
                    raise HTTPException(
                        status_code=400,
                        detail="Volunteers must confirm attendance for this event before submitting a report.",
                    )

                volunteer_id = str(volunteer.get("id") or "")
                is_field_officer = _volunteer_is_field_officer_for_event(connection, volunteer_id, project_id)
                if report_type == "field_report" and not is_field_officer:
                    raise HTTPException(
                        status_code=403,
                        detail="Field reports are only for the assigned field officer of this event.",
                    )
                if report_type != "field_report" and is_field_officer:
                    raise HTTPException(
                        status_code=403,
                        detail="The assigned field officer must submit a field report for this event.",
                    )
                existing_logs = _postgres_reset_stale_daily_time_logs(connection, volunteer_id)
                active_log = next(
                    (
                        log
                        for log in existing_logs
                        if str(log.get("projectId") or "") == project_id and not log.get("timeOut")
                    ),
                    None,
                )

                completion_photo = media_file or (
                    attachments[0]["url"] if attachments and isinstance(attachments[0], dict) else None
                )
                if active_log is not None:
                    updated_log = {
                        **active_log,
                        "timeOut": now,
                        "completionReport": report["description"] or None,
                        "completionPhoto": completion_photo,
                    }
                    _postgres_upsert_hot_item(connection, "volunteerTimeLogs", updated_log)
                    _postgres_add_logged_hours_to_volunteer(connection, volunteer_id, updated_log)
                    broadcast_keys.extend(["volunteerTimeLogs", "volunteers"])

                if _event_attendance_window_has_ended(project):
                    _postgres_complete_volunteer_participation(
                        connection,
                        project_id,
                        volunteer_id,
                        submitter_user_id,
                    )
                    broadcast_keys.extend(["volunteerProjectJoins", "volunteerMatches", "volunteers"])

            saved_report = _postgres_upsert_hot_item(connection, "partnerReports", report)
            connection.commit()
        await connection_manager.broadcast_storage_event(list(dict.fromkeys(broadcast_keys)))
        return {"report": saved_report}
    except HTTPException:
        raise
    except Exception as error:
        print(f"[ERROR] Report submission failed: {type(error).__name__}")
        raise HTTPException(
            status_code=500,
            detail="The report could not be submitted. Please try again.",
        ) from error


@app.delete("/storage/{key}")
# API endpoint that deletes one storage key and any backing hot-storage rows.
async def delete_storage_item(key: str) -> dict[str, str]:
    _require_postgres()
    if is_hot_storage_key(key):
        with get_connection() as connection:
            clear_postgres_hot_storage_collection(connection, key)
            connection.commit()
        
        _invalidate_collection_cache([key])
        _projects_snapshot_cache.clear()
        await connection_manager.broadcast_storage_event([key])
        return {"status": "ok"}
    if key in SPECIAL_STORAGE_KEYS:
        with get_connection() as connection:
            _clear_special_storage_collection(connection, key)
            connection.commit()
        
        _invalidate_collection_cache([key])
        _projects_snapshot_cache.clear()
        await connection_manager.broadcast_storage_event([key])
        return {"status": "ok"}
    raise HTTPException(status_code=400, detail=f"Unsupported storage key '{key}'.")


@app.delete("/storage")
# API endpoint that clears all app storage and hot-storage collections.
async def clear_storage() -> dict[str, str]:
    _require_postgres()
    with get_connection() as connection:
        clear_all_postgres_hot_storage(connection)
        for key in SPECIAL_STORAGE_KEYS:
            _clear_special_storage_collection(connection, key)
        connection.commit()

    _invalidate_collection_cache()
    _projects_snapshot_cache.clear()
    await connection_manager.broadcast_storage_event(list(HOT_STORAGE_TABLES.keys()) + list(SPECIAL_STORAGE_KEYS))
    return {"status": "ok"}


@app.post("/admin/clear-cache")
async def clear_all_caches() -> dict[str, Any]:
    """Clear all server-side caches. Useful after manual database changes."""
    _invalidate_collection_cache()
    _projects_snapshot_cache.clear()
    _storage_collection_cache.clear()
    await connection_manager.broadcast_storage_event(list(HOT_STORAGE_TABLES.keys()) + list(SPECIAL_STORAGE_KEYS))
    return {"status": "ok", "message": "All caches cleared successfully"}






class GcalSyncNotifyPayload(BaseModel):
    recipient_email: str
    user_name: str
    synced_count: int
    synced_at: str
    schedule_type: str = "volunteer"
    calendar_url: str = "https://calendar.google.com/calendar/u/0/r"


@app.post("/notify/gcal-sync")
async def notify_gcal_sync(payload: GcalSyncNotifyPayload) -> dict[str, Any]:
    """Sends a confirmation email to the user after a successful Google Calendar sync."""
    subject = "Your NVC Calendar Has Been Synced to Google Calendar"
    schedule_label = (
        "partner project schedule" if payload.schedule_type == "partner"
        else "events and projects schedule" if payload.schedule_type == "admin"
        else "volunteer event schedule"
    )
    text_body = (
        f"Hi {payload.user_name},\n\n"
        f"Your NVC {schedule_label} has been successfully synced to your Google Calendar.\n\n"
        f"Schedule items synced: {payload.synced_count}\n"
        f"Synced at: {payload.synced_at}\n\n"
        f"Open your Google Calendar here: {payload.calendar_url}\n\n"
        f"-- NVC Volunteer System"
    )
    html_body = f"""
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
      <div style="background:#166534;padding:28px 32px;">
        <h1 style="color:#fff;margin:0;font-size:22px;">NVC Volunteer System</h1>
        <p style="color:#bbf7d0;margin:6px 0 0;font-size:14px;">Google Calendar Sync Confirmation</p>
      </div>
      <div style="padding:28px 32px;background:#fff;">
        <p style="font-size:16px;color:#0f172a;">Hi <strong>{payload.user_name}</strong>,</p>
        <p style="color:#475569;line-height:1.6;">Your NVC {schedule_label} has been successfully synced to your Google Calendar.</p>
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px 20px;margin:20px 0;">
          <p style="margin:0 0 8px;font-size:13px;color:#166534;font-weight:bold;">Sync Summary</p>
          <p style="margin:4px 0;color:#14532d;font-size:15px;"><strong>{payload.synced_count}</strong> schedule items added or updated in Google Calendar</p>
          <p style="margin:4px 0;color:#14532d;font-size:14px;">Synced at: {payload.synced_at}</p>
        </div>
        <p style="color:#475569;line-height:1.6;">Open Google Calendar to view your updated NVC schedule.</p>
        <p style="margin:20px 0;">
          <a href="{payload.calendar_url}" style="display:inline-block;background:#166534;color:#ffffff;text-decoration:none;font-weight:bold;border-radius:8px;padding:12px 18px;">Open Google Calendar</a>
        </p>
      </div>
      <div style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;text-align:center;">
        <p style="color:#94a3b8;font-size:12px;margin:0;">NVC Volunteer Management System</p>
      </div>
    </div>
    """
    try:
        _send_email_message(
            recipient_email=payload.recipient_email,
            subject=subject,
            text_body=text_body,
            html_body=html_body,
        )
        return {"status": "ok", "message": f"Confirmation email sent to {payload.recipient_email}"}
    except Exception as error:
        print(f"[GCAL-NOTIFY] Failed to send email: {type(error).__name__}")
        return {"status": "error", "message": "Calendar notification failed. Please try again."}
