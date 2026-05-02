# Database Tables and Their Uses

This document describes the database tables used by the Volunteer System backend.

## Scope and source of truth

The canonical operational schema is defined primarily in:
- `backend/relational_mirror.py`
- `backend/api.py` (message tables)
- `backend/init_supabase.py` (bootstrap)

System maintenance and compatibility logic references legacy tables in:
- `backend/schema_maintenance.py`
- `backend/consolidate_schema.py`
- `backend/data_archival.py`

## Canonical operational tables

These are the primary tables used by the running system.

### 1) users
- Purpose: Stores all platform user accounts (admin, volunteer, partner).
- Used for: authentication, identity, user profile basics, role-based access.
- Key links: referenced by `messages.sender_id`, `messages.recipient_id`, and `project_group_messages.sender_id`.

### 2) partners
- Purpose: Stores partner organization records and verification data.
- Used for: partner onboarding, accreditation tracking, and partner profile management.
- Key links: referenced by projects and partner-related workflows.

### 3) volunteers
- Purpose: Stores volunteer profile, availability, background, and engagement details.
- Used for: volunteer registration, matching, status review, and participation tracking.
- Key links: associated with users via `user_id`.

### 4) projects
- Purpose: Stores top-level operational project records that represent programs in the main workflow.
- Used for: project lifecycle, scheduling, locations, volunteer requirements, and status progression.
- Key links: linked from status updates, matches, joins, reports, and group messages.
- **skills_needed**: JSONB column containing an array of skill strings required for the project as a whole.
- **Internal Tasks Structure**: The `internal_tasks` JSONB column contains an array of task objects with the following structure (see section 6 for detailed structure definition). Projects with `is_event = true` use this field for event-specific task assignment.

### 5) programs
- Purpose: Stores a dedicated program table synchronized from top-level `projects` rows where `is_event = false`.
- Used for: program-only reporting, cleaner querying, and schema-safe separation of program records from event rows.
- Key links: mirrors program/project identity through `id`, keeps `partner_id`, `program_module`, schedule, volunteer metadata, and `linked_event_count`.

### 6) events
- Purpose: Stores event-level records linked to programs through `parent_project_id`.
- Used for: event scheduling, volunteer deployment, internal task assignment, and event-specific participation tracking.
- Key links: linked back to the owning program via `parent_project_id`.
- **skills_needed**: JSONB column containing an array of skill strings required for the event as a whole.
- **Internal Tasks Structure**: The `internal_tasks` JSONB column contains an array of task objects with the following structure:
  ```json
  {
    "id": "string (unique task ID)",
    "title": "string (task name)",
    "description": "string (task details)",
    "category": "string (e.g., 'Field Officer', 'Logistics', 'Front Desk')",
    "priority": "High | Medium | Low",
    "status": "Unassigned | Assigned | In Progress | Completed",
    "assignedVolunteerId": "string (optional, volunteer profile ID)",
    "assignedVolunteerName": "string (optional, volunteer name)",
    "isFieldOfficer": "boolean (optional, true if task requires field officer role)",
    "skillsNeeded": ["array of skill strings (required for matching volunteers)"],
    "createdAt": "string (ISO timestamp)",
    "updatedAt": "string (ISO timestamp)"
  }
  ```
  - **skillsNeeded**: Required array of skill identifiers needed for this task. Used to match qualified volunteers during task assignment.

### 7) status_updates
- Purpose: Stores timeline/status change entries for projects.
- Used for: project progress feed and historical status tracking.
- Key links: references `project_id`.

### 8) volunteer_matches
- Purpose: Stores volunteer-to-project matching requests and outcomes.
- Used for: assignment workflow, review/approval flow, and contributed hours accounting.
- Key links: references `volunteer_id` and `project_id`.

### 9) volunteer_time_logs
- Purpose: Stores volunteer attendance/time-in and time-out logs plus completion notes.
- Used for: attendance validation, contribution reporting, and completion evidence.
- Key links: references `volunteer_id` and `project_id`.

### 10) volunteer_event_joins
- Purpose: Stores explicit join records between volunteers and projects.
- Used for: participation roster management and completion tracking.
- Key links: references project and volunteer identity fields.

### 11) partner_project_applications
- Purpose: Stores partner requests/applications for project participation and their review state.
- Used for: partner request approval and project participation governance.
- Key links: references `project_id` and `partner_user_id`.

### 12) retired partner check-ins
- The partner event check-in table was removed from the active schema.

### 13) reports
- Purpose: Stores submitted reports from partners, volunteers, field submissions, and published impact file records.
- Used for: project/event reporting, impact metrics capture, review workflow, field report history, and published report tracking.
- Key links: references `project_id`, partner identity fields, submitter fields, `report_type`, and generated impact file metadata.

### 14) messages
- Purpose: Stores direct (user-to-user) chat messages.
- Used for: one-to-one communication and message read state handling.
- Key links: `sender_id` and `recipient_id` reference `users(id)`.

### 15) project_group_messages
- Purpose: Stores project group chat messages and structured proposal/resolution messages.
- Used for: project coordination, scope proposals, and threaded response actions.
- Key links: `sender_id` references `users(id)`, scoped by `project_id`.

### 16) admin_planning_calendars
- Purpose: Stores admin calendar definitions.
- Used for: planning calendar setup and calendar-level organization.
- Key links: parent table for planning items.

### 17) admin_planning_items
- Purpose: Stores scheduled planning items/events under admin calendars.
- Used for: planning/scheduling operations and optional linking to projects.
- Key links: references `calendar_id` and optionally `linked_project_id`.

## Legacy and compatibility tables

These tables are retained for migration/compatibility in some environments and scripts. They are not the canonical target schema.

### app_users
- Purpose: Legacy user table from earlier schema versions.
- Current use: read/migrate/prune path in maintenance and consolidation scripts.

### app_storage
- Purpose: Legacy key-value JSON storage table (`key`, `value`).
- Current use: backward compatibility fallback and migration source in consolidation logic.

### Deprecated canonical report tables
- partner_reports
- published_impact_reports

Purpose:
- Older canonical report tables used before consolidating all report records into `reports`.

Current use:
- Migration source only. Rows are migrated into `reports` during schema maintenance.

### Legacy hot-storage `app_*_store` tables
- app_users_store
- app_partners_store
- app_projects_store
- app_volunteers_store
- app_status_updates_store
- app_volunteer_matches_store
- app_volunteer_time_logs_store
- app_volunteer_project_joins_store
- app_partner_project_applications_store
- app_partner_reports_store
- app_published_impact_reports_store

Purpose:
- Legacy per-collection row storage used by older app-storage implementations.

Current use:
- Sanitization, retention cleanup, max-record enforcement, and migration support in maintenance scripts.
- Some instances are cleaned or dropped during schema consolidation.

## Notes on data lifecycle and maintenance

- Data quality constraints are applied across both canonical and selected legacy tables by `schema_maintenance.py`.
- Retention and max-record policies in `data_archival.py` primarily target legacy `app_*_store` tables and selected high-growth messaging tables.
- Consolidation scripts migrate legacy data into canonical tables and remove deprecated structures when safe.

## Quick mapping from app collections to canonical tables

- users -> users
- partners -> partners
- projects -> projects
- programs -> programs
- events -> events
- volunteers -> volunteers
- statusUpdates -> status_updates
- volunteerMatches -> volunteer_matches
- volunteerTimeLogs -> volunteer_time_logs
- volunteerProjectJoins -> volunteer_event_joins
- partnerProjectApplications -> partner_project_applications
- partnerReports -> reports
- publishedImpactReports -> reports
- adminPlanningCalendars -> admin_planning_calendars
- adminPlanningItems -> admin_planning_items
- messages -> messages
- projectGroupMessages -> project_group_messages
