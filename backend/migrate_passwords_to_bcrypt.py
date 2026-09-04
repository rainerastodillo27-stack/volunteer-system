"""One-time migration for legacy plaintext values in ``public.users``.

Run with:

    python -m backend.migrate_passwords_to_bcrypt

The API also performs this migration automatically when it initializes the
relational mirror, but this command is useful for an explicit deployment step.
"""

try:
    from .db import get_postgres_connection
    from .relational_mirror import _migrate_plaintext_user_passwords
except ImportError:
    from db import get_postgres_connection
    from relational_mirror import _migrate_plaintext_user_passwords


def main() -> None:
    with get_postgres_connection() as connection:
        migrated_count = _migrate_plaintext_user_passwords(connection)
        connection.commit()
    print(f"Migrated {migrated_count} plaintext user password(s) to bcrypt.")


if __name__ == "__main__":
    main()
