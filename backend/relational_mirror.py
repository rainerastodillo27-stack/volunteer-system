import json
import os
from typing import Any


JSON_ARRAY = "'[]'"
JSON_OBJECT = "'{}'"
TEXT_ARRAY = "'{}'::text[]"
TRACE_STORAGE = str(os.getenv("VOLCRE_TRACE_STORAGE", "")).strip().lower() in {"1", "true", "yes", "on"}


def _trace(message: str) -> None:
    if TRACE_STORAGE:
        print(message)


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
      pillars_of_interest text[] not null default {TEXT_ARRAY},
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
      advocacy_focus text[] not null default {TEXT_ARRAY},
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
      registration_documents text not null default {JSON_ARRAY}
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
      skills text[] not null default {TEXT_ARRAY},
      skills_description text,
      availability text not null default {JSON_OBJECT},
      past_projects text[] not null default {TEXT_ARRAY},
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
      affiliations text not null default {JSON_ARRAY},
      registration_status text,
      reviewed_by text,
      reviewed_at text,
      credentials_unlocked_at text,
      created_at text
    )
    """,
    "create index if not exists volunteers_user_id_idx on volunteers (user_id)",
    "create unique index if not exists volunteers_user_id_unique_idx on volunteers (user_id) where user_id is not null",
    "create index if not exists volunteers_registration_status_idx on volunteers (registration_status)",
    "create index if not exists volunteers_engagement_status_idx on volunteers (engagement_status)",
    "create index if not exists volunteers_created_at_idx on volunteers (created_at)",
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
      image_url text,
      image_hidden boolean not null default false,
      program_module text,
      is_event boolean not null default false,
      parent_project_id text,
      status_mode text,
      manual_status text,
      status text,
      category text,
      start_date text,
      end_date text,
      location text not null default {JSON_OBJECT},
      volunteers_needed integer not null default 0,
      volunteers text[] not null default {TEXT_ARRAY},
      joined_user_ids text[] not null default {TEXT_ARRAY},
      skills_needed text[] not null default {TEXT_ARRAY},
      internal_tasks text not null default {JSON_ARRAY},
      created_at text,
      updated_at text
    )
    """,
    """
    do $$
    begin
      if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public' and table_name = 'projects' and column_name = 'project_id'
      ) and not exists (
        select 1
        from information_schema.columns
        where table_schema = 'public' and table_name = 'projects' and column_name = 'id'
      ) then
        alter table projects rename column project_id to id;
      end if;
    end $$;
    """,
    """
    do $$
    begin
      if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public' and table_name = 'projects' and column_name = 'id'
      ) then
        alter table projects alter column id drop identity if exists;
        alter table projects alter column id type text using id::text;
      end if;
      if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public' and table_name = 'projects' and column_name = 'created_at'
      ) then
        alter table projects alter column created_at type text using created_at::text;
      end if;
    end $$;
    """,
    "alter table projects add column if not exists title text not null default ''",
    "alter table projects add column if not exists description text",
    "alter table projects add column if not exists partner_id text",
    "alter table projects add column if not exists program_module text",
    "alter table projects add column if not exists is_event boolean not null default false",
    "alter table projects add column if not exists parent_project_id text",
    "alter table projects add column if not exists image_url text",
    "alter table projects add column if not exists image_hidden boolean not null default false",
    "alter table projects add column if not exists status_mode text",
    "alter table projects add column if not exists manual_status text",
    "alter table projects add column if not exists status text",
    "alter table projects add column if not exists category text",
    "alter table projects add column if not exists start_date text",
    "alter table projects add column if not exists end_date text",
    "alter table projects add column if not exists location text not null default '{}'",
    "alter table projects add column if not exists volunteers_needed integer not null default 0",
    "alter table projects add column if not exists volunteers text[] not null default '{}'::text[]",
    "alter table projects add column if not exists joined_user_ids text[] not null default '{}'::text[]",
    "alter table projects add column if not exists internal_tasks text not null default '[]'",
    "alter table projects add column if not exists skills_needed text[] not null default '{}'::text[]",
    "alter table projects add column if not exists updated_at text",
    "alter table projects alter column updated_at type text using updated_at::text",
    "create index if not exists projects_partner_id_idx on projects (partner_id)",
    "create index if not exists projects_parent_project_id_idx on projects (parent_project_id)",
    "create index if not exists projects_status_idx on projects (status)",
    "create index if not exists projects_category_idx on projects (category)",
    "create index if not exists projects_created_at_idx on projects (created_at)",
    f"""
    create table if not exists programs (
      id text primary key,
      title text not null,
      description text,
      partner_id text,
      image_url text,
      image_hidden boolean not null default false,
      program_module text,
      status_mode text,
      manual_status text,
      status text,
      category text,
      start_date text,
      end_date text,
      location text not null default {JSON_OBJECT},
      volunteers_needed integer not null default 0,
      volunteers text[] not null default {TEXT_ARRAY},
      joined_user_ids text[] not null default {TEXT_ARRAY},
      linked_event_count integer not null default 0,
      created_at text,
      updated_at text
    )
    """,
    """
    do $$
    begin
      if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public' and table_name = 'programs' and column_name = 'program_id'
      ) and not exists (
        select 1
        from information_schema.columns
        where table_schema = 'public' and table_name = 'programs' and column_name = 'id'
      ) then
        alter table programs rename column program_id to id;
      end if;
    end $$;
    """,
    """
    do $$
    begin
      if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public' and table_name = 'programs' and column_name = 'id'
      ) then
        alter table programs alter column id drop identity if exists;
        alter table programs alter column id type text using id::text;
      end if;
      if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public' and table_name = 'programs' and column_name = 'created_at'
      ) then
        alter table programs alter column created_at type text using created_at::text;
      end if;
    end $$;
    """,
    "alter table programs add column if not exists title text not null default ''",
    "alter table programs add column if not exists description text",
    "alter table programs add column if not exists partner_id text",
    "alter table programs add column if not exists image_url text",
    "alter table programs add column if not exists image_hidden boolean not null default false",
    "alter table programs add column if not exists program_module text",
    "alter table programs add column if not exists status_mode text",
    "alter table programs add column if not exists manual_status text",
    "alter table programs add column if not exists status text",
    "alter table programs add column if not exists category text",
    "alter table programs add column if not exists start_date text",
    "alter table programs add column if not exists end_date text",
    "alter table programs add column if not exists location text not null default '{}'",
    "alter table programs add column if not exists volunteers_needed integer not null default 0",
    "alter table programs add column if not exists volunteers text[] not null default '{}'::text[]",
    "alter table programs add column if not exists joined_user_ids text[] not null default '{}'::text[]",
    "alter table programs add column if not exists linked_event_count integer not null default 0",
    "alter table programs add column if not exists updated_at text",
    "alter table programs alter column updated_at type text using updated_at::text",
    "create index if not exists programs_partner_id_idx on programs (partner_id)",
    "create index if not exists programs_program_module_idx on programs (program_module)",
    "create index if not exists programs_category_idx on programs (category)",
    "create index if not exists programs_status_idx on programs (status)",
    "create index if not exists programs_created_at_idx on programs (created_at)",
    f"""
    create table if not exists program_tracks (
      id text primary key,
      title text not null,
      description text,
      icon text,
      color text,
      image_url text,
      sort_order integer not null default 0,
      is_active boolean not null default true,
      created_at text,
      updated_at text
    )
    """,
    "create index if not exists program_tracks_sort_order_idx on program_tracks (sort_order)",
    "create index if not exists program_tracks_is_active_idx on program_tracks (is_active)",
    f"""
    create table if not exists events (
      id text primary key,
      title text not null,
      description text,
      partner_id text,
      image_url text,
      image_hidden boolean not null default false,
      program_module text,
      is_event boolean not null default true,
      parent_project_id text,
      status_mode text,
      manual_status text,
      status text,
      category text,
      start_date text,
      end_date text,
      location text not null default {JSON_OBJECT},
      volunteers_needed integer not null default 0,
      volunteers text[] not null default {TEXT_ARRAY},
      joined_user_ids text[] not null default {TEXT_ARRAY},
      skills_needed text[] not null default {TEXT_ARRAY},
      internal_tasks text not null default {JSON_ARRAY},
      created_at text,
      updated_at text
    )
    """,
    "alter table events add column if not exists is_event boolean not null default true",
    "alter table events add column if not exists parent_project_id text",
    "alter table events add column if not exists image_url text",
    "alter table events add column if not exists image_hidden boolean not null default false",
    "alter table events add column if not exists status_mode text",
    "alter table events add column if not exists manual_status text",
    "alter table events add column if not exists internal_tasks text not null default '[]'",
    "alter table events add column if not exists skills_needed text[] not null default '{}'::text[]",
    "create index if not exists events_partner_id_idx on events (partner_id)",
    "create index if not exists events_parent_project_id_idx on events (parent_project_id)",
    "create index if not exists events_status_idx on events (status)",
    "create index if not exists events_category_idx on events (category)",
    "create index if not exists events_created_at_idx on events (created_at)",
    f"""
    create table if not exists status_updates (
      id text primary key,
      project_id text,
      status text,
      source text,
      description text,
      updated_by text,
      updated_at text
    )
    """,
    "alter table status_updates add column if not exists source text",
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
    "create index if not exists volunteer_matches_status_idx on volunteer_matches (status)",
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
    "create index if not exists volunteer_time_logs_time_in_idx on volunteer_time_logs (time_in)",
    """
    do $$
    begin
      if exists (
        select 1
        from information_schema.tables
        where table_schema = 'public' and table_name = 'volunteer_project_joins'
      ) and not exists (
        select 1
        from information_schema.tables
        where table_schema = 'public' and table_name = 'volunteer_event_joins'
      ) then
        alter table volunteer_project_joins rename to volunteer_event_joins;
      end if;
    end $$;
    """,
    f"""
    create table if not exists volunteer_event_joins (
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
    "create index if not exists volunteer_event_joins_project_id_idx on volunteer_event_joins (project_id)",
    "create index if not exists volunteer_event_joins_volunteer_id_idx on volunteer_event_joins (volunteer_id)",
    f"""
    create table if not exists partner_project_applications (
      id text primary key,
      project_id text,
      partner_user_id text,
      partner_name text,
      partner_email text,
      proposal_details text not null default {JSON_OBJECT},
      status text,
      requested_at text,
      reviewed_at text,
      reviewed_by text
    )
    """,
    "alter table partner_project_applications add column if not exists proposal_details text not null default '{}'",
    "create index if not exists partner_project_applications_project_id_idx on partner_project_applications (project_id)",
    "create index if not exists partner_project_applications_partner_user_id_idx on partner_project_applications (partner_user_id)",
    "create index if not exists partner_project_applications_status_idx on partner_project_applications (status)",
    "create index if not exists partner_project_applications_requested_at_idx on partner_project_applications (requested_at)",
    f"""
    create table if not exists reports (
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
      metrics text not null default {JSON_OBJECT},
      attachments text not null default {JSON_ARRAY},
      media_file text,
      created_at text,
      status text,
      reviewed_at text,
      reviewed_by text,
      generated_by text,
      generated_at text,
      report_file text,
      format text,
      published_at text,
      download_content text,
      download_mime_type text,
      source_report_ids text[] not null default {TEXT_ARRAY}
    )
    """,
    "create index if not exists reports_project_id_idx on reports (project_id)",
    "create index if not exists reports_partner_user_id_idx on reports (partner_user_id)",
    "create index if not exists reports_generated_at_idx on reports (generated_at)",
    "create index if not exists reports_status_idx on reports (status)",
    "alter table reports add column if not exists submitter_user_id text",
    "alter table reports add column if not exists submitter_name text",
    "alter table reports add column if not exists submitter_role text",
    "alter table reports add column if not exists title text",
    "alter table reports add column if not exists metrics text not null default '{}'",
    "alter table reports add column if not exists attachments text not null default '[]'",
    "alter table reports add column if not exists generated_by text",
    "alter table reports add column if not exists generated_at text",
    "alter table reports add column if not exists report_file text",
    "alter table reports add column if not exists format text",
    "alter table reports add column if not exists published_at text",
    "alter table reports add column if not exists download_content text",
    "alter table reports add column if not exists download_mime_type text",
    "alter table reports add column if not exists source_report_ids text[] not null default '{}'::text[]",
    f"""
    create table if not exists admin_planning_calendars (
      id text primary key,
      name text not null,
      color text not null,
      description text,
            planning_items text not null default {JSON_ARRAY},
      created_at text not null,
      updated_at text not null
    )
    """,
        "alter table admin_planning_calendars add column if not exists planning_items text not null default '[]'",
    "create index if not exists admin_planning_calendars_created_at_idx on admin_planning_calendars (created_at)",
    "create index if not exists admin_planning_calendars_updated_at_idx on admin_planning_calendars (updated_at)",
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
            ("pillars_of_interest", False),
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
            ("advocacy_focus", False),
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
            ("registration_documents", False),
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
            ("skills", False),
            ("skills_description", False),
            ("availability", False),
            ("past_projects", False),
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
            ("affiliations", False),
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
            ("image_url", False),
            ("image_hidden", False),
            ("program_module", False),
            ("is_event", False),
            ("parent_project_id", False),
            ("status_mode", False),
            ("manual_status", False),
            ("status", False),
            ("category", False),
            ("start_date", False),
            ("end_date", False),
            ("location", False),
            ("volunteers_needed", False),
            ("volunteers", False),
            ("joined_user_ids", False),
            ("skills_needed", False),
            ("internal_tasks", False),
            ("created_at", False),
            ("updated_at", False),
        ],
    },
    "programs": {
        "table": "programs",
        "columns": [
            ("id", False),
            ("title", False),
            ("description", False),
            ("partner_id", False),
            ("image_url", False),
            ("image_hidden", False),
            ("program_module", False),
            ("status_mode", False),
            ("manual_status", False),
            ("status", False),
            ("category", False),
            ("start_date", False),
            ("end_date", False),
            ("location", False),
            ("volunteers_needed", False),
            ("volunteers", False),
            ("joined_user_ids", False),
            ("linked_event_count", False),
            ("created_at", False),
            ("updated_at", False),
        ],
    },
    "programTracks": {
        "table": "program_tracks",
        "columns": [
            ("id", False),
            ("title", False),
            ("description", False),
            ("icon", False),
            ("color", False),
            ("image_url", False),
            ("sort_order", False),
            ("is_active", False),
            ("created_at", False),
            ("updated_at", False),
        ],
    },
    "events": {
        "table": "events",
        "columns": [
            ("id", False),
            ("title", False),
            ("description", False),
            ("partner_id", False),
            ("image_url", False),
            ("image_hidden", False),
            ("program_module", False),
            ("is_event", False),
            ("parent_project_id", False),
            ("status_mode", False),
            ("manual_status", False),
            ("status", False),
            ("category", False),
            ("start_date", False),
            ("end_date", False),
            ("location", False),
            ("volunteers_needed", False),
            ("volunteers", False),
            ("joined_user_ids", False),
            ("skills_needed", False),
            ("internal_tasks", False),
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
            ("source", False),
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
        "table": "volunteer_event_joins",
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
            ("proposal_details", False),
            ("status", False),
            ("requested_at", False),
            ("reviewed_at", False),
            ("reviewed_by", False),
        ],
    },
    "partnerReports": {
        "table": "reports",
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
            ("metrics", False),
            ("attachments", False),
            ("media_file", False),
            ("created_at", False),
            ("status", False),
            ("reviewed_at", False),
            ("reviewed_by", False),
        ],
    },
    "publishedImpactReports": {
        "table": "reports",
        "columns": [
            ("id", False),
            ("project_id", False),
            ("generated_by", False),
            ("generated_at", False),
            ("report_file", False),
            ("format", False),
            ("published_at", False),
            ("download_content", False),
            ("download_mime_type", False),
            ("source_report_ids", False),
        ],
    },
    "adminPlanningCalendars": {
        "table": "admin_planning_calendars",
        "columns": [
            ("id", False),
            ("name", False),
            ("color", False),
            ("description", False),
            ("planning_items", False),
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
    "projects": {
        "partnerId": "partner_id",
        "imageUrl": "image_url",
        "imageHidden": "image_hidden",
        "programModule": "program_module",
        "isEvent": "is_event",
        "parentProjectId": "parent_project_id",
        "statusMode": "status_mode",
        "manualStatus": "manual_status",
        "startDate": "start_date",
        "endDate": "end_date",
        "volunteersNeeded": "volunteers_needed",
        "joinedUserIds": "joined_user_ids",
        "skillsNeeded": "skills_needed",
        "internalTasks": "internal_tasks",
        "createdAt": "created_at",
        "updatedAt": "updated_at",
    },
    "programs": {
        "partnerId": "partner_id",
        "imageUrl": "image_url",
        "imageHidden": "image_hidden",
        "programModule": "program_module",
        "statusMode": "status_mode",
        "manualStatus": "manual_status",
        "startDate": "start_date",
        "endDate": "end_date",
        "volunteersNeeded": "volunteers_needed",
        "joinedUserIds": "joined_user_ids",
        "linkedEventCount": "linked_event_count",
        "createdAt": "created_at",
        "updatedAt": "updated_at",
    },
    "programTracks": {
        "imageUrl": "image_url",
        "sortOrder": "sort_order",
        "isActive": "is_active",
        "createdAt": "created_at",
        "updatedAt": "updated_at",
    },
    "events": {
        "partnerId": "partner_id",
        "imageUrl": "image_url",
        "imageHidden": "image_hidden",
        "programModule": "program_module",
        "isEvent": "is_event",
        "parentProjectId": "parent_project_id",
        "statusMode": "status_mode",
        "manualStatus": "manual_status",
        "startDate": "start_date",
        "endDate": "end_date",
        "volunteersNeeded": "volunteers_needed",
        "joinedUserIds": "joined_user_ids",
        "skillsNeeded": "skills_needed",
        "internalTasks": "internal_tasks",
        "createdAt": "created_at",
        "updatedAt": "updated_at",
    },
    "volunteers": {"userId": "user_id"},
    "statusUpdates": {
        "projectId": "project_id",
        "updatedBy": "updated_by",
        "updatedAt": "updated_at",
    },
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
        "proposalDetails": "proposal_details",
        "requestedAt": "requested_at",
        "reviewedAt": "reviewed_at",
        "reviewedBy": "reviewed_by",
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
        "downloadContent": "download_content",
        "downloadMimeType": "download_mime_type",
        "sourceReportIds": "source_report_ids",
        "publishedAt": "published_at",
    },
    "adminPlanningCalendars": {
        "planningItems": "planning_items",
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


def _table_primary_key_column(table_name: str) -> str:
    return f"{table_name}_id"


def _primary_key_column(key: str) -> str:
    spec = TABLE_SPECS[key]
    return _table_primary_key_column(spec["table"])


for _spec in TABLE_SPECS.values():
    if _spec["columns"] and _spec["columns"][0][0] == "id":
        _spec["columns"][0] = (_table_primary_key_column(_spec["table"]), _spec["columns"][0][1])


def _json_dump(value: Any, default: Any) -> str:
    if value is None:
        value = default
    return json.dumps(value)


def _json_load(value: Any, default: Any) -> Any:
    if value is None:
        return default
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        raw_value = value.strip()
        if not raw_value:
            return default
        try:
            parsed = json.loads(raw_value)
        except (TypeError, ValueError, json.JSONDecodeError):
            return default
        return default if parsed is None else parsed
    return default


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


def _normalize_string_list(value: Any) -> list[str]:
    if not isinstance(value, (list, tuple)):
        return []
    normalized: list[str] = []
    for item in value:
        if not isinstance(item, str):
            continue
        trimmed = item.strip()
        if trimmed:
            normalized.append(trimmed)
    return normalized


def _normalize_short_id(value: Any, prefix: str) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    if len(raw) <= 64:
        return raw

    hash_value = 2166136261
    for char in raw:
        hash_value ^= ord(char)
        hash_value = (hash_value * 16777619) & 0xFFFFFFFF
    return f"{prefix}-{format(hash_value, 'x')}"


def _normalize_skills_needed(item: dict[str, Any]) -> list[str]:
    skills = [skill for skill in (item.get("skillsNeeded") or []) if isinstance(skill, str)]
    internal_tasks = item.get("internalTasks") or []
    if isinstance(internal_tasks, list):
        for task in internal_tasks:
            if isinstance(task, dict):
                skills.extend([skill for skill in (task.get("skillsNeeded") or []) if isinstance(skill, str)])

    normalized: list[str] = []
    seen: set[str] = set()
    for skill in skills:
        trimmed = skill.strip()
        if not trimmed:
            continue
        key = trimmed.lower()
        if key in seen:
            continue
        seen.add(key)
        normalized.append(trimmed)
    return normalized


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
            _normalize_string_list(item.get("pillarsOfInterest")),
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
            _normalize_string_list(item.get("advocacyFocus")),
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
            _normalize_string_list(item.get("skills")),
            item.get("skillsDescription"),
            _json_dump(item.get("availability"), {}),
            _normalize_string_list(item.get("pastProjects")),
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
            item.get("imageUrl"),
            bool(item.get("imageHidden", False)),
            item.get("programModule"),
            bool(item.get("isEvent", False)),
            item.get("parentProjectId"),
            item.get("statusMode"),
            item.get("manualStatus"),
            item.get("status"),
            item.get("category"),
            item.get("startDate"),
            item.get("endDate"),
            _json_dump(item.get("location"), {}),
            _to_int(item.get("volunteersNeeded")),
            _normalize_string_list(item.get("volunteers")),
            _normalize_string_list(item.get("joinedUserIds")),
            _normalize_skills_needed(item),
            _json_dump(item.get("internalTasks"), []),
            item.get("createdAt"),
            item.get("updatedAt"),
        )

    if key == "programs":
        return (
            item.get("id"),
            item.get("title") or "",
            item.get("description"),
            item.get("partnerId"),
            item.get("imageUrl"),
            bool(item.get("imageHidden", False)),
            item.get("programModule"),
            item.get("statusMode"),
            item.get("manualStatus"),
            item.get("status"),
            item.get("category"),
            item.get("startDate"),
            item.get("endDate"),
            _json_dump(item.get("location"), {}),
            _to_int(item.get("volunteersNeeded")),
            _normalize_string_list(item.get("volunteers")),
            _normalize_string_list(item.get("joinedUserIds")),
            _to_int(item.get("linkedEventCount")),
            item.get("createdAt"),
            item.get("updatedAt"),
        )

    if key == "programTracks":
        return (
            item.get("id"),
            item.get("title") or "",
            item.get("description"),
            item.get("icon"),
            item.get("color"),
            item.get("imageUrl"),
            _to_int(item.get("sortOrder")),
            bool(item.get("isActive", True)),
            item.get("createdAt"),
            item.get("updatedAt"),
        )

    if key == "events":
        return (
            item.get("id"),
            item.get("title") or "",
            item.get("description"),
            item.get("partnerId"),
            item.get("imageUrl"),
            bool(item.get("imageHidden", False)),
            item.get("programModule"),
            bool(item.get("isEvent", True)),
            item.get("parentProjectId"),
            item.get("statusMode"),
            item.get("manualStatus"),
            item.get("status"),
            item.get("category"),
            item.get("startDate"),
            item.get("endDate"),
            _json_dump(item.get("location"), {}),
            _to_int(item.get("volunteersNeeded")),
            _normalize_string_list(item.get("volunteers")),
            _normalize_string_list(item.get("joinedUserIds")),
            _normalize_skills_needed(item),
            _json_dump(item.get("internalTasks"), []),
            item.get("createdAt"),
            item.get("updatedAt"),
        )

    if key == "statusUpdates":
        return (
            item.get("id"),
            item.get("projectId"),
            item.get("status"),
            item.get("source"),
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
            _normalize_short_id(item.get("id"), "voljoin"),
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
            _json_dump(item.get("proposalDetails"), {}),
            item.get("status"),
            item.get("requestedAt"),
            item.get("reviewedAt"),
            item.get("reviewedBy"),
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
            item.get("downloadContent"),
            item.get("downloadMimeType"),
            _normalize_string_list(item.get("sourceReportIds")),
        )

    if key == "adminPlanningCalendars":
        return (
            item.get("id"),
            item.get("name") or "",
            item.get("color") or "#0F766E",
            item.get("description"),
            _json_dump(item.get("planningItems"), []),
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
    if field_name == "id":
        return _primary_key_column(key)
    return FIELD_NAME_MAPS.get(key, {}).get(field_name, field_name)


def _row_id(key: str, row: dict[str, Any]) -> Any:
    return row[_primary_key_column(key)]


def _row_filter_clause(key: str) -> str | None:
    if key == "partnerReports":
        return "generated_at is null"
    if key == "publishedImpactReports":
        return "generated_at is not null"
    return None


def _row_to_item(key: str, row: dict[str, Any]) -> dict[str, Any]:
    row_id = _row_id(key, row)

    if key == "users":
        return {
            "id": row_id,
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
            "id": row_id,
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
            "registrationDocuments": _json_load(row["registration_documents"], []),
        }

    if key == "volunteers":
        return {
            "id": row_id,
            "userId": row["user_id"],
            "name": row["name"],
            "email": row["email"],
            "phone": row["phone"],
            "skills": row["skills"] or [],
            "skillsDescription": row["skills_description"],
            "availability": _json_load(row["availability"], {}),
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
            "affiliations": _json_load(row["affiliations"], []),
            "registrationStatus": row["registration_status"],
            "reviewedBy": row["reviewed_by"],
            "reviewedAt": row["reviewed_at"],
            "credentialsUnlockedAt": row["credentials_unlocked_at"],
            "createdAt": row["created_at"],
        }

    if key == "projects":
        return {
            "id": row_id,
            "title": row["title"],
            "description": row["description"],
            "partnerId": row["partner_id"],
            "imageUrl": row["image_url"],
            "imageHidden": bool(row["image_hidden"]),
            "programModule": row["program_module"],
            "isEvent": bool(row["is_event"]),
            "parentProjectId": row["parent_project_id"],
            "statusMode": row["status_mode"],
            "manualStatus": row["manual_status"],
            "status": row["status"],
            "category": row["category"],
            "startDate": row["start_date"],
            "endDate": row["end_date"],
            "location": _json_load(row["location"], {}),
            "volunteersNeeded": row["volunteers_needed"],
            "volunteers": row["volunteers"] or [],
            "joinedUserIds": row["joined_user_ids"] or [],
            "skillsNeeded": row["skills_needed"] or [],
            "internalTasks": _json_load(row["internal_tasks"], []),
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }

    if key == "programs":
        return {
            "id": row_id,
            "title": row["title"],
            "description": row["description"],
            "partnerId": row["partner_id"],
            "imageUrl": row["image_url"],
            "imageHidden": bool(row["image_hidden"]),
            "programModule": row["program_module"],
            "statusMode": row["status_mode"],
            "manualStatus": row["manual_status"],
            "status": row["status"],
            "category": row["category"],
            "startDate": row["start_date"],
            "endDate": row["end_date"],
            "location": _json_load(row["location"], {}),
            "volunteersNeeded": row["volunteers_needed"],
            "volunteers": row["volunteers"] or [],
            "joinedUserIds": row["joined_user_ids"] or [],
            "linkedEventCount": row["linked_event_count"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }

    if key == "programTracks":
        return {
            "id": row_id,
            "title": row["title"],
            "description": row["description"],
            "icon": row["icon"],
            "color": row["color"],
            "imageUrl": row["image_url"],
            "sortOrder": row["sort_order"],
            "isActive": bool(row["is_active"]),
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }

    if key == "events":
        return {
            "id": row_id,
            "title": row["title"],
            "description": row["description"],
            "partnerId": row["partner_id"],
            "imageUrl": row["image_url"],
            "imageHidden": bool(row["image_hidden"]),
            "programModule": row["program_module"],
            "isEvent": True,
            "parentProjectId": row["parent_project_id"],
            "statusMode": row["status_mode"],
            "manualStatus": row["manual_status"],
            "status": row["status"],
            "category": row["category"],
            "startDate": row["start_date"],
            "endDate": row["end_date"],
            "location": _json_load(row["location"], {}),
            "volunteersNeeded": row["volunteers_needed"],
            "volunteers": row["volunteers"] or [],
            "joinedUserIds": row["joined_user_ids"] or [],
            "skillsNeeded": row["skills_needed"] or [],
            "internalTasks": _json_load(row["internal_tasks"], []),
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }

    if key == "statusUpdates":
        return {
            "id": row_id,
            "projectId": row["project_id"],
            "status": row["status"],
            "source": row["source"],
            "description": row["description"],
            "updatedBy": row["updated_by"],
            "updatedAt": row["updated_at"],
        }

    if key == "volunteerMatches":
        return {
            "id": row_id,
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
            "id": row_id,
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
            "id": row_id,
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
            "id": row_id,
            "projectId": row["project_id"],
            "partnerUserId": row["partner_user_id"],
            "partnerName": row["partner_name"],
            "partnerEmail": row["partner_email"],
            "proposalDetails": _json_load(row["proposal_details"], {}),
            "status": row["status"],
            "requestedAt": row["requested_at"],
            "reviewedAt": row["reviewed_at"],
            "reviewedBy": row["reviewed_by"],
        }

    if key == "partnerReports":
        return {
            "id": row_id,
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
            "metrics": _json_load(row["metrics"], {}),
            "attachments": _json_load(row["attachments"], []),
            "mediaFile": row["media_file"],
            "createdAt": row["created_at"],
            "status": row["status"],
            "reviewedAt": row["reviewed_at"],
            "reviewedBy": row["reviewed_by"],
        }

    if key == "publishedImpactReports":
        return {
            "id": row_id,
            "projectId": row["project_id"],
            "generatedBy": row["generated_by"],
            "generatedAt": row["generated_at"],
            "reportFile": row["report_file"],
            "format": row["format"],
            "downloadContent": row["download_content"],
            "downloadMimeType": row["download_mime_type"],
            "sourceReportIds": row["source_report_ids"] or [],
            "publishedAt": row["published_at"],
        }

    if key == "adminPlanningCalendars":
        return {
            "id": row_id,
            "name": row["name"],
            "color": row["color"],
            "description": row["description"],
            "planningItems": _json_load(row["planning_items"], []),
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }

    if key == "adminPlanningItems":
        return {
            "id": row_id,
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


def refresh_program_rows_from_tracks(connection: Any) -> None:
    with connection.cursor() as cursor:
        cursor.execute("delete from programs")
        cursor.execute(
            """
            insert into programs (
              programs_id,
              title,
              description,
              partner_id,
              image_url,
              image_hidden,
              program_module,
              status_mode,
              manual_status,
              status,
              category,
              start_date,
              end_date,
              location,
              volunteers_needed,
              volunteers,
              joined_user_ids,
              linked_event_count,
              created_at,
              updated_at
            )
            select
              t.program_tracks_id,
              t.title,
              t.description,
              '' as partner_id,
              nullif(t.image_url, '') as image_url,
              false as image_hidden,
              t.program_tracks_id as program_module,
              'System' as status_mode,
              null::text as manual_status,
              'Planning' as status,
              t.program_tracks_id as category,
              null::text as start_date,
              null::text as end_date,
              '{}'::text as location,
              0 as volunteers_needed,
              '{}'::text[] as volunteers,
              '{}'::text[] as joined_user_ids,
              0 as linked_event_count,
              coalesce(t.created_at, now()::text),
              coalesce(t.updated_at, now()::text)
            from program_tracks t
            where coalesce(t.is_active, true) = true
              and t.program_tracks_id in ('Nutrition', 'Education', 'Livelihood')
            order by coalesce(t.sort_order, 0), t.program_tracks_id
            """
        )


def ensure_default_program_tracks(connection: Any) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            insert into program_tracks (
              program_tracks_id,
              title,
              description,
              icon,
              color,
              image_url,
              sort_order,
              is_active,
              created_at,
              updated_at
            )
            values
              ('Nutrition', 'Nutrition', 'Food security and health programs for children and families.', 'restaurant', '#dc2626', '', 10, true, now()::text, now()::text),
              ('Education', 'Education', 'Learning, literacy, and skill development for students.', 'school', '#2563eb', '', 20, true, now()::text, now()::text),
              ('Livelihood', 'Livelihood', 'Economic empowerment and vocational training programs.', 'work', '#7c3aed', '', 30, true, now()::text, now()::text)
            on conflict (program_tracks_id) do update set
              title = excluded.title,
              description = excluded.description,
              icon = excluded.icon,
              color = excluded.color,
              image_url = excluded.image_url,
              sort_order = excluded.sort_order,
              is_active = true,
              updated_at = excluded.updated_at
            """
        )
        cursor.execute(
            """
            delete from program_tracks
            where program_tracks_id not in ('Nutrition', 'Education', 'Livelihood')
            """
        )


def migrate_admin_planning_items_into_calendars(connection: Any) -> None:
        with connection.cursor() as cursor:
                cursor.execute(
                        """
                        with legacy_items as (
                            select
                                calendar_id,
                                jsonb_agg(
                                    jsonb_build_object(
                                        'id', admin_planning_items_id,
                                        'title', title,
                                        'description', description,
                                        'calendarId', calendar_id,
                                        'linkedProjectId', linked_project_id,
                                        'startDate', start_date,
                                        'endDate', end_date,
                                        'location', location,
                                        'participantsLabel', participants_label,
                                        'createdBy', created_by,
                                        'createdAt', created_at,
                                        'updatedAt', updated_at
                                    )
                                    order by created_at, updated_at, admin_planning_items_id
                                ) as planning_items,
                                min(created_at) as created_at,
                                max(updated_at) as updated_at
                            from admin_planning_items
                            group by calendar_id
                        ),
                        calendar_rows as (
                            select
                                c.admin_planning_calendars_id,
                                coalesce(c.planning_items, '[]')::jsonb as planning_items,
                                c.name,
                                c.color,
                                c.description,
                                c.created_at,
                                c.updated_at
                            from admin_planning_calendars c
                        )
                        update admin_planning_calendars c
                        set planning_items = (
                            coalesce(c.planning_items, '[]')::jsonb || coalesce(li.planning_items, '[]'::jsonb)
                        )::text
                        from legacy_items li
                        where c.admin_planning_calendars_id = li.calendar_id
                        """
                )
                cursor.execute(
                        """
                        insert into admin_planning_calendars (
                            admin_planning_calendars_id,
                            name,
                            color,
                            description,
                            planning_items,
                            created_at,
                            updated_at
                        )
                        select
                            li.calendar_id,
                            li.calendar_id,
                            '#0F766E',
                            'Migrated planning lane.',
                            li.planning_items::text,
                            li.created_at,
                            li.updated_at
                        from (
                            select
                                calendar_id,
                                jsonb_agg(
                                    jsonb_build_object(
                                        'id', admin_planning_items_id,
                                        'title', title,
                                        'description', description,
                                        'calendarId', calendar_id,
                                        'linkedProjectId', linked_project_id,
                                        'startDate', start_date,
                                        'endDate', end_date,
                                        'location', location,
                                        'participantsLabel', participants_label,
                                        'createdBy', created_by,
                                        'createdAt', created_at,
                                        'updatedAt', updated_at
                                    )
                                    order by created_at, updated_at, admin_planning_items_id
                                ) as planning_items,
                                min(created_at) as created_at,
                                max(updated_at) as updated_at
                            from admin_planning_items
                            group by calendar_id
                        ) li
                        left join admin_planning_calendars c on c.admin_planning_calendars_id = li.calendar_id
                        where c.admin_planning_calendars_id is null
                        on conflict (admin_planning_calendars_id) do update set
                            planning_items = excluded.planning_items,
                            updated_at = excluded.updated_at
                        """
                )


def ensure_named_primary_key_columns(connection: Any) -> None:
    table_names = sorted({spec["table"] for spec in TABLE_SPECS.values()})
    with connection.cursor() as cursor:
        for table_name in table_names:
            primary_key_column = _table_primary_key_column(table_name)
            cursor.execute(
                """
                select column_name
                from information_schema.columns
                where table_schema = 'public'
                  and table_name = %s
                  and column_name in ('id', %s)
                """,
                (table_name, primary_key_column),
            )
            columns = {row[0] for row in cursor.fetchall()}
            if "id" in columns and primary_key_column not in columns:
                cursor.execute(f"alter table {table_name} alter column id drop identity if exists")
                cursor.execute(f"alter table {table_name} alter column id type text using id::text")
                cursor.execute(f"alter table {table_name} rename column id to {primary_key_column}")
            elif primary_key_column in columns:
                cursor.execute(
                    f"alter table {table_name} alter column {primary_key_column} type text using {primary_key_column}::text"
                )


def ensure_relational_mirror_tables(connection: Any) -> None:
    import time as _time
    with connection.cursor() as cursor:
        # Increase statement timeout for DDL operations as they can be slow on remote databases.
        try:
            cursor.execute("SET statement_timeout = '300s'")
        except Exception:
            pass

        for idx, statement in enumerate(RELATIONAL_TABLE_DDL):
            _t0 = _time.perf_counter()
            _trace(f"[TRACE] ensure_relational_mirror_tables: executing DDL #{idx} (len={len(statement):d})")
            cursor.execute(statement)
            _trace(f"[TRACE] ensure_relational_mirror_tables: finished DDL #{idx} in {_time.perf_counter() - _t0:.3f}s")
    ensure_named_primary_key_columns(connection)
    migrate_admin_planning_items_into_calendars(connection)
    ensure_default_program_tracks(connection)
    refresh_program_rows_from_tracks(connection)


def sync_relational_mirror_collection(connection: Any, key: str, items: list[Any]) -> None:
    spec = TABLE_SPECS.get(key)
    if not spec:
        return

    normalized_items = [item for item in items if isinstance(item, dict) and item.get("id")]
    rows = [_normalize_row(key, item) for item in normalized_items]
    column_names = [column_name for column_name, _ in spec["columns"]]
    placeholders = ["%s" for _ in spec["columns"]]
    filter_clause = _row_filter_clause(key)

    with connection.cursor() as cursor:
        if filter_clause:
            cursor.execute(f"delete from {spec['table']} where {filter_clause}")
        else:
            cursor.execute(f"delete from {spec['table']}")
        if rows:
            cursor.executemany(
                f"""
                insert into {spec['table']} ({', '.join(column_names)})
                values ({', '.join(placeholders)})
                """,
                rows,
            )
    if key in {"programTracks", "projects", "events"}:
        refresh_program_rows_from_tracks(connection)


def sync_all_relational_mirror_tables(connection: Any, collections: dict[str, list[Any]]) -> None:
    for key, items in collections.items():
        sync_relational_mirror_collection(connection, key, items if isinstance(items, list) else [])


def get_relational_collection(connection: Any, key: str) -> list[dict[str, Any]]:
    spec = TABLE_SPECS.get(key)
    if not spec:
        raise KeyError(f"Unsupported relational mirror key: {key}")

    from psycopg.rows import dict_row
    from psycopg.errors import UndefinedColumn, UndefinedTable

    column_names = [column_name for column_name, _ in spec["columns"]]
    filter_clause = _row_filter_clause(key)
    with connection.cursor(row_factory=dict_row) as cursor:
        # Set a per-query timeout to prevent indefinite hangs during large table scans
        try:
            cursor.execute("SET statement_timeout = '180s'")
        except Exception:
            pass  # If timeout setting fails, continue with default
        query = f"select {', '.join(column_names)} from {spec['table']}"
        if filter_clause:
            query += f" where {filter_clause}"
        query += f" order by {_primary_key_column(key)} asc"
        try:
            _trace(f"[TRACE] get_relational_collection: executing query on {spec['table']}")
            _trace(f"[TRACE] get_relational_collection: query length: {len(query)}")
            cursor.execute(query)
        except (UndefinedColumn, UndefinedTable) as exc:
            # Some environments may have an older DB schema (or missing tables)
            # even though the code expects the latest relational mirror columns.
            # Avoid running potentially long DDL sync here (can time out and block
            # the request). Instead, log the issue and return an empty payload so
            # callers can continue to operate with degraded data.
            connection.rollback()
            _trace(f"[WARN] get_relational_collection: schema mismatch for {spec['table']}: {exc}; returning empty list")
            return []
        except Exception as exc:
            # Handle query timeouts and other errors gracefully
            connection.rollback()
            _trace(f"[WARN] get_relational_collection: query error for {spec['table']}: {type(exc).__name__}: {exc}; returning empty list")
            return []
        rows = cursor.fetchall()
        _trace(f"[TRACE] get_relational_collection: fetched {len(rows)} rows from {spec['table']}")
    return [_row_to_item(key, row) for row in rows]


def get_relational_item_by_id(connection: Any, key: str, item_id: str) -> dict[str, Any] | None:
    spec = TABLE_SPECS.get(key)
    if not spec:
        raise KeyError(f"Unsupported relational mirror key: {key}")

    from psycopg.rows import dict_row
    from psycopg.errors import UndefinedColumn, UndefinedTable

    column_names = [column_name for column_name, _ in spec["columns"]]
    filter_clause = _row_filter_clause(key)
    with connection.cursor(row_factory=dict_row) as cursor:
        query = f"select {', '.join(column_names)} from {spec['table']} where {_primary_key_column(key)} = %s"
        if filter_clause:
            query += f" and {filter_clause}"
        try:
            cursor.execute(query, (item_id,))
        except (UndefinedColumn, UndefinedTable):
            connection.rollback()
            ensure_relational_mirror_tables(connection)
            connection.commit()
            cursor.execute(query, (item_id,))
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
    from psycopg.errors import UndefinedColumn, UndefinedTable

    column_name = _field_column_name(key, field_name)
    valid_columns = {column_name for column_name, _ in spec["columns"]}
    if column_name not in valid_columns:
        return []

    column_names = [column_name for column_name, _ in spec["columns"]]
    filter_clause = _row_filter_clause(key)
    with connection.cursor(row_factory=dict_row) as cursor:
        if field_value is None:
            query = f"select {', '.join(column_names)} from {spec['table']} where {column_name} is null"
            params: tuple[Any, ...] = ()
        elif field_value == "":
            query = (
                f"select {', '.join(column_names)} from {spec['table']} "
                f"where ({column_name} is null or {column_name} = '')"
            )
            params = ()
        else:
            query = f"select {', '.join(column_names)} from {spec['table']} where {column_name} = %s"
            params = (field_value,)

        if filter_clause:
            query += f" and {filter_clause}"
        query += f" order by {_primary_key_column(key)} asc"
        try:
            cursor.execute(query, params)
        except (UndefinedColumn, UndefinedTable):
            connection.rollback()
            ensure_relational_mirror_tables(connection)
            connection.commit()
            cursor.execute(query, params)
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
    placeholders = ["%s" for _ in spec["columns"]]
    primary_key_column = _primary_key_column(key)
    update_assignments = [
        f"{column_name} = excluded.{column_name}" for column_name in column_names if column_name != primary_key_column
    ]

    with connection.cursor() as cursor:
        cursor.execute(
            f"""
            insert into {spec['table']} ({', '.join(column_names)})
            values ({', '.join(placeholders)})
            on conflict ({primary_key_column}) do update set
              {', '.join(update_assignments)}
            """,
            row,
        )
    if key in {"programTracks", "projects", "events"}:
        refresh_program_rows_from_tracks(connection)

    return item
