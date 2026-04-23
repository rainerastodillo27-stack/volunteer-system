import json
from datetime import datetime, timezone

try:
    from backend.db import get_postgres_connection
except ImportError:
    from db import get_postgres_connection


SAMPLE_EVENT_ID = "project-sample-nutrition-event-1"
SAMPLE_VOLUNTEER_ID = "volunteer-profile-1"
SAMPLE_VOLUNTEER_USER_ID = "volunteer-1"
SAMPLE_VOLUNTEER_NAME = "Volunteer Account"
SAMPLE_VOLUNTEER_EMAIL = "volunteer@example.com"
SAMPLE_ADMIN_ID = "admin-1"
SAMPLE_JOIN_ID = "join-qassessment-vol1"
SAMPLE_MATCH_ID = "match-qassessment-vol1"


def main() -> None:
    now_iso = datetime.now(timezone.utc).isoformat()
    sample_tasks = [
        {
            "id": f"{SAMPLE_EVENT_ID}-task-field-officer",
            "title": "Field Officer Lead",
            "description": "Coordinate the Quarterly Assessment floor team and assign other volunteers within this event as needs change.",
            "category": "Field Officer",
            "priority": "High",
            "status": "Assigned",
            "assignedVolunteerId": SAMPLE_VOLUNTEER_ID,
            "assignedVolunteerName": SAMPLE_VOLUNTEER_NAME,
            "isFieldOfficer": True,
            "createdAt": now_iso,
            "updatedAt": now_iso,
        },
        {
            "id": f"{SAMPLE_EVENT_ID}-task-mingo-supplies",
            "title": "Mingo Supply Staging",
            "description": "Prepare nutrition packs, assessment sheets, and event materials before the session opens.",
            "category": "Logistics",
            "priority": "High",
            "status": "Unassigned",
            "createdAt": now_iso,
            "updatedAt": now_iso,
        },
        {
            "id": f"{SAMPLE_EVENT_ID}-task-attendance",
            "title": "Attendance and Assessment Desk",
            "description": "Welcome arrivals, confirm attendance, and guide participants through the assessment flow.",
            "category": "Front Desk",
            "priority": "Medium",
            "status": "Unassigned",
            "createdAt": now_iso,
            "updatedAt": now_iso,
        },
    ]

    with get_postgres_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                update projects
                set joined_user_ids = '[]'::jsonb,
                    volunteers = '[]'::jsonb,
                    internal_tasks = '[]'::jsonb,
                    updated_at = %s
                """,
                (now_iso,),
            )

            cursor.execute(
                """
                delete from volunteer_event_joins
                where project_id in (select id from projects)
                """
            )

            cursor.execute(
                """
                delete from volunteer_matches
                where project_id in (select id from projects)
                """
            )

            cursor.execute(
                """
                update events
                set joined_user_ids = %s::jsonb,
                    volunteers = %s::jsonb,
                    internal_tasks = %s::jsonb,
                    updated_at = %s,
                    description = %s
                where id = %s
                """,
                (
                    json.dumps([SAMPLE_VOLUNTEER_USER_ID]),
                    json.dumps([SAMPLE_VOLUNTEER_ID]),
                    json.dumps(sample_tasks),
                    now_iso,
                    "Quarterly Assessment event for Mingo nutrition coordination, announcements, and assigning tasks to the event team.",
                    SAMPLE_EVENT_ID,
                ),
            )

            cursor.execute(
                """
                insert into volunteer_event_joins (
                    id,
                    project_id,
                    volunteer_id,
                    volunteer_user_id,
                    volunteer_name,
                    volunteer_email,
                    joined_at,
                    source,
                    participation_status,
                    completed_at,
                    completed_by
                )
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                on conflict (id) do update
                set project_id = excluded.project_id,
                    volunteer_id = excluded.volunteer_id,
                    volunteer_user_id = excluded.volunteer_user_id,
                    volunteer_name = excluded.volunteer_name,
                    volunteer_email = excluded.volunteer_email,
                    joined_at = excluded.joined_at,
                    source = excluded.source,
                    participation_status = excluded.participation_status,
                    completed_at = excluded.completed_at,
                    completed_by = excluded.completed_by
                """,
                (
                    SAMPLE_JOIN_ID,
                    SAMPLE_EVENT_ID,
                    SAMPLE_VOLUNTEER_ID,
                    SAMPLE_VOLUNTEER_USER_ID,
                    SAMPLE_VOLUNTEER_NAME,
                    SAMPLE_VOLUNTEER_EMAIL,
                    now_iso,
                    "VolunteerJoin",
                    "Active",
                    None,
                    None,
                ),
            )

            cursor.execute(
                """
                insert into volunteer_matches (
                    id,
                    volunteer_id,
                    project_id,
                    status,
                    requested_at,
                    matched_at,
                    reviewed_at,
                    reviewed_by,
                    hours_contributed
                )
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                on conflict (id) do update
                set volunteer_id = excluded.volunteer_id,
                    project_id = excluded.project_id,
                    status = excluded.status,
                    requested_at = excluded.requested_at,
                    matched_at = excluded.matched_at,
                    reviewed_at = excluded.reviewed_at,
                    reviewed_by = excluded.reviewed_by,
                    hours_contributed = excluded.hours_contributed
                """,
                (
                    SAMPLE_MATCH_ID,
                    SAMPLE_VOLUNTEER_ID,
                    SAMPLE_EVENT_ID,
                    "Matched",
                    now_iso,
                    now_iso,
                    now_iso,
                    SAMPLE_ADMIN_ID,
                    0,
                ),
            )

        connection.commit()

    print("Volunteer event membership migrated.")


if __name__ == "__main__":
    main()
