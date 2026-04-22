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
- Purpose: Stores both program-level records and event-level records.
- Used for: project lifecycle, scheduling, locations, volunteer requirements, and status progression.
- Key links: linked from status updates, matches, joins, reports, and group messages.

### 5) status_updates
- Purpose: Stores timeline/status change entries for projects.
- Used for: project progress feed and historical status tracking.
- Key links: references `project_id`.

### 6) volunteer_matches
- Purpose: Stores volunteer-to-project matching requests and outcomes.
- Used for: assignment workflow, review/approval flow, and contributed hours accounting.
- Key links: references `volunteer_id` and `project_id`.

### 7) volunteer_time_logs
- Purpose: Stores volunteer attendance/time-in and time-out logs plus completion notes.
- Used for: attendance validation, contribution reporting, and completion evidence.
- Key links: references `volunteer_id` and `project_id`.

### 8) volunteer_project_joins
- Purpose: Stores explicit join records between volunteers and projects.
- Used for: participation roster management and completion tracking.
- Key links: references project and volunteer identity fields.

### 9) partner_project_applications
- Purpose: Stores partner requests/applications for project participation and their review state.
- Used for: partner request approval and project participation governance.
- Key links: references `project_id` and `partner_user_id`.

### 10) partner_event_check_ins
- Purpose: Stores partner check-in records for events, including GPS coordinates.
- Used for: on-site participation validation and event presence tracking.
- Key links: references project and partner identity fields.

### 11) partner_reports
- Purpose: Stores submitted reports from partners (and report metadata).
- Used for: project/event reporting, impact metrics capture, and review workflow.
- Key links: references `project_id`, partner identity fields, and submitter fields.

### 12) published_impact_reports
- Purpose: Stores publication records for finalized impact reports.
- Used for: report publishing history and generated report file tracking.
- Key links: references `project_id`.

### 13) messages
- Purpose: Stores direct (user-to-user) chat messages.
- Used for: one-to-one communication and message read state handling.
- Key links: `sender_id` and `recipient_id` reference `users(id)`.

### 14) project_group_messages
- Purpose: Stores project group chat messages and structured proposal/resolution messages.
- Used for: project coordination, scope proposals, and threaded response actions.
- Key links: `sender_id` references `users(id)`, scoped by `project_id`.

### 15) admin_planning_calendars
- Purpose: Stores admin calendar definitions.
- Used for: planning calendar setup and calendar-level organization.
- Key links: parent table for planning items.

### 16) admin_planning_items
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
- app_partner_event_check_ins_store
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
- volunteers -> volunteers
- statusUpdates -> status_updates
- volunteerMatches -> volunteer_matches
- volunteerTimeLogs -> volunteer_time_logs
- volunteerProjectJoins -> volunteer_project_joins
- partnerProjectApplications -> partner_project_applications
- partnerEventCheckIns -> partner_event_check_ins
- partnerReports -> partner_reports
- publishedImpactReports -> published_impact_reports
- adminPlanningCalendars -> admin_planning_calendars
- adminPlanningItems -> admin_planning_items
- messages -> messages
- projectGroupMessages -> project_group_messages
