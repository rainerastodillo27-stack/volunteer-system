from typing import Any

try:
    from psycopg import sql
except ImportError:
    import psycopg

    sql = psycopg.sql

try:
    from .api import ensure_message_storage, ensure_project_group_message_storage
    from .app_storage_seed import ensure_app_storage_seeded
    from .db import get_postgres_connection
    from .storage_table_contract import DEPRECATED_STORAGE_TABLES
except ImportError:
    from api import ensure_message_storage, ensure_project_group_message_storage
    from app_storage_seed import ensure_app_storage_seeded
    from db import get_postgres_connection
    from storage_table_contract import DEPRECATED_STORAGE_TABLES


LEGACY_DROP_TABLES = list(DEPRECATED_STORAGE_TABLES)


def _table_exists(connection: Any, table_name: str) -> bool:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            select exists (
              select 1
              from information_schema.tables
              where table_schema = 'public' and table_name = %s
            )
            """,
            (table_name,),
        )
        row = cursor.fetchone()
    return bool(row and row[0])


def _get_app_storage_items(connection: Any, key: str) -> list[dict[str, Any]]:
    if not _table_exists(connection, "app_storage"):
        return []

    with connection.cursor() as cursor:
        cursor.execute("select value from app_storage where key = %s", (key,))
        row = cursor.fetchone()

    if row is None or not isinstance(row[0], list):
        return []
    return [item for item in row[0] if isinstance(item, dict) and item.get("id")]


def _migrate_messages_from_app_storage(connection: Any) -> int:
    if not _table_exists(connection, "messages"):
        return 0

    with connection.cursor() as cursor:
        cursor.execute("select count(*) from messages")
        existing_count = int(cursor.fetchone()[0] or 0)
        if existing_count > 0:
            return 0

        migrated = 0
        for item in _get_app_storage_items(connection, "messages"):
            cursor.execute(
                """
                insert into messages (
                  messages_id, sender_id, recipient_id, project_id, content, timestamp, read, attachments
                )
                values (%s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                on conflict (messages_id) do nothing
                """,
                (
                    item["id"],
                    item.get("senderId"),
                    item.get("recipientId"),
                    item.get("projectId"),
                    item.get("content") or "",
                    item.get("timestamp"),
                    bool(item.get("read")),
                    __import__("json").dumps(item.get("attachments") or []),
                ),
            )
            migrated += 1

    return migrated


def _migrate_legacy_app_users(connection: Any) -> int:
    if not _table_exists(connection, "app_users"):
        return 0

    with connection.cursor() as cursor:
        cursor.execute(
            """
            select app_users_id, email, password, role, name, phone, created_at
            from app_users
            """
        )
        rows = cursor.fetchall()
        migrated = 0
        for row in rows:
            cursor.execute(
                """
                insert into users (id, email, password, role, name, phone, created_at)
                values (%s, %s, %s, %s, %s, %s, %s)
                on conflict (id) do update set
                  email = excluded.email,
                  password = excluded.password,
                  role = excluded.role,
                  name = excluded.name,
                  phone = excluded.phone,
                  created_at = coalesce(users.created_at, excluded.created_at)
                """,
                row,
            )
            migrated += 1

    return migrated


def _migrate_project_group_messages_from_app_storage(connection: Any) -> int:
    if not _table_exists(connection, "project_group_messages"):
        return 0

    with connection.cursor() as cursor:
        cursor.execute("select count(*) from project_group_messages")
        existing_count = int(cursor.fetchone()[0] or 0)
        if existing_count > 0:
            return 0

        migrated = 0
        for item in _get_app_storage_items(connection, "projectGroupMessages"):
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
                values (%s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s, %s, %s, %s::jsonb)
                on conflict (project_group_messages_id) do nothing
                """,
                (
                    item["id"],
                    item.get("projectId"),
                    item.get("senderId"),
                    item.get("content") or "",
                    item.get("timestamp"),
                    item.get("kind") or "message",
                    __import__("json").dumps(item.get("needPost")) if item.get("needPost") is not None else None,
                    __import__("json").dumps(item.get("scopeProposal")) if item.get("scopeProposal") is not None else None,
                    item.get("responseToMessageId"),
                    item.get("responseAction"),
                    item.get("responseToTitle"),
                    __import__("json").dumps(item.get("attachments") or []),
                ),
            )
            migrated += 1

    return migrated


def _drop_foreign_keys_for_column(cursor: Any, table_name: str, column_name: str) -> None:
    cursor.execute(
        """
        select con.conname
        from pg_constraint con
        join pg_class rel on rel.oid = con.conrelid
        join unnest(con.conkey) as column_keys(attnum) on true
        join pg_attribute attr on attr.attrelid = rel.oid and attr.attnum = column_keys.attnum
        where con.contype = 'f'
          and rel.relname = %s
          and attr.attname = %s
        """,
        (table_name, column_name),
    )
    constraint_names = [row[0] for row in cursor.fetchall()]
    for constraint_name in constraint_names:
        cursor.execute(
            sql.SQL('alter table {} drop constraint if exists {}').format(
                sql.Identifier(table_name),
                sql.Identifier(constraint_name),
            )
        )


def _ensure_user_foreign_keys(connection: Any) -> None:
    with connection.cursor() as cursor:
        if _table_exists(connection, "messages"):
            _drop_foreign_keys_for_column(cursor, "messages", "sender_id")
            _drop_foreign_keys_for_column(cursor, "messages", "recipient_id")
            cursor.execute(
                """
                alter table messages
                add constraint messages_sender_id_fkey
                foreign key (sender_id) references users(id) on delete cascade
                """
            )
            cursor.execute(
                """
                alter table messages
                add constraint messages_recipient_id_fkey
                foreign key (recipient_id) references users(id) on delete cascade
                """
            )

        if _table_exists(connection, "project_group_messages"):
            _drop_foreign_keys_for_column(cursor, "project_group_messages", "sender_id")
            cursor.execute(
                """
                alter table project_group_messages
                add constraint project_group_messages_sender_id_fkey
                foreign key (sender_id) references users(id) on delete cascade
                """
            )


def _drop_legacy_tables(connection: Any) -> list[str]:
    dropped: list[str] = []
    with connection.cursor() as cursor:
        for table_name in LEGACY_DROP_TABLES:
            if not _table_exists(connection, table_name):
                continue
            cursor.execute(
                sql.SQL("drop table if exists {} cascade").format(sql.Identifier(table_name))
            )
            dropped.append(table_name)
    return dropped


def main() -> None:
    ensure_app_storage_seeded()
    ensure_message_storage()
    ensure_project_group_message_storage()

    with get_postgres_connection() as connection:
        migrated_app_users = _migrate_legacy_app_users(connection)
        migrated_messages = _migrate_messages_from_app_storage(connection)
        migrated_group_messages = _migrate_project_group_messages_from_app_storage(connection)
        _ensure_user_foreign_keys(connection)
        dropped_tables = _drop_legacy_tables(connection)
        connection.commit()

    print("Schema consolidation complete.")
    print(f"Migrated legacy app_users rows: {migrated_app_users}")
    print(f"Migrated direct messages from legacy storage: {migrated_messages}")
    print(f"Migrated project group messages from legacy storage: {migrated_group_messages}")
    if dropped_tables:
        print("Dropped deprecated tables: " + ", ".join(dropped_tables))
    else:
        print("No deprecated tables needed dropping.")


if __name__ == "__main__":
    main()
