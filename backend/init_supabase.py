from db import get_connection


DDL = """
drop table if exists impact_reports;
drop table if exists partner_donations;

create table if not exists app_users (
  id text primary key,
  email text not null unique,
  password text not null,
  role text not null check (role in ('admin', 'volunteer', 'partner')),
  name text not null,
  phone text,
  created_at timestamptz not null
);

create table if not exists partners (
  id text primary key,
  name text not null,
  description text not null,
  category text not null check (category in ('Education', 'Livelihood', 'Nutrition', 'Other')),
  contact_email text not null,
  contact_phone text not null,
  address text not null,
  status text not null check (status in ('Pending', 'Approved', 'Rejected')),
  validated_by text,
  validated_at timestamptz,
  created_at timestamptz not null,
  registration_documents jsonb not null default '[]'::jsonb
);

create table if not exists projects (
  id text primary key,
  title text not null,
  description text not null,
  partner_id text not null references partners(id) on delete restrict,
  is_event boolean not null default false,
  status text not null check (status in ('Planning', 'In Progress', 'On Hold', 'Completed', 'Cancelled')),
  category text not null check (category in ('Education', 'Livelihood', 'Nutrition', 'Other')),
  start_date timestamptz not null,
  end_date timestamptz not null,
  location jsonb not null,
  volunteers_needed integer not null default 0,
  volunteers jsonb not null default '[]'::jsonb,
  joined_user_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  status_updates jsonb not null default '[]'::jsonb
);

create table if not exists volunteers (
  id text primary key,
  user_id text not null unique references app_users(id) on delete cascade,
  name text not null,
  email text not null,
  phone text not null,
  skills jsonb not null default '[]'::jsonb,
  skills_description text not null,
  availability jsonb not null,
  past_projects jsonb not null default '[]'::jsonb,
  total_hours_contributed numeric not null default 0,
  rating numeric not null default 0,
  engagement_status text not null check (engagement_status in ('Open to Volunteer', 'Busy')),
  background text not null,
  created_at timestamptz not null
);

create table if not exists messages (
  id text primary key,
  sender_id text not null references app_users(id) on delete cascade,
  recipient_id text not null references app_users(id) on delete cascade,
  project_id text,
  content text not null,
  timestamp timestamptz not null,
  read boolean not null default false,
  attachments jsonb not null default '[]'::jsonb
);

create table if not exists status_updates (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  status text not null check (status in ('Planning', 'In Progress', 'On Hold', 'Completed', 'Cancelled')),
  description text not null,
  updated_by text not null references app_users(id) on delete restrict,
  updated_at timestamptz not null
);

create table if not exists volunteer_project_matches (
  id text primary key,
  volunteer_id text not null references volunteers(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  status text not null check (status in ('Requested', 'Matched', 'Completed', 'Cancelled')),
  matched_at timestamptz not null,
  hours_contributed numeric not null default 0
);

create table if not exists partner_project_applications (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  partner_user_id text not null references app_users(id) on delete cascade,
  partner_name text not null,
  partner_email text not null,
  status text not null check (status in ('Pending', 'Approved', 'Rejected')),
  requested_at timestamptz not null,
  reviewed_at timestamptz,
  reviewed_by text
);

create index if not exists idx_projects_partner_id on projects(partner_id);
create index if not exists idx_messages_recipient_id on messages(recipient_id);
create index if not exists idx_status_updates_project_id on status_updates(project_id);
create index if not exists idx_partner_project_applications_project_id on partner_project_applications(project_id);

create table if not exists app_storage (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

delete from app_storage where key in ('impactReports', 'donations');
"""


# Creates or updates the backend schema used by the volunteer system.
def main() -> None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            for statement in [part.strip() for part in DDL.split(";") if part.strip()]:
                cursor.execute(statement)
        connection.commit()

    print("Supabase Postgres schema created or updated.")


if __name__ == "__main__":
    main()
