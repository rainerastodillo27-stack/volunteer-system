"""Populate realistic role-flow data for local E2E testing.

The seed is intentionally idempotent. It upserts records with stable ``e2e-*``
IDs and leaves unrelated production/local records untouched.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
from typing import Any

from .app_storage_seed import (
    HOT_STORAGE_TABLES,
)
from .db import get_postgres_connection
from .relational_mirror import TABLE_SPECS, _normalize_row, _primary_key_column, ensure_relational_mirror_tables


ADMIN_ID = "e2e-admin-1"
VOLUNTEER_USER_ID = "e2e-volunteer-user-1"
VOLUNTEER_ID = "e2e-volunteer-1"
PENDING_VOLUNTEER_USER_ID = "e2e-volunteer-user-pending"
PENDING_VOLUNTEER_ID = "e2e-volunteer-pending"
PARTNER_USER_ID = "e2e-partner-user-1"
PARTNER_ID = "e2e-partner-1"
PENDING_PARTNER_USER_ID = "e2e-partner-user-pending"
PENDING_PARTNER_ID = "e2e-partner-pending"
PROJECT_ID = "e2e-project-nutrition-1"
EVENT_ID = "e2e-event-nutrition-1"
PARTNER_APPLICATION_ID = "e2e-partner-application-1"
VOLUNTEER_MATCH_ID = "e2e-volunteer-match-1"
VOLUNTEER_JOIN_ID = "e2e-volunteer-join-1"
VOLUNTEER_REPORT_ID = "e2e-volunteer-report-1"
PARTNER_REPORT_ID = "e2e-partner-report-1"
LIVE_ATTENDANCE_PROJECT_ID = "e2e-live-project-attendance"
LIVE_ATTENDANCE_EVENT_ID = "e2e-live-event-attendance"
LIVE_REVIEW_PROJECT_ID = "e2e-live-project-review"
LIVE_REVIEW_EVENT_ID = "e2e-live-event-review"
LIVE_VOLUNTEER_MATCH_ID = "e2e-live-volunteer-match-requested"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.isoformat()


def _location(address: str, latitude: float = 10.6765, longitude: float = 122.9509) -> dict[str, Any]:
    return {
        "latitude": latitude,
        "longitude": longitude,
        "address": address,
        "region": "Western Visayas",
        "city": "Bacolod City",
        "barangay": "Mandalagan",
    }


def build_realistic_e2e_storage() -> dict[str, list[dict[str, Any]]]:
    now = _now()
    created_at = _iso(now)
    project_start = _iso(now - timedelta(days=21))
    project_end = _iso(now + timedelta(days=75))
    event_start = _iso(now + timedelta(days=7))
    event_end = _iso(now + timedelta(days=7, hours=5))
    live_start = _iso(now - timedelta(hours=2))
    live_end = _iso(now + timedelta(days=1))
    completed_log_start = _iso(now - timedelta(days=3, hours=4))
    completed_log_end = _iso(now - timedelta(days=3, hours=1))

    users = [
        {
            "id": "admin-1",
            "email": "admin@nvc.org",
            "password": "admin123",
            "role": "admin",
            "name": "NVC Admin Account",
            "phone": "09170000001",
            "userType": "Adult",
            "pillarsOfInterest": ["Education", "Livelihood", "Nutrition"],
            "approvalStatus": "approved",
            "createdAt": created_at,
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
            "approvalStatus": "approved",
            "approvedBy": "admin-1",
            "approvedAt": created_at,
            "createdAt": created_at,
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
            "approvalStatus": "approved",
            "approvedBy": "admin-1",
            "approvedAt": created_at,
            "createdAt": created_at,
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
            "approvalStatus": "approved",
            "approvedBy": "admin-1",
            "approvedAt": created_at,
            "createdAt": created_at,
        },
        {
            "id": ADMIN_ID,
            "email": "e2e.admin@nvc.test",
            "password": "Admin123!",
            "role": "admin",
            "name": "E2E NVC Program Admin",
            "phone": "09170001001",
            "userType": "Adult",
            "pillarsOfInterest": ["Nutrition", "Education", "Livelihood"],
            "approvalStatus": "approved",
            "createdAt": created_at,
        },
        {
            "id": VOLUNTEER_USER_ID,
            "email": "e2e.volunteer@nvc.test",
            "password": "Volunteer123!",
            "role": "volunteer",
            "name": "E2E Volunteer Maria Santos",
            "phone": "09170001002",
            "userType": "Adult",
            "pillarsOfInterest": ["Nutrition", "Education"],
            "approvalStatus": "approved",
            "approvedBy": ADMIN_ID,
            "approvedAt": created_at,
            "createdAt": created_at,
        },
        {
            "id": PENDING_VOLUNTEER_USER_ID,
            "email": "e2e.pending.volunteer@nvc.test",
            "password": "Volunteer123!",
            "role": "volunteer",
            "name": "E2E Pending Volunteer Juan Dela Cruz",
            "phone": "09170001003",
            "userType": "Student",
            "pillarsOfInterest": ["Nutrition"],
            "approvalStatus": "pending",
            "createdAt": created_at,
        },
        {
            "id": PARTNER_USER_ID,
            "email": "e2e.partner@nvc.test",
            "password": "Partner123!",
            "role": "partner",
            "name": "E2E Partner Coordinator",
            "phone": "09170001004",
            "userType": "Adult",
            "pillarsOfInterest": ["Nutrition", "Livelihood"],
            "approvalStatus": "approved",
            "approvedBy": ADMIN_ID,
            "approvedAt": created_at,
            "createdAt": created_at,
        },
        {
            "id": PENDING_PARTNER_USER_ID,
            "email": "e2e.pending.partner@nvc.test",
            "password": "Partner123!",
            "role": "partner",
            "name": "E2E Pending Partner Coordinator",
            "phone": "09170001005",
            "userType": "Adult",
            "pillarsOfInterest": ["Education"],
            "approvalStatus": "pending",
            "createdAt": created_at,
            "partnerRegistration": {
                "organizationName": "E2E Pending Community Learning Hub",
                "stakeholderName": "Juan Learning Coordinator",
                "sectorType": "NGO",
                "dswdAccreditationNo": "E2E-DSWD-PENDING-001",
                "secRegistrationNo": "E2E-SEC-PENDING-001",
                "region": "Western Visayas",
                "province": "Negros Occidental",
                "cityMunicipality": "Bacolod City",
                "advocacyFocus": ["Education"],
            },
        },
    ]

    partners = [
        {
            "id": "partner-1780189738",
            "ownerUserId": "partner-user-1",
            "name": "Kabankalan LGU",
            "stakeholderName": "LGU Livelihood Coordinator",
            "description": "Local government partner for livelihood and nutrition coordination.",
            "category": "Livelihood",
            "sectorType": "Institution",
            "dswdAccreditationNo": "LGU-2026-001",
            "secRegistrationNo": "LGU-KABANKALAN-001",
            "advocacyFocus": ["Nutrition", "Livelihood"],
            "contactEmail": "partner@livelihoods.org",
            "contactPhone": "09198765432",
            "region": "Western Visayas",
            "province": "Negros Occidental",
            "cityMunicipality": "Kabankalan City",
            "address": "Kabankalan City Hall, Kabankalan City, Negros Occidental",
            "status": "Approved",
            "verificationStatus": "Verified",
            "validatedBy": "admin-1",
            "validatedAt": created_at,
            "credentialsUnlockedAt": created_at,
            "createdAt": created_at,
        },
        {
            "id": PARTNER_ID,
            "ownerUserId": PARTNER_USER_ID,
            "name": "E2E Barangay Nutrition Council",
            "stakeholderName": "Ana Reyes",
            "description": "Local nutrition partner coordinating meal distribution and parent orientation.",
            "category": "Nutrition",
            "sectorType": "Institution",
            "dswdAccreditationNo": "E2E-DSWD-2026-001",
            "secRegistrationNo": "E2E-SEC-2026-001",
            "advocacyFocus": ["Nutrition", "Livelihood"],
            "contactEmail": "e2e.partner@nvc.test",
            "contactPhone": "09170001004",
            "region": "Western Visayas",
            "province": "Negros Occidental",
            "cityMunicipality": "Bacolod City",
            "address": "Barangay Hall, Mandalagan, Bacolod City",
            "status": "Approved",
            "verificationStatus": "Verified",
            "validatedBy": ADMIN_ID,
            "validatedAt": created_at,
            "credentialsUnlockedAt": created_at,
            "createdAt": created_at,
        },
        {
            "id": PENDING_PARTNER_ID,
            "ownerUserId": PENDING_PARTNER_USER_ID,
            "name": "E2E Pending Community Learning Hub",
            "stakeholderName": "Juan Learning Coordinator",
            "description": "Applicant partner awaiting admin verification.",
            "category": "Education",
            "sectorType": "NGO",
            "dswdAccreditationNo": "E2E-DSWD-PENDING-001",
            "secRegistrationNo": "E2E-SEC-PENDING-001",
            "advocacyFocus": ["Education"],
            "contactEmail": "e2e.pending.partner@nvc.test",
            "contactPhone": "09170001005",
            "region": "Western Visayas",
            "province": "Negros Occidental",
            "cityMunicipality": "Bacolod City",
            "address": "Bacolod City, Negros Occidental",
            "status": "Pending",
            "verificationStatus": "Pending",
            "createdAt": created_at,
        },
    ]

    volunteers = [
        {
            "id": "volunteer-profile-1",
            "userId": "volunteer-1",
            "name": "Volunteer Account",
            "email": "volunteer@example.com",
            "phone": "09123456789",
            "skills": ["Tutoring", "Meal Packing", "Event Support"],
            "skillsDescription": "General NVC volunteer available for education and nutrition events.",
            "availability": {
                "daysPerWeek": 2,
                "hoursPerWeek": 6,
                "availableDays": ["Saturday", "Sunday"],
            },
            "pastProjects": [],
            "totalHoursContributed": 0,
            "rating": 4.5,
            "engagementStatus": "Open to Volunteer",
            "background": "Restored standard volunteer account for local testing.",
            "registrationStatus": "Approved",
            "reviewedBy": "admin-1",
            "reviewedAt": created_at,
            "credentialsUnlockedAt": created_at,
            "createdAt": created_at,
        },
        {
            "id": VOLUNTEER_ID,
            "userId": VOLUNTEER_USER_ID,
            "name": "E2E Volunteer Maria Santos",
            "email": "e2e.volunteer@nvc.test",
            "phone": "09170001002",
            "skills": ["Meal Packing", "Community Facilitation", "Data Collection"],
            "skillsDescription": "Experienced in beneficiary registration, event support, and nutrition packs.",
            "availability": {
                "daysPerWeek": 2,
                "hoursPerWeek": 8,
                "availableDays": ["Saturday", "Sunday"],
            },
            "pastProjects": [PROJECT_ID],
            "totalHoursContributed": 12,
            "rating": 4.8,
            "engagementStatus": "Open to Volunteer",
            "background": "Community volunteer from Bacolod with experience in feeding programs.",
            "gender": "Female",
            "dateOfBirth": "1998-05-12",
            "civilStatus": "Single",
            "homeAddress": "Mandalagan, Bacolod City",
            "occupation": "Teacher",
            "workplaceOrSchool": "Bacolod Community School",
            "specialSkills": "Facilitation, registration desk, basic first aid",
            "registrationStatus": "Approved",
            "reviewedBy": ADMIN_ID,
            "reviewedAt": created_at,
            "credentialsUnlockedAt": created_at,
            "createdAt": created_at,
        },
        {
            "id": PENDING_VOLUNTEER_ID,
            "userId": PENDING_VOLUNTEER_USER_ID,
            "name": "E2E Pending Volunteer Juan Dela Cruz",
            "email": "e2e.pending.volunteer@nvc.test",
            "phone": "09170001003",
            "skills": ["Logistics", "Documentation"],
            "skillsDescription": "New volunteer applicant available for weekend activities.",
            "availability": {
                "daysPerWeek": 1,
                "hoursPerWeek": 4,
                "availableDays": ["Saturday"],
            },
            "pastProjects": [],
            "totalHoursContributed": 0,
            "rating": 4,
            "engagementStatus": "Open to Volunteer",
            "background": "Student applicant awaiting NVC approval.",
            "registrationStatus": "Pending",
            "createdAt": created_at,
        },
    ]

    project = {
        "id": PROJECT_ID,
        "title": "E2E Mingo Meal Distribution Program",
        "description": "Community nutrition support program for families with young children.",
        "partnerId": PARTNER_ID,
        "imageUrl": "https://images.unsplash.com/photo-1593113598332-cd288d649433",
        "icon": "restaurant",
        "color": "#16a34a",
        "programModule": "Nutrition",
        "program_id": "nutrition",
        "isEvent": False,
        "statusMode": "Manual",
        "manualStatus": "In Progress",
        "status": "In Progress",
        "category": "Nutrition",
        "startDate": project_start,
        "endDate": project_end,
        "location": _location("Barangay Hall, Mandalagan, Bacolod City"),
        "locationRegion": "Western Visayas",
        "locationCity": "Bacolod City",
        "volunteersNeeded": 18,
        "volunteerRequirements": ["Meal packing", "Crowd assistance", "Beneficiary registration"],
        "acceptVolunteers": True,
        "applicationRequired": True,
        "reviewRequired": True,
        "applicationDeadline": _iso(now + timedelta(days=20)),
        "volunteers": [VOLUNTEER_ID],
        "joinedUserIds": [VOLUNTEER_USER_ID],
        "skillsNeeded": ["Meal Packing", "Community Facilitation", "Data Collection"],
        "communityNeed": "Improve access to nutritious meals for selected family beneficiaries.",
        "expectedDeliverables": "Weekly distribution summary and beneficiary count report.",
        "createdAt": created_at,
        "updatedAt": created_at,
        "statusUpdates": [],
        "internalTasks": [
            {
                "id": "e2e-task-registration",
                "title": "Beneficiary registration desk",
                "description": "Validate beneficiary list and encode attendance.",
                "category": "Operations",
                "priority": "High",
                "status": "Assigned",
                "assignedVolunteerId": VOLUNTEER_ID,
                "assignedVolunteerName": "E2E Volunteer Maria Santos",
                "assignedVolunteerIds": [VOLUNTEER_ID],
                "assignedVolunteerNames": ["E2E Volunteer Maria Santos"],
                "volunteersNeeded": 1,
                "isFieldOfficer": True,
                "skillsNeeded": ["Data Collection", "Community Facilitation"],
                "createdAt": created_at,
                "updatedAt": created_at,
            }
        ],
    }
    event = {
        **project,
        "id": EVENT_ID,
        "title": "E2E Nutrition Pack Distribution Day",
        "description": "One-day meal pack distribution and beneficiary validation activity.",
        "isEvent": True,
        "parentProjectId": PROJECT_ID,
        "startDate": event_start,
        "endDate": event_end,
        "locationBarangay": "Mandalagan",
        "locationVenue": "Barangay Hall Covered Court",
        "volunteersNeeded": 12,
        "applicationDeadline": _iso(now + timedelta(days=3)),
    }
    live_attendance_project = {
        **project,
        "id": LIVE_ATTENDANCE_PROJECT_ID,
        "title": "E2E Live Community Kitchen Support",
        "description": "Live workflow project used for cross-platform volunteer attendance and reporting.",
        "startDate": _iso(now - timedelta(days=1)),
        "endDate": _iso(now + timedelta(days=14)),
        "volunteers": [VOLUNTEER_ID],
        "joinedUserIds": [VOLUNTEER_USER_ID],
    }
    live_attendance_event = {
        **live_attendance_project,
        "id": LIVE_ATTENDANCE_EVENT_ID,
        "title": "E2E Live Kitchen Shift",
        "description": "Started event used for time-in, time-out, and field report workflow.",
        "isEvent": True,
        "parentProjectId": LIVE_ATTENDANCE_PROJECT_ID,
        "startDate": live_start,
        "endDate": live_end,
        "locationVenue": "NVC Kitchen",
        "internalTasks": [
            {
                "id": "e2e-live-task-field-officer",
                "title": "Field officer attendance desk",
                "description": "Confirm attendance and summarize shift completion.",
                "category": "Operations",
                "priority": "High",
                "status": "Assigned",
                "assignedVolunteerId": VOLUNTEER_ID,
                "assignedVolunteerName": "E2E Volunteer Maria Santos",
                "assignedVolunteerIds": [VOLUNTEER_ID],
                "assignedVolunteerNames": ["E2E Volunteer Maria Santos"],
                "volunteersNeeded": 1,
                "isFieldOfficer": True,
                "skillsNeeded": ["Data Collection", "Community Facilitation"],
                "createdAt": created_at,
                "updatedAt": created_at,
            }
        ],
    }
    live_review_project = {
        **project,
        "id": LIVE_REVIEW_PROJECT_ID,
        "title": "E2E Live Volunteer Review Program",
        "description": "Live workflow project used for admin volunteer join approval.",
        "startDate": _iso(now - timedelta(days=1)),
        "endDate": _iso(now + timedelta(days=20)),
        "volunteers": [],
        "joinedUserIds": [],
    }
    live_review_event = {
        **live_review_project,
        "id": LIVE_REVIEW_EVENT_ID,
        "title": "E2E Live Volunteer Review Event",
        "description": "Event with a pending volunteer request for real admin approval.",
        "isEvent": True,
        "parentProjectId": LIVE_REVIEW_PROJECT_ID,
        "startDate": _iso(now + timedelta(days=2)),
        "endDate": _iso(now + timedelta(days=2, hours=4)),
        "locationVenue": "NVC Activity Center",
    }

    return {
        "users": users,
        "partners": partners,
        "volunteers": volunteers,
        "programTracks": [
            {
                "id": "nutrition",
                "title": "Nutrition",
                "description": "Food security and child nutrition programs.",
                "context": "Supports meal distribution, monitoring, and local partner coordination.",
                "icon": "restaurant",
                "color": "#16a34a",
                "sortOrder": 10,
                "isActive": True,
                "createdAt": created_at,
                "updatedAt": created_at,
            }
        ],
        "programs": [project],
        "projects": [project, live_attendance_project, live_review_project],
        "events": [event, live_attendance_event, live_review_event],
        "statusUpdates": [
            {
                "id": "e2e-status-project-1",
                "projectId": PROJECT_ID,
                "status": "In Progress",
                "description": "Admin opened the nutrition program for volunteer applications.",
                "source": "Manual",
                "updatedBy": ADMIN_ID,
                "updatedAt": created_at,
            }
        ],
        "volunteerMatches": [
            {
                "id": VOLUNTEER_MATCH_ID,
                "volunteerId": VOLUNTEER_ID,
                "projectId": EVENT_ID,
                "status": "Matched",
                "requestedAt": _iso(now - timedelta(days=5)),
                "matchedAt": _iso(now - timedelta(days=4)),
                "reviewedAt": _iso(now - timedelta(days=4)),
                "reviewedBy": ADMIN_ID,
                "hoursContributed": 4,
            },
            {
                "id": "e2e-volunteer-match-requested",
                "volunteerId": VOLUNTEER_ID,
                "projectId": PROJECT_ID,
                "status": "Requested",
                "requestedAt": _iso(now - timedelta(days=1)),
                "matchedAt": _iso(now - timedelta(days=1)),
                "hoursContributed": 0,
            },
            {
                "id": LIVE_VOLUNTEER_MATCH_ID,
                "volunteerId": VOLUNTEER_ID,
                "projectId": LIVE_REVIEW_EVENT_ID,
                "status": "Requested",
                "requestedAt": _iso(now - timedelta(minutes=30)),
                "matchedAt": _iso(now - timedelta(minutes=30)),
                "hoursContributed": 0,
            },
        ],
        "volunteerProjectJoins": [
            {
                "id": VOLUNTEER_JOIN_ID,
                "projectId": EVENT_ID,
                "volunteerId": VOLUNTEER_ID,
                "volunteerUserId": VOLUNTEER_USER_ID,
                "volunteerName": "E2E Volunteer Maria Santos",
                "volunteerEmail": "e2e.volunteer@nvc.test",
                "joinedAt": _iso(now - timedelta(days=4)),
                "source": "AdminMatch",
                "participationStatus": "Active",
            }
        ],
        "volunteerTimeLogs": [
            {
                "id": "e2e-time-log-1",
                "volunteerId": VOLUNTEER_ID,
                "projectId": EVENT_ID,
                "timeIn": completed_log_start,
                "timeOut": completed_log_end,
                "note": "Checked in for registration and pack release support.",
                "attendanceConfirmedAt": completed_log_start,
                "attendanceCheckedAt": completed_log_start,
                "attendanceCheckedBy": ADMIN_ID,
                "attendanceCheckedByName": "E2E NVC Program Admin",
                "completionReport": "Completed beneficiary registration and assisted distribution flow.",
            }
        ],
        "partnerProjectApplications": [
            {
                "id": PARTNER_APPLICATION_ID,
                "projectId": PROJECT_ID,
                "partnerUserId": PARTNER_USER_ID,
                "partnerName": "E2E Barangay Nutrition Council",
                "partnerEmail": "e2e.partner@nvc.test",
                "proposalDetails": {
                    "targetProjectId": PROJECT_ID,
                    "targetProjectTitle": "E2E Mingo Meal Distribution Program",
                    "requestedProgramModule": "Nutrition",
                    "proposedTitle": "Expanded nutrition pack distribution support",
                    "proposedDescription": "Partner will coordinate beneficiary lists, venue, and local volunteers.",
                    "proposedStartDate": project_start,
                    "proposedEndDate": project_end,
                    "proposedLocation": "Barangay Hall, Mandalagan, Bacolod City",
                    "proposedVolunteersNeeded": 12,
                    "skillsNeeded": ["Meal Packing", "Community Facilitation"],
                    "communityNeed": "Additional support is needed for families with preschool children.",
                    "expectedDeliverables": "Validated list, distribution photos, and impact report.",
                },
                "status": "Approved",
                "requestedAt": _iso(now - timedelta(days=10)),
                "reviewedAt": _iso(now - timedelta(days=8)),
                "reviewedBy": ADMIN_ID,
                "reviewNotes": "Partner has verified credentials and suitable local coordination capacity.",
            }
        ],
        "partnerReports": [
            {
                "id": PARTNER_REPORT_ID,
                "projectId": PROJECT_ID,
                "partnerId": PARTNER_ID,
                "partnerUserId": PARTNER_USER_ID,
                "partnerName": "E2E Barangay Nutrition Council",
                "submitterUserId": PARTNER_USER_ID,
                "submitterName": "E2E Partner Coordinator",
                "submitterRole": "partner",
                "title": "Week 1 Nutrition Distribution Update",
                "reportType": "program_impact",
                "description": "Prepared beneficiary master list and coordinated distribution venue readiness.",
                "impactCount": 85,
                "metrics": {"familiesServed": 85, "packsPrepared": 85},
                "attachments": [],
                "createdAt": _iso(now - timedelta(days=2)),
                "status": "Submitted",
            },
            {
                "id": VOLUNTEER_REPORT_ID,
                "projectId": EVENT_ID,
                "partnerId": PARTNER_ID,
                "partnerUserId": PARTNER_USER_ID,
                "partnerName": "E2E Barangay Nutrition Council",
                "submitterUserId": VOLUNTEER_USER_ID,
                "submitterName": "E2E Volunteer Maria Santos",
                "submitterRole": "volunteer",
                "title": "Volunteer Attendance and Distribution Report",
                "reportType": "field_report",
                "description": "Verified attendance and supported distribution table flow for beneficiaries.",
                "impactCount": 42,
                "metrics": {"beneficiariesAssisted": 42, "volunteerHours": 4},
                "attachments": [],
                "createdAt": _iso(now - timedelta(days=3)),
                "status": "Submitted",
            },
        ],
        "adminPlanningCalendars": [
            {
                "id": "e2e-calendar-nutrition",
                "name": "E2E Nutrition Operations",
                "color": "#16a34a",
                "description": "Calendar entries for seeded E2E nutrition activities.",
                "planningItems": [],
                "createdAt": created_at,
                "updatedAt": created_at,
            }
        ],
        "adminPlanningItems": [
            {
                "id": "e2e-planning-item-1",
                "title": "Prepare distribution checklist",
                "description": "Confirm beneficiary list, volunteer assignments, and venue layout.",
                "calendarId": "e2e-calendar-nutrition",
                "linkedProjectId": EVENT_ID,
                "startDate": _iso(now + timedelta(days=5)),
                "endDate": _iso(now + timedelta(days=5, hours=2)),
                "location": "NVC Office",
                "participantsLabel": "Admin, partner coordinator, field officer",
                "createdBy": ADMIN_ID,
                "createdAt": created_at,
                "updatedAt": created_at,
            }
        ],
    }


def _upsert_collection(connection: Any, key: str, seeded_items: list[dict[str, Any]], reset_e2e: bool) -> int:
    # ``reset_e2e`` is kept for the CLI contract. These stable upserts reset all
    # canonical E2E records to their intended values without rewriting unrelated
    # production/local rows.
    del reset_e2e
    spec = TABLE_SPECS[key]
    column_names = [column_name for column_name, _ in spec["columns"]]
    placeholders = ["%s" for _ in column_names]
    primary_key_column = _primary_key_column(key)

    for item in seeded_items:
        item_id = str(item.get("id") or "").strip()
        try:
            row = _normalize_row(key, item)
            with connection.cursor() as cursor:
                cursor.execute(
                    f"delete from {spec['table']} where {primary_key_column} = %s",
                    (item_id,),
                )
                cursor.execute(
                    f"""
                    insert into {spec['table']} ({', '.join(column_names)})
                    values ({', '.join(placeholders)})
                    """,
                    row,
                )
            connection.commit()
        except Exception as error:
            connection.rollback()
            raise RuntimeError(f"Failed to seed {key}/{item_id}: {error}") from error
    return len(seeded_items)


def _cleanup_live_workflow_records(connection: Any) -> None:
    cleanup_statements = [
        ("delete from public.volunteer_matches where volunteer_matches_id like 'e2e-live-%'", ()),
        ("delete from public.volunteer_event_joins where volunteer_event_joins_id like 'e2e-live-%'", ()),
        ("delete from public.volunteer_time_logs where volunteer_time_logs_id like 'e2e-live-%'", ()),
        ("delete from public.volunteer_time_logs where volunteer_id = %s and project_id = %s", (VOLUNTEER_ID, LIVE_ATTENDANCE_EVENT_ID)),
        ("delete from public.reports where reports_id like 'e2e-live-%'", ()),
        (
            """
            delete from public.partner_project_applications
            where partner_user_id = %s
              and (
                project_id like 'program:Education%%'
                or proposal_details like '%%E2E Live Partner Education Outreach%%'
                or proposal_details like '%%"requestedProgramModule": "Education"%%'
              )
            """,
            (PARTNER_USER_ID,),
        ),
        ("delete from public.projects where title like 'E2E Live Partner%'", ()),
        ("delete from public.messages where id like 'e2e-live-%' or id like 'msg-proposal-%' or id like 'review-card-%'", ()),
    ]
    with connection.cursor() as cursor:
        for statement, params in cleanup_statements:
            try:
                cursor.execute(statement, params)
            except Exception:
                connection.rollback()
            else:
                connection.commit()


def seed_realistic_e2e_data(reset_e2e: bool = False) -> dict[str, int]:
    seed_storage = build_realistic_e2e_storage()
    written_counts: dict[str, int] = {}
    skipped_schema_variant_keys = {"programs", "programTracks"}

    with get_postgres_connection() as connection:
        ensure_relational_mirror_tables(connection)
        # Some optional schema-maintenance helpers intentionally swallow errors.
        # Clear any aborted transaction before writing seed records.
        connection.rollback()
        if reset_e2e:
            _cleanup_live_workflow_records(connection)
        for key, items in seed_storage.items():
            if key not in HOT_STORAGE_TABLES or key in skipped_schema_variant_keys:
                continue
            written_counts[key] = _upsert_collection(connection, key, items, reset_e2e)
        connection.commit()

    return written_counts


def main() -> None:
    parser = argparse.ArgumentParser(description="Populate realistic local E2E data.")
    parser.add_argument(
        "--reset-e2e",
        action="store_true",
        help="Remove existing e2e-* records before writing the canonical seed.",
    )
    args = parser.parse_args()
    counts = seed_realistic_e2e_data(reset_e2e=args.reset_e2e)
    summary = ", ".join(f"{key}={count}" for key, count in sorted(counts.items()))
    print(f"Realistic E2E seed data populated: {summary}")


if __name__ == "__main__":
    main()

