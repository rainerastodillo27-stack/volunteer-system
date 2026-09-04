"""Password hashing helpers for the custom users table.

Supabase Auth hashes passwords automatically, but this project authenticates
against its own ``public.users`` table.  Keep the bcrypt details in one place
so every create, update, migration, and login path uses the same policy.
"""

import hmac

import bcrypt


BCRYPT_PASSWORD_BYTES = 72
_BCRYPT_PREFIXES = ("$2a$", "$2b$", "$2y$")


def is_bcrypt_hash(value: object) -> bool:
    """Return whether a stored value has a bcrypt hash prefix."""

    return isinstance(value, str) and value.startswith(_BCRYPT_PREFIXES)


def hash_password(password: str) -> str:
    """Hash a password with bcrypt and return its UTF-8 database value."""

    if not isinstance(password, str) or not password:
        raise ValueError("Password is required.")

    password_bytes = password.encode("utf-8")
    if len(password_bytes) > BCRYPT_PASSWORD_BYTES:
        raise ValueError("Password must be 72 UTF-8 bytes or fewer.")

    return bcrypt.hashpw(password_bytes, bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, stored_value: object) -> bool:
    """Verify bcrypt values and temporarily support legacy plaintext values.

    Plaintext comparison exists only to allow a safe one-time upgrade for
    records that were created before bcrypt was enabled.  Callers should hash
    the value immediately after a successful legacy login.
    """

    if not isinstance(password, str) or not isinstance(stored_value, str):
        return False

    password_bytes = password.encode("utf-8")
    if len(password_bytes) > BCRYPT_PASSWORD_BYTES:
        return False

    if is_bcrypt_hash(stored_value):
        try:
            return bcrypt.checkpw(password_bytes, stored_value.encode("utf-8"))
        except (ValueError, TypeError):
            return False

    # Legacy compatibility only.  This branch disappears for a record after
    # the startup migration or the first successful login.
    return hmac.compare_digest(stored_value, password)
