import json
from datetime import datetime, timezone
from typing import Any

from .db import get_postgres_connection
from .field_rules import normalize_comparable_phone, normalize_email, sanitize_hot_storage_item
from .relational_mirror import (
    ensure_relational_mirror_tables,
    sync_all_relational_mirror_tables,
    sync_relational_mirror_collection,
)


HOT_STORAGE_TABLES = {
    "users": "app_users_store",
    "partners": "app_partners_store",
    "projects": "app_projects_store",
    "volunteers": "app_volunteers_store",
    "statusUpdates": "app_status_updates_store",
    "volunteerMatches": "app_volunteer_matches_store",
    "volunteerTimeLogs": "app_volunteer_time_logs_store",
    "volunteerProjectJoins": "app_volunteer_project_joins_store",
    "partnerProjectApplications": "app_partner_project_applications_store",
    "partnerEventCheckIns": "app_partner_event_check_ins_store",
    "partnerReports": "app_partner_reports_store",
    "publishedImpactReports": "app_published_impact_reports_store",
}
EXPECTED_HOT_STORAGE_COLUMNS = {"id", "data", "sort_order", "updated_at"}
REQUIRED_DEMO_COLLECTION_KEYS = {"users", "partners", "volunteers"}
_APP_STORAGE_SEED_CONFIRMED = False


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
                "email": "partnerships@pbsp.org.ph",
                "password": "partner123",
                "role": "partner",
                "name": "PBSP Account",
                "phone": "09188188678",
                "userType": "Adult",
                "pillarsOfInterest": ["Education", "Livelihood", "Nutrition"],
                "createdAt": now_iso,
            },
            {
                "id": "partner-user-3",
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
        "partners": [
            {
                "id": "partner-partner-user-1",
                "ownerUserId": "partner-user-1",
                "name": "Kabankalan Livelihood Network",
                "description": "Livelihood partnership application",
                "category": "Livelihood",
                "sectorType": "Institution",
                "dswdAccreditationNo": "DSWD-NEG-2026-001",
                "advocacyFocus": ["Livelihood"],
                "contactEmail": "partner@livelihoods.org",
                "contactPhone": "09198765432",
                "address": "Kabankalan City, Negros Occidental",
                "status": "Approved",
                "verificationStatus": "Verified",
                "validatedBy": "admin-1",
                "validatedAt": now_iso,
                "credentialsUnlockedAt": now_iso,
                "createdAt": now_iso,
            },
            {
                "id": "partner-partner-user-2",
                "ownerUserId": "partner-user-2",
                "name": "PBSP Negros Partnership Desk",
                "description": "Education, Livelihood, Nutrition partnership application",
                "category": "Education",
                "sectorType": "NGO",
                "dswdAccreditationNo": "DSWD-NEG-2026-002",
                "advocacyFocus": ["Education", "Livelihood", "Nutrition"],
                "contactEmail": "partnerships@pbsp.org.ph",
                "contactPhone": "+63 2 8818 8678",
                "address": "Bacolod City, Negros Occidental",
                "status": "Approved",
                "verificationStatus": "Verified",
                "validatedBy": "admin-1",
                "validatedAt": now_iso,
                "credentialsUnlockedAt": now_iso,
                "createdAt": now_iso,
            },
            {
                "id": "partner-partner-user-3",
                "ownerUserId": "partner-user-3",
                "name": "Jollibee Foundation Field Unit",
                "description": "Nutrition and livelihood partnership application",
                "category": "Nutrition",
                "sectorType": "Private",
                "dswdAccreditationNo": "DSWD-NEG-2026-003",
                "advocacyFocus": ["Nutrition", "Livelihood"],
                "contactEmail": "partnerships@jollibeefoundation.org",
                "contactPhone": "+63 2 8634 1111",
                "address": "Talisay City, Negros Occidental",
                "status": "Approved",
                "verificationStatus": "Verified",
                "validatedBy": "admin-1",
                "validatedAt": now_iso,
                "credentialsUnlockedAt": now_iso,
                "createdAt": now_iso,
            },
        ],
        "projects": [],
        "volunteers": [
            {
                "id": "volunteer-profile-1",
                "userId": "volunteer-1",
                "name": "Volunteer Account",
                "email": "volunteer@example.com",
                "phone": "09123456789",
                "skills": [],
                "skillsDescription": "Education, Nutrition",
                "availability": {
                    "daysPerWeek": 2,
                    "hoursPerWeek": 8,
                    "availableDays": ["Saturday", "Sunday"],
                },
                "pastProjects": [],
                "totalHoursContributed": 0,
                "rating": 0,
                "engagementStatus": "Open to Volunteer",
                "background": "",
                "registrationStatus": "Approved",
                "reviewedBy": "admin-1",
                "reviewedAt": now_iso,
                "credentialsUnlockedAt": now_iso,
                "createdAt": now_iso,
            },
        ],
        "messages": [],
        "projectGroupMessages": [],
        "statusUpdates": [],
        "volunteerMatches": [],
        "volunteerTimeLogs": [],
        "volunteerProjectJoins": [],
        "partnerProjectApplications": [],
        "partnerEventCheckIns": [],
        "partnerReports": [],
        "publishedImpactReports": [],
    }


def ensure_app_storage_table() -> None:
    with get_postgres_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                create table if not exists app_storage (
                  key text primary key,
                  value jsonb not null,
                  updated_at timestamptz not null default now()
                )
                """
            )
        connection.commit()


# Checks whether a storage key should use a dedicated hot-storage table.
def is_hot_storage_key(key: str) -> bool:
    return key in HOT_STORAGE_TABLES


# Ensures all hot-storage tables exist with the expected schema.
def ensure_postgres_hot_storage_tables(connection: Any) -> None:
    ensure_relational_mirror_tables(connection)
    with connection.cursor() as cursor:
        for table_name in HOT_STORAGE_TABLES.values():
            cursor.execute(
                """
                select column_name
                from information_schema.columns
                where table_schema = 'public' and table_name = %s
                """,
                (table_name,),
            )
            existing_columns = {row[0] for row in cursor.fetchall()}
            if existing_columns and existing_columns != EXPECTED_HOT_STORAGE_COLUMNS:
                cursor.execute(f"drop table if exists {table_name}")

            cursor.execute(
                f"""
                create table if not exists {table_name} (
                  id text primary key,
                  data jsonb not null,
                  sort_order integer not null default 0,
                  updated_at timestamptz not null default now()
                )
                """
            )
            cursor.execute(
                f"""
                alter table {table_name}
                add column if not exists data jsonb default '{{}}'::jsonb
                """
            )
            cursor.execute(
                f"""
                alter table {table_name}
                add column if not exists sort_order integer not null default 0
                """
            )
            cursor.execute(
                f"""
                alter table {table_name}
                add column if not exists updated_at timestamptz not null default now()
                """
            )

        cursor.execute(
            """
            create index if not exists app_users_store_email_idx
            on app_users_store (lower(coalesce(data->>'email', '')))
            """
        )
        cursor.execute(
            """
            create index if not exists app_users_store_phone_idx
            on app_users_store ((coalesce(data->>'phone', '')))
            """
        )


# Reads one hot-storage collection from its dedicated relational table.
def get_postgres_hot_storage_collection(connection: Any, key: str) -> list[Any]:
    table_name = HOT_STORAGE_TABLES[key]
    with connection.cursor() as cursor:
        cursor.execute(
            f"""
            select data
            from {table_name}
            order by sort_order asc, updated_at asc, id asc
            """
        )
        rows = cursor.fetchall()

    return [row[0] for row in rows]


# Keeps the generic app-storage mirror aligned with hot-storage collections.
def _upsert_app_storage_value(connection: Any, key: str, value: Any) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            insert into app_storage (key, value, updated_at)
            values (%s, %s::jsonb, now())
            on conflict (key) do update set
              value = excluded.value,
              updated_at = excluded.updated_at
            """,
            (key, json.dumps(value)),
        )


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

    table_name = HOT_STORAGE_TABLES[key]
    with connection.cursor() as cursor:
        if item_ids:
            cursor.execute(f"delete from {table_name} where id <> all(%s)", (item_ids,))
        else:
            cursor.execute(f"delete from {table_name}")

        for sort_order, item in enumerate(normalized_items):
            cursor.execute(
                f"""
                insert into {table_name} (id, data, sort_order, updated_at)
                values (%s, %s::jsonb, %s, now())
                on conflict (id) do update set
                  data = excluded.data,
                  sort_order = excluded.sort_order,
                  updated_at = excluded.updated_at
                """,
                (item["id"], json.dumps(item), sort_order),
            )

    _upsert_app_storage_value(connection, key, normalized_items)
    sync_relational_mirror_collection(connection, key, normalized_items)


# Deletes all rows for one hot-storage collection.
def clear_postgres_hot_storage_collection(connection: Any, key: str) -> None:
    table_name = HOT_STORAGE_TABLES[key]
    with connection.cursor() as cursor:
        cursor.execute(f"delete from {table_name}")

    _upsert_app_storage_value(connection, key, [])
    sync_relational_mirror_collection(connection, key, [])


# Deletes all rows from every hot-storage collection.
def clear_all_postgres_hot_storage(connection: Any) -> None:
    with connection.cursor() as cursor:
        for table_name in HOT_STORAGE_TABLES.values():
            cursor.execute(f"delete from {table_name}")

    for key in HOT_STORAGE_TABLES:
        _upsert_app_storage_value(connection, key, [])
        sync_relational_mirror_collection(connection, key, [])


# Reads a batch of generic app-storage items from Postgres.
def _get_postgres_app_storage_items(connection: Any, keys: list[str]) -> dict[str, Any]:
    if not keys:
        return {}

    with connection.cursor() as cursor:
        cursor.execute(
            "select key, value from app_storage where key = any(%s)",
            (keys,),
        )
        rows = cursor.fetchall()

    return {row[0]: row[1] for row in rows}


# Checks whether a hot-storage collection needs to be backfilled from source data.
def _postgres_hot_storage_needs_backfill(connection: Any, key: str) -> bool:
    table_name = HOT_STORAGE_TABLES[key]
    with connection.cursor() as cursor:
        cursor.execute(f"select count(*) from {table_name}")
        count_row = cursor.fetchone()

        cursor.execute(
            f"""
            select exists (
              select 1
              from {table_name}
              where coalesce(data->>'id', '') = ''
            )
            """
        )
        invalid_row = cursor.fetchone()

    row_count = int(count_row[0]) if count_row else 0
    has_invalid_rows = bool(invalid_row[0]) if invalid_row else False
    return row_count == 0 or has_invalid_rows


# Ensures each hot-storage table has seed data when it is empty or invalid.
def ensure_postgres_hot_storage_seeded(connection: Any, demo_storage: dict[str, Any]) -> None:
    ensure_postgres_hot_storage_tables(connection)
    existing_storage = _get_postgres_app_storage_items(connection, list(HOT_STORAGE_TABLES.keys()))

    for key in HOT_STORAGE_TABLES:
        if not _postgres_hot_storage_needs_backfill(connection, key):
            continue

        source_items = existing_storage.get(key, demo_storage.get(key, []))
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

    synced_collections = {
        key: get_postgres_hot_storage_collection(connection, key)
        for key in HOT_STORAGE_TABLES
    }
    sync_all_relational_mirror_tables(connection, synced_collections)


# Returns whether the minimum demo collections already exist in hot storage.
def _has_required_demo_seed(connection: Any) -> bool:
    for key in REQUIRED_DEMO_COLLECTION_KEYS:
        table_name = HOT_STORAGE_TABLES[key]
        with connection.cursor() as cursor:
            cursor.execute(f"select exists (select 1 from {table_name} limit 1)")
            row = cursor.fetchone()
        if not row or not bool(row[0]):
            return False

    with connection.cursor() as cursor:
        cursor.execute(
            """
            select exists (
              select 1
              from app_users_store
              where lower(coalesce(data->>'email', '')) = 'admin@nvc.org'
            )
            """
        )
        row = cursor.fetchone()

    return bool(row and row[0])


# Seeds both app storage and hot-storage tables with demo data.
def ensure_app_storage_seeded() -> None:
    global _APP_STORAGE_SEED_CONFIRMED

    if _APP_STORAGE_SEED_CONFIRMED:
        return

    ensure_app_storage_table()
    demo_storage = build_demo_app_storage()

    max_retries = 3
    retry_count = 0
    
    while retry_count < max_retries:
        try:
            with get_postgres_connection() as connection:
                ensure_postgres_hot_storage_tables(connection)
                if _has_required_demo_seed(connection):
                    connection.commit()
                    _APP_STORAGE_SEED_CONFIRMED = True
                    break

                with connection.cursor() as cursor:
                    for key, value in demo_storage.items():
                        cursor.execute(
                            """
                            insert into app_storage (key, value, updated_at)
                            values (%s, %s::jsonb, now())
                            on conflict (key) do nothing
                            """,
                            (key, json.dumps(value)),
                        )
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
