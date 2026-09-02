"""
Safely remove all E2E test data (projects, events, proposals) while preserving user accounts.
"""

import json
from datetime import datetime, timezone
from pathlib import Path
from backend.db import get_postgres_connection
from backend.app_storage_seed import (
    get_postgres_hot_storage_collection,
    replace_postgres_hot_storage_collection,
)

def main():
    conn = get_postgres_connection()
    try:
        with conn.cursor() as cur:
            # 1. Identify E2E events to remove
            cur.execute("""
                SELECT events_id, title, parent_project_id, partner_id 
                FROM public.events 
                WHERE events_id LIKE 'e2e%' 
                   OR parent_project_id LIKE 'e2e%' 
                   OR partner_id = 'e2e-partner-1'
                   OR title ILIKE 'e2e%'
            """)
            target_events = cur.fetchall()
            target_event_ids = [r[0] for r in target_events]
            print(f"Target E2E Events to remove ({len(target_event_ids)}):")
            for r in target_events:
                print(f"  - {r[0]} | {r[1]} | parent={r[2]}")

            # 2. Identify E2E projects to remove
            cur.execute("""
                SELECT projects_id, title, partner_id 
                FROM public.projects 
                WHERE projects_id LIKE 'e2e%' 
                   OR partner_id = 'e2e-partner-1'
                   OR title ILIKE 'e2e%'
            """)
            target_projects = cur.fetchall()
            target_project_ids = [r[0] for r in target_projects]
            print(f"\nTarget E2E Projects/Proposals to remove ({len(target_project_ids)}):")
            for r in target_projects:
                print(f"  - {r[0]} | {r[1]} | partner={r[2]}")

            # 3. Create a backup
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            backup_dir = Path("migration_backups")
            backup_dir.mkdir(exist_ok=True)
            backup = {
                "generated_at": stamp,
                "target_event_ids": target_event_ids,
                "target_project_ids": target_project_ids,
            }
            backup_path = backup_dir / f"e2e-data-cleanup-{stamp}.json"
            backup_path.write_text(json.dumps(backup, indent=2), encoding="utf-8")
            print(f"\nBackup saved to {backup_path}")

            # 4. Delete dependent records first
            all_target_ids = list(set(target_event_ids + target_project_ids))
            if all_target_ids:
                ph = ",".join(["%s"] * len(all_target_ids))
                # Reports
                cur.execute(f"DELETE FROM public.reports WHERE project_id IN ({ph})", all_target_ids)
                print(f"Deleted dependent reports: {cur.rowcount}")

                # Applications
                cur.execute(f"DELETE FROM public.partner_project_applications WHERE project_id IN ({ph})", all_target_ids)
                print(f"Deleted dependent partner applications: {cur.rowcount}")

                # Volunteer matches
                cur.execute(f"DELETE FROM public.volunteer_matches WHERE project_id IN ({ph})", all_target_ids)
                print(f"Deleted dependent volunteer matches: {cur.rowcount}")

                # Project group messages
                cur.execute(f"DELETE FROM public.project_group_messages WHERE project_id IN ({ph})", all_target_ids)
                print(f"Deleted dependent project group messages: {cur.rowcount}")

                # Messages referencing project
                cur.execute(f"DELETE FROM public.messages WHERE project_id IN ({ph})", all_target_ids)
                print(f"Deleted dependent messages: {cur.rowcount}")

            # 5. Delete events
            if target_event_ids:
                ph_ev = ",".join(["%s"] * len(target_event_ids))
                cur.execute(f"DELETE FROM public.events WHERE events_id IN ({ph_ev})", target_event_ids)
                print(f"Deleted from public.events: {cur.rowcount}")

            # 6. Delete projects
            if target_project_ids:
                ph_pr = ",".join(["%s"] * len(target_project_ids))
                cur.execute(f"DELETE FROM public.projects WHERE projects_id IN ({ph_pr})", target_project_ids)
                print(f"Deleted from public.projects: {cur.rowcount}")

            conn.commit()

        # 7. Clean hot storage collections
        current_projects = get_postgres_hot_storage_collection(conn, "projects")
        clean_projects = [
            p for p in current_projects 
            if not str(p.get("id") or "").startswith("e2e-") 
               and not str(p.get("title") or "").lower().startswith("e2e")
               and str(p.get("partnerId") or "") != "e2e-partner-1"
               and str(p.get("id") or "") not in target_project_ids
        ]
        replace_postgres_hot_storage_collection(conn, "projects", clean_projects)
        print(f"Cleaned hot storage projects: {len(current_projects)} -> {len(clean_projects)}")

        current_events = get_postgres_hot_storage_collection(conn, "events")
        clean_events = [
            e for e in current_events 
            if not str(e.get("id") or "").startswith("e2e-") 
               and not str(e.get("title") or "").lower().startswith("e2e")
               and str(e.get("parentProjectId") or "") not in target_project_ids
               and str(e.get("id") or "") not in target_event_ids
        ]
        replace_postgres_hot_storage_collection(conn, "events", clean_events)
        print(f"Cleaned hot storage events: {len(current_events)} -> {len(clean_events)}")
        conn.commit()

        print("\n[SUCCESS] All E2E test data cleanly removed.")

    finally:
        conn.close()

if __name__ == "__main__":
    main()
