"""Print columns and constraints for one public table."""

from __future__ import annotations

import argparse

from .db import get_postgres_connection


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("table")
    args = parser.parse_args()

    with get_postgres_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                select column_name, is_nullable, data_type
                from information_schema.columns
                where table_schema = %s and table_name = %s
                order by ordinal_position
                """,
                ("public", args.table),
            )
            print("COLUMNS")
            for row in cursor.fetchall():
                print(row)

            cursor.execute(
                """
                select tc.constraint_name, tc.constraint_type, kcu.column_name
                from information_schema.table_constraints tc
                left join information_schema.key_column_usage kcu
                  on tc.constraint_name = kcu.constraint_name
                 and tc.table_schema = kcu.table_schema
                where tc.table_schema = %s and tc.table_name = %s
                order by tc.constraint_name, kcu.ordinal_position
                """,
                ("public", args.table),
            )
            print("CONSTRAINTS")
            for row in cursor.fetchall():
                print(row)


if __name__ == "__main__":
    main()
