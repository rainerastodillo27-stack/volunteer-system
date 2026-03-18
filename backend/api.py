import os
import json
from datetime import datetime, timezone
from typing import Any

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
    ensure_app_storage_table,
    get_postgres_hot_storage_collection,
    is_hot_storage_key,
    replace_postgres_hot_storage_collection,
)
from .db import (
    get_configured_db_mode,
    get_db_mode,
    get_postgres_connection,
    get_postgres_status,
    get_sqlite_connection,
)


load_dotenv()


class StoragePayload(BaseModel):
    value: Any


class StorageBatchPayload(BaseModel):
    keys: list[str]


class AuthLoginPayload(BaseModel):
    identifier: str
    password: str


class ProjectJoinPayload(BaseModel):
    userId: str


class VolunteerTimeLogStartPayload(BaseModel):
    projectId: str
    note: str | None = None


class VolunteerTimeLogEndPayload(BaseModel):
    projectId: str


class PartnerProjectJoinRequestPayload(BaseModel):
    projectId: str
    partnerUserId: str
    partnerName: str
    partnerEmail: str = ""


class MessagePayload(BaseModel):
    id: str
    senderId: str
    recipientId: str
    projectId: str | None = None
    content: str
    timestamp: str
    read: bool = False
    attachments: list[str] | None = None


app = FastAPI(title="Volcre Storage API")

allowed_origins = [origin.strip() for origin in os.getenv("ALLOWED_ORIGINS", "*").split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = {}
        self._storage_connections: set[WebSocket] = set()

    async def connect(self, user_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections.setdefault(user_id, set()).add(websocket)

    async def connect_storage(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self._storage_connections.add(websocket)

    def disconnect(self, user_id: str, websocket: WebSocket) -> None:
        sockets = self._connections.get(user_id)
        if not sockets:
            return
        sockets.discard(websocket)
        if not sockets:
            self._connections.pop(user_id, None)

    def disconnect_storage(self, websocket: WebSocket) -> None:
        self._storage_connections.discard(websocket)

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

    async def broadcast_message_event(self, message: dict[str, Any]) -> None:
        payload = {"type": "message.changed", "message": message}
        recipients = {message["senderId"], message["recipientId"]}
        for user_id in recipients:
            await self.send_user_event(user_id, payload)

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


def ensure_message_storage() -> None:
    if get_db_mode() == "postgres":
        with get_postgres_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    create table if not exists messages (
                      id text primary key,
                      sender_id text not null,
                      recipient_id text not null,
                      project_id text,
                      content text not null,
                      timestamp timestamptz not null,
                      read boolean not null default false,
                      attachments jsonb not null default '[]'::jsonb
                    )
                    """
                )
            connection.commit()
        return

    with get_sqlite_connection() as connection:
        connection.execute(
            """
            create table if not exists messages (
              id text primary key,
              sender_id text not null,
              recipient_id text not null,
              project_id text,
              content text not null,
              timestamp text not null,
              read integer not null default 0,
              attachments text not null default '[]'
            )
            """
        )
        connection.commit()


def serialize_message_row(row: Any) -> dict[str, Any]:
    if row is None:
        raise HTTPException(status_code=404, detail="Message not found.")

    attachments = row["attachments"]
    if isinstance(attachments, str):
        attachments = json.loads(attachments)
    if attachments is None:
        attachments = []

    return {
        "id": row["id"],
        "senderId": row["sender_id"],
        "recipientId": row["recipient_id"],
        "projectId": row["project_id"],
        "content": row["content"],
        "timestamp": row["timestamp"].isoformat() if hasattr(row["timestamp"], "isoformat") else row["timestamp"],
        "read": bool(row["read"]),
        "attachments": attachments,
    }


@app.on_event("startup")
def startup() -> None:
    ensure_app_storage_seeded()
    if get_db_mode() == "postgres":
        with get_postgres_connection() as connection:
            _postgres_sync_all_legacy_app_users(connection)
            connection.commit()


@app.get("/health", response_model=None)
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

    return {
        "status": "ok",
        "configured_mode": configured_mode,
        "mode": "postgres",
        "timestamp": timestamp,
    }


def _get_user_by_identifier(identifier: str) -> dict[str, Any] | None:
    normalized_identifier = identifier.strip().lower()
    raw_identifier = identifier.strip()

    if get_db_mode() == "postgres":
        with get_postgres_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    select data
                    from app_users_store
                    where lower(coalesce(data->>'email', '')) = %s
                       or coalesce(data->>'phone', '') = %s
                    order by sort_order asc
                    limit 1
                    """,
                    (normalized_identifier, raw_identifier),
                )
                row = cursor.fetchone()
        return None if row is None else row[0]

    users_payload = get_storage_item("users")
    users = users_payload.get("value") or []
    for user in users:
        if not isinstance(user, dict):
            continue
        email = str(user.get("email") or "").strip().lower()
        phone = str(user.get("phone") or "").strip()
        if email == normalized_identifier or phone == raw_identifier:
            return user

    return None


def _require_postgres() -> None:
    if get_db_mode() != "postgres":
        raise HTTPException(status_code=503, detail="Supabase Postgres backend is unavailable.")


def _sort_iso_desc(items: list[dict[str, Any]], field: str) -> list[dict[str, Any]]:
    return sorted(items, key=lambda item: str(item.get(field) or ""), reverse=True)


def _hot_table_name(key: str) -> str:
    table_name = HOT_STORAGE_TABLES.get(key)
    if not table_name:
        raise HTTPException(status_code=400, detail=f"Unsupported hot storage key '{key}'.")
    return table_name


def _postgres_get_hot_item_by_id(connection: Any, key: str, item_id: str) -> dict[str, Any] | None:
    table_name = _hot_table_name(key)
    with connection.cursor() as cursor:
        cursor.execute(f"select data from {table_name} where id = %s", (item_id,))
        row = cursor.fetchone()
    return None if row is None else row[0]


def _legacy_app_user_email(user_id: str, user: dict[str, Any]) -> str:
    email = str(user.get("email") or "").strip().lower()
    if email:
        return email

    return f"{user_id}@volcre.local"


def _postgres_upsert_legacy_app_user(connection: Any, user_id: str, user: dict[str, Any]) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            create table if not exists app_users (
              id text primary key,
              email text not null unique,
              password text not null,
              role text not null,
              name text not null,
              phone text,
              created_at timestamptz not null
            )
            """
        )
        cursor.execute(
            "delete from app_users where email = %s and id <> %s",
            (_legacy_app_user_email(user_id, user), user_id),
        )
        cursor.execute(
            """
            insert into app_users (id, email, password, role, name, phone, created_at)
            values (%s, %s, %s, %s, %s, %s, %s)
            on conflict (id) do update set
              email = excluded.email,
              password = excluded.password,
              role = excluded.role,
              name = excluded.name,
              phone = excluded.phone,
              created_at = excluded.created_at
            """,
            (
                user_id,
                _legacy_app_user_email(user_id, user),
                str(user.get("password") or ""),
                str(user.get("role") or "volunteer"),
                str(user.get("name") or user_id),
                str(user.get("phone") or "") or None,
                str(user.get("createdAt") or datetime.now(timezone.utc).isoformat()),
            ),
        )


def _postgres_ensure_legacy_app_user(connection: Any, user_id: str) -> None:
    user = _postgres_get_hot_item_by_id(connection, "users", user_id)
    if user is None:
        raise HTTPException(status_code=404, detail=f"User '{user_id}' was not found.")

    _postgres_upsert_legacy_app_user(connection, user_id, user)


def _postgres_sync_all_legacy_app_users(connection: Any) -> None:
    users = get_postgres_hot_storage_collection(connection, "users")
    for user in users:
        user_id = user.get("id")
        if isinstance(user_id, str) and user_id:
            _postgres_upsert_legacy_app_user(connection, user_id, user)


def _postgres_get_hot_items_by_field(
    connection: Any,
    key: str,
    field_name: str,
    field_value: str,
) -> list[dict[str, Any]]:
    table_name = _hot_table_name(key)
    with connection.cursor() as cursor:
        cursor.execute(
            f"""
            select data
            from {table_name}
            where coalesce(data ->> %s, '') = %s
            order by sort_order asc, updated_at asc, id asc
            """,
            (field_name, field_value),
        )
        rows = cursor.fetchall()
    return [row[0] for row in rows]


def _postgres_upsert_hot_item(connection: Any, key: str, item: dict[str, Any]) -> dict[str, Any]:
    item_id = item.get("id")
    if not isinstance(item_id, str) or not item_id:
        raise HTTPException(status_code=400, detail=f"Hot storage key '{key}' expects an object with an id.")

    table_name = _hot_table_name(key)
    with connection.cursor() as cursor:
        cursor.execute(f"select sort_order from {table_name} where id = %s", (item_id,))
        row = cursor.fetchone()
        if row is None:
            cursor.execute(f"select coalesce(max(sort_order), -1) + 1 from {table_name}")
            sort_order = int(cursor.fetchone()[0])
        else:
            sort_order = int(row[0])

        cursor.execute(
            f"""
            insert into {table_name} (id, data, sort_order, updated_at)
            values (%s, %s::jsonb, %s, now())
            on conflict (id) do update set
              data = excluded.data,
              sort_order = excluded.sort_order,
              updated_at = excluded.updated_at
            """,
            (item_id, json.dumps(item), sort_order),
        )

    return item


def _postgres_get_volunteer_by_user_id(connection: Any, user_id: str) -> dict[str, Any] | None:
    volunteers = _postgres_get_hot_items_by_field(connection, "volunteers", "userId", user_id)
    return volunteers[0] if volunteers else None


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


def _postgres_get_volunteer_time_logs(connection: Any, volunteer_id: str) -> list[dict[str, Any]]:
    logs = _postgres_get_hot_items_by_field(connection, "volunteerTimeLogs", "volunteerId", volunteer_id)
    return _sort_iso_desc(logs, "timeIn")


def _postgres_ensure_volunteer_project_join_record(
    connection: Any,
    project_id: str,
    volunteer: dict[str, Any],
    source: str,
) -> None:
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
        "id": f"volunteer-join-{project_id}-{volunteer['id']}",
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
        for match in matches
    )
    has_active_participation = any(
        (record.get("participationStatus") or "Active") == "Active"
        for record in join_records
    )

    next_status = "Busy" if has_active_match or has_active_participation else "Open to Volunteer"
    if volunteer.get("engagementStatus") == next_status:
        return volunteer

    updated_volunteer = {**volunteer, "engagementStatus": next_status}
    return _postgres_upsert_hot_item(connection, "volunteers", updated_volunteer)


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


def _build_projects_snapshot(
    connection: Any,
    user_id: str | None,
    role: str | None,
) -> dict[str, Any]:
    projects = get_postgres_hot_storage_collection(connection, "projects")
    snapshot: dict[str, Any] = {
        "projects": projects,
        "volunteerProfile": None,
        "timeLogs": [],
        "partnerApplications": [],
        "volunteerJoinRecords": [],
    }

    if not user_id or not role:
        return snapshot

    if role == "volunteer":
        volunteer = _postgres_get_volunteer_by_user_id(connection, user_id)
        snapshot["volunteerProfile"] = volunteer
        if volunteer is not None:
            snapshot["timeLogs"] = _postgres_get_volunteer_time_logs(connection, volunteer["id"])
            snapshot["volunteerJoinRecords"] = _sort_iso_desc(
                _postgres_get_hot_items_by_field(connection, "volunteerProjectJoins", "volunteerId", volunteer["id"]),
                "joinedAt",
            )
        return snapshot

    if role == "partner":
        snapshot["partnerApplications"] = _postgres_get_partner_project_applications_by_user(connection, user_id)

    return snapshot


@app.get("/")
def root() -> dict[str, Any]:
    return {
        "status": "ok",
        "message": "Volcre backend is running.",
        "docs": "/docs",
        "health": "/health",
        "db_health": "/db-health",
    }


@app.get("/db-health")
def db_health() -> dict[str, Any]:
    configured_mode = get_configured_db_mode()
    mode = get_db_mode()
    result: dict[str, Any] = {
        "status": "ok",
        "configured_mode": configured_mode,
        "mode": mode,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    try:
        postgres_available, postgres_error = get_postgres_status(force_refresh=True)
        result["postgres_available"] = postgres_available
        if postgres_error:
            result["postgres_error"] = postgres_error

        if mode == "postgres":
            with get_postgres_connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute("select current_database(), current_user")
                    database, user = cursor.fetchone()
            result["database"] = database
            result["user"] = user
        else:
            ensure_app_storage_table()
            with get_sqlite_connection() as connection:
                connection.execute("select 1").fetchone()
            result["database"] = "sqlite"
    except Exception as exc:
        result["status"] = "error"
        result["error"] = str(exc)

    return result


@app.get("/users/lookup")
def lookup_user(identifier: str) -> dict[str, Any]:
    return {"user": _get_user_by_identifier(identifier)}


@app.post("/auth/login")
def auth_login(payload: AuthLoginPayload) -> dict[str, Any]:
    user = _get_user_by_identifier(payload.identifier)
    if user is None or user.get("password") != payload.password:
        raise HTTPException(status_code=401, detail="Invalid email/phone or password.")

    return {"user": user}


@app.get("/projects/snapshot")
def get_projects_snapshot(user_id: str | None = None, role: str | None = None) -> dict[str, Any]:
    _require_postgres()
    with get_postgres_connection() as connection:
        return _build_projects_snapshot(connection, user_id, role)


@app.get("/volunteers/by-user/{user_id}")
def get_volunteer_by_user(user_id: str) -> dict[str, Any]:
    _require_postgres()
    with get_postgres_connection() as connection:
        volunteer = _postgres_get_volunteer_by_user_id(connection, user_id)
    return {"volunteer": volunteer}


@app.get("/volunteers/{volunteer_id}/time-logs")
def get_volunteer_logs(volunteer_id: str) -> dict[str, Any]:
    _require_postgres()
    with get_postgres_connection() as connection:
        logs = _postgres_get_volunteer_time_logs(connection, volunteer_id)
    return {"logs": logs}


@app.post("/volunteers/{volunteer_id}/time-logs/start")
async def start_volunteer_log(volunteer_id: str, payload: VolunteerTimeLogStartPayload) -> dict[str, Any]:
    _require_postgres()
    with get_postgres_connection() as connection:
        volunteer = _postgres_get_hot_item_by_id(connection, "volunteers", volunteer_id)
        if volunteer is None:
            raise HTTPException(status_code=404, detail="Volunteer not found.")

        existing_logs = _postgres_get_volunteer_time_logs(connection, volunteer_id)
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

        new_log = {
            "id": f"timelog-{int(datetime.now(timezone.utc).timestamp() * 1000)}",
            "volunteerId": volunteer_id,
            "projectId": payload.projectId,
            "timeIn": datetime.now(timezone.utc).isoformat(),
            "note": payload.note,
        }
        _postgres_upsert_hot_item(connection, "volunteerTimeLogs", new_log)
        connection.commit()
    await connection_manager.broadcast_storage_event(["volunteerTimeLogs"])
    return {"log": new_log}


@app.post("/volunteers/{volunteer_id}/time-logs/end")
async def end_volunteer_log(volunteer_id: str, payload: VolunteerTimeLogEndPayload) -> dict[str, Any]:
    _require_postgres()
    with get_postgres_connection() as connection:
        existing_logs = _postgres_get_volunteer_time_logs(connection, volunteer_id)
        active_log = next(
            (
                log
                for log in existing_logs
                if log.get("projectId") == payload.projectId and not log.get("timeOut")
            ),
            None,
        )
        if active_log is None:
            return {"log": None, "volunteerProfile": _postgres_get_hot_item_by_id(connection, "volunteers", volunteer_id)}

        updated_log = {
            **active_log,
            "timeOut": datetime.now(timezone.utc).isoformat(),
        }
        _postgres_upsert_hot_item(connection, "volunteerTimeLogs", updated_log)
        volunteer = _postgres_add_logged_hours_to_volunteer(connection, volunteer_id, updated_log)
        connection.commit()
    await connection_manager.broadcast_storage_event(["volunteerTimeLogs", "volunteers"])
    return {"log": updated_log, "volunteerProfile": volunteer}


@app.get("/partner-project-applications/by-user/{partner_user_id}")
def get_partner_applications_by_user(partner_user_id: str) -> dict[str, Any]:
    _require_postgres()
    with get_postgres_connection() as connection:
        applications = _postgres_get_partner_project_applications_by_user(connection, partner_user_id)
    return {"applications": applications}


@app.post("/partner-project-applications/request")
async def request_partner_project_join(payload: PartnerProjectJoinRequestPayload) -> dict[str, Any]:
    _require_postgres()
    with get_postgres_connection() as connection:
        project = _postgres_get_hot_item_by_id(connection, "projects", payload.projectId)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found.")

        existing_application = next(
            (
                application
                for application in _postgres_get_partner_project_applications_by_user(
                    connection,
                    payload.partnerUserId,
                )
                if application.get("projectId") == payload.projectId
            ),
            None,
        )
        if existing_application is not None:
            return {"application": existing_application}

        application = {
            "id": f"partner-application-{int(datetime.now(timezone.utc).timestamp() * 1000)}",
            "projectId": payload.projectId,
            "partnerUserId": payload.partnerUserId,
            "partnerName": payload.partnerName,
            "partnerEmail": payload.partnerEmail,
            "status": "Pending",
            "requestedAt": datetime.now(timezone.utc).isoformat(),
        }
        _postgres_upsert_hot_item(connection, "partnerProjectApplications", application)
        connection.commit()
    await connection_manager.broadcast_storage_event(["partnerProjectApplications"])
    return {"application": application}


@app.post("/projects/{project_id}/join")
async def join_project(project_id: str, payload: ProjectJoinPayload) -> dict[str, Any]:
    _require_postgres()
    with get_postgres_connection() as connection:
        project = _postgres_get_hot_item_by_id(connection, "projects", project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found.")

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
        _postgres_upsert_hot_item(connection, "projects", updated_project)

        volunteer_profile = volunteer
        if volunteer is not None:
            _postgres_ensure_volunteer_project_join_record(connection, project_id, volunteer, "VolunteerJoin")
            volunteer_profile = _postgres_sync_volunteer_engagement_status(connection, volunteer["id"]) or volunteer

        connection.commit()

    await connection_manager.broadcast_storage_event(["projects", "volunteerProjectJoins", "volunteers"])
    return {"project": updated_project, "volunteerProfile": volunteer_profile}


@app.get("/messages")
def get_messages(user_id: str) -> dict[str, list[dict[str, Any]]]:
    ensure_message_storage()
    if get_db_mode() == "postgres":
        from psycopg.rows import dict_row

        with get_postgres_connection() as connection:
            with connection.cursor(row_factory=dict_row) as cursor:
                cursor.execute(
                    """
                    select id, sender_id, recipient_id, project_id, content, timestamp, read, attachments
                    from messages
                    where sender_id = %s or recipient_id = %s
                    order by timestamp desc
                    """,
                    (user_id, user_id),
                )
                rows = cursor.fetchall()
        return {"messages": [serialize_message_row(row) for row in rows]}

    with get_sqlite_connection() as connection:
        rows = connection.execute(
            """
            select id, sender_id, recipient_id, project_id, content, timestamp, read, attachments
            from messages
            where sender_id = ? or recipient_id = ?
            order by timestamp desc
            """,
            (user_id, user_id),
        ).fetchall()
    return {"messages": [serialize_message_row(row) for row in rows]}


@app.get("/messages/conversation")
def get_conversation(user1: str, user2: str) -> dict[str, list[dict[str, Any]]]:
    ensure_message_storage()
    if get_db_mode() == "postgres":
        from psycopg.rows import dict_row

        with get_postgres_connection() as connection:
            with connection.cursor(row_factory=dict_row) as cursor:
                cursor.execute(
                    """
                    select id, sender_id, recipient_id, project_id, content, timestamp, read, attachments
                    from messages
                    where (sender_id = %s and recipient_id = %s)
                       or (sender_id = %s and recipient_id = %s)
                    order by timestamp asc
                    """,
                    (user1, user2, user2, user1),
                )
                rows = cursor.fetchall()
        return {"messages": [serialize_message_row(row) for row in rows]}

    with get_sqlite_connection() as connection:
        rows = connection.execute(
            """
            select id, sender_id, recipient_id, project_id, content, timestamp, read, attachments
            from messages
            where (sender_id = ? and recipient_id = ?)
               or (sender_id = ? and recipient_id = ?)
            order by timestamp asc
            """,
            (user1, user2, user2, user1),
        ).fetchall()
    return {"messages": [serialize_message_row(row) for row in rows]}


@app.post("/messages")
async def create_message(payload: MessagePayload) -> dict[str, Any]:
    ensure_message_storage()
    attachments = payload.attachments or []

    if get_db_mode() == "postgres":
        from psycopg.rows import dict_row

        with get_postgres_connection() as connection:
            _postgres_ensure_legacy_app_user(connection, payload.senderId)
            _postgres_ensure_legacy_app_user(connection, payload.recipientId)
            with connection.cursor(row_factory=dict_row) as cursor:
                cursor.execute(
                    """
                    insert into messages (
                      id, sender_id, recipient_id, project_id, content, timestamp, read, attachments
                    )
                    values (%s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                    returning id, sender_id, recipient_id, project_id, content, timestamp, read, attachments
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
        message = serialize_message_row(row)
        await connection_manager.broadcast_message_event(message)
        return message

    with get_sqlite_connection() as connection:
        connection.execute(
            """
            insert into messages (
              id, sender_id, recipient_id, project_id, content, timestamp, read, attachments
            )
            values (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload.id,
                payload.senderId,
                payload.recipientId,
                payload.projectId,
                payload.content,
                payload.timestamp,
                int(payload.read),
                json.dumps(attachments),
            ),
        )
        row = connection.execute(
            """
            select id, sender_id, recipient_id, project_id, content, timestamp, read, attachments
            from messages
            where id = ?
            """,
            (payload.id,),
        ).fetchone()
        connection.commit()

    message = serialize_message_row(row)
    await connection_manager.broadcast_message_event(message)
    return message


@app.patch("/messages/{message_id}/read")
async def mark_message_read(message_id: str) -> dict[str, Any]:
    ensure_message_storage()
    if get_db_mode() == "postgres":
        from psycopg.rows import dict_row

        with get_postgres_connection() as connection:
            with connection.cursor(row_factory=dict_row) as cursor:
                cursor.execute(
                    """
                    update messages
                    set read = true
                    where id = %s
                    returning id, sender_id, recipient_id, project_id, content, timestamp, read, attachments
                    """,
                    (message_id,),
                )
                row = cursor.fetchone()
            connection.commit()
        message = serialize_message_row(row)
        await connection_manager.broadcast_message_event(message)
        return message

    with get_sqlite_connection() as connection:
        connection.execute("update messages set read = 1 where id = ?", (message_id,))
        row = connection.execute(
            """
            select id, sender_id, recipient_id, project_id, content, timestamp, read, attachments
            from messages
            where id = ?
            """,
            (message_id,),
        ).fetchone()
        connection.commit()

    message = serialize_message_row(row)
    await connection_manager.broadcast_message_event(message)
    return message


@app.websocket("/ws/messages/{user_id}")
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
def get_storage_item(key: str) -> dict[str, Any]:
    if get_db_mode() == "postgres" and is_hot_storage_key(key):
        with get_postgres_connection() as connection:
            return {"key": key, "value": get_postgres_hot_storage_collection(connection, key)}

    if get_db_mode() == "postgres":
        from psycopg.rows import dict_row

        with get_postgres_connection() as connection:
            with connection.cursor(row_factory=dict_row) as cursor:
                cursor.execute("select value from app_storage where key = %s", (key,))
                row = cursor.fetchone()
        return {"key": key, "value": None if row is None else row["value"]}

    ensure_app_storage_table()
    with get_sqlite_connection() as connection:
        row = connection.execute(
            "select value from app_storage where key = ?",
            (key,),
        ).fetchone()

    return {"key": key, "value": None if row is None or row["value"] is None else json.loads(row["value"])}


@app.post("/storage/batch")
def get_storage_items_batch(payload: StorageBatchPayload) -> dict[str, dict[str, Any]]:
    keys = [key for key in payload.keys if key]
    items: dict[str, Any] = {key: None for key in keys}

    if not keys:
        return {"items": items}

    if get_db_mode() == "postgres":
        from psycopg.rows import dict_row

        with get_postgres_connection() as connection:
            hot_keys = [key for key in keys if is_hot_storage_key(key)]
            cold_keys = [key for key in keys if not is_hot_storage_key(key)]

            for key in hot_keys:
                items[key] = get_postgres_hot_storage_collection(connection, key)

            if cold_keys:
                with connection.cursor(row_factory=dict_row) as cursor:
                    cursor.execute(
                        "select key, value from app_storage where key = any(%s)",
                        (cold_keys,),
                    )
                    rows = cursor.fetchall()

                for row in rows:
                    items[row["key"]] = row["value"]

        return {"items": items}

    ensure_app_storage_table()
    placeholders = ",".join("?" for _ in keys)
    with get_sqlite_connection() as connection:
        rows = connection.execute(
            f"select key, value from app_storage where key in ({placeholders})",
            keys,
        ).fetchall()

    for row in rows:
        items[row["key"]] = None if row["value"] is None else json.loads(row["value"])

    return {"items": items}


@app.put("/storage/{key}")
async def put_storage_item(key: str, payload: StoragePayload) -> dict[str, str]:
    if get_db_mode() == "postgres" and is_hot_storage_key(key):
        if not isinstance(payload.value, list):
            raise HTTPException(status_code=400, detail=f"Storage key '{key}' expects a list payload.")

        with get_postgres_connection() as connection:
            replace_postgres_hot_storage_collection(connection, key, payload.value)
            if key == "users":
                _postgres_sync_all_legacy_app_users(connection)
            connection.commit()
        await connection_manager.broadcast_storage_event([key])
        return {"status": "ok"}

    if get_db_mode() == "postgres":
        from psycopg.types.json import Jsonb

        with get_postgres_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    insert into app_storage (key, value, updated_at)
                    values (%s, %s, now())
                    on conflict (key) do update set
                      value = excluded.value,
                      updated_at = excluded.updated_at
                    """,
                    (key, Jsonb(payload.value)),
                )
            connection.commit()
        await connection_manager.broadcast_storage_event([key])
        return {"status": "ok"}

    ensure_app_storage_table()
    with get_sqlite_connection() as connection:
        connection.execute(
            """
            insert into app_storage (key, value, updated_at)
            values (?, ?, ?)
            on conflict(key) do update set
              value = excluded.value,
              updated_at = excluded.updated_at
            """,
            (key, json.dumps(payload.value), datetime.now(timezone.utc).isoformat()),
        )
        connection.commit()

    await connection_manager.broadcast_storage_event([key])
    return {"status": "ok"}


@app.delete("/storage/{key}")
async def delete_storage_item(key: str) -> dict[str, str]:
    if get_db_mode() == "postgres" and is_hot_storage_key(key):
        with get_postgres_connection() as connection:
            clear_postgres_hot_storage_collection(connection, key)
            connection.commit()
        await connection_manager.broadcast_storage_event([key])
        return {"status": "ok"}

    if get_db_mode() == "postgres":
        with get_postgres_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute("delete from app_storage where key = %s", (key,))
            connection.commit()
        await connection_manager.broadcast_storage_event([key])
        return {"status": "ok"}

    ensure_app_storage_table()
    with get_sqlite_connection() as connection:
        connection.execute("delete from app_storage where key = ?", (key,))
        connection.commit()

    await connection_manager.broadcast_storage_event([key])
    return {"status": "ok"}


@app.delete("/storage")
async def clear_storage() -> dict[str, str]:
    if get_db_mode() == "postgres":
        with get_postgres_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute("delete from app_storage")
            clear_all_postgres_hot_storage(connection)
            connection.commit()
        await connection_manager.broadcast_storage_event(list(HOT_STORAGE_TABLES.keys()))
        return {"status": "ok"}

    ensure_app_storage_table()
    with get_sqlite_connection() as connection:
        connection.execute("delete from app_storage")
        connection.commit()

    await connection_manager.broadcast_storage_event(list(HOT_STORAGE_TABLES.keys()))
    return {"status": "ok"}


@app.post("/bootstrap")
def bootstrap_storage() -> dict[str, str]:
    ensure_app_storage_seeded()
    return {"status": "ok"}
