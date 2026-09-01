-- ============================================================
-- NVCC Volunteer System – Correct Schema Migration
-- Target: https://ehihgqhajovanlecawiq.supabase.co
-- Generated: 2026-06-26
-- ============================================================

-- ── Drop existing tables to start fresh ─────────────────────
DROP TABLE IF EXISTS public.messages CASCADE;
DROP TABLE IF EXISTS public.project_group_messages CASCADE;
DROP TABLE IF EXISTS public.admin_planning_items CASCADE;
DROP TABLE IF EXISTS public.admin_planning_calendars CASCADE;
DROP TABLE IF EXISTS public.volunteer_time_logs CASCADE;
DROP TABLE IF EXISTS public.volunteer_event_joins CASCADE;
DROP TABLE IF EXISTS public.volunteer_matches CASCADE;
DROP TABLE IF EXISTS public.status_updates CASCADE;
DROP TABLE IF EXISTS public.reports CASCADE;
DROP TABLE IF EXISTS public.projects CASCADE;
DROP TABLE IF EXISTS public.programs CASCADE;
DROP TABLE IF EXISTS public.partners CASCADE;
DROP TABLE IF EXISTS public.partner_project_applications CASCADE;
DROP TABLE IF EXISTS public.events CASCADE;
DROP TABLE IF EXISTS public.dswd_accreditation_numbers CASCADE;
DROP TABLE IF EXISTS public.users CASCADE;
DROP TABLE IF EXISTS public.volunteers CASCADE;
DROP TABLE IF EXISTS public.skills CASCADE;
DROP TABLE IF EXISTS public.tasks CASCADE;
DROP TABLE IF EXISTS public.program_tracks CASCADE;

-- ── users ────────────────────────────────────────────────────
CREATE TABLE public.users (
  users_id text NOT NULL,
  email text,
  password text NOT NULL,
  role text NOT NULL,
  name text NOT NULL,
  phone text,
  user_type text,
  created_at text,
  pillars_of_interest text[] NOT NULL DEFAULT '{}',
  approval_status text,
  approved_by text,
  approved_at text,
  rejection_reason text,
  CONSTRAINT users_pkey PRIMARY KEY (users_id)
);

-- ── volunteers ───────────────────────────────────────────────
CREATE TABLE public.volunteers (
  volunteers_id text NOT NULL,
  user_id text,
  name text NOT NULL,
  email text,
  phone text,
  skills_description text,
  availability text NOT NULL,
  total_hours_contributed double precision NOT NULL,
  rating double precision NOT NULL,
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
  valid_id_photo text,
  hobbies_and_interests text,
  special_skills text,
  video_briefing_url text,
  affiliations text NOT NULL,
  registration_status text,
  reviewed_by text,
  reviewed_at text,
  credentials_unlocked_at text,
  created_at text,
  skills text[] NOT NULL DEFAULT '{}',
  past_projects text[] NOT NULL DEFAULT '{}',
  CONSTRAINT volunteers_pkey PRIMARY KEY (volunteers_id)
);

-- ── partners ─────────────────────────────────────────────────
CREATE TABLE public.partners (
  partners_id text NOT NULL,
  owner_user_id text,
  name text NOT NULL,
  description text,
  category text,
  sector_type text,
  dswd_accreditation_no text,
  sec_registration_no text,
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
  registration_documents jsonb NOT NULL DEFAULT '{}',
  advocacy_focus text[] NOT NULL DEFAULT '{}',
  CONSTRAINT partners_pkey PRIMARY KEY (partners_id)
);

-- ── skills ───────────────────────────────────────────────────
CREATE TABLE public.skills (
  skills_id text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  name text NOT NULL DEFAULT ''::text,
  updated_at text,
  CONSTRAINT skills_pkey PRIMARY KEY (skills_id)
);

-- ── programs ─────────────────────────────────────────────────
CREATE TABLE public.programs (
  id text NOT NULL,
  created_at text NOT NULL,
  title text NOT NULL,
  description text,
  partner_id text,
  image_url text,
  image_hidden boolean NOT NULL,
  program_module text,
  status_mode text,
  manual_status text,
  status text,
  category text,
  start_date text,
  end_date text,
  location text NOT NULL,
  volunteers_needed integer NOT NULL,
  volunteers text[] NOT NULL DEFAULT '{}',
  joined_user_ids text[] NOT NULL DEFAULT '{}',
  linked_event_count integer NOT NULL,
  updated_at text,
  icon text,
  color text,
  program_id text,
  CONSTRAINT programs_pkey PRIMARY KEY (id)
);

-- ── projects ─────────────────────────────────────────────────
CREATE TABLE public.projects (
  id text NOT NULL,
  created_at text NOT NULL,
  title text NOT NULL,
  description text,
  partner_id text,
  program_module text,
  is_event boolean NOT NULL,
  parent_project_id text,
  image_url text,
  image_hidden boolean NOT NULL,
  status_mode text,
  manual_status text,
  status text,
  category text,
  start_date text,
  end_date text,
  location text NOT NULL,
  volunteers_needed integer NOT NULL,
  volunteers text[] NOT NULL DEFAULT '{}',
  joined_user_ids text[] NOT NULL DEFAULT '{}',
  internal_tasks jsonb NOT NULL DEFAULT '[]',
  skills_needed text[] NOT NULL DEFAULT '{}',
  updated_at text,
  program_id text,
  location_region text,
  location_city text,
  location_barangay text,
  CONSTRAINT projects_pkey PRIMARY KEY (id)
);

-- ── events ───────────────────────────────────────────────────
CREATE TABLE public.events (
  id text NOT NULL,
  title text NOT NULL,
  description text,
  partner_id text,
  program_module text,
  is_event boolean NOT NULL,
  parent_project_id text,
  status text,
  category text,
  start_date text,
  end_date text,
  location text NOT NULL,
  volunteers_needed integer NOT NULL,
  internal_tasks jsonb NOT NULL DEFAULT '[]',
  created_at text,
  updated_at text,
  image_url text,
  image_hidden boolean NOT NULL,
  volunteers text[] NOT NULL DEFAULT '{}',
  joined_user_ids text[] NOT NULL DEFAULT '{}',
  skills_needed text[] NOT NULL DEFAULT '{}',
  status_mode text,
  manual_status text,
  program_id text,
  location_region text,
  location_city text,
  location_barangay text,
  location_venue text,
  google_meet_url text,
  notification_settings jsonb NOT NULL DEFAULT '[]',
  CONSTRAINT events_pkey PRIMARY KEY (id)
);

-- ── tasks ────────────────────────────────────────────────────
CREATE TABLE public.tasks (
  tasks_id text NOT NULL,
  title text NOT NULL,
  description text,
  category text,
  priority text,
  status text,
  assigned_volunteer_id text,
  assigned_volunteer_name text,
  is_field_officer boolean NOT NULL DEFAULT false,
  skills_needed text[] NOT NULL DEFAULT '{}'::text[],
  created_at text,
  updated_at text,
  CONSTRAINT tasks_pkey PRIMARY KEY (tasks_id)
);

-- ── status_updates ───────────────────────────────────────────
CREATE TABLE public.status_updates (
  status_updates_id text NOT NULL,
  project_id text,
  status text,
  description text,
  updated_by text,
  updated_at text,
  source text,
  CONSTRAINT status_updates_pkey PRIMARY KEY (status_updates_id)
);

-- ── volunteer_matches ────────────────────────────────────────
CREATE TABLE public.volunteer_matches (
  volunteer_matches_id text NOT NULL,
  volunteer_id text,
  project_id text,
  status text,
  requested_at text,
  matched_at text,
  reviewed_at text,
  reviewed_by text,
  hours_contributed double precision NOT NULL,
  CONSTRAINT volunteer_matches_pkey PRIMARY KEY (volunteer_matches_id)
);

-- ── volunteer_event_joins ────────────────────────────────────
CREATE TABLE public.volunteer_event_joins (
  volunteer_event_joins_id text NOT NULL,
  project_id text,
  volunteer_id text,
  volunteer_user_id text,
  volunteer_name text,
  volunteer_email text,
  joined_at text,
  source text,
  participation_status text,
  completed_at text,
  completed_by text,
  CONSTRAINT volunteer_event_joins_pkey PRIMARY KEY (volunteer_event_joins_id)
);

-- ── volunteer_time_logs ──────────────────────────────────────
CREATE TABLE public.volunteer_time_logs (
  volunteer_time_logs_id text NOT NULL,
  volunteer_id text,
  project_id text,
  time_in text,
  time_out text,
  note text,
  completion_photo text,
  completion_report text,
  attendance_photo text,
  attendance_confirmed_at text,
  attendance_checked_at text,
  attendance_checked_by text,
  attendance_checked_by_name text,
  CONSTRAINT volunteer_time_logs_pkey PRIMARY KEY (volunteer_time_logs_id)
);

-- ── reports ──────────────────────────────────────────────────
CREATE TABLE public.reports (
  reports_id text NOT NULL,
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
  impact_count integer NOT NULL,
  metrics jsonb NOT NULL DEFAULT '{}',
  attachments jsonb NOT NULL DEFAULT '[]',
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
  source_report_ids text[] NOT NULL DEFAULT '{}',
  CONSTRAINT reports_pkey PRIMARY KEY (reports_id)
);

-- ── partner_project_applications ─────────────────────────────
CREATE TABLE public.partner_project_applications (
  partner_project_applications_id text NOT NULL,
  project_id text,
  partner_user_id text,
  partner_name text,
  partner_email text,
  status text,
  requested_at text,
  reviewed_at text,
  reviewed_by text,
  proposal_details jsonb NOT NULL DEFAULT '{}',
  CONSTRAINT partner_project_applications_pkey PRIMARY KEY (partner_project_applications_id)
);

-- ── dswd_accreditation_numbers ───────────────────────────────
CREATE TABLE public.dswd_accreditation_numbers (
  dswd_accreditation_numbers_id integer NOT NULL,
  accreditation_no text NOT NULL,
  is_assigned boolean NOT NULL,
  assigned_to_partner_id text,
  assigned_at text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

-- ── messages ─────────────────────────────────────────────────
CREATE TABLE public.messages (
  id text NOT NULL,
  sender_id text NOT NULL,
  recipient_id text NOT NULL,
  project_id text,
  content text NOT NULL,
  timestamp timestamp with time zone NOT NULL,
  read boolean NOT NULL DEFAULT false,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT messages_pkey PRIMARY KEY (id)
);

-- ── project_group_messages ───────────────────────────────────
CREATE TABLE public.project_group_messages (
  id text NOT NULL,
  project_id text NOT NULL,
  sender_id text NOT NULL,
  content text NOT NULL,
  timestamp timestamp with time zone NOT NULL,
  kind text NOT NULL,
  need_post jsonb,
  scope_proposal jsonb,
  response_to_message_id text,
  response_action text,
  response_to_title text,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb
);

-- ── admin_planning_calendars ─────────────────────────────────
CREATE TABLE public.admin_planning_calendars (
  admin_planning_calendars_id text NOT NULL,
  name text NOT NULL,
  color text NOT NULL,
  description text,
  planning_items jsonb NOT NULL DEFAULT '[]',
  created_at text NOT NULL,
  updated_at text NOT NULL,
  CONSTRAINT admin_planning_calendars_pkey PRIMARY KEY (admin_planning_calendars_id)
);

-- ── Indexes ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_messages_recipient_id            ON public.messages(recipient_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id               ON public.messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_projects_partner_id              ON public.projects(partner_id);
CREATE INDEX IF NOT EXISTS idx_projects_program_id              ON public.projects(program_id);
CREATE INDEX IF NOT EXISTS idx_events_partner_id                ON public.events(partner_id);
CREATE INDEX IF NOT EXISTS idx_volunteer_matches_volunteer      ON public.volunteer_matches(volunteer_id);
CREATE INDEX IF NOT EXISTS idx_volunteer_matches_project        ON public.volunteer_matches(project_id);
CREATE INDEX IF NOT EXISTS idx_volunteer_event_joins_project    ON public.volunteer_event_joins(project_id);
CREATE INDEX IF NOT EXISTS idx_volunteer_event_joins_volunteer  ON public.volunteer_event_joins(volunteer_id);
CREATE INDEX IF NOT EXISTS idx_volunteer_time_logs_volunteer    ON public.volunteer_time_logs(volunteer_id);
CREATE INDEX IF NOT EXISTS idx_volunteer_time_logs_project      ON public.volunteer_time_logs(project_id);
CREATE INDEX IF NOT EXISTS idx_reports_project_id               ON public.reports(project_id);
CREATE INDEX IF NOT EXISTS idx_reports_partner_id               ON public.reports(partner_id);
CREATE INDEX IF NOT EXISTS idx_status_updates_project_id        ON public.status_updates(project_id);
