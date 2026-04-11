import json
from typing import Any


JSON_ARRAY = "'[]'::jsonb"
JSON_OBJECT = "'{}'::jsonb"


RELATIONAL_TABLE_DDL = [
    f"""
    create table if not exists users (
      id text primary key,
      email text,
      password text not null,
      role text not null,
      name text not null,
      phone text,
      user_type text,
      pillars_of_interest jsonb not null default {JSON_ARRAY},
      created_at text
    )
    """,
    "create index if not exists users_email_idx on users (lower(coalesce(email, '')))",
    "create index if not exists users_phone_idx on users (coalesce(phone, ''))",
    f"""
    create table if not exists partners (
      id text primary key,
      owner_user_id text,
      name text not null,
      description text,
      category text,
      sector_type text,
      dswd_accreditation_no text,
      advocacy_focus jsonb not null default {JSON_ARRAY},
      contact_email text,
      contact_phone text,
      address text,
      status text,
      verification_status text,
      verification_notes text,
      validated_by text,
      validated_at text,
      credentials_unlocked_at text,
      created_at text,
      registration_documents jsonb not null default {JSON_ARRAY}
    )
    """,
    "create index if not exists partners_owner_user_id_idx on partners (owner_user_id)",
    "create index if not exists partners_dswd_accreditation_no_idx on partners (dswd_accreditation_no)",
    f"""
    create table if not exists volunteers (
      id text primary key,
      user_id text,
      name text not null,
      email text,
      phone text,
      skills jsonb not null default {JSON_ARRAY},
      skills_description text,
      availability jsonb not null default {JSON_OBJECT},
      past_projects jsonb not null default {JSON_ARRAY},
      total_hours_contributed double precision not null default 0,
      rating double precision not null default 0,
      engagement_status text,
      background text,
      gender text,
      date_of_birth text,
      civil_status text,
      home_address text,
      occupation text,
      workplace_or_school text,
      college_course text,
      certifications_or_trainings text,
      hobbies_and_interests text,
      special_skills text,
      affiliations jsonb not null default {JSON_ARRAY},
      registration_status text,
      reviewed_by text,
      reviewed_at text,
      credentials_unlocked_at text,
      created_at text
    )
    """,
    "create index if not exists volunteers_user_id_idx on volunteers (user_id)",
    "alter table volunteers add column if not exists registration_status text",
    "alter table volunteers add column if not exists reviewed_by text",
    "alter table volunteers add column if not exists reviewed_at text",
    "alter table volunteers add column if not exists credentials_unlocked_at text",
    f"""
    create table if not exists projects (
      id text primary key,
      title text not null,
      description text,
      partner_id text,
      program_module text,
      is_event boolean not null default false,
      status text,
      category text,
      start_date text,
      end_date text,
      location jsonb not null default {JSON_OBJECT},
      volunteers_needed integer not null default 0,
      volunteers jsonb not null default {JSON_ARRAY},
      joined_user_ids jsonb not null default {JSON_ARRAY},
      created_at text,
      updated_at text
    )
    """,
    "create index if not exists projects_partner_id_idx on projects (partner_id)",
    f"""
    create table if not exists status_updates (
      id text primary key,
      project_id text,
      status text,
      description text,
      updated_by text,
      updated_at text
    )
    """,
    "create index if not exists status_updates_project_id_idx on status_updates (project_id)",
    f"""
    create table if not exists volunteer_matches (
      id text primary key,
      volunteer_id text,
      project_id text,
      status text,
      matched_at text,
      hours_contributed double precision not null default 0
    )
    """,
    "create index if not exists volunteer_matches_volunteer_id_idx on volunteer_matches (volunteer_id)",
    "create index if not exists volunteer_matches_project_id_idx on volunteer_matches (project_id)",
    f"""
    create table if not exists volunteer_time_logs (
      id text primary key,
      volunteer_id text,
      project_id text,
      time_in text,
      time_out text,
      note text,
      completion_photo text,
      completion_report text
    )
    """,
    "create index if not exists volunteer_time_logs_volunteer_id_idx on volunteer_time_logs (volunteer_id)",
    "create index if not exists volunteer_time_logs_project_id_idx on volunteer_time_logs (project_id)",
    f"""
    create table if not exists volunteer_project_joins (
      id text primary key,
      project_id text,
      volunteer_id text,
      volunteer_user_id text,
      volunteer_name text,
      volunteer_email text,
      joined_at text,
      source text,
      participation_status text,
      completed_at text,
      completed_by text
    )
    """,
    "create index if not exists volunteer_project_joins_project_id_idx on volunteer_project_joins (project_id)",
    "create index if not exists volunteer_project_joins_volunteer_id_idx on volunteer_project_joins (volunteer_id)",
    f"""
    create table if not exists partner_project_applications (
      id text primary key,
      project_id text,
      partner_user_id text,
      partner_name text,
      partner_email text,
      status text,
      requested_at text,
      reviewed_at text,
      reviewed_by text
    )
    """,
    "create index if not exists partner_project_applications_project_id_idx on partner_project_applications (project_id)",
    "create index if not exists partner_project_applications_partner_user_id_idx on partner_project_applications (partner_user_id)",
    f"""
    create table if not exists partner_event_check_ins (
      id text primary key,
      project_id text,
      partner_id text,
      partner_user_id text,
      gps_coordinates jsonb not null default {JSON_OBJECT},
      check_in_time text
    )
    """,
    "create index if not exists partner_event_check_ins_project_id_idx on partner_event_check_ins (project_id)",
    "create index if not exists partner_event_check_ins_partner_user_id_idx on partner_event_check_ins (partner_user_id)",
    f"""
    create table if not exists partner_reports (
      id text primary key,
      project_id text,
      partner_id text,
      partner_user_id text,
      partner_name text,
      report_type text,
      description text,
      impact_count integer not null default 0,
      media_file text,
      created_at text,
      status text,
      reviewed_at text,
      reviewed_by text
    )
    """,
    "create index if not exists partner_reports_project_id_idx on partner_reports (project_id)",
    "create index if not exists partner_reports_partner_user_id_idx on partner_reports (partner_user_id)",
    f"""
    create table if not exists published_impact_reports (
      id text primary key,
      project_id text,
      generated_by text,
      generated_at text,
      report_file text,
      format text,
      published_at text
    )
    """,
    "create index if not exists published_impact_reports_project_id_idx on published_impact_reports (project_id)",
]


TABLE_SPECS: dict[str, dict[str, Any]] = {
    "users": {
        "table": "users",
        "columns": [
            ("id", False),
            ("email", False),
            ("password", False),
            ("role", False),
            ("name", False),
            ("phone", False),
            ("user_type", False),
            ("pillars_of_interest", True),
            ("created_at", False),
        ],
    },
    "partners": {
        "table": "partners",
        "columns": [
            ("id", False),
            ("owner_user_id", False),
            ("name", False),
            ("description", False),
            ("category", False),
            ("sector_type", False),
            ("dswd_accreditation_no", False),
            ("advocacy_focus", True),
            ("contact_email", False),
            ("contact_phone", False),
            ("address", False),
            ("status", False),
            ("verification_status", False),
            ("verification_notes", False),
            ("validated_by", False),
            ("validated_at", False),
            ("credentials_unlocked_at", False),
            ("created_at", False),
            ("registration_documents", True),
        ],
    },
    "volunteers": {
        "table": "volunteers",
        "columns": [
            ("id", False),
            ("user_id", False),
            ("name", False),
            ("email", False),
            ("phone", False),
            ("skills", True),
            ("skills_description", False),
            ("availability", True),
            ("past_projects", True),
            ("total_hours_contributed", False),
            ("rating", False),
            ("engagement_status", False),
            ("background", False),
            ("gender", False),
            ("date_of_birth", False),
            ("civil_status", False),
            ("home_address", False),
            ("occupation", False),
            ("workplace_or_school", False),
            ("college_course", False),
            ("certifications_or_trainings", False),
            ("hobbies_and_interests", False),
            ("special_skills", False),
            ("affiliations", True),
            ("registration_status", False),
            ("reviewed_by", False),
            ("reviewed_at", False),
            ("credentials_unlocked_at", False),
            ("created_at", False),
        ],
    },
    "projects": {
        "table": "projects",
        "columns": [
            ("id", False),
            ("title", False),
            ("description", False),
            ("partner_id", False),
            ("program_module", False),
            ("is_event", False),
            ("status", False),
            ("category", False),
            ("start_date", False),
            ("end_date", False),
            ("location", True),
            ("volunteers_needed", False),
            ("volunteers", True),
            ("joined_user_ids", True),
            ("created_at", False),
            ("updated_at", False),
        ],
    },
    "statusUpdates": {
        "table": "status_updates",
        "columns": [
            ("id", False),
            ("project_id", False),
            ("status", False),
            ("description", False),
            ("updated_by", False),
            ("updated_at", False),
        ],
    },
    "volunteerMatches": {
        "table": "volunteer_matches",
        "columns": [
            ("id", False),
            ("volunteer_id", False),
            ("project_id", False),
            ("status", False),
            ("matched_at", False),
            ("hours_contributed", False),
        ],
    },
    "volunteerTimeLogs": {
        "table": "volunteer_time_logs",
        "columns": [
            ("id", False),
            ("volunteer_id", False),
            ("project_id", False),
            ("time_in", False),
            ("time_out", False),
            ("note", False),
            ("completion_photo", False),
            ("completion_report", False),
        ],
    },
    "volunteerProjectJoins": {
        "table": "volunteer_project_joins",
        "columns": [
            ("id", False),
            ("project_id", False),
            ("volunteer_id", False),
            ("volunteer_user_id", False),
            ("volunteer_name", False),
            ("volunteer_email", False),
            ("joined_at", False),
            ("source", False),
            ("participation_status", False),
            ("completed_at", False),
            ("completed_by", False),
        ],
    },
    "partnerProjectApplications": {
        "table": "partner_project_applications",
        "columns": [
            ("id", False),
            ("project_id", False),
            ("partner_user_id", False),
            ("partner_name", False),
            ("partner_email", False),
            ("status", False),
            ("requested_at", False),
            ("reviewed_at", False),
            ("reviewed_by", False),
        ],
    },
    "partnerEventCheckIns": {
        "table": "partner_event_check_ins",
        "columns": [
            ("id", False),
            ("project_id", False),
            ("partner_id", False),
            ("partner_user_id", False),
            ("gps_coordinates", True),
            ("check_in_time", False),
        ],
    },
    "partnerReports": {
        "table": "partner_reports",
        "columns": [
            ("id", False),
            ("project_id", False),
            ("partner_id", False),
            ("partner_user_id", False),
            ("partner_name", False),
            ("report_type", False),
            ("description", False),
            ("impact_count", False),
            ("media_file", False),
            ("created_at", False),
            ("status", False),
            ("reviewed_at", False),
            ("reviewed_by", False),
        ],
    },
    "publishedImpactReports": {
        "table": "published_impact_reports",
        "columns": [
            ("id", False),
            ("project_id", False),
            ("generated_by", False),
            ("generated_at", False),
            ("report_file", False),
            ("format", False),
            ("published_at", False),
        ],
    },
}


def _json_dump(value: Any, default: Any) -> str:
    if value is None:
        value = default
    return json.dumps(value)


def _to_float(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _to_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _normalize_row(key: str, item: dict[str, Any]) -> tuple[Any, ...]:
    if key == "users":
        return (
            item.get("id"),
            item.get("email"),
            item.get("password") or "",
            item.get("role") or "",
            item.get("name") or "",
            item.get("phone"),
            item.get("userType"),
            _json_dump(item.get("pillarsOfInterest"), []),
            item.get("createdAt"),
        )

    if key == "partners":
        return (
            item.get("id"),
            item.get("ownerUserId"),
            item.get("name") or "",
            item.get("description"),
            item.get("category"),
            item.get("sectorType"),
            item.get("dswdAccreditationNo"),
            _json_dump(item.get("advocacyFocus"), []),
            item.get("contactEmail"),
            item.get("contactPhone"),
            item.get("address"),
            item.get("status"),
            item.get("verificationStatus"),
            item.get("verificationNotes"),
            item.get("validatedBy"),
            item.get("validatedAt"),
            item.get("credentialsUnlockedAt"),
            item.get("createdAt"),
            _json_dump(item.get("registrationDocuments"), []),
        )

    if key == "volunteers":
        return (
            item.get("id"),
            item.get("userId"),
            item.get("name") or "",
            item.get("email"),
            item.get("phone"),
            _json_dump(item.get("skills"), []),
            item.get("skillsDescription"),
            _json_dump(item.get("availability"), {}),
            _json_dump(item.get("pastProjects"), []),
            _to_float(item.get("totalHoursContributed")),
            _to_float(item.get("rating")),
            item.get("engagementStatus"),
            item.get("background"),
            item.get("gender"),
            item.get("dateOfBirth"),
            item.get("civilStatus"),
            item.get("homeAddress"),
            item.get("occupation"),
            item.get("workplaceOrSchool"),
            item.get("collegeCourse"),
            item.get("certificationsOrTrainings"),
            item.get("hobbiesAndInterests"),
            item.get("specialSkills"),
            _json_dump(item.get("affiliations"), []),
            item.get("registrationStatus"),
            item.get("reviewedBy"),
            item.get("reviewedAt"),
            item.get("credentialsUnlockedAt"),
            item.get("createdAt"),
        )

    if key == "projects":
        return (
            item.get("id"),
            item.get("title") or "",
            item.get("description"),
            item.get("partnerId"),
            item.get("programModule"),
            bool(item.get("isEvent", False)),
            item.get("status"),
            item.get("category"),
            item.get("startDate"),
            item.get("endDate"),
            _json_dump(item.get("location"), {}),
            _to_int(item.get("volunteersNeeded")),
            _json_dump(item.get("volunteers"), []),
            _json_dump(item.get("joinedUserIds"), []),
            item.get("createdAt"),
            item.get("updatedAt"),
        )

    if key == "statusUpdates":
        return (
            item.get("id"),
            item.get("projectId"),
            item.get("status"),
            item.get("description"),
            item.get("updatedBy"),
            item.get("updatedAt"),
        )

    if key == "volunteerMatches":
        return (
            item.get("id"),
            item.get("volunteerId"),
            item.get("projectId"),
            item.get("status"),
            item.get("matchedAt"),
            _to_float(item.get("hoursContributed")),
        )

    if key == "volunteerTimeLogs":
        return (
            item.get("id"),
            item.get("volunteerId"),
            item.get("projectId"),
            item.get("timeIn"),
            item.get("timeOut"),
            item.get("note"),
            item.get("completionPhoto"),
            item.get("completionReport"),
        )

    if key == "volunteerProjectJoins":
        return (
            item.get("id"),
            item.get("projectId"),
            item.get("volunteerId"),
            item.get("volunteerUserId"),
            item.get("volunteerName"),
            item.get("volunteerEmail"),
            item.get("joinedAt"),
            item.get("source"),
            item.get("participationStatus"),
            item.get("completedAt"),
            item.get("completedBy"),
        )

    if key == "partnerProjectApplications":
        return (
            item.get("id"),
            item.get("projectId"),
            item.get("partnerUserId"),
            item.get("partnerName"),
            item.get("partnerEmail"),
            item.get("status"),
            item.get("requestedAt"),
            item.get("reviewedAt"),
            item.get("reviewedBy"),
        )

    if key == "partnerEventCheckIns":
        return (
            item.get("id"),
            item.get("projectId"),
            item.get("partnerId"),
            item.get("partnerUserId"),
            _json_dump(item.get("gpsCoordinates"), {}),
            item.get("checkInTime"),
        )

    if key == "partnerReports":
        return (
            item.get("id"),
            item.get("projectId"),
            item.get("partnerId"),
            item.get("partnerUserId"),
            item.get("partnerName"),
            item.get("reportType"),
            item.get("description"),
            _to_int(item.get("impactCount")),
            item.get("mediaFile"),
            item.get("createdAt"),
            item.get("status"),
            item.get("reviewedAt"),
            item.get("reviewedBy"),
        )

    if key == "publishedImpactReports":
        return (
            item.get("id"),
            item.get("projectId"),
            item.get("generatedBy"),
            item.get("generatedAt"),
            item.get("reportFile"),
            item.get("format"),
            item.get("publishedAt"),
        )

    raise KeyError(f"Unsupported relational mirror key: {key}")


def ensure_relational_mirror_tables(connection: Any) -> None:
    with connection.cursor() as cursor:
        for statement in RELATIONAL_TABLE_DDL:
            cursor.execute(statement)


def sync_relational_mirror_collection(connection: Any, key: str, items: list[Any]) -> None:
    spec = TABLE_SPECS.get(key)
    if not spec:
        return

    normalized_items = [item for item in items if isinstance(item, dict) and item.get("id")]
    rows = [_normalize_row(key, item) for item in normalized_items]
    column_names = [column_name for column_name, _ in spec["columns"]]
    placeholders = [("%s::jsonb" if is_json else "%s") for _, is_json in spec["columns"]]

    with connection.cursor() as cursor:
        cursor.execute(f"delete from {spec['table']}")
        if rows:
            cursor.executemany(
                f"""
                insert into {spec['table']} ({', '.join(column_names)})
                values ({', '.join(placeholders)})
                """,
                rows,
            )


def sync_all_relational_mirror_tables(connection: Any, collections: dict[str, list[Any]]) -> None:
    for key, items in collections.items():
        sync_relational_mirror_collection(connection, key, items if isinstance(items, list) else [])
