import argparse
import json
import sqlite3
from pathlib import Path
from typing import Any

from psycopg.types.json import Jsonb

from db import BACKEND_DIR, get_postgres_connection


DEFAULT_SQLITE_PATH = BACKEND_DIR / "volcre_storage.db"


APP_STORAGE_DDL = """
create table if not exists app_storage (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
)
"""


MESSAGES_DDL = """
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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Migrate the current local Volcre SQLite data into Postgres."
    )
    parser.add_argument(
        "--sqlite-path",
        type=Path,
        default=DEFAULT_SQLITE_PATH,
        help=f"Path to the local SQLite file. Defaults to {DEFAULT_SQLITE_PATH}",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Inspect the local data and print what would be migrated without writing to Postgres.",
    )
    return parser.parse_args()


def load_sqlite_storage(sqlite_path: Path) -> list[sqlite3.Row]:
    connection = sqlite3.connect(sqlite_path)
    connection.row_factory = sqlite3.Row
    try:
        return connection.execute(
            "select key, value, updated_at from app_storage order by key"
        ).fetchall()
    finally:
        connection.close()


def parse_json_value(raw_value: str | None) -> Any:
    if raw_value is None:
        return None
    return json.loads(raw_value)


def extract_messages(storage_rows: list[sqlite3.Row]) -> list[dict[str, Any]]:
    messages_row = next((row for row in storage_rows if row["key"] == "messages"), None)
    if messages_row is None:
        return []

    payload = parse_json_value(messages_row["value"])
    if not isinstance(payload, list):
        raise ValueError("The 'messages' storage item must be a list.")

    normalized_messages: list[dict[str, Any]] = []
    for item in payload:
        if not isinstance(item, dict):
            raise ValueError("Each message entry must be an object.")
        normalized_messages.append(
            {
                "id": item["id"],
                "sender_id": item["senderId"],
                "recipient_id": item["recipientId"],
                "project_id": item.get("projectId"),
                "content": item["content"],
                "timestamp": item["timestamp"],
                "read": bool(item.get("read", False)),
                "attachments": item.get("attachments") or [],
            }
        )
    return normalized_messages


def print_summary(storage_rows: list[sqlite3.Row], messages: list[dict[str, Any]]) -> None:
    print(f"SQLite file: {len(storage_rows)} app_storage rows found.")
    for row in storage_rows:
        value = parse_json_value(row["value"])
        value_type = type(value).__name__
        if isinstance(value, list):
            value_type = f"{value_type}[{len(value)}]"
        elif isinstance(value, dict):
            value_type = f"{value_type}[{len(value)} keys]"
        print(f"- {row['key']}: {value_type}")
    print(f"- messages table rows to upsert: {len(messages)}")


def ensure_postgres_schema(connection: Any) -> None:
    with connection.cursor() as cursor:
        cursor.execute(APP_STORAGE_DDL)
        cursor.execute(MESSAGES_DDL)
    connection.commit()


def migrate_app_storage(connection: Any, storage_rows: list[sqlite3.Row]) -> int:
    count = 0
    with connection.cursor() as cursor:
        for row in storage_rows:
            cursor.execute(
                """
                insert into app_storage (key, value, updated_at)
                values (%s, %s, %s)
                on conflict (key) do update set
                  value = excluded.value,
                  updated_at = excluded.updated_at
                """,
                (
                    row["key"],
                    Jsonb(parse_json_value(row["value"])),
                    row["updated_at"],
                ),
            )
            count += 1
    connection.commit()
    return count


def migrate_messages(connection: Any, messages: list[dict[str, Any]]) -> int:
    count = 0
    with connection.cursor() as cursor:
        for message in messages:
            cursor.execute(
                """
                insert into messages (
                  id, sender_id, recipient_id, project_id, content, timestamp, read, attachments
                )
                values (%s, %s, %s, %s, %s, %s, %s, %s)
                on conflict (id) do update set
                  sender_id = excluded.sender_id,
                  recipient_id = excluded.recipient_id,
                  project_id = excluded.project_id,
                  content = excluded.content,
                  timestamp = excluded.timestamp,
                  read = excluded.read,
                  attachments = excluded.attachments
                """,
                (
                    message["id"],
                    message["sender_id"],
                    message["recipient_id"],
                    message["project_id"],
                    message["content"],
                    message["timestamp"],
                    message["read"],
                    Jsonb(message["attachments"]),
                ),
            )
            count += 1
    connection.commit()
    return count


def main() -> None:
    args = parse_args()
    sqlite_path = args.sqlite_path.resolve()
    if not sqlite_path.exists():
        raise FileNotFoundError(f"SQLite file not found: {sqlite_path}")

    storage_rows = load_sqlite_storage(sqlite_path)
    messages = extract_messages(storage_rows)
    print_summary(storage_rows, messages)

    if args.dry_run:
        print("Dry run only. No Postgres changes were made.")
        return

    with get_postgres_connection() as connection:
        ensure_postgres_schema(connection)
        storage_count = migrate_app_storage(connection, storage_rows)
        message_count = migrate_messages(connection, messages)

    print(
        f"Migration complete. Upserted {storage_count} app_storage rows and {message_count} messages."
    )


if __name__ == "__main__":
    main()
