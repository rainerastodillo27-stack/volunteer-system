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
    "partners",
    "events",
    "volunteers",
    "volunteerMatches",
    "volunteerProjectJoins",
    "partnerProjectApplications",
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
        "projects": [
            {
                "id": "project-sample-nutrition-program",
                "title": "Baybay Nutrition Learning Program",
                "description": "Sample admin-created nutrition program used for planning, volunteer coordination, and event scheduling.",
                "partnerId": "",
                "programModule": "Nutrition",
                "status": "Planning",
                "category": "Nutrition",
                "startDate": "2026-05-12T08:00:00.000Z",
                "endDate": "2026-05-12T12:00:00.000Z",
                "location": {
                    "latitude": 10.5445,
                    "longitude": 123.1868,
                    "address": "Baybay, Talisay City, Negros Occidental",
                },
                "volunteersNeeded": 12,
                "volunteers": [],
                "joinedUserIds": [],
                "createdAt": now_iso,
                "updatedAt": now_iso,
                "statusUpdates": [],
            },
            {
                "id": "project-sample-livelihood-program",
                "title": "Kabankalan Livelihood Starter Initiative",
                "description": "Sample partner-initiated livelihood program that was approved by the admin and now appears with its partnered organization.",
                "partnerId": "partner-partner-user-2",
                "programModule": "Livelihood",
                "status": "Planning",
                "category": "Livelihood",
                "startDate": "2026-06-02T08:00:00.000Z",
                "endDate": "2026-06-02T12:00:00.000Z",
                "location": {
                    "latitude": 10.6711,
                    "longitude": 122.9534,
                    "address": "Kabankalan City, Negros Occidental",
                },
                "volunteersNeeded": 15,
                "volunteers": [],
                "joinedUserIds": [],
                "createdAt": now_iso,
                "updatedAt": now_iso,
                "statusUpdates": [],
            },
        ],
        "events": [
            {
                "id": "project-sample-nutrition-event-1",
                "title": "Quarterly Assessment",
                "description": "Quarterly Assessment event for Mingo nutrition coordination, announcements, and assigning tasks to the event team.",
                "partnerId": "",
                "programModule": "Nutrition",
                "isEvent": True,
                "parentProjectId": "project-sample-nutrition-program",
                "status": "In Progress",
                "category": "Nutrition",
                "startDate": "2026-05-14T08:00:00.000Z",
                "endDate": "2026-05-14T12:00:00.000Z",
                "location": {
                    "latitude": 10.5449,
                    "longitude": 123.1901,
                    "address": "Baybay, Talisay City, Negros Occidental",
                },
                "volunteersNeeded": 8,
                "volunteers": ["volunteer-profile-1"],
                "joinedUserIds": ["volunteer-1"],
                "createdAt": now_iso,
                "updatedAt": now_iso,
                "statusUpdates": [],
                "internalTasks": [
                    {
                        "id": "project-sample-nutrition-event-1-task-field-officer",
                        "title": "Field Officer Lead",
                        "description": "Coordinate the Quarterly Assessment floor team and assign other volunteers within this event as needs change.",
                        "category": "Field Officer",
                        "priority": "High",
                        "status": "Assigned",
                        "assignedVolunteerId": "volunteer-profile-1",
                        "assignedVolunteerName": "Volunteer Account",
                        "isFieldOfficer": True,
                        "createdAt": now_iso,
                        "updatedAt": now_iso,
                    },
                    {
                        "id": "project-sample-nutrition-event-1-task-mingo-supplies",
                        "title": "Mingo Supply Staging",
                        "description": "Prepare nutrition packs, assessment sheets, and event materials before the session opens.",
                        "category": "Logistics",
                        "priority": "High",
                        "status": "Unassigned",
                        "createdAt": now_iso,
                        "updatedAt": now_iso,
                    },
                    {
                        "id": "project-sample-nutrition-event-1-task-attendance",
                        "title": "Attendance and Assessment Desk",
                        "description": "Welcome arrivals, confirm attendance, and guide participants through the assessment flow.",
                        "category": "Front Desk",
                        "priority": "Medium",
                        "status": "Unassigned",
                        "createdAt": now_iso,
                        "updatedAt": now_iso,
                    },
                ],
            },
            {
                "id": "project-sample-livelihood-event-1",
                "title": "Livelihood Kickoff Workshop",
                "description": "Kickoff event for the approved livelihood initiative with partner coordination, volunteer orientation, and starter kit planning.",
                "partnerId": "partner-partner-user-2",
                "programModule": "Livelihood",
                "isEvent": True,
                "parentProjectId": "project-sample-livelihood-program",
                "status": "Planning",
                "category": "Livelihood",
                "startDate": "2026-06-05T08:00:00.000Z",
                "endDate": "2026-06-05T12:00:00.000Z",
                "location": {
                    "latitude": 10.6692,
                    "longitude": 122.9515,
                    "address": "Kabankalan City, Negros Occidental",
                },
                "volunteersNeeded": 10,
                "volunteers": [],
                "joinedUserIds": [],
                "createdAt": now_iso,
                "updatedAt": now_iso,
                "statusUpdates": [],
                "internalTasks": [
                    {
                        "id": "project-sample-livelihood-event-1-task-orientation",
                        "title": "Volunteer Orientation Desk",
                        "description": "Brief volunteers on the approved livelihood initiative, registration flow, and starter kit release process.",
                        "category": "Operations",
                        "priority": "High",
                        "status": "Unassigned",
                        "createdAt": now_iso,
                        "updatedAt": now_iso,
                    },
                    {
                        "id": "project-sample-livelihood-event-1-task-kits",
                        "title": "Starter Kit Preparation",
                        "description": "Prepare participant starter kits, materials, and workshop tools before the event opens.",
                        "category": "Logistics",
                        "priority": "High",
                        "status": "Unassigned",
                        "createdAt": now_iso,
                        "updatedAt": now_iso,
                    },
                ],
            },
        ],
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
        "projectGroupMessages": [
            {
                "id": "message-sample-livelihood-initiation",
                "projectId": "project-sample-livelihood-program",
                "senderId": "partner-user-2",
                "content": "Program Proposal Approved: Kabankalan Livelihood Starter Initiative - Timeline: 6 weeks",
                "timestamp": now_iso,
                "kind": "scope-proposal",
                "scopeProposal": {
                    "title": "Kabankalan Livelihood Starter Initiative",
                    "description": "A partner-initiated livelihood proposal that was approved by the admin and converted into a full program and event sequence.",
                    "included": [
                        "Skills orientation sessions",
                        "Starter toolkits",
                        "Mentor matching",
                    ],
                    "excluded": [
                        "Volunteer deployment scheduling",
                    ],
                    "timeline": "6 weeks",
                    "resources": "Starter kits, mentor roster, barangay venue coordination",
                    "successCriteria": "Admin approval and conversion into a scheduled livelihood project.",
                    "proposedByRole": "partner",
                    "proposedById": "partner-user-2",
                    "status": "Approved",
                    "approvedBy": "admin-1",
                    "approvedAt": now_iso,
                },
            },
        ],
        "statusUpdates": [
            {
                "id": "status-sample-nutrition-program",
                "projectId": "project-sample-nutrition-program",
                "status": "Planning",
                "description": "Sample admin-created nutrition program prepared for planning and event scheduling.",
                "updatedBy": "admin-1",
                "updatedAt": now_iso,
            },
            {
                "id": "status-sample-livelihood-program",
                "projectId": "project-sample-livelihood-program",
                "status": "Planning",
                "description": "Sample partner-initiated livelihood program approved by the admin and linked to its partnered organization.",
                "updatedBy": "admin-1",
                "updatedAt": now_iso,
            },
        ],
        "volunteerMatches": [
            {
                "id": "match-qassessment-vol1",
                "volunteerId": "volunteer-profile-1",
                "projectId": "project-sample-nutrition-event-1",
                "status": "Matched",
                "requestedAt": now_iso,
                "matchedAt": now_iso,
                "reviewedAt": now_iso,
                "reviewedBy": "admin-1",
                "hoursContributed": 0,
            },
        ],
        "volunteerTimeLogs": [],
        "volunteerProjectJoins": [
            {
                "id": "join-qassessment-vol1",
                "projectId": "project-sample-nutrition-event-1",
                "volunteerId": "volunteer-profile-1",
                "volunteerUserId": "volunteer-1",
                "volunteerName": "Volunteer Account",
                "volunteerEmail": "volunteer@example.com",
                "joinedAt": now_iso,
                "source": "VolunteerJoin",
                "participationStatus": "Active",
            },
        ],
        "partnerProjectApplications": [
            {
                "id": "partner-application-sample-livelihood-initiation",
                "projectId": "project-sample-livelihood-program",
                "partnerUserId": "partner-user-2",
                "partnerName": "PBSP Account",
                "partnerEmail": "partnerships@pbsp.org.ph",
                "status": "Approved",
                "requestedAt": now_iso,
                "reviewedAt": now_iso,
                "reviewedBy": "admin-1",
            },
        ],
        "partnerReports": [],
        "publishedImpactReports": [],
        "adminPlanningCalendars": [],
        "adminPlanningItems": [],
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
    canonical_projects = [
        item
        for item in demo_storage.get("projects", [])
        if isinstance(item, dict)
        and str(item.get("id") or "").strip()
        in {"project-sample-nutrition-program", "project-sample-livelihood-program"}
    ]
    if canonical_projects:
        _upsert_demo_collection_items(connection, "projects", canonical_projects)

    canonical_events = [
        item
        for item in demo_storage.get("events", [])
        if isinstance(item, dict)
        and str(item.get("id") or "").strip()
        in {"project-sample-nutrition-event-1", "project-sample-livelihood-event-1"}
    ]
    if canonical_events:
        _upsert_demo_collection_items(connection, "events", canonical_events)

    canonical_status_updates = [
        item
        for item in demo_storage.get("statusUpdates", [])
        if isinstance(item, dict)
        and str(item.get("id") or "").strip()
        in {"status-sample-nutrition-program", "status-sample-livelihood-program"}
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
        str(item.get("email") or "").strip().lower() == "admin@nvc.org"
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
