from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.db import get_postgres_connection


ADMIN = {
    "id": "admin-1",
    "users_id": "admin-1",
    "email": "admin@nvc.org",
    "password": "admin123",
    "role": "admin",
    "name": "NVC Admin Account",
    "phone": "09170000001",
    "user_type": "Adult",
    "pillars_of_interest": ["Education", "Livelihood", "Nutrition"],
    "approval_status": "approved",
    "created_at": datetime.now(timezone.utc).isoformat(),
}


def main() -> None:
    conn = get_postgres_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                select column_name
                from information_schema.columns
                where table_schema = 'public'
                  and table_name = 'users'
                order by ordinal_position
                """
            )
            columns = [row[0] for row in cursor.fetchall()]
            if not columns:
                raise RuntimeError("public.users table does not exist.")

            cursor.execute(
                """
                update users
                set email = %s,
                    password = %s,
                    role = %s,
                    name = %s,
                    phone = %s,
                    user_type = %s,
                    pillars_of_interest = %s,
                    approval_status = %s
                where lower(coalesce(email, '')) = %s
                """,
                (
                    ADMIN["email"],
                    ADMIN["password"],
                    ADMIN["role"],
                    ADMIN["name"],
                    ADMIN["phone"],
                    ADMIN["user_type"],
                    ADMIN["pillars_of_interest"],
                    ADMIN["approval_status"],
                    ADMIN["email"],
                ),
            )

            if cursor.rowcount == 0:
                insert_columns = [column for column in columns if column in ADMIN]
                placeholders = ", ".join(["%s"] * len(insert_columns))
                cursor.execute(
                    f"insert into users ({', '.join(insert_columns)}) values ({placeholders})",
                    tuple(ADMIN[column] for column in insert_columns),
                )

        conn.commit()
        print("admin_ready")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
