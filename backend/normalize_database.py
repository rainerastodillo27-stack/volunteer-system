"""Audit and apply focused, reversible database normalization rules."""

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .db import get_postgres_connection
from .field_rules import is_valid_email, normalize_email, normalize_ph_mobile_phone
from .schema_maintenance import (
    DATA_QUALITY_CONSTRAINT_SPECS,
    IDENTITY_CONSTRAINT_NAMES,
    apply_identity_constraints,
    apply_data_quality_unique_indexes,
)
from .storage_table_contract import DEPRECATED_STORAGE_TABLES


PHONE_COLUMNS = (
    ("users", "users_id", "phone"),
    ("partners", "partners_id", "contact_phone"),
    ("volunteers", "volunteers_id", "phone"),
)
EMAIL_COLUMNS = (
    ("users", "users_id", "email"),
    ("partners", "partners_id", "contact_email"),
    ("volunteers", "volunteers_id", "email"),
)


def _table_exists(connection: Any, table_name: str) -> bool:
    with connection.cursor() as cursor:
        cursor.execute("select to_regclass(%s) is not null", (f"public.{table_name}",))
        return bool(cursor.fetchone()[0])


def _collect_changes(connection: Any) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    changes: list[dict[str, Any]] = []
    invalid: list[dict[str, Any]] = []
    with connection.cursor() as cursor:
        for table, id_column, value_column in PHONE_COLUMNS:
            if not _table_exists(connection, table):
                continue
            cursor.execute(
                f"select {id_column}, {value_column} from {table} "
                f"where {value_column} is not null and btrim({value_column}) <> ''"
            )
            for row_id, old_value in cursor.fetchall():
                normalized = normalize_ph_mobile_phone(old_value)
                if not normalized:
                    invalid.append({"table": table, "id": row_id, "column": value_column, "value": old_value})
                elif normalized != old_value:
                    changes.append(
                        {"table": table, "id_column": id_column, "id": row_id, "column": value_column,
                         "before": old_value, "after": normalized}
                    )

        for table, id_column, value_column in EMAIL_COLUMNS:
            if not _table_exists(connection, table):
                continue
            cursor.execute(
                f"select {id_column}, {value_column} from {table} "
                f"where {value_column} is not null and btrim({value_column}) <> ''"
            )
            for row_id, old_value in cursor.fetchall():
                normalized = normalize_email(old_value)
                if not is_valid_email(normalized):
                    invalid.append({"table": table, "id": row_id, "column": value_column, "value": old_value})
                elif normalized != old_value:
                    changes.append(
                        {"table": table, "id_column": id_column, "id": row_id, "column": value_column,
                         "before": old_value, "after": normalized}
                    )
    return changes, invalid


def _deprecated_table_counts(connection: Any) -> dict[str, int]:
    counts: dict[str, int] = {}
    with connection.cursor() as cursor:
        for table_name in DEPRECATED_STORAGE_TABLES:
            if not _table_exists(connection, table_name):
                continue
            cursor.execute(f'select count(*) from "{table_name}"')
            counts[table_name] = int(cursor.fetchone()[0])
    return counts


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Apply normalization and constraints.")
    args = parser.parse_args()

    with get_postgres_connection() as connection:
        changes, invalid = _collect_changes(connection)
        deprecated_counts = _deprecated_table_counts(connection)
        print(f"[NORMALIZE] candidate value changes: {len(changes)}")
        print(f"[NORMALIZE] invalid phone/email values requiring review: {len(invalid)}")
        for item in invalid:
            print(f"[INVALID] {item['table']}.{item['column']} id={item['id']} value={item['value']!r}")
        print(f"[NORMALIZE] deprecated tables present: {deprecated_counts or 'none'}")

        if not args.apply:
            print("[DRY-RUN] No database changes were made. Use --apply to commit.")
            return
        if invalid:
            raise SystemExit("Refusing to apply: invalid phone values need an explicit correction decision.")

        if changes:
            backup_dir = Path(__file__).resolve().parents[1] / "migration_backups"
            backup_dir.mkdir(parents=True, exist_ok=True)
            timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            backup_path = backup_dir / f"database-normalization-{timestamp}.json"
            backup_path.write_text(json.dumps(changes, indent=2, default=str), encoding="utf-8")
            print(f"[BACKUP] {backup_path}")

        try:
            with connection.cursor() as cursor:
                for change in changes:
                    cursor.execute(
                        f"update {change['table']} set {change['column']} = %s "
                        f"where {change['id_column']} = %s",
                        (change["after"], change["id"]),
                    )

            constraints = apply_identity_constraints(connection)
            indexes = apply_data_quality_unique_indexes(connection)

            dropped: list[str] = []
            with connection.cursor() as cursor:
                for table_name, row_count in deprecated_counts.items():
                    if row_count != 0:
                        print(f"[KEEP] {table_name}: {row_count} row(s), not safe to drop automatically")
                        continue
                    cursor.execute(f'drop table "{table_name}"')
                    dropped.append(table_name)

                for table_name, constraint_name, _ in DATA_QUALITY_CONSTRAINT_SPECS:
                    if constraint_name in IDENTITY_CONSTRAINT_NAMES and _table_exists(connection, table_name):
                        cursor.execute(f"alter table {table_name} validate constraint {constraint_name}")

                # Superseded by the stricter 11-digit mobile-only constraint.
                if _table_exists(connection, "partners"):
                    cursor.execute("alter table partners drop constraint if exists partners_contact_phone_chk")

            connection.commit()
        except Exception:
            connection.rollback()
            raise

        print(f"[OK] normalized values: {len(changes)}")
        print(f"[OK] enforced check constraints: {len(constraints)}")
        print(f"[OK] enforced unique indexes: {len(indexes)}")
        print(f"[OK] removed empty deprecated tables: {dropped or 'none'}")


if __name__ == "__main__":
    main()
