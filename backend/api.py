import os
import json
import threading
import time
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo
from concurrent.futures import ThreadPoolExecutor, as_completed

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .app_storage_seed import (
    HOT_STORAGE_TABLES,
    clear_all_postgres_hot_storage,
    clear_postgres_hot_storage_collection,
    ensure_app_storage_seeded,
    get_postgres_hot_storage_collection,
    is_demo_seed_enabled,
    is_demo_seed_unlocked,
    is_hot_storage_key,
    replace_postgres_hot_storage_collection,
)
from .db import (
    get_configured_db_mode,
    get_db_mode,
    get_postgres_connection,
    get_connection,
    get_postgres_diagnostics,
    get_postgres_status,
    init_postgres_pool,
)
from .field_rules import normalize_comparable_phone
from .image_compression import compress_base64_image, get_image_size_kb
from .relational_mirror import (
    get_relational_item_by_id,
    get_relational_items_by_field,
    upsert_relational_item,
)


load_dotenv()
TRACE_STORAGE = str(os.getenv("VOLCRE_TRACE_STORAGE", "")).strip().lower() in {"1", "true", "yes", "on"}


def _trace(message: str) -> None:
    if TRACE_STORAGE:
        print(message)

# Initialize FastAPI application
app = FastAPI(title="NVC CONNECT API")

# Add CORS middleware to allow frontend requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
# A longer TTL avoids frequent cold rebuilds; cache is explicitly cleared on writes.
_projects_snapshot_cache = TTLCache(ttl_seconds=45)
_projects_snapshot_lock = threading.Lock()
_storage_collection_cache = TTLCache(ttl_seconds=20)
_DEFAULT_SNAPSHOT_FIELDS = {
    "projects",
    "programTracks",
    "statusUpdates",
    "volunteerProfile",
    "volunteerMatches",
    "timeLogs",
    "partnerApplications",
    "volunteerJoinRecords",
}


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


# Request payload for batch storage reads.
class StorageBatchPayload(BaseModel):
    keys: list[str]


# Request payload for email, username alias, or phone login.
class AuthLoginPayload(BaseModel):
    identifier: str
    password: str


# Request payload for approving/rejecting user accounts.
class UserApprovalPayload(BaseModel):
    status: str  # 'approved' or 'rejected'
    rejectionReason: str | None = None


# Request payload for direct project joins.
class ProjectJoinPayload(BaseModel):
    userId: str


# Request payload for starting a volunteer time log.
class VolunteerTimeLogStartPayload(BaseModel):
    projectId: str
    note: str | None = None


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


# Request payload for reviewing a partner join request.
class PartnerProjectApplicationReviewPayload(BaseModel):
    status: str
    reviewedBy: str


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
    start_of_day = start_date.astimezone(APP_TIMEZONE).replace(hour=0, minute=0, second=0, microsecond=0)
    return current_time >= start_of_day


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
        stale: list[WebSocket] = []
        for socket in sockets:
            try:
                await socket.send_json(payload)
            except Exception:
                stale.append(socket)
        for socket in stale:
            self.disconnect(user_id, socket)

    # Broadcasts a direct-message change to both sender and recipient.
    async def broadcast_message_event(self, message: dict[str, Any]) -> None:
        payload = {"type": "message.changed", "message": message}
        recipients = {message["senderId"], message["recipientId"]}
        for user_id in recipients:
            await self.send_user_event(user_id, payload)

    # Broadcasts a project-group message to all eligible project chat participants.
    async def broadcast_project_group_message_event(
        self, project_id: str, message: dict[str, Any]
    ) -> None:
        payload = {"type": "project-group-message.changed", "message": message}
        with get_connection() as connection:
            recipients = _get_project_chat_participant_user_ids(connection, project_id)
        recipients.add(message["senderId"])
        for user_id in recipients:
            await self.send_user_event(user_id, payload)

    # Broadcasts a shared-storage change notification to all listeners.
    async def broadcast_storage_event(self, keys: list[str]) -> None:
        if not keys:
            return

        payload = {"type": "storage.changed", "keys": keys}
        sockets = list(self._storage_connections)
        stale: list[WebSocket] = []

        for socket in sockets:
            try:
                await socket.send_json(payload)
            except Exception:
                stale.append(socket)

        for socket in stale:
            self.disconnect_storage(socket)


connection_manager = ConnectionManager()


# Ensures the direct-message table exists before message APIs are used.
def ensure_message_storage() -> None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                create table if not exists messages (
                  id text primary key,
                  sender_id text not null references users(users_id) on delete cascade,
                  recipient_id text not null references users(users_id) on delete cascade,
                  project_id text,
                  content text not null,
                  timestamp timestamptz not null,
                  read boolean not null default false,
                  attachments text not null default '[]'
                )
                """
            )
        connection.commit()


# Ensures the project group message table exists before group chat APIs are used.
def ensure_project_group_message_storage() -> None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                create table if not exists project_group_messages (
                  id text primary key,
                  project_id text not null,
                  sender_id text not null references users(users_id) on delete cascade,
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
        connection.commit()


# Converts a database message row into the API shape returned to clients.
def serialize_message_row(row: Any) -> dict[str, Any]:
    if row is None:
        raise HTTPException(status_code=404, detail="Message not found.")

    attachments = row["attachments"]
    if isinstance(attachments, str):
        attachments = json.loads(attachments)
    if attachments is None:
        attachments = []

    return {
        "id": row.get("messages_id") or row.get("id"),
        "senderId": row["sender_id"],
        "recipientId": row["recipient_id"],
        "projectId": row["project_id"],
        "content": row["content"],
        "timestamp": row["timestamp"].isoformat() if hasattr(row["timestamp"], "isoformat") else row["timestamp"],
        "read": bool(row["read"]),
        "attachments": attachments,
    }


# Converts a database project-group message row into the API response shape.
def serialize_project_group_message_row(row: Any) -> dict[str, Any]:
    if row is None:
        raise HTTPException(status_code=404, detail="Project group message not found.")

    attachments = row["attachments"]
    if isinstance(attachments, str):
        attachments = json.loads(attachments)
    if attachments is None:
        attachments = []
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


SPECIAL_STORAGE_KEYS = {"messages", "projectGroupMessages"}


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
    ensure_message_storage()
    ensure_project_group_message_storage()
    from psycopg.rows import dict_row

    with connection.cursor(row_factory=dict_row) as cursor:
        if key == "messages":
            cursor.execute(
                """
                select id as messages_id, sender_id, recipient_id, project_id, content, timestamp, read, attachments
                from messages
                order by timestamp asc, id asc
                """
            )
            return [serialize_message_row(row) for row in cursor.fetchall()]

        if key == "projectGroupMessages":
            cursor.execute(
                """
                select
                  id as project_group_messages_id,
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
                from project_group_messages
                order by timestamp asc, id asc
                """
            )
            return [serialize_project_group_message_row(row) for row in cursor.fetchall()]

    raise HTTPException(status_code=400, detail=f"Unsupported storage key '{key}'.")


def _replace_special_storage_collection(connection: Any, key: str, value: Any) -> None:
    items = _validate_storage_items(key, value)
    ensure_message_storage()
    ensure_project_group_message_storage()

    with connection.cursor() as cursor:
        if key == "messages":
            cursor.execute("delete from messages")
            for item in items:
                cursor.execute(
                    """
                    insert into messages (
                      id, sender_id, recipient_id, project_id, content, timestamp, read, attachments
                    )
                    values (%s, %s, %s, %s, %s, %s, %s, %s)
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
    ensure_message_storage()
    ensure_project_group_message_storage()
    with connection.cursor() as cursor:
        if key == "messages":
            cursor.execute("delete from messages")
            return
        if key == "projectGroupMessages":
            cursor.execute("delete from project_group_messages")
            return

    raise HTTPException(status_code=400, detail=f"Unsupported storage key '{key}'.")


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

    for volunteer_id in project.get("volunteers") or []:
        if not isinstance(volunteer_id, str) or not volunteer_id:
            continue
        volunteer = _postgres_get_hot_item_by_id(connection, "volunteers", volunteer_id)
        volunteer_user_id = volunteer.get("userId") if volunteer else None
        if isinstance(volunteer_user_id, str) and volunteer_user_id:
            participant_user_ids.add(volunteer_user_id)

    approved_project_ids = {project_id}
    parent_project_id = project.get("parentProjectId")
    if isinstance(parent_project_id, str) and parent_project_id:
        approved_project_ids.add(parent_project_id)

    applications = get_postgres_hot_storage_collection(connection, "partnerProjectApplications")
    for application in applications:
        if str(application.get("status") or "") != "Approved":
            continue
        if str(application.get("projectId") or "") not in approved_project_ids:
            continue
        partner_user_id = str(application.get("partnerUserId") or "")
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


# Sorts dictionaries by an ISO timestamp field in descending order.
def _sort_iso_desc(items: list[dict[str, Any]], field: str) -> list[dict[str, Any]]:
    return sorted(items, key=lambda item: str(item.get(field) or ""), reverse=True)


def _to_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


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
        return
    for key in keys:
        _storage_collection_cache.delete(_collection_cache_key(str(key)))


def _get_cached_collection(connection: Any, key: str) -> Any:
    cache_key = _collection_cache_key(key)
    cached = _storage_collection_cache.get(cache_key)
    if cached is not None:
        return cached

    if is_hot_storage_key(key):
        value = get_postgres_hot_storage_collection(connection, key)
    elif key in SPECIAL_STORAGE_KEYS:
        value = _get_special_storage_collection(connection, key)
    else:
        value = None

    _storage_collection_cache.set(cache_key, value)
    return value


# Fetches a single hot-storage row by item id.
def _postgres_get_hot_item_by_id(connection: Any, key: str, item_id: str) -> dict[str, Any] | None:
    try:
        return get_relational_item_by_id(connection, key, item_id)
    except KeyError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


# Reads hot-storage items filtered by one field value.
def _postgres_get_hot_items_by_field(
    connection: Any,
    key: str,
    field_name: str,
    field_value: str,
) -> list[dict[str, Any]]:
    try:
        return get_relational_items_by_field(connection, key, field_name, field_value)
    except KeyError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


# Inserts or updates one hot-storage item row.
def _postgres_upsert_hot_item(connection: Any, key: str, item: dict[str, Any]) -> dict[str, Any]:
    try:
        result = upsert_relational_item(connection, key, item)
        _invalidate_collection_cache([key])
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

    return None, None


# Finds the volunteer profile tied to a specific user id.
def _postgres_get_volunteer_by_user_id(connection: Any, user_id: str) -> dict[str, Any] | None:
    volunteers = _postgres_get_hot_items_by_field(connection, "volunteers", "userId", user_id)
    return volunteers[0] if volunteers else None


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
        str(task.get("assignedVolunteerId") or "").strip() == volunteer_id
        and bool(task.get("isFieldOfficer"))
        for task in tasks
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
def _postgres_get_volunteer_time_logs(connection: Any, volunteer_id: str) -> list[dict[str, Any]]:
    logs = _postgres_get_hot_items_by_field(connection, "volunteerTimeLogs", "volunteerId", volunteer_id)
    return _sort_iso_desc(logs, "timeIn")


def _postgres_reset_stale_daily_time_logs(
    connection: Any,
    volunteer_id: str,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    reference_now = now or datetime.now(timezone.utc)
    today_key = _get_local_date_key(reference_now.isoformat())
    logs = _postgres_get_volunteer_time_logs(connection, volunteer_id)
    changed = False
    normalized_logs: list[dict[str, Any]] = []

    for log in logs:
        if log.get("timeOut"):
            normalized_logs.append(log)
            continue

        if _get_local_date_key(log.get("timeIn")) == today_key:
            normalized_logs.append(log)
            continue

        updated_log = {
            **log,
            "timeOut": log.get("timeIn"),
            "note": (
                f"{str(log.get('note') or '').strip()} "
                "[Auto-reset after day rollover]"
            ).strip(),
        }
        _postgres_upsert_hot_item(connection, "volunteerTimeLogs", updated_log)
        normalized_logs.append(updated_log)
        changed = True

    if changed:
        connection.commit()

    return _sort_iso_desc(normalized_logs, "timeIn")


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

    matches = _postgres_get_hot_items_by_field(connection, "volunteerMatches", "volunteerId", volunteer_id)
    join_records = _postgres_get_hot_items_by_field(connection, "volunteerProjectJoins", "volunteerId", volunteer_id)

    has_active_match = any(
        match.get("status") in {"Matched", "Requested"}
        and bool((_postgres_get_project_like_item_by_id(connection, str(match.get("projectId") or ""))[0] or {}).get("isEvent"))
        for match in matches
    )
    has_active_participation = any(
        (record.get("participationStatus") or "Active") == "Active"
        and bool((_postgres_get_project_like_item_by_id(connection, str(record.get("projectId") or ""))[0] or {}).get("isEvent"))
        for record in join_records
    )

    next_status = "Busy" if has_active_match or has_active_participation else "Open to Volunteer"
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
) -> dict[str, Any]:
    import sys
    import time as _time
    t0 = _time.perf_counter()
    print(f"[DEBUG] _build_projects_snapshot START: user_id={user_id} role={role} fields={requested_fields}", flush=True)
    _trace(f"[TRACE] _build_projects_snapshot: starting optimized hot storage reads at {_time.perf_counter():.3f}")

    includes = requested_fields if requested_fields is not None else _DEFAULT_SNAPSHOT_FIELDS
    include_projects = "projects" in includes
    include_status_updates = "statusUpdates" in includes
    include_program_tracks = "programTracks" in includes
    include_volunteer_profile = "volunteerProfile" in includes
    include_volunteer_matches = "volunteerMatches" in includes
    include_time_logs = "timeLogs" in includes
    include_partner_applications = "partnerApplications" in includes
    include_join_records = "volunteerJoinRecords" in includes

    print(f"[DEBUG] include_projects={include_projects} include_status_updates={include_status_updates}", flush=True)

    raw_projects: list[dict[str, Any]] = []
    raw_events: list[dict[str, Any]] = []
    raw_status_updates: list[dict[str, Any]] = []
    raw_program_tracks: list[dict[str, Any]] = []
    raw_programs_table: list[dict[str, Any]] = []

    # CORE LOAD: Only fetch the collections requested by the screen.
    if include_projects or include_join_records:
        print(f"[DEBUG] Fetching projects from database...", flush=True)
        try:
            raw_projects = _get_cached_collection(connection, "projects")
            print(f"[DEBUG] Got {len(raw_projects) if raw_projects else 0} projects", flush=True)
        except Exception as e:
            print(f"[ERROR] Failed to fetch projects: {type(e).__name__}: {e}", flush=True)
            import traceback
            traceback.print_exc()
            raw_projects = []
        
        try:
            raw_events = _get_cached_collection(connection, "events")
            print(f"[DEBUG] Got {len(raw_events) if raw_events else 0} events", flush=True)
        except Exception as e:
            print(f"[ERROR] Failed to fetch events: {type(e).__name__}: {e}", flush=True)
            import traceback
            traceback.print_exc()
            raw_events = []
    if include_status_updates:
        try:
            raw_status_updates = _get_cached_collection(connection, "statusUpdates")
            print(f"[DEBUG] Got {len(raw_status_updates) if raw_status_updates else 0} statusUpdates", flush=True)
        except Exception as e:
            print(f"[ERROR] Failed to fetch statusUpdates: {type(e).__name__}: {e}", flush=True)
            import traceback
            traceback.print_exc()
            raw_status_updates = []
    if include_program_tracks:
        try:
            raw_program_tracks = get_postgres_hot_storage_collection(connection, "programTracks")
            print(f"[DEBUG] Got {len(raw_program_tracks) if raw_program_tracks else 0} programTracks", flush=True)
        except Exception as e:
            print(f"[ERROR] Failed to fetch programTracks: {type(e).__name__}: {e}", flush=True)
            import traceback
            traceback.print_exc()
            raw_program_tracks = []
            
        try:
            raw_programs_table = get_postgres_hot_storage_collection(connection, "programs")
            print(f"[DEBUG] Got {len(raw_programs_table) if raw_programs_table else 0} programs", flush=True)
        except Exception as e:
            print(f"[ERROR] Failed to fetch programs: {type(e).__name__}: {e}", flush=True)
            import traceback
            traceback.print_exc()
            raw_programs_table = []
        
        # Merge programs table into program tracks to support the new program creation workflow
        # while maintaining compatibility with legacy tracks.
        track_ids = {str(t.get("id") or "").strip() for t in raw_program_tracks}
        for p in raw_programs_table:
            p_id = str(p.get("id") or "").strip()
            if p_id and p_id not in track_ids:
                raw_program_tracks.append(p)
                track_ids.add(p_id)

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
        programs = [project for project in raw_projects if not bool(project.get("isEvent"))]
        projects = [*programs, *raw_events]

    _trace(f"[TRACE] _build_projects_snapshot: processed projects after {_time.perf_counter() - t1:.3f}s")

    # Build snapshot with core data
    snapshot: dict[str, Any] = {
        "projects": projects,
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
        volunteer = _postgres_get_volunteer_by_user_id(connection, user_id)
        if include_volunteer_profile:
            snapshot["volunteerProfile"] = volunteer
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
                snapshot["timeLogs"] = _postgres_reset_stale_daily_time_logs(connection, volunteer["id"])
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
    elif role == "admin" and include_partner_applications:
        snapshot["partnerApplications"] = _sort_iso_desc(
            get_postgres_hot_storage_collection(connection, "partnerProjectApplications"),
            "requestedAt",
        )

    return snapshot

@app.on_event("startup")
# Prepares storage tables when the FastAPI app starts.
def startup() -> None:
    # Initialize connection pool for better performance
    init_postgres_pool()

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
                full_snapshot = _build_projects_snapshot(connection, None, None, None)
                _projects_snapshot_cache.set("snapshot:None:None:*", full_snapshot)
                _projects_snapshot_cache.set(
                    "snapshot:None:None:projects",
                    _build_projects_snapshot(connection, None, None, {"projects"}),
                )
                _projects_snapshot_cache.set(
                    "snapshot:None:None:projects,statusUpdates",
                    {
                        "projects": full_snapshot.get("projects", []),
                        "statusUpdates": full_snapshot.get("statusUpdates", []),
                        "volunteerProfile": None,
                        "volunteerMatches": [],
                        "timeLogs": [],
                        "partnerApplications": [],
                        "volunteerJoinRecords": [],
                    },
                )
                print("[OK] Warmed projects snapshot cache.")
        except Exception as error:
            print(f"[WARN] Projects snapshot cache warmup skipped: {error}")

    # Run warmup in a background thread to avoid blocking server startup
    threading.Thread(target=_warm_projects_snapshot_cache, daemon=True).start()

    # Always auto-seed demo data if database is empty (prevents "all zeros" after restart)
    # This uses direct SQL instead of the Python seed function which has connection pool issues
    def auto_seed_demo_data():
        try:
            from auto_seed import auto_seed_if_empty
            auto_seed_if_empty()
        except Exception as error:
            print(f"[WARN] Auto-seed skipped: {type(error).__name__}: {error}")
    
    threading.Thread(target=auto_seed_demo_data, daemon=True).start()

    if not is_demo_seed_enabled():
        print("[OK] Backend started; demo seed disabled but auto-seeding empty database")
        return

    if not is_demo_seed_unlocked():
        print("[WARN] Demo seed is enabled but locked. Set VOLCRE_ALLOW_DEMO_SEED=true to seed shared storage intentionally.")
        return

    # Run demo seeding in the background when it is explicitly enabled.
    def seed_storage():
        try:
            ensure_app_storage_seeded()
            print("[OK] Backend started and demo storage was ensured")
        except Exception as error:
            # Don't block startup on database reachability; endpoints still report health.
            print(f"[WARN] Backend started without ensuring demo storage: {error}")
    
    seed_thread = threading.Thread(target=seed_storage, daemon=True)
    seed_thread.start()


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

    # Use cached probe status so health reflects real DB availability
    # without forcing an expensive live diagnostic on every call.
    available, error = get_postgres_status(force_refresh=False)
    if not available:
        return JSONResponse(
            status_code=503,
            content={
                "status": "error",
                "configured_mode": configured_mode,
                "mode": "unavailable",
                "detail": error or "Supabase Postgres is currently unavailable.",
                "timestamp": timestamp,
            },
        )

    return {
        "status": "ok",
        "configured_mode": configured_mode,
        "mode": "postgres",
        "timestamp": timestamp,
    }


@app.get("/db-health", response_model=None)
# Returns detailed database diagnostics for troubleshooting.
def db_health():
    configured_mode = get_configured_db_mode()
    available, error = get_postgres_status(force_refresh=True)
    diagnostics = get_postgres_diagnostics()
    timestamp = datetime.now(timezone.utc).isoformat()

    status_code = 200 if available else 503
    payload = {
        "status": "ok" if available else "error",
        "configured_mode": configured_mode,
        "mode": get_db_mode(),
        "available": available,
        "error": error,
        "diagnostics": diagnostics,
        "timestamp": timestamp,
    }

    return JSONResponse(status_code=status_code, content=payload)


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
        return _postgres_get_hot_item_by_id(active_connection, "users", row[0])

    if connection is not None:
        return query_user(connection)

    with get_connection() as active_connection:
        return query_user(active_connection)


# Retrieves a user by their ID.
def _get_user_by_id(user_id: str, connection: Any) -> dict[str, Any] | None:
    _require_postgres()
    return _postgres_get_hot_item_by_id(connection, "users", user_id)


# Retrieves all users from storage.
def _get_all_users_from_storage(connection: Any) -> list[dict[str, Any]]:
    _require_postgres()
    return get_postgres_hot_storage_collection(connection, "users")


# Saves a user to storage.
def _save_user_to_storage(user: dict[str, Any], connection: Any) -> None:
    _require_postgres()
    _postgres_upsert_hot_item(connection, "users", user)
    connection.commit()


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
def lookup_user(identifier: str) -> dict[str, Any]:
    return {"user": _get_user_by_identifier(identifier)}


# Demo accounts for offline/development mode
DEMO_ACCOUNTS = [
    {
        "id": "admin-1",
        "email": "admin@nvc.org",
        "password": "admin123",
        "role": "admin",
        "name": "NVC Admin Account",
        "phone": "09170000001",
        "created_at": "2026-01-01T00:00:00Z",
        "approvalStatus": "approved"
    },
    {
        "id": "volunteer-1",
        "email": "volunteer@example.com",
        "password": "volunteer123",
        "role": "volunteer",
        "name": "Volunteer Account",
        "phone": "09123456789",
        "created_at": "2026-01-01T00:00:00Z",
        "approvalStatus": "approved"
    },
    {
        "id": "partner-user-1",
        "email": "partner@livelihoods.org",
        "password": "partner123",
        "role": "partner",
        "name": "Partner Org Account",
        "phone": "09198765432",
        "created_at": "2026-01-01T00:00:00Z",
        "approvalStatus": "approved"
    },
    {
        "id": "partner-user-2",
        "email": "partnerships@pbsp.org.ph",
        "password": "partner123",
        "role": "partner",
        "name": "PBSP Account",
        "phone": "09188188678",
        "created_at": "2026-01-01T00:00:00Z",
        "approvalStatus": "approved"
    },
    {
        "id": "partner-user-3",
        "email": "partnerships@jollibeefoundation.org",
        "password": "partner123",
        "role": "partner",
        "name": "Jollibee Foundation Account",
        "phone": "09186341111",
        "created_at": "2026-01-01T00:00:00Z",
        "approvalStatus": "approved"
    },
]

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

@app.post("/auth/login")
# API endpoint that validates login credentials.
def auth_login(payload: AuthLoginPayload) -> dict[str, Any]:
    print(f"[DEBUG] Login attempt for: {payload.identifier}")
    
    # Try demo account first (fast path)
    user = _get_demo_account(payload.identifier)
    
    # If demo account not found, try the shared database directly.
    if user is None:
        try:
            print("[DEBUG] Demo account not found, trying database...")
            with get_connection() as connection:
                user = _get_user_by_identifier(payload.identifier, connection)
        except Exception as db_error:
            print(f"[DEBUG] Database lookup failed: {db_error}")
            raise HTTPException(
                status_code=503,
                detail="Database unavailable while checking your account. Please try again."
            )
    
    print(f"[DEBUG] User found: {user.get('id') if user else 'None'}")
    
    if user is None:
        raise HTTPException(
            status_code=401,
            detail=_get_identifier_error_message(payload.identifier),
        )

    if user.get("password") != payload.password:
        raise HTTPException(status_code=401, detail="Incorrect password")

    print(f"[DEBUG] Password correct for: {user.get('id')}")
    
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
        except Exception as e:
            print(f"[DEBUG] Error during approval check: {e}")

    return {"user": user, "message": "Login successful"}


@app.post("/auth/users/{user_id}/approve")
# API endpoint for admin to approve a pending user account and linked records.
async def approve_user(user_id: str, payload: UserApprovalPayload, admin_id: str) -> dict[str, Any]:
    with get_connection() as connection:
        users = get_postgres_hot_storage_collection(connection, "users")
        user_index = next(
            (index for index, candidate in enumerate(users) if str(candidate.get("id") or "") == user_id),
            -1,
        )
        if user_index < 0:
            raise HTTPException(status_code=404, detail="User not found.")
        user = dict(users[user_index])

        approved_at = datetime.now(timezone.utc).isoformat()

        if payload.status == "approved":
            user["approvalStatus"] = "approved"
            user["approvedBy"] = admin_id
            user["approvedAt"] = approved_at
            # Remove rejection reason if it was previously rejected
            user.pop("rejectionReason", None)
            users[user_index] = user
            replace_postgres_hot_storage_collection(connection, "users", users)
            changed_keys = ["users"]

            if user.get("role") == "volunteer":
                # Find linked volunteer and update it
                volunteers = get_postgres_hot_storage_collection(connection, "volunteers")
                normalized_user_email = str(user.get("email") or "").strip().lower()
                normalized_user_phone = _normalize_comparable_phone(user.get("phone"))
                for volunteer in volunteers:
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
                replace_postgres_hot_storage_collection(connection, "volunteers", volunteers)
                changed_keys.append("volunteers")

            if user.get("role") == "partner":
                partners = get_postgres_hot_storage_collection(connection, "partners")
                normalized_user_email = str(user.get("email") or "").strip().lower()
                normalized_user_phone = _normalize_comparable_phone(user.get("phone"))
                for partner in partners:
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
                replace_postgres_hot_storage_collection(connection, "partners", partners)
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
                    insert into messages (
                      id, sender_id, recipient_id, project_id, content, timestamp, read, attachments
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
            await connection_manager.broadcast_storage_event(changed_keys)

            return {"user": user, "message": "User account and linked records approved successfully."}
        elif payload.status == "rejected":
            changed_keys = _delete_user_account_records(connection, user_id)
            connection.commit()
            _invalidate_collection_cache(changed_keys)
            _projects_snapshot_cache.clear()
            await connection_manager.broadcast_storage_event(changed_keys)
            return {
                "deletedUserId": user_id,
                "message": payload.rejectionReason or "User account rejected and deleted.",
            }
        else:
            raise HTTPException(status_code=400, detail="Invalid approval status. Use 'approved' or 'rejected'.")


@app.get("/auth/users/pending")
# API endpoint to get all pending user approvals (admin only).
def get_pending_users() -> dict[str, Any]:
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
    users = get_postgres_hot_storage_collection(connection, "users")
    user = next((candidate for candidate in users if str(candidate.get("id") or "") == user_id), None)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found.")

    normalized_deleted_email = str(user.get("email") or "").strip().lower()
    normalized_deleted_phone = _normalize_comparable_phone(user.get("phone"))

    volunteers = get_postgres_hot_storage_collection(connection, "volunteers")
    removed_volunteer_ids = {
        str(volunteer.get("id") or "")
        for volunteer in volunteers
        if (
            str(volunteer.get("id") or "") == user_id
            or str(volunteer.get("userId") or "") == user_id
            or (
                normalized_deleted_email
                and str(volunteer.get("email") or "").strip().lower() == normalized_deleted_email
            )
            or (
                normalized_deleted_phone
                and _normalize_comparable_phone(volunteer.get("phone")) == normalized_deleted_phone
            )
        )
    }

    partners = get_postgres_hot_storage_collection(connection, "partners")
    removed_partner_ids = {
        str(partner.get("id") or "")
        for partner in partners
        if (
            str(partner.get("ownerUserId") or "") == user_id
            or (
                normalized_deleted_email
                and str(partner.get("contactEmail") or "").strip().lower() == normalized_deleted_email
            )
            or (
                normalized_deleted_phone
                and _normalize_comparable_phone(partner.get("contactPhone")) == normalized_deleted_phone
            )
        )
    }

    filtered_users = [
        candidate for candidate in users if str(candidate.get("id") or "") != user_id
    ]
    filtered_volunteers = [
        volunteer
        for volunteer in volunteers
        if str(volunteer.get("id") or "") not in removed_volunteer_ids
    ]
    filtered_partners = [
        partner
        for partner in partners
        if str(partner.get("id") or "") not in removed_partner_ids
    ]

    # Account management deletes must be reliable for both pending and approved accounts.
    # Keep this scoped to the account row and linked profile rows shown on this screen.
    replace_postgres_hot_storage_collection(connection, "users", filtered_users)
    replace_postgres_hot_storage_collection(connection, "volunteers", filtered_volunteers)
    replace_postgres_hot_storage_collection(connection, "partners", filtered_partners)
    return ["users", "volunteers", "partners"]


@app.delete("/auth/users/{user_id}")
# API endpoint that deletes one user and linked profile records in one transaction.
async def delete_user_account(user_id: str) -> dict[str, Any]:
    _require_postgres()

    with get_connection() as connection:
        changed_keys = _delete_user_account_records(connection, user_id)
        connection.commit()

    _invalidate_collection_cache(changed_keys)
    _projects_snapshot_cache.clear()
    await connection_manager.broadcast_storage_event(changed_keys)
    return {"status": "ok", "deletedUserId": user_id}


@app.get("/validation/dswd-accreditation/{accreditation_no}")
# API endpoint that validates if a DSWD accreditation number is valid and unassigned.
def validate_dswd_accreditation(accreditation_no: str) -> dict[str, Any]:
    _require_postgres()
    
    # Basic format validation
    normalized_value = accreditation_no.strip().upper()
    if not normalized_value or not normalized_value[0].isalnum():
        return {"valid": False, "reason": "Invalid format"}
    
    # Check regex pattern
    import re
    if not re.match(r'^[A-Z0-9][A-Z0-9\-\/]{5,}$', normalized_value):
        return {"valid": False, "reason": "Invalid format"}
    
    # Check against database
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute("""
                SELECT is_assigned, assigned_to_partner_id 
                FROM dswd_accreditation_numbers 
                WHERE accreditation_no = %s
            """, (normalized_value,))
            
            result = cursor.fetchone()
            if not result:
                return {"valid": False, "reason": "Accreditation number not found in database"}
            
            is_assigned, assigned_to_partner_id = result
            if is_assigned:
                return {"valid": False, "reason": "Accreditation number already assigned"}
            
            return {"valid": True}


@app.get("/projects/snapshot")
# API endpoint that returns the projects screen snapshot.
def get_projects_snapshot(
    user_id: str | None = None,
    role: str | None = None,
    fields: str | None = None,
) -> dict[str, Any]:
    """Return the project snapshot used by web and native project screens."""
    try:
        _require_postgres()

        with get_connection() as connection:
            requested_fields = _normalize_snapshot_fields(fields)
            snapshot = _build_projects_snapshot(connection, user_id, role, requested_fields)
            snapshot["events"] = [
                project
                for project in snapshot.get("projects", [])
                if bool(project.get("isEvent"))
            ]
            return snapshot
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
        }


@app.get("/volunteers/by-user/{user_id}")
# API endpoint that returns a volunteer profile by user id.
def get_volunteer_by_user(user_id: str) -> dict[str, Any]:
    _require_postgres()
    with get_connection() as connection:
        volunteer = _postgres_get_volunteer_by_user_id(connection, user_id)
    return {"volunteer": volunteer}


@app.get("/volunteers/{volunteer_id}/recognition")
# API endpoint that returns volunteer recognition metrics.
def get_volunteer_recognition_status(volunteer_id: str) -> dict[str, Any]:
    _require_postgres()
    with get_connection() as connection:
        recognition = _postgres_get_volunteer_recognition_status(connection, volunteer_id)
    return {"recognition": recognition}


@app.get("/volunteers/{volunteer_id}/time-logs")
# API endpoint that returns a volunteer's time logs.
def get_volunteer_logs(volunteer_id: str) -> dict[str, Any]:
    _require_postgres()
    with get_connection() as connection:
        logs = _postgres_reset_stale_daily_time_logs(connection, volunteer_id)
    return {"logs": logs}


@app.post("/volunteers/{volunteer_id}/time-logs/start")
# API endpoint that starts a volunteer time log.
async def start_volunteer_log(volunteer_id: str, payload: VolunteerTimeLogStartPayload) -> dict[str, Any]:
    _require_postgres()
    with get_connection() as connection:
        volunteer = _postgres_get_hot_item_by_id(connection, "volunteers", volunteer_id)
        if volunteer is None:
            raise HTTPException(status_code=404, detail="Volunteer not found.")

        project, _ = _postgres_get_project_like_item_by_id(connection, payload.projectId)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found.")

        now = datetime.now(timezone.utc)

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

        existing_logs = _postgres_reset_stale_daily_time_logs(connection, volunteer_id, now)
        active_log = next(
            (
                log
                for log in existing_logs
                if log.get("projectId") == payload.projectId and not log.get("timeOut")
            ),
            None,
        )
        if active_log is not None:
            raise HTTPException(status_code=409, detail="You already have an active time log for this project.")

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
            raise HTTPException(
                status_code=409,
                detail="Attendance has already been recorded for this event today.",
            )

        new_log = {
            "id": f"timelog-{int(datetime.now(timezone.utc).timestamp() * 1000)}",
            "volunteerId": volunteer_id,
            "projectId": payload.projectId,
            "timeIn": now.isoformat(),
            "note": payload.note,
        }
        _postgres_upsert_hot_item(connection, "volunteerTimeLogs", new_log)
        connection.commit()
    await connection_manager.broadcast_storage_event(["volunteerTimeLogs"])
    return {"log": new_log}


@app.post("/volunteers/{volunteer_id}/time-logs/end")
# API endpoint that ends a volunteer time log.
async def end_volunteer_log(volunteer_id: str, payload: VolunteerTimeLogEndPayload) -> dict[str, Any]:
    _require_postgres()
    with get_connection() as connection:
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
            raise HTTPException(
                status_code=400,
                detail="You must time in before you can time out.",
            )

        completion_report = str(payload.completionReport or "").strip()
        completion_photo = str(payload.completionPhoto or "").strip()
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
    await connection_manager.broadcast_storage_event(["volunteerTimeLogs", "volunteers"])
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
    requested_program_module = str(payload.programModule or "").strip()
    proposal_project_id = (
        f"program:{requested_program_module}::{int(datetime.now(timezone.utc).timestamp() * 1000)}"
        if requested_program_module
        else payload.projectId
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

        if not requested_program_module:
            existing_application = next(
                (
                    application
                    for application in _postgres_get_partner_project_applications_by_user(
                        connection,
                        payload.partnerUserId,
                    )
                    if application.get("projectId") == proposal_project_id
                ),
                None,
            )
            if existing_application is not None:
                existing_status = str(existing_application.get("status") or "").strip()
                if existing_status == "Rejected":
                    refreshed_application = {
                        **existing_application,
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
                        "reviewedAt": None,
                        "reviewedBy": None,
                    }
                    _postgres_upsert_hot_item(connection, "partnerProjectApplications", refreshed_application)
                    connection.commit()
                    await connection_manager.broadcast_storage_event(["partnerProjectApplications"])
                    return {"application": refreshed_application}

                return {"application": existing_application}

        application = {
            "id": f"partner-application-{int(datetime.now(timezone.utc).timestamp() * 1000)}",
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
        }
        _postgres_upsert_hot_item(connection, "partnerProjectApplications", application)
        connection.commit()
    await connection_manager.broadcast_storage_event(["partnerProjectApplications"])
    return {"application": application}


@app.post("/partner-project-applications/{application_id}/review")
# API endpoint that approves or rejects a partner join request.
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

    broadcast_keys = ["partnerProjectApplications"]
    with get_connection() as connection:
        application = _postgres_get_hot_item_by_id(connection, "partnerProjectApplications", application_id)
        if application is None:
            raise HTTPException(status_code=404, detail="Application not found.")

        next_project_id = str(application.get("projectId") or "")
        should_create_program_project = next_status == "Approved" and next_project_id.startswith("program:")

        if should_create_program_project:
            proposal_details = application.get("proposalDetails") or {}
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

            partner_records = _postgres_get_hot_items_by_field(connection, "partners", "ownerUserId", partner_user_id)
            if not partner_records and partner_email:
                all_partners = get_postgres_hot_storage_collection(connection, "partners")
                partner_records = [
                    candidate
                    for candidate in all_partners
                    if str(candidate.get("contactEmail") or "").strip().lower() == partner_email
                ]

            partner_id = str(partner_records[0].get("id") or "") if partner_records else ""
            created_project_id = f"project-proposal-{int(datetime.now(timezone.utc).timestamp() * 1000)}"
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
                "programModule": requested_program_module,
                "statusMode": "System",
                "manualStatus": None,
                "status": "Planning",
                "category": requested_program_module,
                "startDate": generated_start_date,
                "endDate": generated_end_date,
                "location": {
                    "latitude": 0,
                    "longitude": 0,
                    "address": str(proposal_details.get("proposedLocation") or "").strip()
                    or str(proposal_details.get("targetProjectAddress") or "").strip()
                    or "Program location to be finalized",
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

        updated_application = {
            **application,
            "projectId": next_project_id,
            "status": next_status,
            "reviewedAt": datetime.now(timezone.utc).isoformat(),
            "reviewedBy": reviewed_by,
        }
        _postgres_upsert_hot_item(connection, "partnerProjectApplications", updated_application)

        connection.commit()

    await connection_manager.broadcast_storage_event(broadcast_keys)
    return {"application": updated_application}


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

    await connection_manager.broadcast_storage_event(list(dict.fromkeys(broadcast_keys)))
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

    await connection_manager.broadcast_storage_event([project_storage_key, "volunteerProjectJoins", "volunteers"])
    return {"project": updated_project, "volunteerProfile": volunteer_profile}


@app.get("/messages")
# API endpoint that returns all direct messages for one user.
def get_messages(user_id: str) -> dict[str, list[dict[str, Any]]]:
    ensure_message_storage()
    from psycopg.rows import dict_row

    with get_connection() as connection:
        current_user = _get_user_by_id(user_id, connection)
        current_role = str(current_user.get("role") or "") if current_user else ""
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                select id as messages_id, sender_id, recipient_id, project_id, content, timestamp, read, attachments
                from messages
                where sender_id = %s or recipient_id = %s
                order by timestamp desc, id desc
                """,
                (user_id, user_id),
            )
            rows = cursor.fetchall()

        if current_role:
            visible_rows = []
            for row in rows:
                other_user_id = row["recipient_id"] if row["sender_id"] == user_id else row["sender_id"]
                other_user = _get_user_by_id(other_user_id, connection)
                other_role = str(other_user.get("role") or "") if other_user else ""
                if _is_direct_message_pair_allowed(current_role, other_role):
                    visible_rows.append(row)
            rows = visible_rows
    return {"messages": [serialize_message_row(row) for row in rows]}


@app.get("/messages/conversation")
# API endpoint that returns the direct-message history between two users.
def get_conversation(user1: str, user2: str) -> dict[str, list[dict[str, Any]]]:
    ensure_message_storage()
    from psycopg.rows import dict_row

    with get_connection() as connection:
        _assert_direct_message_access(connection, user1, user2)
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                select id as messages_id, sender_id, recipient_id, project_id, content, timestamp, read, attachments
                from messages
                where (sender_id = %s and recipient_id = %s)
                   or (sender_id = %s and recipient_id = %s)
                order by timestamp asc, id asc
                """,
                (user1, user2, user2, user1),
            )
            rows = cursor.fetchall()
    return {"messages": [serialize_message_row(row) for row in rows]}


@app.get("/projects/{project_id}/group-messages")
# API endpoint that returns project group chat messages for an authorized user.
def get_project_group_messages(project_id: str, user_id: str) -> dict[str, list[dict[str, Any]]]:
    ensure_project_group_message_storage()
    from psycopg.rows import dict_row

    with get_connection() as connection:
        _assert_project_group_chat_access(connection, project_id, user_id)
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                select
                  id as project_group_messages_id,
                  project_id,
                  sender_id,
                  content,
                  timestamp,
                  kind,
                  need_post,
                  response_to_message_id,
                  response_action,
                  response_to_title,
                  attachments
                from project_group_messages
                where project_id = %s
                order by timestamp asc, id asc
                """,
                (project_id,),
            )
            rows = cursor.fetchall()
    return {"messages": [serialize_project_group_message_row(row) for row in rows]}


@app.post("/messages")
# API endpoint that creates a direct message.
async def create_message(payload: MessagePayload) -> dict[str, Any]:
    ensure_message_storage()
    attachments = payload.attachments or []
    from psycopg.rows import dict_row

    with get_connection() as connection:
        _assert_direct_message_access(connection, payload.senderId, payload.recipientId)
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                insert into messages (
                  id, sender_id, recipient_id, project_id, content, timestamp, read, attachments
                )
                values (%s, %s, %s, %s, %s, %s, %s, %s)
                returning id as messages_id, sender_id, recipient_id, project_id, content, timestamp, read, attachments
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
        connection.commit()

    _invalidate_collection_cache(["messages"])
    message = serialize_message_row(row)
    await connection_manager.broadcast_message_event(message)
    return message


@app.post("/projects/{project_id}/group-messages")
# API endpoint that creates a project group chat message.
async def create_project_group_message(
    project_id: str, payload: ProjectGroupMessagePayload
) -> dict[str, Any]:
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
                returning
                  id as project_group_messages_id,
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
        connection.commit()

    _invalidate_collection_cache(["projectGroupMessages"])
    message = serialize_project_group_message_row(row)
    await connection_manager.broadcast_project_group_message_event(project_id, message)
    return message


@app.delete("/projects/{project_id}/group-messages")
# API endpoint that removes all messages for one project group chat.
async def delete_project_group_messages(project_id: str) -> dict[str, Any]:
    ensure_project_group_message_storage()

    with get_connection() as connection:
        project, _ = _postgres_get_project_like_item_by_id(connection, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found.")

        with connection.cursor() as cursor:
            cursor.execute(
                "delete from project_group_messages where project_id = %s",
                (project_id,),
            )
            deleted_count = cursor.rowcount or 0
        connection.commit()

    _invalidate_collection_cache(["projectGroupMessages"])
    await connection_manager.broadcast_storage_event(["projectGroupMessages", "projects", "events"])
    return {"deletedCount": deleted_count}


@app.patch("/messages/{message_id}/read")
# API endpoint that marks one direct message as read.
async def mark_message_read(message_id: str) -> dict[str, Any]:
    ensure_message_storage()
    from psycopg.rows import dict_row

    with get_connection() as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                update messages
                set read = true
                where id = %s
                returning id as messages_id, sender_id, recipient_id, project_id, content, timestamp, read, attachments
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
    await connection_manager.connect(user_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        connection_manager.disconnect(user_id, websocket)
    except Exception:
        connection_manager.disconnect(user_id, websocket)


@app.websocket("/ws/storage")
# Websocket endpoint that streams shared storage changes to all listeners.
async def storage_websocket(websocket: WebSocket) -> None:
    await connection_manager.connect_storage(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        connection_manager.disconnect_storage(websocket)
    except Exception:
        connection_manager.disconnect_storage(websocket)


@app.get("/storage/{key}")
# API endpoint that reads one storage key from app storage or hot storage.
def get_storage_item(key: str) -> dict[str, Any]:
    _require_postgres()
    if not is_hot_storage_key(key) and key not in SPECIAL_STORAGE_KEYS:
        return {"key": key, "value": None}
    try:
        with get_connection() as connection:
            return {"key": key, "value": _get_cached_collection(connection, key)}
    except Exception as error:
        print(f"[ERROR] Failed to get storage key '{key}': {type(error).__name__}: {error}")
        # Return empty list/object instead of 500 error to keep UI responsive
        if key in COLLECTION_KEYS:
            return {"key": key, "value": []}
        return {"key": key, "value": {}}


@app.delete("/program-tracks/{track_id}")
# API endpoint that deletes one program track.
async def delete_program_track(track_id: str) -> dict[str, str]:
    _require_postgres()
    
    with get_connection() as connection:
        program_tracks = get_postgres_hot_storage_collection(connection, "programTracks")
        programs = get_postgres_hot_storage_collection(connection, "programs")
        filtered_tracks = [
            track for track in program_tracks
            if str(track.get("id") or "") != track_id
        ]
        filtered_programs = [
            program for program in programs
            if str(program.get("id") or "") != track_id
        ]
        
        if len(filtered_tracks) == len(program_tracks) and len(filtered_programs) == len(programs):
            raise HTTPException(status_code=404, detail="Program track not found.")
        
        replace_postgres_hot_storage_collection(connection, "programTracks", filtered_tracks)
        replace_postgres_hot_storage_collection(connection, "programs", filtered_programs)
        connection.commit()
    
    _invalidate_collection_cache(["programTracks", "programs"])
    _projects_snapshot_cache.clear()
    await connection_manager.broadcast_storage_event(["programTracks", "programs"])
    return {"status": "ok", "deletedTrackId": track_id}


@app.post("/storage/batch")
# API endpoint that reads multiple storage keys in a single request.
# OPTIMIZED: Fetch keys in parallel using separate connections to avoid sequential DB queries.
def get_storage_items_batch(payload: StorageBatchPayload) -> dict[str, dict[str, Any]]:
    try:
        keys = [key for key in payload.keys if key]
        items: dict[str, Any] = {key: None for key in keys}

        if not keys:
            return {"items": items}

        # Fetch keys in parallel using thread pool
        def _fetch_collection(key: str) -> tuple[str, Any]:
            try:
                with get_connection() as connection:
                    value = _get_cached_collection(connection, key)
                return key, value
            except Exception as e:
                print(f"[WARN] Failed to fetch key '{key}': {type(e).__name__}: {e}")
                return key, [] if key in COLLECTION_KEYS else {}

        # Use ThreadPoolExecutor to parallelize database queries
        # Limit to number of keys to avoid excessive connections
        max_workers = min(len(keys), 5)
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

        return {"items": items}
    except Exception as error:
        print(f"[ERROR] Batch storage request failed: {type(error).__name__}: {error}")
        # Return empty items instead of 500 error
        return {"items": {k: ([] if k in COLLECTION_KEYS else {}) for k in (payload.keys or [])}}


@app.put("/storage/{key}")
# API endpoint that writes one storage key and broadcasts the change.
async def put_storage_item(key: str, payload: StoragePayload) -> dict[str, str]:
    _require_postgres()
    if is_hot_storage_key(key):
        if not isinstance(payload.value, list):
            raise HTTPException(status_code=400, detail=f"Storage key '{key}' expects a list payload.")

        with get_connection() as connection:
            replace_postgres_hot_storage_collection(connection, key, payload.value)
            connection.commit()
        
        _invalidate_collection_cache([key])
        _projects_snapshot_cache.clear()
        await connection_manager.broadcast_storage_event([key])
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


@app.post("/reports")
# API endpoint that inserts or updates one submitted report row directly.
async def submit_report(payload: ReportSubmitPayload) -> dict[str, Any]:
    _require_postgres()

    now = datetime.now(timezone.utc).isoformat()
    project_id = str(payload.projectId).strip()
    submitter_user_id = str(payload.submitterUserId).strip()
    submitter_role = str(payload.submitterRole).strip().lower()
    metrics = payload.metrics if isinstance(payload.metrics, dict) else {}
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
        impact_count = sum(
            int(value)
            for value in metrics.values()
            if isinstance(value, (int, float))
        )

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
        "status": str(payload.status or "Submitted").strip() or "Submitted",
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

                if not _volunteer_has_time_in_for_project(connection, str(volunteer.get("id") or ""), project_id):
                    raise HTTPException(
                        status_code=400,
                        detail="Volunteers must time in to this event before submitting a report.",
                    )

                volunteer_id = str(volunteer.get("id") or "")
                report_type = str(payload.reportType or "").strip()
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
        raise HTTPException(status_code=500, detail=f"Report submission failed: {error}") from error


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


@app.post("/bootstrap")
# API endpoint that seeds app storage with demo data.
def bootstrap_storage() -> dict[str, str]:
    if not is_demo_seed_enabled():
        raise HTTPException(
            status_code=403,
            detail="Demo bootstrap is disabled in canonical-only mode.",
        )
    if not is_demo_seed_unlocked():
        raise HTTPException(
            status_code=403,
            detail="Demo bootstrap is locked. Set VOLCRE_ALLOW_DEMO_SEED=true only for intentional shared-database seeding.",
        )
    ensure_app_storage_seeded()
    _invalidate_collection_cache()
    _projects_snapshot_cache.clear()
    return {"status": "ok"}

