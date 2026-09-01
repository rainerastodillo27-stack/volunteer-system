"""Shared storage table contract for the Volunteer System backend.

Canonical operational tables are the source of truth used by the running app.
Legacy compatibility tables remain optional mirrors for older maintenance and
migration workflows.
"""

CANONICAL_STORAGE_TABLES = {
    "users": "users",
    "partners": "partners",
    "projects": "projects",
    "programs": "programs",
    "events": "events",
    "volunteers": "volunteers",
    "statusUpdates": "status_updates",
    "volunteerMatches": "volunteer_matches",
    "volunteerTimeLogs": "volunteer_time_logs",
    "volunteerProjectJoins": "volunteer_event_joins",
    "partnerProjectApplications": "partner_project_applications",
    "partnerReports": "reports",
    # Published and unpublished reports share one normalized table and are
    # separated by reports.generated_at.
    "publishedImpactReports": "reports",
    "adminPlanningCalendars": "admin_planning_calendars",
}

LEGACY_COMPAT_STORAGE_TABLES = {}

MESSAGE_STORAGE_TABLES = {
    "messages": "messages",
    "projectGroupMessages": "project_group_messages",
}

LEGACY_AUXILIARY_TABLES = ()

# Normalized lookup/index tables maintained from canonical project and
# volunteer records, plus operational scheduler state.
DERIVED_TABLES = ("skills", "tasks")
RUNTIME_SUPPORT_TABLES = ("event_email_reminders",)

# These tables are not part of the supported schema contract and can be removed
# when they appear. Keep this list intentionally narrow to avoid dropping legacy
# compatibility tables that are still referenced by maintenance workflows.
DEPRECATED_STORAGE_TABLES = (
    "app_storage",
    "app_users",
    "app_users_store",
    "app_partners_store",
    "app_projects_store",
    "app_volunteers_store",
    "app_status_updates_store",
    "app_volunteer_matches_store",
    "app_volunteer_time_logs_store",
    "app_volunteer_project_joins_store",
    "app_partner_project_applications_store",
    "app_partner_event_check_ins_store",
    "app_partner_reports_store",
    "app_published_impact_reports_store",
    "partner_event_check_ins",
    "partner_reports",
    "published_impact_reports",
    "team_members",
    "admin_planning_items",
    "program_tracks",
)

KNOWN_ROGUE_TABLES = (
    "Volunteer management System",
    "team_members",
    "volunteer_project_joins",
)
