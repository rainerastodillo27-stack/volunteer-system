import os


SHARED_DB_PROTECTION_ENV_VAR = "VOLCRE_PROTECT_SHARED_DB"
DEMO_SEED_UNLOCK_ENV_VAR = "VOLCRE_ALLOW_DEMO_SEED"
SCHEMA_SETUP_UNLOCK_ENV_VAR = "VOLCRE_ALLOW_SCHEMA_SETUP"
DEMO_LOGIN_SEED_UNLOCK_ENV_VAR = "VOLCRE_ALLOW_DEMO_LOGIN_SEED"
DB_MIGRATION_UNLOCK_ENV_VAR = "VOLCRE_ALLOW_DB_MIGRATION"


def _is_truthy_env(value: str | None) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def is_shared_db_protection_enabled() -> bool:
    raw_value = os.getenv(SHARED_DB_PROTECTION_ENV_VAR, "true")
    return _is_truthy_env(raw_value)


def require_shared_db_unlock(action: str, unlock_env_var: str) -> None:
    if not is_shared_db_protection_enabled():
        return

    if _is_truthy_env(os.getenv(unlock_env_var)):
        return

    raise RuntimeError(
        f"Blocked {action}. Set {unlock_env_var}=true only when you intentionally want to "
        f"change the shared database."
    )
