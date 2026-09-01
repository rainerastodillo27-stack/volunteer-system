"""Consolidate legacy planning/program tables into their canonical tables."""

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from psycopg.rows import dict_row

from .db import get_postgres_connection


LEGACY_TABLES = ("admin_planning_items", "program_tracks")


def _table_exists(connection: Any, table_name: str) -> bool:
    with connection.cursor() as cursor:
        cursor.execute("select to_regclass(%s) is not null", (f"public.{table_name}",))
        return bool(cursor.fetchone()[0])


def _read_rows(connection: Any, table_name: str) -> list[dict[str, Any]]:
    if not _table_exists(connection, table_name):
        return []
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(f'select * from "{table_name}" order by 1')
        return [dict(row) for row in cursor.fetchall()]


def _json_list(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    if not value:
        return []
    try:
        parsed = json.loads(str(value))
    except (TypeError, ValueError, json.JSONDecodeError):
        return []
    return [item for item in parsed if isinstance(item, dict)] if isinstance(parsed, list) else []


def _planning_item_payload(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("admin_planning_items_id") or row.get("id"),
        "title": row.get("title") or "",
        "description": row.get("description"),
        "calendarId": row.get("calendar_id") or "planner-projects",
        "linkedProjectId": row.get("linked_project_id"),
        "startDate": row.get("start_date") or "",
        "endDate": row.get("end_date") or "",
        "location": row.get("location"),
        "participantsLabel": row.get("participants_label"),
        "createdBy": row.get("created_by") or "",
        "createdAt": row.get("created_at") or "",
        "updatedAt": row.get("updated_at") or "",
    }


def _migrate_planning_items(connection: Any, rows: list[dict[str, Any]]) -> int:
    migrated = 0
    with connection.cursor(row_factory=dict_row) as cursor:
        for row in rows:
            item = _planning_item_payload(row)
            item_id = str(item.get("id") or "").strip()
            if not item_id:
                raise ValueError("Legacy planning item has no id.")
            calendar_id = str(item.get("calendarId") or "planner-projects").strip()
            cursor.execute(
                """
                select planning_items
                from admin_planning_calendars
                where admin_planning_calendars_id = %s
                """,
                (calendar_id,),
            )
            calendar_row = cursor.fetchone()
            existing_items = _json_list(calendar_row["planning_items"]) if calendar_row else []
            merged_items = [entry for entry in existing_items if str(entry.get("id") or "") != item_id]
            merged_items.append(item)
            encoded_items = json.dumps(merged_items, separators=(",", ":"))
            if calendar_row:
                cursor.execute(
                    """
                    update admin_planning_calendars
                    set planning_items = %s, updated_at = %s
                    where admin_planning_calendars_id = %s
                    """,
                    (encoded_items, item.get("updatedAt") or datetime.now(timezone.utc).isoformat(), calendar_id),
                )
            else:
                cursor.execute(
                    """
                    insert into admin_planning_calendars (
                      admin_planning_calendars_id, name, color, description,
                      planning_items, created_at, updated_at
                    ) values (%s, %s, '#0F766E', 'Migrated planning lane.', %s, %s, %s)
                    """,
                    (
                        calendar_id,
                        calendar_id,
                        encoded_items,
                        item.get("createdAt") or datetime.now(timezone.utc).isoformat(),
                        item.get("updatedAt") or datetime.now(timezone.utc).isoformat(),
                    ),
                )
            migrated += 1
    return migrated


def _program_category(row: dict[str, Any]) -> str:
    text = f"{row.get('id') or ''} {row.get('title') or ''}".lower()
    for category in ("Nutrition", "Education", "Livelihood", "Disaster"):
        if category.lower() in text:
            return category
    return "Disaster"


def _migrate_program_tracks(connection: Any, rows: list[dict[str, Any]]) -> int:
    migrated = 0
    with connection.cursor() as cursor:
        for row in rows:
            program_id = str(row.get("id") or row.get("program_tracks_id") or "").strip()
            if not program_id:
                raise ValueError("Legacy program track has no id.")
            category = _program_category(row)
            created_at = row.get("created_at") or datetime.now(timezone.utc).isoformat()
            updated_at = row.get("updated_at") or created_at
            cursor.execute(
                """
                insert into programs (
                  programs_id, title, description, icon, color, image_url,
                  image_hidden, program_module, status, category, start_date,
                  end_date, location, volunteers_needed, volunteers,
                  joined_user_ids, linked_event_count, created_at, updated_at
                ) values (
                  %s, %s, %s, %s, %s, %s,
                  false, %s, 'Planning', %s, %s,
                  %s, '{}', 0, '{}'::text[],
                  '{}'::text[], 0, %s, %s
                )
                on conflict (programs_id) do nothing
                """,
                (
                    program_id,
                    row.get("title") or program_id,
                    row.get("description"),
                    row.get("icon"),
                    row.get("color"),
                    row.get("image_url"),
                    category,
                    category,
                    created_at,
                    updated_at,
                    created_at,
                    updated_at,
                ),
            )
            migrated += 1
    return migrated


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    with get_postgres_connection() as connection:
        table_rows = {table: _read_rows(connection, table) for table in LEGACY_TABLES}
        existing_tables = [table for table in LEGACY_TABLES if _table_exists(connection, table)]
        for table in LEGACY_TABLES:
            print(f"[CONSOLIDATE] {table}: {len(table_rows[table])} row(s)")
        if not args.apply:
            print("[DRY-RUN] No changes made. Use --apply to migrate and drop the tables.")
            return

        backup_dir = Path(__file__).resolve().parents[1] / "migration_backups"
        backup_dir.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        backup_path = backup_dir / f"redundant-tables-{timestamp}.json"
        backup_path.write_text(json.dumps(table_rows, indent=2, default=str), encoding="utf-8")
        print(f"[BACKUP] {backup_path}")

        try:
            planning_count = _migrate_planning_items(connection, table_rows["admin_planning_items"])
            program_count = _migrate_program_tracks(connection, table_rows["program_tracks"])
            with connection.cursor() as cursor:
                for table_name in existing_tables:
                    cursor.execute(f'drop table "{table_name}"')
            connection.commit()
        except Exception:
            connection.rollback()
            raise

        remaining = [table for table in LEGACY_TABLES if _table_exists(connection, table)]
        if remaining:
            raise RuntimeError(f"Tables still exist after consolidation: {remaining}")
        print(f"[OK] planning items migrated: {planning_count}")
        print(f"[OK] program tracks migrated: {program_count}")
        print(f"[OK] dropped tables: {existing_tables or 'none'}")


if __name__ == "__main__":
    main()
