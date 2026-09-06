"""Create or update an administrator account from a trusted terminal.

Run from the project root:

    python -m backend.create_admin

The password is requested interactively and is stored only as a bcrypt hash.
This command is intentionally separate from the public registration flow.
"""

from __future__ import annotations

import getpass
import uuid
from datetime import datetime, timezone

try:
    from .db import get_postgres_connection
    from .field_rules import is_valid_email
    from .password_utils import hash_password
except ImportError:  # pragma: no cover - supports direct script execution
    from db import get_postgres_connection
    from field_rules import is_valid_email
    from password_utils import hash_password


DEFAULT_NAME = "NVC Administrator"


def _validate_password(password: str) -> None:
    if len(password) < 8:
        raise ValueError("Password must be at least 8 characters long.")
    if not any(character.isupper() for character in password):
        raise ValueError("Password must include at least one uppercase letter.")
    if not any(character.islower() for character in password):
        raise ValueError("Password must include at least one lowercase letter.")
    if not any(character.isdigit() for character in password):
        raise ValueError("Password must include at least one number.")


def main() -> int:
    email = input("Admin email: ").strip().lower()
    if not is_valid_email(email):
        raise SystemExit("Please enter a valid email address.")

    name = input(f"Admin name [{DEFAULT_NAME}]: ").strip() or DEFAULT_NAME
    password = getpass.getpass("Admin password: ")
    confirmation = getpass.getpass("Confirm admin password: ")
    if password != confirmation:
        raise SystemExit("Passwords do not match.")

    try:
        _validate_password(password)
        password_hash = hash_password(password)
    except ValueError as error:
        raise SystemExit(str(error)) from error

    now = datetime.now(timezone.utc).isoformat()
    connection = get_postgres_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                "select users_id from public.users where lower(email) = %s",
                (email,),
            )
            existing = cursor.fetchone()

            if existing:
                user_id = str(existing[0])
                cursor.execute(
                    """
                    update public.users
                    set password = %s,
                        role = 'admin',
                        name = %s,
                        user_type = 'admin',
                        approval_status = 'approved',
                        approved_by = 'terminal',
                        approved_at = %s,
                        rejection_reason = null
                    where users_id = %s
                    """,
                    (password_hash, name, now, user_id),
                )
                action = "updated"
            else:
                user_id = f"admin-{uuid.uuid4().hex[:16]}"
                cursor.execute(
                    """
                    insert into public.users (
                        users_id, email, password, role, name, phone, user_type,
                        created_at, pillars_of_interest, approval_status,
                        approved_by, approved_at, rejection_reason
                    ) values (
                        %s, %s, %s, 'admin', %s, null, 'admin', %s, %s,
                        'approved', 'terminal', %s, null
                    )
                    """,
                    (user_id, email, password_hash, name, now, [], now),
                )
                action = "created"

        connection.commit()
    finally:
        connection.close()

    print(f"Admin account {action}: {email} (id={user_id})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
