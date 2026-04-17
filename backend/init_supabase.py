try:
    from .app_storage_seed import ensure_app_storage_table, ensure_postgres_hot_storage_tables
    from .db import get_connection
    from .relational_mirror import ensure_relational_mirror_tables
    from .schema_maintenance import maintain_schema_health
except ImportError:
    from app_storage_seed import ensure_app_storage_table, ensure_postgres_hot_storage_tables
    from db import get_connection
    from relational_mirror import ensure_relational_mirror_tables
    from schema_maintenance import maintain_schema_health


BASE_DDL = [
    """
    create table if not exists app_users (
      app_users_id text primary key,
      email text not null unique,
      password text not null,
      role text not null check (role in ('admin', 'volunteer', 'partner')),
      name text not null,
      phone text,
      created_at timestamptz not null
    )
    """,
    """
    create table if not exists messages (
      messages_id text primary key,
      sender_id text not null references app_users(app_users_id) on delete cascade,
      recipient_id text not null references app_users(app_users_id) on delete cascade,
      project_id text,
      content text not null,
      timestamp timestamptz not null,
      read boolean not null default false,
      attachments jsonb not null default '[]'::jsonb
    )
    """,
    """
    create table if not exists project_group_messages (
      project_group_messages_id text primary key,
      project_id text not null,
      sender_id text not null references app_users(app_users_id) on delete cascade,
      content text not null,
      timestamp timestamptz not null,
      attachments jsonb not null default '[]'::jsonb
    )
    """,
    "create index if not exists idx_messages_recipient_id on messages(recipient_id)",
    "create index if not exists idx_project_group_messages_project_id on project_group_messages(project_id)",
]


# Creates or updates the backend schema used by the volunteer system.
def main() -> None:
    ensure_app_storage_table()

    with get_connection() as connection:
        with connection.cursor() as cursor:
            for statement in BASE_DDL:
                cursor.execute(statement)

        ensure_postgres_hot_storage_tables(connection)
        ensure_relational_mirror_tables(connection)
        maintenance_summary = maintain_schema_health(connection)
        connection.commit()

    dropped_tables = maintenance_summary["dropped_rogue_tables"]
    cleaned_hot_storage = maintenance_summary["cleaned_hot_storage"]
    pruned_users = maintenance_summary["pruned_stale_app_users"]
    print("Supabase Postgres schema created or updated.")
    if dropped_tables:
        print(f"Dropped rogue tables: {', '.join(dropped_tables)}")
    if cleaned_hot_storage:
        print(f"Sanitized collections: {', '.join(cleaned_hot_storage)}")
    if pruned_users:
        print(f"Pruned stale legacy app users: {', '.join(pruned_users)}")


if __name__ == "__main__":
    main()
