"""Safely remove non-allowlisted user accounts and linked profiles.

Usage: python -m backend.cleanup_accounts --apply
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from backend.db import get_postgres_connection
from backend.relational_mirror import _stable_bigint_id

KEEP_USER_IDS = {
    "user-1788285740560",  # NVC — nvc@gmail.com
    "user-1788132906999",  # Rainer Astodillo — partner (rainerastodillo079@gmail.com)
    "user-1788128433682",  # Raijen — volunteer (rainerastodillo7@gmail.com)
    "user-1788121297340",  # Rainer Astodillo — volunteer (rainerastodillo27@gmail.com)
}


def rows(conn, table: str):
    with conn.cursor() as cur:
        cur.execute(f"SELECT row_to_json(t) FROM public.{table} t")
        return [r[0] for r in cur.fetchall()]


def as_list(value):
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except (TypeError, ValueError, json.JSONDecodeError):
            return []
        return parsed if isinstance(parsed, list) else []
    return []


def delete_in(cursor, table: str, column: str, values: set[str]) -> int:
    normalized = sorted({str(value).strip() for value in values if str(value).strip()})
    if not normalized:
        return 0
    placeholders = ",".join(["%s"] * len(normalized))
    cursor.execute(
        f"DELETE FROM public.{table} WHERE {column} IN ({placeholders})",
        normalized,
    )
    return cursor.rowcount


def delete_with_any(cursor, table: str, conditions: list[tuple[str, set[str]]]) -> int:
    clauses = []
    params = []
    for column, values in conditions:
        normalized = sorted({str(value).strip() for value in values if str(value).strip()})
        if normalized:
            clauses.append(f"{column} IN ({','.join(['%s'] * len(normalized))})")
            params.extend(normalized)
    if not clauses:
        return 0
    cursor.execute(
        f"DELETE FROM public.{table} WHERE {' OR '.join(clauses)}",
        params,
    )
    return cursor.rowcount


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    conn = get_postgres_connection()
    try:
        users = rows(conn, "users")
        targets = [u for u in users if str(u.get("users_id") or "") not in KEEP_USER_IDS]
        print("TARGETS TO REMOVE:")
        for u in targets:
            print(f"- {u.get('users_id')} | {u.get('name')} | {u.get('role')} | {u.get('email')}")
        print("\nACCOUNTS BEING KEPT:")
        for u in users:
            if str(u.get("users_id") or "") in KEEP_USER_IDS:
                print(f"+ {u.get('users_id')} | {u.get('name')} | {u.get('role')} | {u.get('email')}")

        volunteers = rows(conn, "volunteers")
        partners = rows(conn, "partners")
        projects = rows(conn, "projects")
        events = rows(conn, "events")
        programs = rows(conn, "programs")

        target_ids = {str(u.get("users_id") or "").strip() for u in targets}
        deleted_volunteer_ids = {
            str(v.get("volunteers_id") or "").strip()
            for v in volunteers
            if str(v.get("user_id") or "").strip() in target_ids
        }
        deleted_partner_ids = {
            str(p.get("partners_id") or "").strip()
            for p in partners
            if str(p.get("owner_user_id") or "").strip() in target_ids
        }
        deleted_project_ids = {
            str(p.get("projects_id") or "").strip()
            for p in projects
            if str(p.get("projects_id") or "").strip().startswith("e2e-")
            or str(p.get("partner_id") or "").strip() in deleted_partner_ids
        }
        deleted_event_ids = {
            str(event.get("events_id") or "").strip()
            for event in events
            if str(event.get("events_id") or "").strip().startswith("e2e-")
            or str(event.get("partner_id") or "").strip() in deleted_partner_ids
            or str(event.get("parent_project_id") or "").strip() in deleted_project_ids
        }
        deleted_program_ids = {
            str(program.get("programs_id") or "").strip()
            for program in programs
            if str(program.get("programs_id") or "").strip().startswith("e2e-")
            or str(program.get("partner_id") or "").strip() in deleted_partner_ids
        }

        surviving_project_items = [
            item for item in projects
            if str(item.get("projects_id") or "").strip() not in deleted_project_ids
        ]
        surviving_event_items = [
            item for item in events
            if str(item.get("events_id") or "").strip() not in deleted_event_ids
        ]
        retained_task_ids = set()
        for item in [*surviving_project_items, *surviving_event_items]:
            for task in as_list(item.get("internal_tasks")):
                if isinstance(task, dict) and task.get("id"):
                    retained_task_ids.add(str(_stable_bigint_id(task.get("id"))))

        print("\nLINKED DATA TO REMOVE:")
        print(f"- Projects: {len(deleted_project_ids)}")
        print(f"- Events: {len(deleted_event_ids)}")
        print(f"- Programs: {len(deleted_program_ids)}")
        print(f"- Volunteer profiles: {len(deleted_volunteer_ids)}")
        print(f"- Partner profiles: {len(deleted_partner_ids)}")

        if not args.apply:
            print("\nDRY RUN: no changes made. Run with --apply to execute deletion.")
            return 0

        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        backup_dir = Path("migration_backups")
        backup_dir.mkdir(exist_ok=True)
        backup = {
            "generated_at": stamp,
            "users": [{k: ("[REDACTED]" if k == "password" else v) for k, v in u.items()} for u in users if u in targets],
            "volunteers": [v for v in volunteers if str(v.get("volunteers_id") or "") in deleted_volunteer_ids],
            "partners": [p for p in partners if str(p.get("partners_id") or "") in deleted_partner_ids],
            "projects": [p for p in projects if str(p.get("projects_id") or "") in deleted_project_ids],
            "events": [e for e in events if str(e.get("events_id") or "") in deleted_event_ids],
        }
        backup_path = backup_dir / f"account-cleanup-{stamp}.json"
        backup_path.write_text(json.dumps(backup, indent=2, default=str), encoding="utf-8")
        deleted_counts = {}
        with conn.cursor() as cur:
            deleted_counts["messages"] = delete_with_any(
                cur,
                "messages",
                [("sender_id", target_ids), ("recipient_id", target_ids), ("project_id", deleted_project_ids)],
            )
            deleted_counts["project_group_messages"] = delete_with_any(
                cur,
                "project_group_messages",
                [("sender_id", target_ids), ("project_id", deleted_project_ids)],
            )
            deleted_counts["event_email_reminders"] = delete_with_any(
                cur,
                "event_email_reminders",
                [("event_id", deleted_event_ids), ("volunteer_id", deleted_volunteer_ids)],
            )
            deleted_counts["volunteer_event_joins"] = delete_with_any(
                cur,
                "volunteer_event_joins",
                [
                    ("volunteer_id", deleted_volunteer_ids),
                    ("volunteer_user_id", target_ids),
                    ("project_id", deleted_project_ids),
                ],
            )
            deleted_counts["volunteer_matches"] = delete_with_any(
                cur,
                "volunteer_matches",
                [("volunteer_id", deleted_volunteer_ids), ("project_id", deleted_project_ids)],
            )
            deleted_counts["volunteer_time_logs"] = delete_with_any(
                cur,
                "volunteer_time_logs",
                [("volunteer_id", deleted_volunteer_ids), ("project_id", deleted_project_ids)],
            )
            deleted_counts["partner_project_applications"] = delete_with_any(
                cur,
                "partner_project_applications",
                [("partner_user_id", target_ids), ("project_id", deleted_project_ids)],
            )
            deleted_counts["reports"] = delete_with_any(
                cur,
                "reports",
                [
                    ("submitter_user_id", target_ids),
                    ("partner_user_id", target_ids),
                    ("partner_id", deleted_partner_ids),
                    ("project_id", deleted_project_ids),
                ],
            )
            deleted_counts["status_updates"] = delete_in(cur, "status_updates", "project_id", deleted_project_ids)
            deleted_counts["events"] = delete_in(cur, "events", "events_id", deleted_event_ids)
            deleted_counts["projects"] = delete_in(cur, "projects", "projects_id", deleted_project_ids)
            deleted_counts["programs"] = delete_in(cur, "programs", "programs_id", deleted_program_ids)
            deleted_counts["admin_planning_calendars"] = delete_in(
                cur,
                "admin_planning_calendars",
                "admin_planning_calendars_id",
                {str(calendar_id) for calendar_id in ["e2e-calendar-nutrition"]},
            )
            if retained_task_ids:
                cur.execute(
                    f"DELETE FROM public.tasks WHERE tasks_id NOT IN ({','.join(['%s'] * len(retained_task_ids))})",
                    sorted(retained_task_ids),
                )
            else:
                cur.execute("DELETE FROM public.tasks")
            deleted_counts["tasks"] = cur.rowcount
            deleted_counts["volunteers"] = delete_in(cur, "volunteers", "user_id", target_ids)
            deleted_counts["partners"] = delete_in(cur, "partners", "owner_user_id", target_ids)
            deleted_counts["users"] = delete_in(cur, "users", "users_id", target_ids)
        changed = sorted(deleted_counts)
        conn.commit()
        print(f"BACKUP {backup_path}")
        print(f"DELETED {len(targets)} accounts")
        print("DELETED RECORDS:")
        for table, count in deleted_counts.items():
            if count:
                print(f"- {table}: {count}")
        print("CHANGED " + ", ".join(sorted(set(changed))))
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
