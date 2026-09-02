"""Safely remove non-allowlisted user accounts and linked profiles.

Usage: python -m backend.cleanup_accounts --apply
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from backend.db import get_postgres_connection

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

        if not args.apply:
            print("\nDRY RUN: no changes made. Run with --apply to execute deletion.")
            return 0

        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        backup_dir = Path("migration_backups")
        backup_dir.mkdir(exist_ok=True)
        backup = {
            "generated_at": stamp,
            "users": [{k: ("[REDACTED]" if k == "password" else v) for k, v in u.items()} for u in users if u in targets],
            "volunteers": rows(conn, "volunteers"),
            "partners": rows(conn, "partners"),
        }
        backup_path = backup_dir / f"account-cleanup-{stamp}.json"
        backup_path.write_text(json.dumps(backup, indent=2, default=str), encoding="utf-8")
        target_ids = [str(u.get("users_id")) for u in targets]
        placeholders = ",".join(["%s"] * len(target_ids))
        with conn.cursor() as cur:
            # Remove dependent operational records, then profiles and accounts.
            for table, column in [
                ("messages", "sender_id"),
                ("messages", "recipient_id"),
                ("project_group_messages", "sender_id"),
                ("volunteer_event_joins", "volunteer_user_id"),
                ("partner_project_applications", "partner_user_id"),
            ]:
                cur.execute(f"DELETE FROM public.{table} WHERE {column} IN ({placeholders})", target_ids)
            cur.execute(f"DELETE FROM public.reports WHERE submitter_user_id IN ({placeholders}) OR partner_user_id IN ({placeholders})", target_ids + target_ids)
            cur.execute(f"DELETE FROM public.volunteer_matches WHERE volunteer_id IN (SELECT volunteers_id FROM public.volunteers WHERE user_id IN ({placeholders}))", target_ids)
            cur.execute(f"DELETE FROM public.volunteer_time_logs WHERE volunteer_id IN (SELECT volunteers_id FROM public.volunteers WHERE user_id IN ({placeholders}))", target_ids)
            cur.execute(f"DELETE FROM public.volunteers WHERE user_id IN ({placeholders})", target_ids)
            cur.execute(f"DELETE FROM public.partners WHERE owner_user_id IN ({placeholders})", target_ids)
            cur.execute(f"DELETE FROM public.users WHERE users_id IN ({placeholders})", target_ids)
        changed = ["users", "volunteers", "partners", "messages", "project_group_messages", "volunteer_event_joins", "volunteer_matches", "volunteer_time_logs", "partner_project_applications", "reports"]
        conn.commit()
        print(f"BACKUP {backup_path}")
        print(f"DELETED {len(targets)} accounts")
        print("CHANGED " + ", ".join(sorted(set(changed))))
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
