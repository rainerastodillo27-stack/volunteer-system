from datetime import datetime, timezone

from db import get_connection


NOW = datetime.now(timezone.utc).isoformat()

USERS = [
    {
        "id": "admin-1",
        "email": "admin@nvc.org",
        "password": "admin123",
        "role": "admin",
        "name": "NVC Admin Account",
        "phone": "+63 917 000 0001",
        "created_at": NOW,
    },
    {
        "id": "volunteer-1",
        "email": "volunteer@example.com",
        "password": "volunteer123",
        "role": "volunteer",
        "name": "Volunteer Account",
        "phone": "+0987654321",
        "created_at": NOW,
    },
    {
        "id": "partner-user-1",
        "email": "partner@livelihoods.org",
        "password": "partner123",
        "role": "partner",
        "name": "Partner Org Account",
        "phone": "+919876543211",
        "created_at": NOW,
    },
    {
        "id": "partner-user-2",
        "email": "partnerships@pbsp.org.ph",
        "password": "partner123",
        "role": "partner",
        "name": "PBSP Account",
        "phone": "+63 2 8818 8678",
        "created_at": NOW,
    },
    {
        "id": "partner-user-3",
        "email": "partnerships@jollibeefoundation.org",
        "password": "partner123",
        "role": "partner",
        "name": "Jollibee Foundation Account",
        "phone": "+63 2 8634 1111",
        "created_at": NOW,
    },
]


def run_many(cursor, statement: str, rows: list[tuple]) -> None:
    for row in rows:
        cursor.execute(statement, row)


# Seeds only the demo login accounts into Postgres.
def main() -> None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            run_many(
                cursor,
                """
                insert into app_users (app_users_id, email, password, role, name, phone, created_at)
                values (%s, %s, %s, %s, %s, %s, %s)
                on conflict (app_users_id) do update set
                  email = excluded.email,
                  password = excluded.password,
                  role = excluded.role,
                  name = excluded.name,
                  phone = excluded.phone
                """,
                [
                    (
                        user["id"],
                        user["email"],
                        user["password"],
                        user["role"],
                        user["name"],
                        user["phone"],
                        user["created_at"],
                    )
                    for user in USERS
                ],
            )
        connection.commit()

    print("Demo login users seeded.")


if __name__ == "__main__":
    main()
