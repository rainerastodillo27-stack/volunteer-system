from typing import Any

from psycopg import sql
from psycopg.errors import LockNotAvailable, QueryCanceled

try:
    from .db import get_connection
    from .operation_guard import SCHEMA_SETUP_UNLOCK_ENV_VAR, require_shared_db_unlock
except ImportError:
    from db import get_connection
    from operation_guard import SCHEMA_SETUP_UNLOCK_ENV_VAR, require_shared_db_unlock


TARGET_COLUMNS: list[tuple[str, str]] = [
    ("users", "pillars_of_interest"),
    ("partners", "advocacy_focus"),
    ("volunteers", "skills"),
    ("volunteers", "past_projects"),
    ("projects", "volunteers"),
    ("projects", "joined_user_ids"),
    ("projects", "skills_needed"),
    ("programs", "volunteers"),
    ("programs", "joined_user_ids"),
    ("events", "volunteers"),
    ("events", "joined_user_ids"),
    ("events", "skills_needed"),
    ("reports", "source_report_ids"),
]


def _get_column_udt_name(connection: Any, table_name: str, column_name: str) -> str | None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            select udt_name
            from information_schema.columns
            where table_schema = 'public'
              and table_name = %s
              and column_name = %s
            limit 1
            """,
            (table_name, column_name),
        )
        row = cursor.fetchone()
    return str(row[0]) if row and row[0] is not None else None


def _count_non_array_json_values(connection: Any, table_name: str, column_name: str) -> int:
    with connection.cursor() as cursor:
        cursor.execute(
            sql.SQL(
                """
                select count(*)
                from {table_name}
                where {column_name} is not null
                  and jsonb_typeof({column_name}) <> 'array'
                """
            ).format(
                table_name=sql.Identifier(table_name),
                column_name=sql.Identifier(column_name),
            )
        )
        row = cursor.fetchone()
    return int(row[0] or 0) if row else 0


def _count_non_string_array_elements(connection: Any, table_name: str, column_name: str) -> int:
    with connection.cursor() as cursor:
        cursor.execute(
            sql.SQL(
                """
                select count(*)
                from {table_name} t
                cross join lateral jsonb_array_elements(t.{column_name}) as e(value)
                where t.{column_name} is not null
                  and jsonb_typeof(t.{column_name}) = 'array'
                  and jsonb_typeof(e.value) <> 'string'
                """
            ).format(
                table_name=sql.Identifier(table_name),
                column_name=sql.Identifier(column_name),
            )
        )
        row = cursor.fetchone()
    return int(row[0] or 0) if row else 0


def _convert_column_to_text_array(connection: Any, table_name: str, column_name: str) -> None:
    temp_column_name = f"{column_name}__text_array_tmp"
    with connection.cursor() as cursor:
        cursor.execute(
            sql.SQL(
                """
                alter table {table_name}
                  drop column if exists {temp_column_name}
                """
            ).format(
                table_name=sql.Identifier(table_name),
                temp_column_name=sql.Identifier(temp_column_name),
            )
        )
        cursor.execute(
            sql.SQL(
                """
                alter table {table_name}
                  add column {temp_column_name} text[] not null default '{{}}'::text[]
                """
            ).format(
                table_name=sql.Identifier(table_name),
                temp_column_name=sql.Identifier(temp_column_name),
            )
        )
        cursor.execute(
            sql.SQL(
                """
                update {table_name}
                set {temp_column_name} = case
                  when {column_name} is null then '{{}}'::text[]
                  when jsonb_typeof({column_name}) = 'array' then array(
                    select value
                    from jsonb_array_elements_text({column_name}) as e(value)
                  )
                  else '{{}}'::text[]
                end
                """
            ).format(
                table_name=sql.Identifier(table_name),
                column_name=sql.Identifier(column_name),
                temp_column_name=sql.Identifier(temp_column_name),
            )
        )
        cursor.execute(
            sql.SQL(
                """
                alter table {table_name}
                  drop column {column_name}
                """
            ).format(
                table_name=sql.Identifier(table_name),
                column_name=sql.Identifier(column_name),
            )
        )
        cursor.execute(
            sql.SQL(
                """
                alter table {table_name}
                  rename column {temp_column_name} to {column_name}
                """
            ).format(
                table_name=sql.Identifier(table_name),
                temp_column_name=sql.Identifier(temp_column_name),
                column_name=sql.Identifier(column_name),
            )
        )


def _normalize_existing_text_array_column(connection: Any, table_name: str, column_name: str) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            sql.SQL(
                """
                update {table_name}
                set {column_name} = '{{}}'::text[]
                where {column_name} is null
                """
            ).format(
                table_name=sql.Identifier(table_name),
                column_name=sql.Identifier(column_name),
            )
        )
        cursor.execute(
            sql.SQL(
                """
                alter table {table_name}
                  alter column {column_name} set default '{{}}'::text[],
                  alter column {column_name} set not null
                """
            ).format(
                table_name=sql.Identifier(table_name),
                column_name=sql.Identifier(column_name),
            )
        )


def migrate_jsonb_string_arrays_to_text_arrays() -> None:
    require_shared_db_unlock(
        "jsonb-to-text[] schema migration",
        SCHEMA_SETUP_UNLOCK_ENV_VAR,
    )

    converted: list[str] = []
    already_text_array: list[str] = []
    skipped: list[str] = []

    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute("set statement_timeout = '120s'")
            cursor.execute("set lock_timeout = '5s'")
        for table_name, column_name in TARGET_COLUMNS:
            label = f"{table_name}.{column_name}"
            print(f"Processing {label}...")
            udt_name = _get_column_udt_name(connection, table_name, column_name)

            if udt_name is None:
                skipped.append(f"{label} (missing)")
                continue

            if udt_name == "jsonb":
                non_array_count = _count_non_array_json_values(connection, table_name, column_name)
                non_string_count = _count_non_string_array_elements(connection, table_name, column_name)

                if non_array_count or non_string_count:
                    raise RuntimeError(
                        f"Blocked conversion for {label}: non-array rows={non_array_count}, non-string elements={non_string_count}."
                    )

                try:
                    _convert_column_to_text_array(connection, table_name, column_name)
                    connection.commit()
                    converted.append(label)
                except (LockNotAvailable, QueryCanceled) as exc:
                    connection.rollback()
                    skipped.append(f"{label} (lock/timeout: {exc})")
                continue

            if udt_name == "_text":
                try:
                    _normalize_existing_text_array_column(connection, table_name, column_name)
                    connection.commit()
                    already_text_array.append(label)
                except (LockNotAvailable, QueryCanceled) as exc:
                    connection.rollback()
                    skipped.append(f"{label} (lock/timeout: {exc})")
                continue

            skipped.append(f"{label} (type={udt_name})")

    print("JSONB string-array migration complete.")
    print(f"Converted ({len(converted)}): {', '.join(converted) if converted else 'none'}")
    print(
        f"Already text[] ({len(already_text_array)}): "
        f"{', '.join(already_text_array) if already_text_array else 'none'}"
    )
    print(f"Skipped ({len(skipped)}): {', '.join(skipped) if skipped else 'none'}")


if __name__ == "__main__":
    migrate_jsonb_string_arrays_to_text_arrays()
