import json
import os
from datetime import datetime, timezone
from typing import Any

try:
    from .db import get_postgres_connection
    from .field_rules import normalize_comparable_phone, normalize_email, sanitize_hot_storage_item
    from .operation_guard import (
        DEMO_SEED_UNLOCK_ENV_VAR,
        require_shared_db_unlock,
    )
    from .relational_mirror import (
        ensure_relational_mirror_tables,
        get_relational_collection,
        replace_relational_collection,
        sync_all_relational_mirror_tables,
        sync_relational_mirror_collection,
    )
    from .storage_table_contract import (
        CANONICAL_STORAGE_TABLES,
        LEGACY_COMPAT_STORAGE_TABLES,
    )
except ImportError:
    from db import get_postgres_connection
    from field_rules import normalize_comparable_phone, normalize_email, sanitize_hot_storage_item
    from operation_guard import DEMO_SEED_UNLOCK_ENV_VAR, require_shared_db_unlock
    from relational_mirror import (
        ensure_relational_mirror_tables,
        get_relational_collection,
        replace_relational_collection,
        sync_all_relational_mirror_tables,
        sync_relational_mirror_collection,
    )
    from storage_table_contract import (
        CANONICAL_STORAGE_TABLES,
        LEGACY_COMPAT_STORAGE_TABLES,
    )


HOT_STORAGE_TABLES = dict(CANONICAL_STORAGE_TABLES)
LEGACY_HOT_STORAGE_TABLES = dict(LEGACY_COMPAT_STORAGE_TABLES)
REQUIRED_DEMO_COLLECTION_KEYS = {
    "users",
}
_APP_STORAGE_SEED_CONFIRMED = False
DEMO_SEED_ENV_VAR = "ENABLE_DEMO_SEED"


def is_demo_seed_enabled() -> bool:
    raw_value = str(os.getenv(DEMO_SEED_ENV_VAR, "")).strip().lower()
    return raw_value in {"1", "true", "yes", "on"}


def is_demo_seed_unlocked() -> bool:
    raw_value = str(os.getenv(DEMO_SEED_UNLOCK_ENV_VAR, "")).strip().lower()
    return raw_value in {"1", "true", "yes", "on"}


# Builds the demo JSON collections used by the app storage layer.
def build_demo_app_storage() -> dict[str, Any]:
    now_iso = datetime.now(timezone.utc).isoformat()

    return {
        "users": [
            {
                "id": "admin-1",
                "email": "admin@nvc.org",
                "password": "admin123",
                "role": "admin",
                "name": "NVC Admin Account",
                "phone": "09170000001",
                "userType": "Adult",
                "pillarsOfInterest": ["Education", "Livelihood", "Nutrition"],
                "createdAt": now_iso,
            },
            {
                "id": "volunteer-1",
                "email": "volunteer@example.com",
                "password": "volunteer123",
                "role": "volunteer",
                "name": "Volunteer Account",
                "phone": "09123456789",
                "userType": "Student",
                "pillarsOfInterest": ["Education", "Nutrition"],
                "createdAt": now_iso,
            },
            {
                "id": "partner-user-1",
                "email": "partner@livelihoods.org",
                "password": "partner123",
                "role": "partner",
                "name": "Partner Org Account",
                "phone": "09198765432",
                "userType": "Adult",
                "pillarsOfInterest": ["Livelihood"],
                "createdAt": now_iso,
            },
            {
                "id": "partner-user-2",
                "email": "partnerships@jollibeefoundation.org",
                "password": "partner123",
                "role": "partner",
                "name": "Jollibee Foundation Account",
                "phone": "09186341111",
                "userType": "Adult",
                "pillarsOfInterest": ["Nutrition", "Livelihood"],
                "createdAt": now_iso,
            },
        ],
        # All other data removed - only user accounts are seeded
        "partners": [
            {
                "id": "partner-1780189738",
                "ownerUserId": "partner-user-1",
                "name": "Kabankalan LGU",
                "sectorType": "Institution",
                "dswdAccreditationNo": "LGU-2026-001",
                "secRegistrationNo": "LGU-KABANKALAN-001",
                "advocacyFocus": ["Nutrition", "Livelihood"],
                "contactEmail": "partner@livelihoods.org",
                "contactPhone": "09198765432",
                "address": "Kabankalan City Hall, Kabankalan City, Negros Occidental",
                "status": "Approved",
                "createdAt": now_iso,
                "updatedAt": now_iso,
            }
        ],
        "programs": [],
        "projects": [],
        "events": [],
        "volunteers": [],
        "messages": [],
        "projectGroupMessages": [],
        "statusUpdates": [],
        "volunteerMatches": [],
        "volunteerTimeLogs": [],
        "volunteerProjectJoins": [],
        "partnerProjectApplications": [],
        "partnerReports": [],
        "adminPlanningCalendars": [],
    }


def ensure_app_storage_table() -> None:
    with get_postgres_connection() as connection:
        ensure_relational_mirror_tables(connection)
        connection.commit()


# Checks whether a storage key should use a dedicated hot-storage table.
def is_hot_storage_key(key: str) -> bool:
    return key in HOT_STORAGE_TABLES


# Ensures all hot-storage tables exist with the expected schema.
def ensure_postgres_hot_storage_tables(connection: Any) -> None:
    ensure_relational_mirror_tables(connection)


# Reads one hot-storage collection from its dedicated relational table.
def get_postgres_hot_storage_collection(connection: Any, key: str) -> list[Any]:
    return get_relational_collection(connection, key)


def _table_exists(connection: Any, table_name: str) -> bool:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            select exists (
              select 1
              from information_schema.tables
              where table_schema = 'public' and table_name = %s
            )
            """,
            (table_name,),
        )
        row = cursor.fetchone()
    return bool(row and row[0])


def _get_legacy_hot_storage_collection(connection: Any, key: str) -> list[Any]:
    table_name = LEGACY_HOT_STORAGE_TABLES.get(key)
    if not table_name or not _table_exists(connection, table_name):
        return []

    with connection.cursor() as cursor:
        cursor.execute(
            f"""
            select data
            from {table_name}
            order by sort_order asc, updated_at asc, id asc
            """
        )
        rows = cursor.fetchall()
    return [row[0] for row in rows if isinstance(row[0], dict)]


def _get_legacy_app_storage_collection(connection: Any, key: str) -> list[Any]:
    if not _table_exists(connection, "app_storage"):
        return []

    with connection.cursor() as cursor:
        cursor.execute("select value from app_storage where key = %s", (key,))
        row = cursor.fetchone()
    if row is None or not isinstance(row[0], list):
        return []
    return [item for item in row[0] if isinstance(item, dict)]


def _items_match_same_identity(key: str, left: dict[str, Any], right: dict[str, Any]) -> bool:
    left_id = str(left.get("id") or "").strip()
    right_id = str(right.get("id") or "").strip()
    if left_id and right_id and left_id == right_id:
        return True

    if key == "users":
        left_email = normalize_email(left.get("email"))
        right_email = normalize_email(right.get("email"))
        if left_email and right_email and left_email == right_email:
            return True

        left_phone = normalize_comparable_phone(left.get("phone"))
        right_phone = normalize_comparable_phone(right.get("phone"))
        return bool(left_phone and right_phone and left_phone == right_phone)

    if key == "volunteers":
        left_user_id = str(left.get("userId") or "").strip()
        right_user_id = str(right.get("userId") or "").strip()
        if left_user_id and right_user_id and left_user_id == right_user_id:
            return True

        left_email = normalize_email(left.get("email"))
        right_email = normalize_email(right.get("email"))
        if left_email and right_email and left_email == right_email:
            return True

        left_phone = normalize_comparable_phone(left.get("phone"))
        right_phone = normalize_comparable_phone(right.get("phone"))
        return bool(left_phone and right_phone and left_phone == right_phone)

    if key == "partners":
        left_owner_user_id = str(left.get("ownerUserId") or "").strip()
        right_owner_user_id = str(right.get("ownerUserId") or "").strip()
        if left_owner_user_id and right_owner_user_id and left_owner_user_id == right_owner_user_id:
            return True

        left_email = normalize_email(left.get("contactEmail"))
        right_email = normalize_email(right.get("contactEmail"))
        if left_email and right_email and left_email == right_email:
            return True

        left_phone = normalize_comparable_phone(left.get("contactPhone"))
        right_phone = normalize_comparable_phone(right.get("contactPhone"))
        return bool(left_phone and right_phone and left_phone == right_phone)

    return False


def _merge_required_demo_items(
    key: str,
    existing_items: list[Any],
    required_items: list[Any],
) -> list[dict[str, Any]]:
    merged_items: list[dict[str, Any]] = []
    remaining_existing_items = [
        item for item in existing_items if isinstance(item, dict)
    ]

    for item in required_items:
        if isinstance(item, dict) and isinstance(item.get("id"), str) and item.get("id"):
            merged_items.append(item)
            remaining_existing_items = [
                existing_item
                for existing_item in remaining_existing_items
                if not _items_match_same_identity(key, existing_item, item)
            ]

    for item in remaining_existing_items:
        merged_items.append(item)

    return merged_items


def _upsert_demo_collection_items(
    connection: Any,
    key: str,
    canonical_items: list[dict[str, Any]],
    remove_ids: set[str] | None = None,
) -> None:
    if key not in HOT_STORAGE_TABLES:
        return

    existing_items = get_postgres_hot_storage_collection(connection, key)
    keep_items = [
        item
        for item in existing_items
        if isinstance(item, dict)
        and str(item.get("id") or "").strip() not in (remove_ids or set())
        and str(item.get("id") or "").strip()
        not in {str(canonical_item.get("id") or "").strip() for canonical_item in canonical_items}
    ]
    replace_postgres_hot_storage_collection(connection, key, [*keep_items, *canonical_items])


def _normalize_demo_project_examples(connection: Any, demo_storage: dict[str, Any]) -> None:
    # NOTE: Demo sample projects have been disabled. Not loading any canonical projects.
    canonical_projects: list[dict[str, Any]] = []
    
    # Explicitly remove sample projects if they exist
    _upsert_demo_collection_items(
        connection, 
        "projects", 
        canonical_projects,
        remove_ids={
            "project-sample-nutrition-program",
            "project-sample-livelihood-program",
            "project-sample-education-program",
        }
    )

    # Explicitly remove sample events if they exist
    _upsert_demo_collection_items(
        connection,
        "events",
        [],
        remove_ids={
            "project-sample-nutrition-event-1",
            "project-sample-livelihood-event-1",
            "project-sample-education-event-1",
            "project-sample-education-event-2",
        }
    )

    # Remove PBSP partner records
    _upsert_demo_collection_items(
        connection,
        "partners",
        [],
        remove_ids={
            "partner-1780188678",  # PBSP partner organization ID
        }
    )

    canonical_status_updates = [
        item
        for item in demo_storage.get("statusUpdates", [])
        if isinstance(item, dict)
        and str(item.get("id") or "").strip()
        in {
            "status-sample-nutrition-program",
            "status-sample-livelihood-program",
            "status-sample-education-program",
        }
    ]
    if canonical_status_updates:
        _upsert_demo_collection_items(connection, "statusUpdates", canonical_status_updates)

    canonical_messages = [
        item
        for item in demo_storage.get("projectGroupMessages", [])
        if isinstance(item, dict)
        and str(item.get("id") or "").strip() == "message-sample-livelihood-initiation"
    ]
    if canonical_messages:
        _upsert_demo_collection_items(
            connection,
            "projectGroupMessages",
            canonical_messages,
            remove_ids={"message-sample-nutrition-proposal"},
        )

    canonical_applications = [
        item
        for item in demo_storage.get("partnerProjectApplications", [])
        if isinstance(item, dict)
        and str(item.get("id") or "").strip() == "partner-application-sample-livelihood-initiation"
    ]
    if canonical_applications:
        _upsert_demo_collection_items(
            connection,
            "partnerProjectApplications",
            canonical_applications,
            remove_ids={"partner-application-sample-nutrition-program"},
        )


# Replaces all rows in a hot-storage collection with a normalized item list.
def replace_postgres_hot_storage_collection(
    connection: Any,
    key: str,
    items: list[Any],
) -> None:
    if not isinstance(items, list):
        raise ValueError(f"Hot storage key '{key}' expects a list payload.")

    normalized_items: list[dict[str, Any]] = []
    item_ids: list[str] = []
    for item in items:
        if not isinstance(item, dict):
            raise ValueError(f"Hot storage key '{key}' expects object items.")
        item_id = item.get("id")
        if not isinstance(item_id, str) or not item_id:
            raise ValueError(f"Hot storage key '{key}' contains an item without a valid id.")
        normalized_items.append(sanitize_hot_storage_item(key, item))
        item_ids.append(item_id)

    replace_relational_collection(connection, key, normalized_items)


# Deletes all rows for one hot-storage collection.
def clear_postgres_hot_storage_collection(connection: Any, key: str) -> None:
    replace_relational_collection(connection, key, [])


# Deletes all rows from every hot-storage collection.
def clear_all_postgres_hot_storage(connection: Any) -> None:
    for key in HOT_STORAGE_TABLES:
        replace_relational_collection(connection, key, [])


def _postgres_hot_storage_needs_backfill(connection: Any, key: str) -> bool:
    return len(get_relational_collection(connection, key)) == 0


# Ensures each hot-storage table has seed data when it is empty or invalid.
def ensure_postgres_hot_storage_seeded(connection: Any, demo_storage: dict[str, Any]) -> None:
    ensure_postgres_hot_storage_tables(connection)

    for key in HOT_STORAGE_TABLES:
        if not _postgres_hot_storage_needs_backfill(connection, key):
            continue

        source_items = _get_legacy_hot_storage_collection(connection, key)
        if not source_items:
            source_items = _get_legacy_app_storage_collection(connection, key)
        if not source_items:
            source_items = demo_storage.get(key, [])
        if isinstance(source_items, list):
            replace_postgres_hot_storage_collection(connection, key, source_items)

    for key in REQUIRED_DEMO_COLLECTION_KEYS:
        current_items = get_postgres_hot_storage_collection(connection, key)
        required_items = demo_storage.get(key, [])
        if not isinstance(required_items, list):
            continue

        merged_items = _merge_required_demo_items(key, current_items, required_items)
        if merged_items != current_items:
            replace_postgres_hot_storage_collection(connection, key, merged_items)

    _normalize_demo_project_examples(connection, demo_storage)

    synced_collections = {
        key: get_postgres_hot_storage_collection(connection, key)
        for key in HOT_STORAGE_TABLES
    }
    sync_hot_storage_app_storage(connection, synced_collections)
    sync_all_relational_mirror_tables(connection, synced_collections)


# Refreshes app_storage so hot-storage keys reflect the current relational tables.
def sync_hot_storage_app_storage(connection: Any, collections: dict[str, list[Any]] | None = None) -> None:
    return None


# Returns whether the minimum demo collections already exist in hot storage.
def _has_required_demo_seed(connection: Any) -> bool:
    for key in REQUIRED_DEMO_COLLECTION_KEYS:
        if not get_postgres_hot_storage_collection(connection, key):
            return False
    return any(
        str(item.get("email") or "").strip().lower() in {"admin@nvc.org", "nvc@gmail.com"}
        for item in get_postgres_hot_storage_collection(connection, "users")
        if isinstance(item, dict)
    )


# Seeds both app storage and hot-storage tables with demo data.
def ensure_app_storage_seeded() -> None:
    global _APP_STORAGE_SEED_CONFIRMED

    if _APP_STORAGE_SEED_CONFIRMED:
        return

    if not is_demo_seed_enabled():
        return

    require_shared_db_unlock("demo storage seeding", DEMO_SEED_UNLOCK_ENV_VAR)

    ensure_app_storage_table()
    demo_storage = build_demo_app_storage()

    max_retries = 3
    retry_count = 0
    
    while retry_count < max_retries:
        try:
            with get_postgres_connection() as connection:
                ensure_postgres_hot_storage_tables(connection)
                if _has_required_demo_seed(connection):
                    _normalize_demo_project_examples(connection, demo_storage)
                    synced_collections = {
                        key: get_postgres_hot_storage_collection(connection, key)
                        for key in HOT_STORAGE_TABLES
                    }
                    sync_hot_storage_app_storage(connection, synced_collections)
                    sync_all_relational_mirror_tables(connection, synced_collections)
                    connection.commit()
                    _APP_STORAGE_SEED_CONFIRMED = True
                    break
                ensure_postgres_hot_storage_seeded(connection, demo_storage)
                connection.commit()
                _APP_STORAGE_SEED_CONFIRMED = True
            break  # Success
        except Exception as e:
            retry_count += 1
            error_msg = str(e).lower()
            is_deadlock = "deadlock" in error_msg
            
            if is_deadlock and retry_count < max_retries:
                import time
                wait_time = 1 + retry_count  # Exponential backoff: 2s, 3s, etc.
                print(f"Database deadlock detected. Retrying in {wait_time} seconds... (attempt {retry_count}/{max_retries})")
                time.sleep(wait_time)
            else:
                raise


# CLI entry point for seeding demo app-storage data into Postgres.
def main() -> None:
    ensure_app_storage_seeded()
    print("App storage demo data ensured.")


if __name__ == "__main__":
    main()

