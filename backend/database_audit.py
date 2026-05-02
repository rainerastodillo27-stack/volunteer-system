try:
    from .db import get_postgres_connection
    from .relational_mirror import TABLE_SPECS
    from .storage_table_contract import (
        CANONICAL_STORAGE_TABLES,
        LEGACY_AUXILIARY_TABLES,
        LEGACY_COMPAT_STORAGE_TABLES,
        MESSAGE_STORAGE_TABLES,
    )
except ImportError:
    from db import get_postgres_connection
    from relational_mirror import TABLE_SPECS
    from storage_table_contract import (
        CANONICAL_STORAGE_TABLES,
        LEGACY_AUXILIARY_TABLES,
        LEGACY_COMPAT_STORAGE_TABLES,
        MESSAGE_STORAGE_TABLES,
    )


CANONICAL_TABLES = sorted(
    {
        *CANONICAL_STORAGE_TABLES.values(),
        *MESSAGE_STORAGE_TABLES.values(),
    }
)

EXPECTED_SUPPORT_TABLES: set[str] = {
    *LEGACY_COMPAT_STORAGE_TABLES.values(),
    *LEGACY_AUXILIARY_TABLES,
}

EXPECTED_TABLES = set(CANONICAL_TABLES) | EXPECTED_SUPPORT_TABLES


def _expected_columns_by_table() -> dict[str, set[str]]:
    expected_columns: dict[str, set[str]] = {}
    for spec in TABLE_SPECS.values():
        table_name = spec["table"]
        expected_columns.setdefault(table_name, set()).update(column_name for column_name, _ in spec["columns"])
    return expected_columns


def print_section(title: str) -> None:
    print(f"\n## {title}")


def main() -> None:
    with get_postgres_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                select table_name
                from information_schema.tables
                where table_schema = 'public'
                order by table_name
                """
            )
            existing_tables = [row[0] for row in cursor.fetchall()]

            print_section("Tables")
            for table_name in existing_tables:
                print(table_name)

            rogue_tables = [
                table_name
                for table_name in existing_tables
                if table_name not in EXPECTED_TABLES
            ]
            print_section("Unexpected Tables")
            if rogue_tables:
                for table_name in rogue_tables:
                    print(table_name)
            else:
                print("none")

            print_section("Canonical Row Counts")
            existing_table_names = set(existing_tables)
            for table_name in CANONICAL_TABLES:
                if table_name not in existing_table_names:
                    print(f"{table_name}: missing table")
                    continue
                cursor.execute(f"select count(*) from {table_name}")
                print(f"{table_name}: {cursor.fetchone()[0]}")

            cursor.execute(
                """
                select table_name, column_name
                from information_schema.columns
                where table_schema = 'public'
                order by table_name, ordinal_position
                """
            )
            actual_columns_by_table: dict[str, list[str]] = {}
            for table_name, column_name in cursor.fetchall():
                actual_columns_by_table.setdefault(table_name, []).append(column_name)

            expected_columns_by_table = _expected_columns_by_table()
            print_section("Canonical Columns")
            for table_name in CANONICAL_TABLES:
                columns = actual_columns_by_table.get(table_name, [])
                print(f"{table_name}: {', '.join(columns) if columns else 'missing table'}")

            print_section("Column Mismatches")
            found_mismatch = False
            for table_name in sorted(expected_columns_by_table):
                if table_name not in CANONICAL_TABLES:
                    continue
                expected_columns = expected_columns_by_table[table_name]
                actual_columns = set(actual_columns_by_table.get(table_name, []))
                missing_columns = sorted(expected_columns - actual_columns)
                extra_columns = sorted(actual_columns - expected_columns)
                if not missing_columns and not extra_columns:
                    continue
                found_mismatch = True
                print(f"{table_name}:")
                if missing_columns:
                    print(f"  missing: {', '.join(missing_columns)}")
                if extra_columns:
                    print(f"  extra: {', '.join(extra_columns)}")
            if not found_mismatch:
                print("none")

            checks = {
                "duplicate_user_emails": """
                    select lower(coalesce(email, '')) as value, count(*)
                    from users
                    group by lower(coalesce(email, ''))
                    having lower(coalesce(email, '')) <> '' and count(*) > 1
                    order by count(*) desc, value
                """,
                "duplicate_partner_emails": """
                    select lower(coalesce(contact_email, '')) as value, count(*)
                    from partners
                    group by lower(coalesce(contact_email, ''))
                    having lower(coalesce(contact_email, '')) <> '' and count(*) > 1
                    order by count(*) desc, value
                """,
                "duplicate_volunteer_user_ids": """
                    select coalesce(user_id, '') as value, count(*)
                    from volunteers
                    group by coalesce(user_id, '')
                    having coalesce(user_id, '') <> '' and count(*) > 1
                    order by count(*) desc, value
                """,
                "invalid_user_phones": """
                    select users_id, phone
                    from users
                    where phone is not null
                      and phone !~ '^09[0-9]{9}$'
                    order by users_id
                """,
                "invalid_partner_contact_phones": """
                    select partners_id, contact_phone
                    from partners
                    where contact_phone is not null
                      and contact_phone !~ '^(09[0-9]{9}|\\+63[0-9]{9,11})$'
                    order by partners_id
                """,
                "invalid_volunteer_phones": """
                    select volunteers_id, phone
                    from volunteers
                    where phone is not null
                      and phone !~ '^09[0-9]{9}$'
                    order by volunteers_id
                """,
                "projects_without_partner": """
                    select count(*)
                    from projects p
                    left join partners pr on pr.partners_id = p.partner_id
                    where coalesce(p.partner_id, '') <> '' and pr.partners_id is null
                """,
                "matches_with_missing_project_or_event": """
                    select count(*)
                    from volunteer_matches m
                    left join projects p on p.projects_id = m.project_id
                    left join events e on e.events_id = m.project_id
                    where coalesce(m.project_id, '') <> ''
                      and p.projects_id is null
                      and e.events_id is null
                """,
                "matches_with_missing_volunteer": """
                    select count(*)
                    from volunteer_matches m
                    left join volunteers v on v.volunteers_id = m.volunteer_id
                    where coalesce(m.volunteer_id, '') <> '' and v.volunteers_id is null
                """,
            }

            print_section("Data Quality")
            for name, query in checks.items():
                cursor.execute(query)
                rows = cursor.fetchall()
                if not rows:
                    print(f"{name}: none")
                    continue
                print(f"{name}:")
                for row in rows:
                    print(row)


if __name__ == "__main__":
    main()
