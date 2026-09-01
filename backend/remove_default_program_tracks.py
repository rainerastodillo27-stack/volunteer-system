"""Remove built-in pillar programs from the canonical programs table."""

from __future__ import annotations

from .db import get_postgres_connection


DEFAULT_TRACKS = ("Nutrition", "Education", "Livelihood", "Disaster")


def main() -> None:
    with get_postgres_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                delete from programs
                where programs_id = any(%s) or title = any(%s)
                returning programs_id, title
                """,
                (list(DEFAULT_TRACKS), list(DEFAULT_TRACKS)),
            )
            deleted_rows = cursor.fetchall()
            connection.commit()

            cursor.execute("select programs_id, title from programs order by created_at, programs_id")
            remaining_rows = cursor.fetchall()

    print(f"deleted={deleted_rows}")
    print(f"remaining={remaining_rows}")


if __name__ == "__main__":
    main()
