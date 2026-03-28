from db import get_connection


DDL = """
drop table if exists impact_reports;
drop table if exists partner_donations;
drop table if exists partner_project_applications;
drop table if exists volunteer_project_matches;
drop table if exists status_updates;
drop table if exists volunteers;
drop table if exists projects;
drop table if exists partners;
drop table if exists app_status_updates;
drop table if exists app_volunteers;
drop table if exists app_projects;
drop table if exists app_partners;

create table if not exists app_users (
  app_users_id text primary key,
  email text not null unique,
  password text not null,
  role text not null check (role in ('admin', 'volunteer', 'partner')),
  name text not null,
  phone text,
  created_at timestamptz not null
);

create table if not exists messages (
  messages_id text primary key,
  sender_id text not null references app_users(app_users_id) on delete cascade,
  recipient_id text not null references app_users(app_users_id) on delete cascade,
  project_id text,
  content text not null,
  timestamp timestamptz not null,
  read boolean not null default false,
  attachments jsonb not null default '[]'::jsonb
);

create table if not exists project_group_messages (
  project_group_messages_id text primary key,
  project_id text not null,
  sender_id text not null references app_users(app_users_id) on delete cascade,
  content text not null,
  timestamp timestamptz not null,
  attachments jsonb not null default '[]'::jsonb
);
create index if not exists idx_messages_recipient_id on messages(recipient_id);
create index if not exists idx_project_group_messages_project_id on project_group_messages(project_id);

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
