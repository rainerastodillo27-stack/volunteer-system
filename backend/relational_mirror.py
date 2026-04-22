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
      sec_registration_no text,
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
    "alter table partners add column if not exists sec_registration_no text",
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
      home_address_region text,
      home_address_city_municipality text,
      home_address_barangay text,
      occupation text,
      workplace_or_school text,
      college_course text,
      certifications_or_trainings text,
      hobbies_and_interests text,
      special_skills text,
      video_briefing_url text,
      affiliations jsonb not null default {JSON_ARRAY},
      registration_status text,
      reviewed_by text,
      reviewed_at text,
      credentials_unlocked_at text,
      created_at text
    )
    """,
    "create index if not exists volunteers_user_id_idx on volunteers (user_id)",
    "create unique index if not exists volunteers_user_id_unique_idx on volunteers (user_id) where user_id is not null",
    "alter table volunteers add column if not exists registration_status text",
    "alter table volunteers add column if not exists reviewed_by text",
    "alter table volunteers add column if not exists reviewed_at text",
    "alter table volunteers add column if not exists credentials_unlocked_at text",
    "alter table volunteers add column if not exists home_address_region text",
    "alter table volunteers add column if not exists home_address_city_municipality text",
    "alter table volunteers add column if not exists home_address_barangay text",
    "alter table volunteers add column if not exists video_briefing_url text",
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
      internal_tasks jsonb not null default {JSON_ARRAY},
      created_at text,
      updated_at text
    )
    """,
    "create index if not exists projects_partner_id_idx on projects (partner_id)",
    "alter table projects add column if not exists internal_tasks jsonb not null default '[]'::jsonb",
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
      requested_at text,
      matched_at text,
      reviewed_at text,
      reviewed_by text,
      hours_contributed double precision not null default 0
    )
    """,
    "create index if not exists volunteer_matches_volunteer_id_idx on volunteer_matches (volunteer_id)",
    "create index if not exists volunteer_matches_project_id_idx on volunteer_matches (project_id)",
    "alter table volunteer_matches add column if not exists requested_at text",
    "alter table volunteer_matches add column if not exists reviewed_at text",
    "alter table volunteer_matches add column if not exists reviewed_by text",
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
      submitter_user_id text,
      submitter_name text,
      submitter_role text,
      title text,
      report_type text,
      description text,
      impact_count integer not null default 0,
      metrics jsonb not null default {JSON_OBJECT},
      attachments jsonb not null default {JSON_ARRAY},
      media_file text,
      created_at text,
      status text,
      reviewed_at text,
      reviewed_by text
    )
    """,
    "create index if not exists partner_reports_project_id_idx on partner_reports (project_id)",
    "create index if not exists partner_reports_partner_user_id_idx on partner_reports (partner_user_id)",
    "alter table partner_reports add column if not exists submitter_user_id text",
    "alter table partner_reports add column if not exists submitter_name text",
    "alter table partner_reports add column if not exists submitter_role text",
    "alter table partner_reports add column if not exists title text",
    "alter table partner_reports add column if not exists metrics jsonb not null default '{}'::jsonb",
    "alter table partner_reports add column if not exists attachments jsonb not null default '[]'::jsonb",
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
    f"""
    create table if not exists admin_planning_calendars (
      id text primary key,
      name text not null,
      color text not null,
      description text,
      created_at text not null,
      updated_at text not null
    )
    """,
    f"""
    create table if not exists admin_planning_items (
      id text primary key,
      title text not null,
      description text,
      calendar_id text not null,
      linked_project_id text,
      start_date text not null,
      end_date text not null,
      location text,
      participants_label text,
      created_by text not null,
      created_at text not null,
      updated_at text not null
    )
    """,
    "create index if not exists admin_planning_items_calendar_id_idx on admin_planning_items (calendar_id)",
    "create index if not exists admin_planning_items_linked_project_id_idx on admin_planning_items (linked_project_id)",
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
            ("sec_registration_no", False),
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
            ("home_address_region", False),
            ("home_address_city_municipality", False),
            ("home_address_barangay", False),
            ("occupation", False),
            ("workplace_or_school", False),
            ("college_course", False),
            ("certifications_or_trainings", False),
            ("hobbies_and_interests", False),
            ("special_skills", False),
            ("video_briefing_url", False),
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
            ("internal_tasks", True),
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
            ("requested_at", False),
            ("matched_at", False),
            ("reviewed_at", False),
            ("reviewed_by", False),
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
            ("submitter_user_id", False),
            ("submitter_name", False),
            ("submitter_role", False),
            ("title", False),
            ("report_type", False),
            ("description", False),
            ("impact_count", False),
            ("metrics", True),
            ("attachments", True),
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
    "adminPlanningCalendars": {
        "table": "admin_planning_calendars",
        "columns": [
            ("id", False),
            ("name", False),
            ("color", False),
            ("description", False),
            ("created_at", False),
            ("updated_at", False),
        ],
    },
    "adminPlanningItems": {
        "table": "admin_planning_items",
        "columns": [
            ("id", False),
            ("title", False),
            ("description", False),
            ("calendar_id", False),
            ("linked_project_id", False),
            ("start_date", False),
            ("end_date", False),
            ("location", False),
            ("participants_label", False),
            ("created_by", False),
            ("created_at", False),
            ("updated_at", False),
        ],
    },
}

FIELD_NAME_MAPS: dict[str, dict[str, str]] = {
    "volunteers": {"userId": "user_id"},
    "statusUpdates": {"projectId": "project_id", "updatedBy": "updated_by", "updatedAt": "updated_at"},
    "volunteerMatches": {
        "volunteerId": "volunteer_id",
        "projectId": "project_id",
        "requestedAt": "requested_at",
        "matchedAt": "matched_at",
        "reviewedAt": "reviewed_at",
        "reviewedBy": "reviewed_by",
        "hoursContributed": "hours_contributed",
    },
    "volunteerTimeLogs": {
        "volunteerId": "volunteer_id",
        "projectId": "project_id",
        "timeIn": "time_in",
        "timeOut": "time_out",
        "completionPhoto": "completion_photo",
        "completionReport": "completion_report",
    },
    "volunteerProjectJoins": {
        "projectId": "project_id",
        "volunteerId": "volunteer_id",
        "volunteerUserId": "volunteer_user_id",
        "volunteerName": "volunteer_name",
        "volunteerEmail": "volunteer_email",
        "joinedAt": "joined_at",
        "participationStatus": "participation_status",
        "completedAt": "completed_at",
        "completedBy": "completed_by",
    },
    "partnerProjectApplications": {
        "projectId": "project_id",
        "partnerUserId": "partner_user_id",
        "partnerName": "partner_name",
        "partnerEmail": "partner_email",
        "requestedAt": "requested_at",
        "reviewedAt": "reviewed_at",
        "reviewedBy": "reviewed_by",
    },
    "partnerEventCheckIns": {
        "projectId": "project_id",
        "partnerId": "partner_id",
        "partnerUserId": "partner_user_id",
        "gpsCoordinates": "gps_coordinates",
        "checkInTime": "check_in_time",
    },
    "partnerReports": {
        "projectId": "project_id",
        "partnerId": "partner_id",
        "partnerUserId": "partner_user_id",
        "partnerName": "partner_name",
        "submitterUserId": "submitter_user_id",
        "submitterName": "submitter_name",
        "submitterRole": "submitter_role",
        "reportType": "report_type",
        "impactCount": "impact_count",
        "createdAt": "created_at",
        "reviewedAt": "reviewed_at",
        "reviewedBy": "reviewed_by",
        "mediaFile": "media_file",
    },
    "publishedImpactReports": {
        "projectId": "project_id",
        "generatedBy": "generated_by",
        "generatedAt": "generated_at",
        "reportFile": "report_file",
        "publishedAt": "published_at",
    },
    "adminPlanningCalendars": {
        "createdAt": "created_at",
        "updatedAt": "updated_at",
    },
    "adminPlanningItems": {
        "calendarId": "calendar_id",
        "linkedProjectId": "linked_project_id",
        "startDate": "start_date",
        "endDate": "end_date",
        "participantsLabel": "participants_label",
        "createdBy": "created_by",
        "createdAt": "created_at",
        "updatedAt": "updated_at",
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
            item.get("secRegistrationNo"),
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
            item.get("homeAddressRegion"),
            item.get("homeAddressCityMunicipality"),
            item.get("homeAddressBarangay"),
            item.get("occupation"),
            item.get("workplaceOrSchool"),
            item.get("collegeCourse"),
            item.get("certificationsOrTrainings"),
            item.get("hobbiesAndInterests"),
            item.get("specialSkills"),
            item.get("videoBriefingUrl"),
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
            _json_dump(item.get("internalTasks"), []),
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
            item.get("requestedAt"),
            item.get("matchedAt"),
            item.get("reviewedAt"),
            item.get("reviewedBy"),
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
            item.get("submitterUserId"),
            item.get("submitterName"),
            item.get("submitterRole"),
            item.get("title"),
            item.get("reportType"),
            item.get("description"),
            _to_int(item.get("impactCount")),
            _json_dump(item.get("metrics"), {}),
            _json_dump(item.get("attachments"), []),
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

    if key == "adminPlanningCalendars":
        return (
            item.get("id"),
            item.get("name") or "",
            item.get("color") or "#0F766E",
            item.get("description"),
            item.get("createdAt") or "",
            item.get("updatedAt") or "",
        )

    if key == "adminPlanningItems":
        return (
            item.get("id"),
            item.get("title") or "",
            item.get("description"),
            item.get("calendarId") or "",
            item.get("linkedProjectId"),
            item.get("startDate") or "",
            item.get("endDate") or "",
            item.get("location"),
            item.get("participantsLabel"),
            item.get("createdBy") or "",
            item.get("createdAt") or "",
            item.get("updatedAt") or "",
        )

    raise KeyError(f"Unsupported relational mirror key: {key}")


def _field_column_name(key: str, field_name: str) -> str:
    return FIELD_NAME_MAPS.get(key, {}).get(field_name, field_name)


def _row_to_item(key: str, row: dict[str, Any]) -> dict[str, Any]:
    if key == "users":
        return {
            "id": row["id"],
            "email": row["email"],
            "password": row["password"],
            "role": row["role"],
            "name": row["name"],
            "phone": row["phone"],
            "userType": row["user_type"],
            "pillarsOfInterest": row["pillars_of_interest"] or [],
            "createdAt": row["created_at"],
        }

    if key == "partners":
        return {
            "id": row["id"],
            "ownerUserId": row["owner_user_id"],
            "name": row["name"],
            "description": row["description"],
            "category": row["category"],
            "sectorType": row["sector_type"],
            "dswdAccreditationNo": row["dswd_accreditation_no"],
            "secRegistrationNo": row["sec_registration_no"],
            "advocacyFocus": row["advocacy_focus"] or [],
            "contactEmail": row["contact_email"],
            "contactPhone": row["contact_phone"],
            "address": row["address"],
            "status": row["status"],
            "verificationStatus": row["verification_status"],
            "verificationNotes": row["verification_notes"],
            "validatedBy": row["validated_by"],
            "validatedAt": row["validated_at"],
            "credentialsUnlockedAt": row["credentials_unlocked_at"],
            "createdAt": row["created_at"],
            "registrationDocuments": row["registration_documents"] or [],
        }

    if key == "volunteers":
        return {
            "id": row["id"],
            "userId": row["user_id"],
            "name": row["name"],
            "email": row["email"],
            "phone": row["phone"],
            "skills": row["skills"] or [],
            "skillsDescription": row["skills_description"],
            "availability": row["availability"] or {},
            "pastProjects": row["past_projects"] or [],
            "totalHoursContributed": row["total_hours_contributed"],
            "rating": row["rating"],
            "engagementStatus": row["engagement_status"],
            "background": row["background"],
            "gender": row["gender"],
            "dateOfBirth": row["date_of_birth"],
            "civilStatus": row["civil_status"],
            "homeAddress": row["home_address"],
            "homeAddressRegion": row["home_address_region"],
            "homeAddressCityMunicipality": row["home_address_city_municipality"],
            "homeAddressBarangay": row["home_address_barangay"],
            "occupation": row["occupation"],
            "workplaceOrSchool": row["workplace_or_school"],
            "collegeCourse": row["college_course"],
            "certificationsOrTrainings": row["certifications_or_trainings"],
            "hobbiesAndInterests": row["hobbies_and_interests"],
            "specialSkills": row["special_skills"],
            "videoBriefingUrl": row["video_briefing_url"],
            "affiliations": row["affiliations"] or [],
            "registrationStatus": row["registration_status"],
            "reviewedBy": row["reviewed_by"],
            "reviewedAt": row["reviewed_at"],
            "credentialsUnlockedAt": row["credentials_unlocked_at"],
            "createdAt": row["created_at"],
        }

    if key == "projects":
        return {
            "id": row["id"],
            "title": row["title"],
            "description": row["description"],
            "partnerId": row["partner_id"],
            "programModule": row["program_module"],
            "isEvent": bool(row["is_event"]),
            "status": row["status"],
            "category": row["category"],
            "startDate": row["start_date"],
            "endDate": row["end_date"],
            "location": row["location"] or {},
            "volunteersNeeded": row["volunteers_needed"],
            "volunteers": row["volunteers"] or [],
            "joinedUserIds": row["joined_user_ids"] or [],
            "internalTasks": row["internal_tasks"] or [],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }

    if key == "statusUpdates":
        return {
            "id": row["id"],
            "projectId": row["project_id"],
            "status": row["status"],
            "description": row["description"],
            "updatedBy": row["updated_by"],
            "updatedAt": row["updated_at"],
        }

    if key == "volunteerMatches":
        return {
            "id": row["id"],
            "volunteerId": row["volunteer_id"],
            "projectId": row["project_id"],
            "status": row["status"],
            "requestedAt": row["requested_at"],
            "matchedAt": row["matched_at"],
            "reviewedAt": row["reviewed_at"],
            "reviewedBy": row["reviewed_by"],
            "hoursContributed": row["hours_contributed"],
        }

    if key == "volunteerTimeLogs":
        return {
            "id": row["id"],
            "volunteerId": row["volunteer_id"],
            "projectId": row["project_id"],
            "timeIn": row["time_in"],
            "timeOut": row["time_out"],
            "note": row["note"],
            "completionPhoto": row["completion_photo"],
            "completionReport": row["completion_report"],
        }

    if key == "volunteerProjectJoins":
        return {
            "id": row["id"],
            "projectId": row["project_id"],
            "volunteerId": row["volunteer_id"],
            "volunteerUserId": row["volunteer_user_id"],
            "volunteerName": row["volunteer_name"],
            "volunteerEmail": row["volunteer_email"],
            "joinedAt": row["joined_at"],
            "source": row["source"],
            "participationStatus": row["participation_status"],
            "completedAt": row["completed_at"],
            "completedBy": row["completed_by"],
        }

    if key == "partnerProjectApplications":
        return {
            "id": row["id"],
            "projectId": row["project_id"],
            "partnerUserId": row["partner_user_id"],
            "partnerName": row["partner_name"],
            "partnerEmail": row["partner_email"],
            "status": row["status"],
            "requestedAt": row["requested_at"],
            "reviewedAt": row["reviewed_at"],
            "reviewedBy": row["reviewed_by"],
        }

    if key == "partnerEventCheckIns":
        return {
            "id": row["id"],
            "projectId": row["project_id"],
            "partnerId": row["partner_id"],
            "partnerUserId": row["partner_user_id"],
            "gpsCoordinates": row["gps_coordinates"] or {},
            "checkInTime": row["check_in_time"],
        }

    if key == "partnerReports":
        return {
            "id": row["id"],
            "projectId": row["project_id"],
            "partnerId": row["partner_id"],
            "partnerUserId": row["partner_user_id"],
            "partnerName": row["partner_name"],
            "submitterUserId": row["submitter_user_id"],
            "submitterName": row["submitter_name"],
            "submitterRole": row["submitter_role"],
            "title": row["title"],
            "reportType": row["report_type"],
            "description": row["description"],
            "impactCount": row["impact_count"],
            "metrics": row["metrics"] or {},
            "attachments": row["attachments"] or [],
            "mediaFile": row["media_file"],
            "createdAt": row["created_at"],
            "status": row["status"],
            "reviewedAt": row["reviewed_at"],
            "reviewedBy": row["reviewed_by"],
        }

    if key == "publishedImpactReports":
        return {
            "id": row["id"],
            "projectId": row["project_id"],
            "generatedBy": row["generated_by"],
            "generatedAt": row["generated_at"],
            "reportFile": row["report_file"],
            "format": row["format"],
            "publishedAt": row["published_at"],
        }

    if key == "adminPlanningCalendars":
        return {
            "id": row["id"],
            "name": row["name"],
            "color": row["color"],
            "description": row["description"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }

    if key == "adminPlanningItems":
        return {
            "id": row["id"],
            "title": row["title"],
            "description": row["description"],
            "calendarId": row["calendar_id"],
            "linkedProjectId": row["linked_project_id"],
            "startDate": row["start_date"],
            "endDate": row["end_date"],
            "location": row["location"],
            "participantsLabel": row["participants_label"],
            "createdBy": row["created_by"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }

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


def get_relational_collection(connection: Any, key: str) -> list[dict[str, Any]]:
    spec = TABLE_SPECS.get(key)
    if not spec:
        raise KeyError(f"Unsupported relational mirror key: {key}")

    from psycopg.rows import dict_row

    column_names = [column_name for column_name, _ in spec["columns"]]
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            f"select {', '.join(column_names)} from {spec['table']} order by id asc"
        )
        rows = cursor.fetchall()
    return [_row_to_item(key, row) for row in rows]


def get_relational_item_by_id(connection: Any, key: str, item_id: str) -> dict[str, Any] | None:
    spec = TABLE_SPECS.get(key)
    if not spec:
        raise KeyError(f"Unsupported relational mirror key: {key}")

    from psycopg.rows import dict_row

    column_names = [column_name for column_name, _ in spec["columns"]]
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            f"select {', '.join(column_names)} from {spec['table']} where id = %s",
            (item_id,),
        )
        row = cursor.fetchone()
    return None if row is None else _row_to_item(key, row)


def get_relational_items_by_field(
    connection: Any,
    key: str,
    field_name: str,
    field_value: Any,
) -> list[dict[str, Any]]:
    spec = TABLE_SPECS.get(key)
    if not spec:
        raise KeyError(f"Unsupported relational mirror key: {key}")

    from psycopg.rows import dict_row

    column_name = _field_column_name(key, field_name)
    valid_columns = {column_name for column_name, _ in spec["columns"]}
    if column_name not in valid_columns:
        return []

    column_names = [column_name for column_name, _ in spec["columns"]]
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            f"select {', '.join(column_names)} from {spec['table']} where coalesce({column_name}, '') = %s order by id asc",
            (field_value,),
        )
        rows = cursor.fetchall()
    return [_row_to_item(key, row) for row in rows]


def replace_relational_collection(connection: Any, key: str, items: list[Any]) -> None:
    sync_relational_mirror_collection(connection, key, items)


def upsert_relational_item(connection: Any, key: str, item: dict[str, Any]) -> dict[str, Any]:
    spec = TABLE_SPECS.get(key)
    if not spec:
        raise KeyError(f"Unsupported relational mirror key: {key}")

    item_id = item.get("id")
    if not isinstance(item_id, str) or not item_id:
        raise ValueError(f"Relational storage key '{key}' expects an object with an id.")

    row = _normalize_row(key, item)
    column_names = [column_name for column_name, _ in spec["columns"]]
    placeholders = [("%s::jsonb" if is_json else "%s") for _, is_json in spec["columns"]]
    update_assignments = [f"{column_name} = excluded.{column_name}" for column_name in column_names if column_name != "id"]

    with connection.cursor() as cursor:
        cursor.execute(
            f"""
            insert into {spec['table']} ({', '.join(column_names)})
            values ({', '.join(placeholders)})
            on conflict (id) do update set
              {', '.join(update_assignments)}
            """,
            row,
        )

    return item
