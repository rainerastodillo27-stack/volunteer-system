try:
    from .db import get_postgres_connection
except ImportError:
    from db import get_postgres_connection


CANONICAL_TABLES = [
    "users",
    "partners",
    "volunteers",
    "projects",
    "status_updates",
    "volunteer_matches",
    "volunteer_time_logs",
    "volunteer_project_joins",
    "partner_project_applications",
    "partner_event_check_ins",
    "partner_reports",
    "published_impact_reports",
    "messages",
    "project_group_messages",
    "admin_planning_calendars",
    "admin_planning_items",
]

EXPECTED_SUPPORT_TABLES: set[str] = set()

EXPECTED_TABLES = set(CANONICAL_TABLES) | EXPECTED_SUPPORT_TABLES


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

            rogue_tables = [table_name for table_name in existing_tables if table_name not in EXPECTED_TABLES]
            print_section("Unexpected Tables")
            if rogue_tables:
                for table_name in rogue_tables:
                    print(table_name)
            else:
                print("none")

            print_section("Canonical Row Counts")
            for table_name in CANONICAL_TABLES:
                cursor.execute(f"select count(*) from {table_name}")
                print(f"{table_name}: {cursor.fetchone()[0]}")

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
                    select id, phone
                    from users
                    where phone is not null
                      and phone !~ '^09[0-9]{9}$'
                    order by id
                """,
                "invalid_partner_contact_phones": """
                    select id, contact_phone
                    from partners
                    where contact_phone is not null
                      and contact_phone !~ '^(09[0-9]{9}|\\+63[0-9]{9,11})$'
                    order by id
                """,
                "invalid_volunteer_phones": """
                    select id, phone
                    from volunteers
                    where phone is not null
                      and phone !~ '^09[0-9]{9}$'
                    order by id
                """,
                "projects_without_partner": """
                    select count(*)
                    from projects p
                    left join partners pr on pr.id = p.partner_id
                    where coalesce(p.partner_id, '') <> '' and pr.id is null
                """,
                "matches_with_missing_project": """
                    select count(*)
                    from volunteer_matches m
                    left join projects p on p.id = m.project_id
                    where coalesce(m.project_id, '') <> '' and p.id is null
                """,
                "matches_with_missing_volunteer": """
                    select count(*)
                    from volunteer_matches m
                    left join volunteers v on v.id = m.volunteer_id
                    where coalesce(m.volunteer_id, '') <> '' and v.id is null
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
