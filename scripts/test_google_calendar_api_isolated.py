"""Exercise calendar API logic using memory-only fixtures.

No API import, database connection, account creation, or HTTP request is made.
The functions under test are compiled from the actual source AST; only their
database/network boundaries are replaced with fixtures.
"""

from __future__ import annotations

import ast
import asyncio
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import os
from pathlib import Path
import runpy
import secrets
import threading
import time
from typing import Any
import unittest
from unittest.mock import Mock, patch
import uuid


ROOT = Path(__file__).resolve().parents[1]
HELPERS = runpy.run_path(str(ROOT / "backend/google_calendar_sync.py"))
SOURCE = ast.parse((ROOT / "backend/api.py").read_text(encoding="utf-8"))
FUNCTION_NAMES = {
    "_google_calendar_event_metadata", "_apply_google_calendar_schedule",
    "_process_google_calendar_event_changes", "_connect_partner_google_calendar",
    "_lock_google_calendar_transaction", "_google_calendar_lock_for_user",
    "_run_google_calendar_sync", "_renew_google_calendar_watch",
    "_google_calendar_watch", "_google_calendar_stop_watch",
    "_google_calendar_comparison_project", "_ensure_google_calendar_tables",
}


def load_functions() -> dict[str, Any]:
    namespace = {
        **HELPERS, "Any": Any, "datetime": datetime, "timezone": timezone,
        "hashlib": hashlib, "secrets": secrets, "threading": threading,
        "time": time, "uuid": uuid, "os": os, "asyncio": asyncio,
        "_google_calendar_sync_locks": {},
        "_google_calendar_sync_locks_guard": threading.Lock(),
        "TABLE_SPECS": {"projects": {"table": "projects"}, "events": {"table": "events"}},
        "_primary_key_column": lambda key: f"{key}_id",
    }
    selected = [node for node in SOURCE.body if isinstance(node, ast.FunctionDef) and node.name in FUNCTION_NAMES]
    assert {node.name for node in selected} == FUNCTION_NAMES
    exec(compile(ast.Module(body=selected, type_ignores=[]), str(ROOT / "backend/api.py"), "exec"), namespace)
    return namespace


class FixtureCursor:
    def __init__(self, fixture: "FixtureState") -> None:
        self.fixture = fixture
        self.rowcount = 1

    def __enter__(self) -> "FixtureCursor":
        return self

    def __exit__(self, *args: Any) -> None:
        pass

    def execute(self, query: Any, params: Any = None) -> None:
        rendered = str(query)
        self.fixture.queries.append((rendered, params))
        if 'start_date = %s, end_date = %s' in rendered:
            assert params[-1] == self.fixture.project["id"]
            self.fixture.project["startDate"], self.fixture.project["endDate"] = params[:2]
            if 'repeat_rule = %s' in rendered:
                self.fixture.project["repeat"] = params[2]
        if 'update google_calendar_connections set sync_token' in rendered:
            self.fixture.connection_row["sync_token"] = params[0]

    def fetchone(self) -> tuple[bool]:
        return (self.fixture.lock_available,)


class FixtureConnection:
    def __init__(self, fixture: "FixtureState") -> None:
        self.fixture = fixture

    def cursor(self, **kwargs: Any) -> FixtureCursor:
        return FixtureCursor(self.fixture)

    def commit(self) -> None:
        if self.fixture.fail_commit:
            raise RuntimeError("injected commit failure")
        self.fixture.commits += 1


class FixtureState:
    def __init__(self) -> None:
        self.namespace = load_functions()
        self.project = {
            "id": "fixture-event", "isEvent": True, "title": "Latest official title",
            "startDate": "2026-10-02T08:00:00+08:00", "endDate": "2026-10-02T09:00:00+08:00",
            "repeat": "Does not repeat", "volunteers": ["memory-only-volunteer"],
            "imageUrl": "memory-only-image", "internalTasks": [{"id": "memory-only-task"}],
        }
        event_id = HELPERS["stable_google_event_id"](self.project["id"])
        self.google_event = {"id": event_id, "etag": "fixture-etag", "status": "confirmed", **HELPERS["format_project_as_google_event"](self.project)}
        self.links = [{
            "project_id": self.project["id"], "google_event_id": event_id,
            "last_exported_start": self.project["startDate"], "last_exported_end": self.project["endDate"],
            "last_exported_repeat": "Does not repeat",
        }]
        self.connection_row = {
            "client_id": "fixture-client", "encrypted_refresh_token": "fixture-encrypted-token",
            "channel_id": "fixture-channel", "resource_id": "fixture-resource",
            "sync_token": "fixture-old-cursor", "channel_expiration": int((time.time() + 48 * 3600) * 1000),
        }
        self.queries: list[Any] = []
        self.api_calls: list[Any] = []
        self.commits = 0
        self.rollbacks = 0
        self.fail_commit = False
        self.lock_available = True
        self.project_exists = True
        self.approved = True
        self.changes: list[dict[str, Any]] = []
        self.sync_calls: list[str | None] = []
        self.conn = FixtureConnection(self)

        @contextmanager
        def connection() -> Any:
            before = deepcopy((self.project, self.links, self.connection_row))
            try:
                yield self.conn
            except Exception:
                self.project, self.links, self.connection_row = before
                self.rollbacks += 1
                raise

        def approved_items(connection: Any, partner_user_id: str) -> Any:
            return ({"fixture-root"}, {self.project["id"]: ("projects", deepcopy(self.project))} if self.approved and self.project_exists else {})

        def get_item(connection: Any, key: str, item_id: str, **kwargs: Any) -> Any:
            if key == "users":
                return {"email": "fixture@example.invalid"}
            return deepcopy(self.project) if self.project_exists else None

        def update_link(connection: Any, partner_user_id: str, project_id: str, start: str, end: str, repeat: str = "Does not repeat") -> None:
            for link in self.links:
                if link["project_id"] == project_id:
                    link.update(last_exported_start=start, last_exported_end=end, last_exported_repeat=repeat)

        def upsert_link(connection: Any, partner_user_id: str, project_id: str, event_id: str, start: str, end: str, repeat: str = "Does not repeat") -> None:
            self.links[:] = [{
                "project_id": project_id, "google_event_id": event_id,
                "last_exported_start": start, "last_exported_end": end, "last_exported_repeat": repeat,
            }]

        def google_api(path: str, access_token: str, method: str = "GET", payload: Any = None, **kwargs: Any) -> Any:
            self.api_calls.append((path, method, deepcopy(payload), kwargs))
            if path.endswith("/channels/stop") or path == "/channels/stop":
                return {}
            if method == "PATCH":
                self.google_event.update(deepcopy(payload))
                return deepcopy(self.google_event)
            if method == "GET":
                return deepcopy(self.google_event)
            if method == "POST" and path.endswith("/events"):
                self.google_event = deepcopy(payload)
                return deepcopy(self.google_event)
            raise AssertionError(f"Unexpected fixture request: {method} {path}")

        def list_events(access_token: str, sync_token: str | None = None) -> Any:
            self.sync_calls.append(sync_token)
            return deepcopy(self.changes), "fixture-new-cursor"

        self.namespace.update({
            "get_connection": connection, "_ensure_google_calendar_tables": Mock(),
            "_google_calendar_row": lambda connection, partner: deepcopy(self.connection_row),
            "_google_calendar_links": lambda connection, partner: deepcopy(self.links),
            "_approved_partner_calendar_items": approved_items,
            "_postgres_get_hot_item_by_id": get_item,
            "_postgres_get_project_like_item_by_id": lambda connection, project_id, **kwargs: (get_item(connection, "projects", project_id), "projects"),
            "_google_calendar_update_link_schedule": update_link,
            "_google_calendar_upsert_link": upsert_link,
            "_google_calendar_upsert_connection": Mock(),
            "exchange_authorization_code": lambda *args: {"access_token": "fixture-access-token", "refresh_token": "fixture-refresh-token"},
            "get_google_email": lambda token: "fixture@example.invalid",
            "encrypt_refresh_token": lambda token: "fixture-encrypted-token",
            "decrypt_refresh_token": lambda token: "fixture-refresh-token",
            "refresh_access_token": lambda *args: "fixture-access-token",
            "google_api_request": google_api,
            "_google_calendar_list_events": list_events,
            "_google_calendar_watch": lambda token: ("fixture-new-channel", "fixture-channel-token", "fixture-new-resource", int((time.time() + 48 * 3600) * 1000)),
            "_google_calendar_stop_watch": Mock(),
            "_invalidate_collection_cache": Mock(),
            "_projects_snapshot_cache": Mock(), "_realtime_event_loop": None,
        })

    def run_sync(self) -> list[str]:
        return self.namespace["_run_google_calendar_sync"]("memory-only-partner", broadcast_changes=False)

    def connect(self) -> Any:
        payload = {
            "authorizationCode": "fixture-authorization-code", "clientId": "fixture-client",
            "redirectUri": "https://fixture.example.invalid/callback", "codeVerifier": "fixture-verifier",
            "projectIds": [self.project["id"]],
        }
        with patch.dict(os.environ, {
            "GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY": "fixture-key-unused-by-mock",
            "GOOGLE_CALENDAR_WEBHOOK_URL": "https://fixture.example.invalid/notifications",
        }):
            return self.namespace["_connect_partner_google_calendar"]("memory-only-partner", payload)


class CalendarApiIsolatedTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fixture = FixtureState()

    def test_unique_connect_handler_and_public_webhook_aliases(self) -> None:
        routes = []
        for node in SOURCE.body:
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for decorator in node.decorator_list:
                if isinstance(decorator, ast.Call) and decorator.args and isinstance(decorator.args[0], ast.Constant):
                    routes.append(decorator.args[0].value)
        self.assertEqual(routes.count("/partner/google-calendar/connect"), 1)
        self.assertEqual(routes.count("/google-calendar/partner/notifications"), 1)
        self.assertEqual(routes.count("/api/google-calendar/partner/notifications"), 1)

    def test_inbound_preserves_latest_non_schedule_fields(self) -> None:
        stale = {**self.fixture.project, "title": "obsolete title", "volunteers": []}
        self.fixture.google_event["start"]["dateTime"] = "2026-10-02T10:00:00+08:00"
        self.fixture.google_event["end"]["dateTime"] = "2026-10-02T11:00:00+08:00"
        updated, changed = self.fixture.namespace["_apply_google_calendar_schedule"](self.fixture.conn, "projects", stale, self.fixture.google_event)
        self.assertTrue(changed)
        self.assertEqual(updated["title"], "Latest official title")
        self.assertEqual(updated["volunteers"], ["memory-only-volunteer"])
        self.assertEqual(updated["imageUrl"], "memory-only-image")
        self.assertEqual(updated["internalTasks"], [{"id": "memory-only-task"}])
        self.assertFalse(any("insert into" in query.lower() for query, _ in self.fixture.queries))

    def test_deleted_event_is_never_recreated(self) -> None:
        self.fixture.project_exists = False
        _, changed = self.fixture.namespace["_apply_google_calendar_schedule"](self.fixture.conn, "projects", self.fixture.project, self.fixture.google_event)
        self.assertFalse(changed)
        self.assertEqual(self.fixture.queries, [])

    def test_unapproved_event_cannot_import(self) -> None:
        self.fixture.approved = False
        self.fixture.google_event["end"]["dateTime"] = "2026-10-02T11:00:00+08:00"
        self.fixture.changes = [deepcopy(self.fixture.google_event)]
        self.assertEqual(self.fixture.run_sync(), [])
        self.assertEqual(self.fixture.project["endDate"], "2026-10-02T09:00:00+08:00")
        self.assertEqual(self.fixture.api_calls, [])

    def test_google_change_imports_once_without_stale_outbound_patch(self) -> None:
        self.fixture.google_event["start"]["dateTime"] = "2026-10-02T10:00:00+08:00"
        self.fixture.google_event["end"]["dateTime"] = "2026-10-02T11:00:00+08:00"
        self.fixture.changes = [deepcopy(self.fixture.google_event)]
        self.assertEqual(self.fixture.run_sync(), ["projects"])
        self.assertEqual(self.fixture.project["endDate"], "2026-10-02T11:00:00+08:00")
        self.assertEqual(self.fixture.links[0]["last_exported_end"], "2026-10-02T11:00:00+08:00")
        self.assertFalse(any(method == "PATCH" for _, method, _, _ in self.fixture.api_calls))
        self.assertEqual(self.fixture.run_sync(), [])

    def test_mock_google_save_refreshes_admin_volunteer_and_partner_views(self) -> None:
        """Mock a Google edit through DB commit, websocket broadcast, and UI listeners."""
        self.fixture.google_event["start"]["dateTime"] = "2026-10-05T10:00:00+08:00"
        self.fixture.google_event["end"]["dateTime"] = "2026-10-05T11:00:00+08:00"
        self.fixture.changes = [deepcopy(self.fixture.google_event)]

        ui_source_paths = {
            "admin": ROOT / "contexts/GlobalDataContext.tsx",
            "volunteer": ROOT / "screens/VolunteerEventsScreen.tsx",
            "partner": ROOT / "screens/PartnerProgramManagementScreen.tsx",
        }
        for role, source_path in ui_source_paths.items():
            source_text = source_path.read_text(encoding="utf-8-sig")
            start = source_text.find("subscribeToStorageChanges(")
            self.assertGreaterEqual(start, 0, f"{role} view must subscribe to shared storage.")
            subscription = source_text[start:start + 900]
            self.assertRegex(subscription, r"['\"](?:projects|events)['\"]",
                             f"{role} view must watch project/event schedule keys.")

        storage_source = (ROOT / "models/storage.ts").read_text(encoding="utf-8-sig")
        self.assertIn("const STORAGE_CHANGE_POLL_INTERVAL_MS = 1000;", storage_source)
        self.assertIn("new WebSocket(socketUrl)", storage_source)
        self.assertIn("payload.type !== 'storage.changed'", storage_source)

        refreshed_views: dict[str, tuple[str, str]] = {}
        subscribers = {
            role: {"projects", "events"}
            for role in ("admin", "volunteer", "partner")
        }

        async def broadcast_storage_event(keys: list[str]) -> None:
            event = {"type": "storage.changed", "keys": keys}
            for role, watched_keys in subscribers.items():
                if set(event["keys"]) & watched_keys:
                    # Each mock UI refetches the authoritative canonical record.
                    refreshed_views[role] = (
                        self.fixture.project["startDate"],
                        self.fixture.project["endDate"],
                    )

        class RunningLoop:
            @staticmethod
            def is_running() -> bool:
                return True

        class ConnectionManager:
            @staticmethod
            def broadcast_storage_event(keys: list[str]) -> Any:
                return broadcast_storage_event(keys)

        def submit_broadcast(coroutine: Any, loop: Any) -> None:
            asyncio.run(coroutine)

        class AsyncioBridge:
            run_coroutine_threadsafe = staticmethod(submit_broadcast)

        self.fixture.namespace.update({
            "_realtime_event_loop": RunningLoop(),
            "connection_manager": ConnectionManager(),
            "asyncio": AsyncioBridge,
        })
        changed_keys = self.fixture.namespace["_run_google_calendar_sync"](
            "memory-only-partner", broadcast_changes=True,
        )

        expected_schedule = (
            "2026-10-05T10:00:00+08:00",
            "2026-10-05T11:00:00+08:00",
        )
        self.assertEqual(changed_keys, ["projects"])
        self.assertEqual(self.fixture.project["startDate"], expected_schedule[0])
        self.assertEqual(self.fixture.project["endDate"], expected_schedule[1])
        self.assertEqual(set(refreshed_views), {"admin", "volunteer", "partner"})
        self.assertTrue(all(schedule == expected_schedule for schedule in refreshed_views.values()))

    def test_official_change_pushes_schedule_only_with_etag(self) -> None:
        self.fixture.project["endDate"] = "2026-10-02T11:00:00+08:00"
        self.assertEqual(self.fixture.run_sync(), [])
        patches = [call for call in self.fixture.api_calls if call[1] == "PATCH"]
        self.assertEqual(len(patches), 1)
        _, _, payload, kwargs = patches[0]
        self.assertEqual(set(payload), {"start", "end", "recurrence"})
        self.assertEqual(kwargs["headers"], {"If-Match": "fixture-etag"})
        self.assertEqual(self.fixture.links[0]["last_exported_end"], "2026-10-02T11:00:00+08:00")

    def test_newer_google_edit_wins_when_official_schedule_also_changed(self) -> None:
        self.fixture.project["endDate"] = "2026-10-02T10:00:00+08:00"
        self.fixture.google_event["end"]["dateTime"] = "2026-10-02T11:00:00+08:00"
        self.assertEqual(self.fixture.run_sync(), ["projects"])
        self.assertEqual(self.fixture.project["endDate"], "2026-10-02T11:00:00+08:00")
        self.assertFalse(any(method == "PATCH" for _, method, _, _ in self.fixture.api_calls))

    def test_commit_failure_returns_no_uncommitted_changes(self) -> None:
        self.fixture.google_event["end"]["dateTime"] = "2026-10-02T11:00:00+08:00"
        self.fixture.changes = [deepcopy(self.fixture.google_event)]
        self.fixture.fail_commit = True
        self.assertEqual(self.fixture.run_sync(), [])
        self.assertEqual(self.fixture.rollbacks, 1)
        self.assertEqual(self.fixture.project["endDate"], "2026-10-02T09:00:00+08:00")
        self.fixture.namespace["_invalidate_collection_cache"].assert_not_called()

    def test_cross_worker_transaction_lock_prevents_duplicate_work(self) -> None:
        self.fixture.lock_available = False
        self.assertEqual(self.fixture.run_sync(), [])
        self.assertEqual(self.fixture.sync_calls, [])
        self.assertEqual(self.fixture.api_calls, [])

    def test_expired_google_cursor_falls_back_to_full_snapshot(self) -> None:
        original_list = self.fixture.namespace["_google_calendar_list_events"]
        expired_cursor = Mock(side_effect=[HELPERS["GoogleCalendarError"]("expired cursor", 410), original_list("fixture-access-token")])
        self.fixture.namespace["_google_calendar_list_events"] = expired_cursor
        self.assertEqual(self.fixture.run_sync(), [])
        self.assertEqual(expired_cursor.call_args_list[0].args[1], "fixture-old-cursor")
        self.assertEqual(len(expired_cursor.call_args_list[1].args), 1)

    def test_google_etag_conflict_preserves_baseline_for_next_sync(self) -> None:
        self.fixture.project["endDate"] = "2026-10-02T11:00:00+08:00"
        original_api = self.fixture.namespace["google_api_request"]
        def conflicting_api(path: str, token: str, **kwargs: Any) -> Any:
            if kwargs.get("method") == "PATCH":
                raise HELPERS["GoogleCalendarError"]("etag conflict", 412)
            return original_api(path, token, **kwargs)
        self.fixture.namespace["google_api_request"] = conflicting_api
        self.assertEqual(self.fixture.run_sync(), [])
        self.assertEqual(self.fixture.links[0]["last_exported_end"], "2026-10-02T09:00:00+08:00")

    def test_cancelled_google_event_never_removes_official_event(self) -> None:
        self.fixture.google_event["status"] = "cancelled"
        self.fixture.project["endDate"] = "2026-10-02T11:00:00+08:00"
        self.fixture.changes = [deepcopy(self.fixture.google_event)]
        self.assertEqual(self.fixture.run_sync(), [])
        self.assertTrue(self.fixture.project_exists)
        self.assertFalse(any(method == "PATCH" for _, method, _, _ in self.fixture.api_calls))

    def test_individual_recurrence_instance_cannot_replace_series_schedule(self) -> None:
        self.fixture.google_event["id"] += "_20261002T000000Z"
        self.fixture.google_event["recurringEventId"] = self.fixture.links[0]["google_event_id"]
        self.fixture.changes = [deepcopy(self.fixture.google_event)]
        self.assertEqual(self.fixture.run_sync(), [])
        self.assertEqual(self.fixture.project["startDate"], "2026-10-02T08:00:00+08:00")

    def test_legacy_all_day_inclusive_end_is_migrated_without_official_date_change(self) -> None:
        self.fixture.project.update(startDate="2026-10-02", endDate="2026-10-04")
        self.fixture.google_event.update(start={"date": "2026-10-02"}, end={"date": "2026-10-04"})
        self.fixture.links = []
        self.fixture.namespace["_run_google_calendar_sync"] = Mock(return_value=[])
        self.fixture.namespace["_google_calendar_list_events"] = lambda token: ([deepcopy(self.fixture.google_event)], "fixture-new-cursor")
        self.assertEqual(self.fixture.connect(), (1, []))
        self.assertEqual(self.fixture.project["endDate"], "2026-10-04")
        self.assertEqual(self.fixture.google_event["end"], {"date": "2026-10-05"})

    def test_legacy_plain_recurring_range_is_migrated_without_official_date_change(self) -> None:
        self.fixture.project.update(startDate="2026-10-02T08:00:00+08:00", endDate="2026-10-10T09:00:00+08:00", repeat="Daily")
        self.fixture.google_event.update(start={"dateTime": self.fixture.project["startDate"]}, end={"dateTime": self.fixture.project["endDate"]})
        self.fixture.links = []
        self.fixture.namespace["_run_google_calendar_sync"] = Mock(return_value=[])
        self.fixture.namespace["_google_calendar_list_events"] = lambda token: ([deepcopy(self.fixture.google_event)], "fixture-new-cursor")
        self.assertEqual(self.fixture.connect(), (1, []))
        self.assertEqual(self.fixture.project["endDate"], "2026-10-10T09:00:00+08:00")
        self.assertEqual(self.fixture.google_event["end"]["dateTime"], "2026-10-02T09:00:00+08:00")
        self.assertEqual(self.fixture.google_event["recurrence"], ["RRULE:FREQ=DAILY;UNTIL=20261010T000000Z"])

    def test_root_project_date_change_imports(self) -> None:
        self.fixture.project["isEvent"] = False
        self.fixture.google_event["end"]["dateTime"] = "2026-10-03T11:00:00+08:00"
        self.fixture.changes = [deepcopy(self.fixture.google_event)]
        self.assertEqual(self.fixture.run_sync(), ["projects"])
        self.assertEqual(self.fixture.project["endDate"], "2026-10-03T11:00:00+08:00")
        self.assertFalse(self.fixture.project["isEvent"])

    def test_google_repeat_changes_never_change_official_rule(self) -> None:
        self.fixture.google_event["recurrence"] = ["RRULE:FREQ=DAILY;UNTIL=20261010T000000Z"]
        self.fixture.changes = [deepcopy(self.fixture.google_event)]
        self.assertEqual(self.fixture.run_sync(), [])
        self.assertEqual(self.fixture.project["repeat"], "Does not repeat")
        self.assertEqual(self.fixture.queries[-1][1][0], "fixture-new-cursor")
        self.assertFalse(any("repeat_rule =" in query for query, _ in self.fixture.queries))

    def test_official_repeat_only_change_is_pushed_outbound(self) -> None:
        self.fixture.project["repeat"] = "Daily"
        self.assertEqual(self.fixture.run_sync(), [])
        self.assertEqual(self.fixture.google_event["recurrence"], ["RRULE:FREQ=DAILY;UNTIL=20261002T000000Z"])
        self.assertEqual(self.fixture.project["repeat"], "Daily")
        self.assertEqual(self.fixture.links[0]["last_exported_repeat"], "Daily")

    def test_official_repeat_change_is_preserved_during_google_time_import(self) -> None:
        self.fixture.project["repeat"] = "Daily"
        self.fixture.project["endDate"] = "2026-10-10T09:00:00+08:00"
        self.fixture.google_event = {"id": self.fixture.links[0]["google_event_id"], "etag": "fixture-etag", **HELPERS["format_project_as_google_event"](self.fixture.project)}
        self.fixture.links[0].update(last_exported_end=self.fixture.project["endDate"], last_exported_repeat="Daily")
        self.fixture.project["repeat"] = "Weekly"
        self.fixture.google_event["end"]["dateTime"] = "2026-10-02T11:00:00+08:00"
        self.fixture.changes = [deepcopy(self.fixture.google_event)]
        self.assertEqual(self.fixture.run_sync(), ["projects"])
        self.assertEqual(self.fixture.project["repeat"], "Weekly")
        self.assertEqual(self.fixture.project["endDate"], "2026-10-10T11:00:00+08:00")
        self.assertIn("FREQ=WEEKLY", self.fixture.google_event["recurrence"][0])
        self.assertEqual(self.fixture.links[0]["last_exported_repeat"], "Weekly")

    def test_existing_schema_check_performs_no_ddl(self) -> None:
        namespace = load_functions()
        cursor = Mock()
        cursor.fetchone.return_value = ("connections", "links", "index", True)
        connection = Mock()
        connection.cursor.return_value.__enter__ = Mock(return_value=cursor)
        connection.cursor.return_value.__exit__ = Mock(return_value=None)
        namespace["_ensure_google_calendar_tables"](connection)
        self.assertEqual(cursor.execute.call_count, 1)
        self.assertTrue(cursor.execute.call_args.args[0].startswith("select "))

    def test_failed_connect_commit_stops_unused_google_watch(self) -> None:
        self.fixture.fail_commit = True
        with self.assertRaises(RuntimeError):
            self.fixture.connect()
        self.fixture.namespace["_google_calendar_stop_watch"].assert_called_once_with(
            "fixture-access-token", "fixture-new-channel", "fixture-new-resource",
        )
        self.assertEqual(self.fixture.rollbacks, 1)


if __name__ == "__main__":
    unittest.main()
