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
    "publishedImpactReports": "reports",
    "adminPlanningCalendars": "admin_planning_calendars",
    "adminPlanningItems": "admin_planning_items",
}

LEGACY_COMPAT_STORAGE_TABLES = {}

MESSAGE_STORAGE_TABLES = {
    "messages": "messages",
    "projectGroupMessages": "project_group_messages",
}

LEGACY_AUXILIARY_TABLES = ()

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
)

KNOWN_ROGUE_TABLES = (
    "Volunteer management System",
    "team_members",
    "volunteer_project_joins",
)
