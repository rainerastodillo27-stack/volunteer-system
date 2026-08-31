"""Remove the built-in four program pillar tracks from Supabase."""

from __future__ import annotations

from .db import get_postgres_connection


DEFAULT_TRACKS = ("Nutrition", "Education", "Livelihood", "Disaster")


def main() -> None:
    with get_postgres_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                delete from program_tracks
                where id = any(%s) or title = any(%s)
                returning id, title
                """,
                (list(DEFAULT_TRACKS), list(DEFAULT_TRACKS)),
            )
            deleted_rows = cursor.fetchall()
            connection.commit()

            cursor.execute("select id, title from program_tracks order by sort_order, id")
            remaining_rows = cursor.fetchall()

    print(f"deleted={deleted_rows}")
    print(f"remaining={remaining_rows}")


if __name__ == "__main__":
    main()
