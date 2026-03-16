import os
import json
from datetime import datetime, timezone
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .db import ensure_sqlite_storage, get_db_mode, get_postgres_connection, get_sqlite_connection


load_dotenv()


class StoragePayload(BaseModel):
    value: Any


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

    async def connect(self, user_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections.setdefault(user_id, set()).add(websocket)

    def disconnect(self, user_id: str, websocket: WebSocket) -> None:
        sockets = self._connections.get(user_id)
        if not sockets:
            return
        sockets.discard(websocket)
        if not sockets:
            self._connections.pop(user_id, None)

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
    ensure_sqlite_storage()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}


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


@app.get("/storage/{key}")
def get_storage_item(key: str) -> dict[str, Any]:
    if get_db_mode() == "postgres":
        from psycopg.rows import dict_row

        with get_postgres_connection() as connection:
            with connection.cursor(row_factory=dict_row) as cursor:
                cursor.execute("select value from app_storage where key = %s", (key,))
                row = cursor.fetchone()
        return {"key": key, "value": None if row is None else row["value"]}

    ensure_sqlite_storage()
    with get_sqlite_connection() as connection:
        row = connection.execute(
            "select value from app_storage where key = ?",
            (key,),
        ).fetchone()

    return {"key": key, "value": None if row is None or row["value"] is None else json.loads(row["value"])}


@app.put("/storage/{key}")
def put_storage_item(key: str, payload: StoragePayload) -> dict[str, str]:
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
        return {"status": "ok"}

    ensure_sqlite_storage()
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

    return {"status": "ok"}


@app.delete("/storage/{key}")
def delete_storage_item(key: str) -> dict[str, str]:
    if get_db_mode() == "postgres":
        with get_postgres_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute("delete from app_storage where key = %s", (key,))
            connection.commit()
        return {"status": "ok"}

    ensure_sqlite_storage()
    with get_sqlite_connection() as connection:
        connection.execute("delete from app_storage where key = ?", (key,))
        connection.commit()

    return {"status": "ok"}


@app.delete("/storage")
def clear_storage() -> dict[str, str]:
    if get_db_mode() == "postgres":
        with get_postgres_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute("delete from app_storage")
            connection.commit()
        return {"status": "ok"}

    ensure_sqlite_storage()
    with get_sqlite_connection() as connection:
        connection.execute("delete from app_storage")
        connection.commit()

    return {"status": "ok"}


@app.post("/bootstrap")
def bootstrap_storage() -> dict[str, str]:
    if get_db_mode() == "postgres":
        with get_postgres_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    create table if not exists app_storage (
                      key text primary key,
                      value jsonb not null,
                      updated_at timestamptz not null default now()
                    )
                    """
                )
            connection.commit()
        return {"status": "ok"}

    ensure_sqlite_storage()

    return {"status": "ok"}
