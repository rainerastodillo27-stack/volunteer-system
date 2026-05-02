import argparse
import csv
import json
from pathlib import Path
import re
from typing import Any

try:
    from .db import get_postgres_connection
    from .relational_mirror import (
        ensure_relational_mirror_tables,
        get_relational_collection,
        upsert_relational_item,
    )
except ImportError:
    from db import get_postgres_connection
    from relational_mirror import (
        ensure_relational_mirror_tables,
        get_relational_collection,
        upsert_relational_item,
    )


def _read_csv_rows(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []

    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        return [dict(row) for row in reader]


def _read_first_existing_csv_rows(downloads_dir: Path, file_names: tuple[str, ...]) -> list[dict[str, str]]:
    for file_name in file_names:
        rows = _read_csv_rows(downloads_dir / file_name)
        if rows:
            return rows
    return []


def _clean_string(value: Any) -> str | None:
    if value is None:
        return None
    cleaned = str(value).strip()
    return cleaned or None


def _parse_bool(value: Any) -> bool:
    normalized = str(value or "").strip().lower()
    return normalized in {"1", "true", "t", "yes", "y"}


def _parse_json_field(value: Any, default: Any) -> Any:
    cleaned = _clean_string(value)
    if cleaned is None:
        return default
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        return default


def _users_item(row: dict[str, str]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "email": _clean_string(row.get("email")),
        "password": _clean_string(row.get("password")) or "",
        "role": _clean_string(row.get("role")) or "volunteer",
        "name": _clean_string(row.get("name")) or row["id"],
        "phone": _clean_string(row.get("phone")),
        "userType": _clean_string(row.get("user_type")),
        "pillarsOfInterest": _parse_json_field(row.get("pillars_of_interest"), []),
        "createdAt": _clean_string(row.get("created_at")),
    }


def _partners_item(row: dict[str, str]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "ownerUserId": _clean_string(row.get("owner_user_id")),
        "name": _clean_string(row.get("name")) or row["id"],
        "description": _clean_string(row.get("description")),
        "category": _clean_string(row.get("category")),
        "sectorType": _clean_string(row.get("sector_type")),
        "dswdAccreditationNo": _clean_string(row.get("dswd_accreditation_no")),
        "secRegistrationNo": _clean_string(row.get("sec_registration_no")),
        "advocacyFocus": _parse_json_field(row.get("advocacy_focus"), []),
        "contactEmail": _clean_string(row.get("contact_email")),
        "contactPhone": _clean_string(row.get("contact_phone")),
        "address": _clean_string(row.get("address")),
        "status": _clean_string(row.get("status")),
        "verificationStatus": _clean_string(row.get("verification_status")),
        "verificationNotes": _clean_string(row.get("verification_notes")),
        "validatedBy": _clean_string(row.get("validated_by")),
        "validatedAt": _clean_string(row.get("validated_at")),
        "credentialsUnlockedAt": _clean_string(row.get("credentials_unlocked_at")),
        "createdAt": _clean_string(row.get("created_at")),
        "registrationDocuments": _parse_json_field(row.get("registration_documents"), []),
    }


def _project_like_item(row: dict[str, str]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "title": _clean_string(row.get("title")) or row["id"],
        "description": _clean_string(row.get("description")),
        "partnerId": _clean_string(row.get("partner_id")),
        "programModule": _clean_string(row.get("program_module")),
        "isEvent": _parse_bool(row.get("is_event")),
        "parentProjectId": _clean_string(row.get("parent_project_id")),
        "status": _clean_string(row.get("status")),
        "category": _clean_string(row.get("category")),
        "startDate": _clean_string(row.get("start_date")),
        "endDate": _clean_string(row.get("end_date")),
        "location": _parse_json_field(row.get("location"), {}),
        "volunteersNeeded": row.get("volunteers_needed") or 0,
        "volunteers": _parse_json_field(row.get("volunteers"), []),
        "joinedUserIds": _parse_json_field(row.get("joined_user_ids"), []),
        "internalTasks": _parse_json_field(row.get("internal_tasks"), []),
        "createdAt": _clean_string(row.get("created_at")),
        "updatedAt": _clean_string(row.get("updated_at")),
    }


def _status_update_item(row: dict[str, str]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "projectId": _clean_string(row.get("project_id")),
        "status": _clean_string(row.get("status")),
        "description": _clean_string(row.get("description")),
        "updatedBy": _clean_string(row.get("updated_by")),
        "updatedAt": _clean_string(row.get("updated_at")),
    }


def _volunteer_item(row: dict[str, str]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "userId": _clean_string(row.get("user_id")),
        "name": _clean_string(row.get("name")) or row["id"],
        "email": _clean_string(row.get("email")),
        "phone": _clean_string(row.get("phone")),
        "skills": _parse_json_field(row.get("skills"), []),
        "skillsDescription": _clean_string(row.get("skills_description")),
        "availability": _parse_json_field(row.get("availability"), {}),
        "pastProjects": _parse_json_field(row.get("past_projects"), []),
        "totalHoursContributed": row.get("total_hours_contributed") or 0,
        "rating": row.get("rating") or 0,
        "engagementStatus": _clean_string(row.get("engagement_status")),
        "background": _clean_string(row.get("background")),
        "gender": _clean_string(row.get("gender")),
        "dateOfBirth": _clean_string(row.get("date_of_birth")),
        "civilStatus": _clean_string(row.get("civil_status")),
        "homeAddress": _clean_string(row.get("home_address")),
        "homeAddressRegion": _clean_string(row.get("home_address_region")),
        "homeAddressCityMunicipality": _clean_string(row.get("home_address_city_municipality")),
        "homeAddressBarangay": _clean_string(row.get("home_address_barangay")),
        "occupation": _clean_string(row.get("occupation")),
        "workplaceOrSchool": _clean_string(row.get("workplace_or_school")),
        "collegeCourse": _clean_string(row.get("college_course")),
        "certificationsOrTrainings": _clean_string(row.get("certifications_or_trainings")),
        "hobbiesAndInterests": _clean_string(row.get("hobbies_and_interests")),
        "specialSkills": _clean_string(row.get("special_skills")),
        "videoBriefingUrl": _clean_string(row.get("video_briefing_url")),
        "affiliations": _parse_json_field(row.get("affiliations"), []),
        "registrationStatus": _clean_string(row.get("registration_status")),
        "reviewedBy": _clean_string(row.get("reviewed_by")),
        "reviewedAt": _clean_string(row.get("reviewed_at")),
        "credentialsUnlockedAt": _clean_string(row.get("credentials_unlocked_at")),
        "createdAt": _clean_string(row.get("created_at")),
    }


def _volunteer_match_item(row: dict[str, str]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "volunteerId": _clean_string(row.get("volunteer_id")),
        "projectId": _clean_string(row.get("project_id")),
        "status": _clean_string(row.get("status")),
        "requestedAt": _clean_string(row.get("requested_at")),
        "matchedAt": _clean_string(row.get("matched_at")),
        "reviewedAt": _clean_string(row.get("reviewed_at")),
        "reviewedBy": _clean_string(row.get("reviewed_by")),
        "hoursContributed": row.get("hours_contributed") or 0,
    }


def _volunteer_time_log_item(row: dict[str, str]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "volunteerId": _clean_string(row.get("volunteer_id")),
        "projectId": _clean_string(row.get("project_id")),
        "timeIn": _clean_string(row.get("time_in")),
        "timeOut": _clean_string(row.get("time_out")),
        "note": _clean_string(row.get("note")),
        "completionPhoto": _clean_string(row.get("completion_photo")),
        "completionReport": _clean_string(row.get("completion_report")),
    }


def _volunteer_project_join_item(row: dict[str, str]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "projectId": _clean_string(row.get("project_id")),
        "volunteerId": _clean_string(row.get("volunteer_id")),
        "volunteerUserId": _clean_string(row.get("volunteer_user_id")),
        "volunteerName": _clean_string(row.get("volunteer_name")),
        "volunteerEmail": _clean_string(row.get("volunteer_email")),
        "joinedAt": _clean_string(row.get("joined_at")),
        "source": _clean_string(row.get("source")),
        "participationStatus": _clean_string(row.get("participation_status")),
        "completedAt": _clean_string(row.get("completed_at")),
        "completedBy": _clean_string(row.get("completed_by")),
    }


def _partner_project_application_item(row: dict[str, str]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "projectId": _clean_string(row.get("project_id")),
        "partnerUserId": _clean_string(row.get("partner_user_id")),
        "partnerName": _clean_string(row.get("partner_name")),
        "partnerEmail": _clean_string(row.get("partner_email")),
        "status": _clean_string(row.get("status")),
        "requestedAt": _clean_string(row.get("requested_at")),
        "reviewedAt": _clean_string(row.get("reviewed_at")),
        "reviewedBy": _clean_string(row.get("reviewed_by")),
    }


def _published_impact_report_item(row: dict[str, str]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "projectId": _clean_string(row.get("project_id")),
        "generatedBy": _clean_string(row.get("generated_by")),
        "generatedAt": _clean_string(row.get("generated_at")),
        "reportFile": _clean_string(row.get("report_file")),
        "format": _clean_string(row.get("format")),
        "publishedAt": _clean_string(row.get("published_at")),
    }


def _load_projects(downloads_dir: Path) -> dict[str, list[dict[str, Any]]]:
    items = [_project_like_item(row) for row in _read_csv_rows(downloads_dir / "projects_rows.csv")]
    return {
        "projects": [item for item in items if not item["isEvent"]],
        "events": [item for item in items if item["isEvent"]],
    }


def _build_partner_id_aliases(partners: list[dict[str, Any]]) -> dict[str, str]:
    aliases: dict[str, str] = {}
    for partner in partners:
        partner_id = _clean_string(partner.get("id"))
        owner_user_id = _clean_string(partner.get("ownerUserId"))
        if not partner_id or not owner_user_id:
            continue

        match = re.fullmatch(r"partner-user-(\d+)", owner_user_id)
        if match:
            aliases[f"partner-{match.group(1)}"] = partner_id

    return aliases


def _build_volunteer_id_aliases(volunteers: list[dict[str, Any]]) -> dict[str, str]:
    aliases: dict[str, str] = {}
    for volunteer in volunteers:
        volunteer_id = _clean_string(volunteer.get("id"))
        user_id = _clean_string(volunteer.get("userId"))
        if volunteer_id and user_id and volunteer_id != user_id:
            aliases[user_id] = volunteer_id
    return aliases


def _apply_id_aliases(imports: dict[str, list[dict[str, Any]]]) -> None:
    partner_aliases = _build_partner_id_aliases(imports.get("partners", []))
    volunteer_aliases = _build_volunteer_id_aliases(imports.get("volunteers", []))

    for key in ("projects", "events"):
        for item in imports.get(key, []):
            partner_id = _clean_string(item.get("partnerId"))
            if partner_id in partner_aliases:
                item["partnerId"] = partner_aliases[partner_id]

    for key in ("volunteerMatches", "volunteerTimeLogs", "volunteerProjectJoins"):
        for item in imports.get(key, []):
            volunteer_id = _clean_string(item.get("volunteerId"))
            if volunteer_id in volunteer_aliases:
                item["volunteerId"] = volunteer_aliases[volunteer_id]


def _load_import_items(downloads_dir: Path) -> dict[str, list[dict[str, Any]]]:
    imports = {
        "users": [_users_item(row) for row in _read_csv_rows(downloads_dir / "users_rows.csv")],
        "partners": [_partners_item(row) for row in _read_csv_rows(downloads_dir / "partners_rows.csv")],
        "statusUpdates": [_status_update_item(row) for row in _read_csv_rows(downloads_dir / "status_updates_rows.csv")],
        "volunteers": [_volunteer_item(row) for row in _read_csv_rows(downloads_dir / "volunteers_rows.csv")],
        "volunteerMatches": [
            _volunteer_match_item(row) for row in _read_csv_rows(downloads_dir / "volunteer_matches_rows.csv")
        ],
        "volunteerTimeLogs": [
            _volunteer_time_log_item(row) for row in _read_csv_rows(downloads_dir / "volunteer_time_logs_rows.csv")
        ],
        "volunteerProjectJoins": [
            _volunteer_project_join_item(row)
            for row in _read_first_existing_csv_rows(
                downloads_dir,
                ("volunteer_event_joins_rows.csv", "volunteer_project_joins_rows.csv"),
            )
        ],
        "partnerProjectApplications": [
            _partner_project_application_item(row)
            for row in _read_csv_rows(downloads_dir / "partner_project_applications_rows.csv")
        ],
        "publishedImpactReports": [
            _published_impact_report_item(row)
            for row in _read_csv_rows(downloads_dir / "published_impact_reports_rows.csv")
        ],
    }
    imports.update(_load_projects(downloads_dir))
    _apply_id_aliases(imports)
    return imports


def _collection_count(connection: Any, key: str) -> int:
    return len(get_relational_collection(connection, key))


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Merge exported CSV snapshots into the current canonical Volunteer System schema."
    )
    parser.add_argument(
        "--downloads-dir",
        default=str(Path.home() / "Downloads"),
        help="Directory that contains the exported *_rows.csv files.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write the merged rows into the live database. Without this flag, runs as a dry-run.",
    )
    args = parser.parse_args()

    downloads_dir = Path(args.downloads_dir).expanduser()
    import_items = _load_import_items(downloads_dir)
    target_keys = [
        "users",
        "partners",
        "projects",
        "events",
        "statusUpdates",
        "volunteers",
        "volunteerMatches",
        "volunteerTimeLogs",
        "volunteerProjectJoins",
        "partnerProjectApplications",
        "publishedImpactReports",
    ]

    with get_postgres_connection() as connection:
        ensure_relational_mirror_tables(connection)

        print("Import summary:")
        for key in target_keys:
            incoming = import_items.get(key, [])
            existing_count = _collection_count(connection, key)
            print(f"- {key}: csv_rows={len(incoming)} existing_rows={existing_count}")

        if not args.apply:
            print("Dry-run only. Re-run with --apply to merge these exports into the live database.")
            return

        merged_counts: dict[str, int] = {}
        for key in target_keys:
            merged = 0
            for item in import_items.get(key, []):
                upsert_relational_item(connection, key, item)
                merged += 1
            merged_counts[key] = merged

        connection.commit()

        print("Applied merges:")
        for key in target_keys:
            print(f"- {key}: merged_rows={merged_counts[key]} final_rows={_collection_count(connection, key)}")


if __name__ == "__main__":
    main()
