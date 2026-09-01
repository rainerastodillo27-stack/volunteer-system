"""Migrate Volunteer System data from one Supabase Postgres database to another.

The running backend uses the canonical relational tables defined by
relational_mirror.TABLE_SPECS, so this script reads supported collections from
the old database and replaces those same collections in the new database.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import psycopg

try:
    from .init_supabase import BASE_DDL
    from .relational_mirror import (
        TABLE_SPECS,
        ensure_relational_mirror_tables,
        get_relational_collection,
        _primary_key_column,
        _row_filter_clause,
        _row_to_item,
        replace_relational_collection,
    )
except ImportError:
    from init_supabase import BASE_DDL
    from relational_mirror import (
        TABLE_SPECS,
        ensure_relational_mirror_tables,
        get_relational_collection,
        _primary_key_column,
        _row_filter_clause,
        _row_to_item,
        replace_relational_collection,
    )


DEFAULT_OLD_DB_URL = (
    "postgresql://postgres.oshkcfyytdzojswnrbhu:CAPSTONE_ISCAP1"
    "@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=require"
)

COLLECTION_KEYS = [
    "users",
    "partners",
    "volunteers",
    "programs",
    "programTracks",
    "projects",
    "events",
    "statusUpdates",
    "volunteerMatches",
    "volunteerTimeLogs",
    "volunteerProjectJoins",
    "partnerProjectApplications",
    "partnerReports",
    "publishedImpactReports",
    "adminPlanningCalendars",
]

DERIVED_COLLECTION_KEYS = ["skills", "tasks"]
DIRECT_TABLES = ["messages", "project_group_messages"]


def load_dotenv_file() -> None:
    env_file = Path(__file__).resolve().parent.parent / ".env"
    if not env_file.exists():
        return

    for line in env_file.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        os.environ.setdefault(key, value)


def connect(url: str):
    return psycopg.connect(url, connect_timeout=15, prepare_threshold=None)


def table_exists(connection: Any, table_name: str) -> bool:
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


def table_columns(connection: Any, table_name: str) -> list[str]:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            select column_name
            from information_schema.columns
            where table_schema = 'public' and table_name = %s
            order by ordinal_position
            """,
            (table_name,),
        )
        return [str(row[0]) for row in cursor.fetchall()]


def fetch_app_storage_collection(connection: Any, key: str) -> list[dict[str, Any]]:
    if not table_exists(connection, "app_storage"):
        return []

    with connection.cursor() as cursor:
        cursor.execute("select value from app_storage where key = %s", (key,))
        row = cursor.fetchone()
    if not row or not isinstance(row[0], list):
        return []
    return [item for item in row[0] if isinstance(item, dict) and item.get("id")]


def fetch_collection(connection: Any, key: str) -> list[dict[str, Any]]:
    try:
        items = get_relational_collection(connection, key)
    except Exception:
        items = []
    if items:
        return [item for item in items if isinstance(item, dict) and item.get("id")]
    return fetch_app_storage_collection(connection, key)


def fetch_source_collection(connection: Any, key: str) -> list[dict[str, Any]]:
    spec = TABLE_SPECS.get(key)
    if not spec or not table_exists(connection, spec["table"]):
        return fetch_app_storage_collection(connection, key)

    source_columns = set(table_columns(connection, spec["table"]))
    expected_columns = [column_name for column_name, _ in spec["columns"]]
    pk_column = _primary_key_column(key)
    select_parts: list[str] = []

    for index, column_name in enumerate(expected_columns):
        if column_name in source_columns:
            select_parts.append(f'"{column_name}"')
        elif index == 0 and column_name == pk_column and "id" in source_columns:
            select_parts.append(f'"id" as "{column_name}"')
        else:
            select_parts.append(f'null as "{column_name}"')

    query = f"select {', '.join(select_parts)} from {spec['table']}"
    filter_clause = _row_filter_clause(key)
    if filter_clause and all(part in source_columns for part in ["generated_at"]):
        query += f" where {filter_clause}"
    if pk_column in source_columns:
        query += f" order by {pk_column} asc"
    elif "id" in source_columns:
        query += " order by id asc"

    with connection.cursor(row_factory=psycopg.rows.dict_row) as cursor:
        cursor.execute("set statement_timeout = '30s'")
        cursor.execute(query)
        rows = cursor.fetchall()

    items = []
    for row in rows:
        try:
            item = _row_to_item(key, dict(row))
        except Exception:
            continue
        if isinstance(item, dict) and item.get("id"):
            items.append(item)
    if items:
        return items
    return fetch_app_storage_collection(connection, key)


def count_table(connection: Any, table_name: str) -> int | None:
    if not table_exists(connection, table_name):
        return None

    with connection.cursor() as cursor:
        cursor.execute(f"select count(*) from {table_name}")
        row = cursor.fetchone()
    return int(row[0]) if row else 0


def backup_target(connection: Any, collections: dict[str, list[dict[str, Any]]]) -> Path:
    backup_dir = Path(__file__).resolve().parent.parent / "migration_backups"
    backup_dir.mkdir(exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_path = backup_dir / f"target-before-supabase-migration-{stamp}.json"

    payload: dict[str, Any] = {
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "collections": {},
        "directTables": {},
    }

    for key in collections:
        payload["collections"][key] = fetch_collection(connection, key)

    for table_name in DIRECT_TABLES:
        if not table_exists(connection, table_name):
            payload["directTables"][table_name] = []
            continue
        columns = table_columns(connection, table_name)
        with connection.cursor() as cursor:
            cursor.execute(f"select row_to_json(t) from {table_name} t")
            payload["directTables"][table_name] = [row[0] for row in cursor.fetchall()]
            payload["directTables"][f"{table_name}Columns"] = columns

    backup_path.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    return backup_path


def ensure_target_schema(connection: Any) -> None:
    ensure_relational_mirror_tables(connection)
    with connection.cursor() as cursor:
        for statement in BASE_DDL:
            cursor.execute(statement)
    connection.commit()


def migrate_direct_table(source: Any, target: Any, table_name: str) -> tuple[int, int]:
    if not table_exists(source, table_name) or not table_exists(target, table_name):
        return (0, count_table(target, table_name) or 0)

    source_columns = table_columns(source, table_name)
    target_columns = table_columns(target, table_name)
    source_column_set = set(source_columns)
    selected_target_columns: list[str] = []
    select_parts: list[str] = []

    for index, column in enumerate(target_columns):
        if column in source_column_set:
            selected_target_columns.append(column)
            select_parts.append(f'"{column}"')
        elif index == 0 and "id" in source_column_set:
            selected_target_columns.append(column)
            select_parts.append(f'"id" as "{column}"')

    if not selected_target_columns:
        return (0, count_table(target, table_name) or 0)

    target_column_sql = ", ".join([f'"{column}"' for column in selected_target_columns])
    select_sql = ", ".join(select_parts)
    with source.cursor() as source_cursor:
        source_cursor.execute(f"select {select_sql} from {table_name}")
        rows = source_cursor.fetchall()

    with target.cursor() as target_cursor:
        target_cursor.execute(f"delete from {table_name}")
        if rows:
            placeholders = ", ".join(["%s"] * len(selected_target_columns))
            target_cursor.executemany(
                f"insert into {table_name} ({target_column_sql}) values ({placeholders})",
                rows,
            )
    target.commit()
    return (len(rows), count_table(target, table_name) or 0)


def main() -> None:
    load_dotenv_file()

    old_db_url = os.getenv("OLD_SUPABASE_DB_URL", DEFAULT_OLD_DB_URL)
    new_db_url = os.getenv("SUPABASE_DB_URL", "").strip()
    if not new_db_url:
        raise RuntimeError("SUPABASE_DB_URL is not set.")

    print("Connecting to old and new Supabase Postgres databases...", flush=True)
    with connect(old_db_url) as old_conn, connect(new_db_url) as new_conn:
        print("Connected.", flush=True)
        ensure_target_schema(new_conn)

        source_collections = {}
        print("Reading source collections...", flush=True)
        for key in [*COLLECTION_KEYS, *DERIVED_COLLECTION_KEYS]:
            if key not in TABLE_SPECS:
                continue
            items = fetch_source_collection(old_conn, key)
            source_collections[key] = items
            print(f"  {key}: {len(items)} source records found", flush=True)

        backup_path = backup_target(new_conn, source_collections)
        print(f"Backed up current target data to {backup_path}", flush=True)

        print("Replacing canonical target collections...", flush=True)
        for key in [*COLLECTION_KEYS, *DERIVED_COLLECTION_KEYS]:
            items = source_collections.get(key, [])
            if key in TABLE_SPECS:
                target_table = TABLE_SPECS[key]["table"]
                if not table_exists(new_conn, target_table) and not items:
                    print(f"  {key}: target table missing and source empty; skipped", flush=True)
                    continue
                replace_relational_collection(new_conn, key, items)
                new_conn.commit()
                print(f"  {key}: {len(items)} source records migrated", flush=True)

        print("Replacing direct message tables...", flush=True)
        direct_results: dict[str, tuple[int, int]] = {}
        for table_name in DIRECT_TABLES:
            migrated_count, target_count = migrate_direct_table(old_conn, new_conn, table_name)
            direct_results[table_name] = (migrated_count, target_count)
            print(f"  {table_name}: {migrated_count} source rows migrated", flush=True)

        print("Verifying target counts...", flush=True)
        failed: list[str] = []
        for key, source_items in source_collections.items():
            target_table = TABLE_SPECS[key]["table"]
            if not table_exists(new_conn, target_table) and not source_items:
                print(f"  {key}: source=0 target=0 OK", flush=True)
                continue
            target_items = fetch_collection(new_conn, key)
            source_count = len(source_items)
            target_count = len(target_items)
            status = "OK" if source_count == target_count else "MISMATCH"
            print(f"  {key}: source={source_count} target={target_count} {status}", flush=True)
            if source_count != target_count:
                failed.append(key)

        for table_name, (source_count, target_count) in direct_results.items():
            status = "OK" if source_count == target_count else "MISMATCH"
            print(f"  {table_name}: source={source_count} target={target_count} {status}", flush=True)
            if source_count != target_count:
                failed.append(table_name)

        if failed:
            raise RuntimeError("Migration verification failed for: " + ", ".join(failed))

        print("Migration complete and verified.", flush=True)


if __name__ == "__main__":
    main()
