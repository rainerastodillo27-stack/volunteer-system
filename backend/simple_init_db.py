"""
Simple database initialization - creates basic tables only
"""
import os
try:
    from .db import get_connection
    from .app_storage_seed import ensure_app_storage_table, ensure_postgres_hot_storage_tables
except ImportError:
    from db import get_connection
    from app_storage_seed import ensure_app_storage_table, ensure_postgres_hot_storage_tables

BASE_DDL = [
    """
    create table if not exists messages (
      messages_id text primary key,
      sender_id text not null,
      recipient_id text not null,
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
      sender_id text not null,
      content text not null,
      timestamp timestamptz not null,
      kind text not null default 'message',
      need_post jsonb,
      scope_proposal jsonb,
      response_to_message_id text,
      response_action text,
      response_to_title text,
      attachments jsonb not null default '[]'::jsonb
    )
    """,
    "create index if not exists idx_messages_recipient_id on messages(recipient_id)",
    "create index if not exists idx_project_group_messages_project_id on project_group_messages(project_id)",
]

def main():
    print("Initializing database with basic schema...")
    
    # Create app_storage table
    ensure_app_storage_table()
    print("✓ app_storage table created")
    
    # Create other tables
    with get_connection() as connection:
        with connection.cursor() as cursor:
            for statement in BASE_DDL:
                cursor.execute(statement)
        
        # Create hot storage tables
        ensure_postgres_hot_storage_tables(connection)
        print("✓ Hot storage tables created")
        
        connection.commit()
    
    print("✓ Database initialization complete!")

if __name__ == "__main__":
    main()
