#!/usr/bin/env python3
"""
Add start/end dates to events that don't have them.
Sets default dates based on parent project dates or current date.
"""

import os
import sys
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv

# Load environment
load_dotenv()
SUPABASE_URL = os.getenv("SUPABASE_DB_URL", "").strip()

if not SUPABASE_URL:
    print("ERROR: SUPABASE_DB_URL not found in environment")
    sys.exit(1)

try:
    import psycopg
except ImportError:
    print("ERROR: psycopg not installed. Install with: pip install psycopg[binary]")
    sys.exit(1)


def get_connection():
    """Connect directly to Supabase PostgreSQL."""
    return psycopg.connect(SUPABASE_URL, connect_timeout=5)


def add_event_dates():
    """Add start/end dates to events that don't have them."""
    print("\n" + "="*70)
    print("  ADDING DATES TO EVENTS WITHOUT DATES")
    print("="*70 + "\n")
    
    conn = None
    try:
        conn = get_connection()
        cursor = conn.cursor()
        
        # Create events table if it doesn't exist
        print("Ensuring events table exists...")
        cursor.execute("""
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
              status text,
              category text,
              start_date text,
              end_date text,
              location jsonb not null default '{}'::jsonb,
              volunteers_needed integer not null default 0,
              volunteers text[] not null default '{}'::text[],
              joined_user_ids text[] not null default '{}'::text[],
              skills_needed text[] not null default '{}'::text[],
              internal_tasks jsonb not null default '[]'::jsonb,
              created_at text,
              updated_at text
            )
        """)
        print("Events table ensured.\n")
        
        # Get all events
        cursor.execute("SELECT id, title, start_date, end_date, parent_project_id FROM events")
        events = cursor.fetchall()
        
        updated_count = 0
        
        for event_id, title, start_date, end_date, parent_project_id in events:
            if not start_date or not end_date:
                print(f"Event {event_id} ({title}) missing dates")
                
                # Try to get dates from parent project
                if parent_project_id:
                    cursor.execute("SELECT start_date, end_date FROM projects WHERE id = %s", (parent_project_id,))
                    parent_result = cursor.fetchone()
                    if parent_result:
                        parent_start, parent_end = parent_result
                        
                        if parent_start and parent_end:
                            # Set event dates to be within parent dates
                            # For example, start 1 day after parent start, end 1 day before parent end
                            parent_start_dt = datetime.fromisoformat(parent_start.replace('Z', '+00:00'))
                            parent_end_dt = datetime.fromisoformat(parent_end.replace('Z', '+00:00'))
                            
                            # Ensure there's at least 1 day difference
                            if (parent_end_dt - parent_start_dt).days > 1:
                                event_start = (parent_start_dt + timedelta(days=1)).isoformat()
                                event_end = (parent_end_dt - timedelta(days=1)).isoformat()
                            else:
                                # If parent dates are too close, use parent dates
                                event_start = parent_start
                                event_end = parent_end
                            
                            print(f"  Set dates from parent: {event_start} to {event_end}")
                        else:
                            # Parent doesn't have dates either, use default
                            now = datetime.now(timezone.utc)
                            event_start = (now + timedelta(days=1)).isoformat()
                            event_end = (now + timedelta(days=2)).isoformat()
                            print(f"  Set default dates: {event_start} to {event_end}")
                    else:
                        # Parent not found, use default
                        now = datetime.now(timezone.utc)
                        event_start = (now + timedelta(days=1)).isoformat()
                        event_end = (now + timedelta(days=2)).isoformat()
                        print(f"  Set default dates: {event_start} to {event_end}")
                else:
                    # No parent, use default
                    now = datetime.now(timezone.utc)
                    event_start = (now + timedelta(days=1)).isoformat()
                    event_end = (now + timedelta(days=2)).isoformat()
                    print(f"  Set default dates: {event_start} to {event_end}")
                
                # Update the event
                cursor.execute(
                    "UPDATE events SET start_date = %s, end_date = %s, updated_at = NOW() WHERE id = %s",
                    (event_start, event_end, event_id)
                )
                updated_count += 1
        
        conn.commit()
        
        print(f"\nUpdated {updated_count} events with missing dates")
        print("="*70)
        print("  EVENT DATES ADDITION COMPLETE")
        print("="*70 + "\n")
        
    except Exception as e:
        print(f"ERROR: {e}")
        if conn:
            conn.rollback()
        sys.exit(1)
    finally:
        if conn:
            conn.close()


if __name__ == "__main__":
    add_event_dates()
