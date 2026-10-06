"""Exercise partner event task saves with memory-only storage fixtures.

The handlers are compiled from the actual API source without importing the API,
opening a database connection, or making a network request.
"""

from __future__ import annotations

import ast
import asyncio
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
import runpy
from types import SimpleNamespace
from typing import Any
import unittest
from unittest.mock import AsyncMock, Mock


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ast.parse((ROOT / "backend/api.py").read_text(encoding="utf-8"))
FUNCTION_NAMES = {
    "_normalize_role",
    "_partner_can_manage_scoped_event",
    "_ensure_event_field_officer_task",
    "_normalize_internal_task_assignment_ids",
    "_validate_internal_task_assignment_limits",
    "save_partner_event",
}


class FixtureHttpException(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def load_functions(function_names: set[str] | None = None) -> dict[str, Any]:
    selected_names = function_names or FUNCTION_NAMES
    calendar_helpers = runpy.run_path(str(ROOT / "backend/google_calendar_sync.py"))
    namespace = {
        "Any": Any,
        "FastAPIRequest": Any,
        "StoragePayload": Any,
        "HTTPException": FixtureHttpException,
        "datetime": datetime,
        "timezone": timezone,
        "APP_TIMEZONE": timezone(timedelta(hours=8)),
        "asyncio": asyncio,
        "normalize_schedule_value": calendar_helpers["normalize_schedule_value"],
    }
    selected = [
        deepcopy(node)
        for node in SOURCE.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        and node.name in selected_names
    ]
    assert {node.name for node in selected} == selected_names
    for node in selected:
        node.decorator_list = []
    exec(
        compile(ast.Module(body=selected, type_ignores=[]), str(ROOT / "backend/api.py"), "exec"),
        namespace,
    )
    return namespace


def task(task_id: str, **fields: Any) -> dict[str, Any]:
    return {
        "id": task_id,
        "title": "Community preparation",
        "isFieldOfficer": False,
        "volunteersNeeded": 2,
        "assignedVolunteerIds": [],
        "status": "Unassigned",
        **fields,
    }


class FixtureState:
    def __init__(self) -> None:
        self.namespace = load_functions()
        self.session = {"sub": "fixture-partner", "role": "partner"}
        self.parent = {
            "id": "fixture-project",
            "partnerId": "fixture-organization",
            "startDate": "2026-10-01",
            "endDate": "2026-10-31",
        }
        self.event = {
            "id": "fixture-event",
            "isEvent": True,
            "parentProjectId": self.parent["id"],
            "title": "Official event title",
            "startDate": "2026-10-06T08:00:00+08:00",
            "endDate": "2026-10-06T09:00:00+08:00",
            "volunteersNeeded": 5,
            "volunteers": ["fixture-volunteer-profile"],
            "joinedUserIds": ["fixture-volunteer-user"],
            "statusUpdates": [{"id": "fixture-update"}],
            "internalTasks": [task("fixture-existing-task")],
        }
        self.existing_event: dict[str, Any] | None = deepcopy(self.event)
        self.scope = {self.parent["id"]}
        self.volunteers = [{"id": "fixture-volunteer-profile", "userId": "fixture-volunteer-user"}]
        self.saved: list[dict[str, Any]] = []
        self.connection = Mock()
        cursor = Mock()
        cursor.__enter__ = Mock(return_value=cursor)
        cursor.__exit__ = Mock(return_value=None)
        cursor.fetchall.return_value = [(record["id"], record["userId"]) for record in self.volunteers]
        self.connection.cursor.return_value = cursor
        self.broadcast = AsyncMock()
        self.calendar_push = AsyncMock()

        @contextmanager
        def connection() -> Any:
            yield self.connection

        def get_item(connection: Any, collection: str, item_id: str, **options: Any) -> Any:
            if collection == "events" and item_id == self.event["id"]:
                return deepcopy(self.existing_event)
            if collection == "projects" and item_id == self.parent["id"]:
                return deepcopy(self.parent)
            if collection == "volunteers":
                return next((deepcopy(record) for record in self.volunteers if record["id"] == item_id), None)
            return None

        def upsert(connection: Any, collection: str, record: dict[str, Any]) -> Any:
            assert collection == "events"
            self.saved.append(deepcopy(record))
            return deepcopy(record)

        self.namespace.update({
            "_get_session_user": lambda request: deepcopy(self.session),
            "_require_postgres": Mock(),
            "get_connection": connection,
            "_postgres_get_hot_item_by_id": get_item,
            "_postgres_get_hot_items_by_field": Mock(return_value=[]),
            "_get_partner_project_scope": lambda connection, partner_id: set(self.scope),
            "_primary_key_column": lambda collection: f"{collection}_id",
            "_reject_duplicate_event_writes": Mock(),
            "_postgres_upsert_hot_item": upsert,
            "_invalidate_collection_cache": Mock(),
            "_projects_snapshot_cache": Mock(),
            "connection_manager": SimpleNamespace(broadcast_storage_event=self.broadcast),
            "_push_partner_google_calendar_item": self.calendar_push,
        })

    async def save(self, payload: dict[str, Any]) -> dict[str, Any]:
        response = await self.namespace["save_partner_event"](object(), self.event["id"], deepcopy(payload))
        await asyncio.sleep(0)
        return response


class PartnerEventTaskSaveTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.fixture = FixtureState()

    async def test_partner_adds_operational_task_and_preserves_event_details(self) -> None:
        payload = deepcopy(self.fixture.event)
        payload.update(title="Obsolete client title", volunteers=[], joinedUserIds=[], statusUpdates=[])
        new_task = task("fixture-new-task")
        payload["internalTasks"].append(new_task)

        response = await self.fixture.save(payload)

        saved = self.fixture.saved[0]
        self.assertEqual(saved["internalTasks"][:-1], [task("fixture-existing-task"), new_task])
        self.assertEqual(saved["internalTasks"][-1]["id"], "fixture-event-field-officer")
        self.assertEqual(saved["internalTasks"][-1]["status"], "Unassigned")
        for field in ("title", "volunteers", "joinedUserIds", "statusUpdates"):
            self.assertEqual(saved[field], self.fixture.event[field])
        self.assertEqual(response["event"], saved)
        self.fixture.connection.commit.assert_called_once()
        self.fixture.broadcast.assert_awaited_once_with(["events"])
        self.fixture.calendar_push.assert_not_awaited()

    async def test_existing_event_replaces_synthetic_field_officer_with_saved_default(self) -> None:
        payload = deepcopy(self.fixture.event)
        payload["internalTasks"].extend([
            task("fixture-new-task"),
            task("fixture-client-field-officer", title="Field Officer", isFieldOfficer=True),
        ])

        await self.fixture.save(payload)

        self.assertEqual(
            [saved_task["id"] for saved_task in self.fixture.saved[0]["internalTasks"]],
            ["fixture-existing-task", "fixture-new-task", "fixture-event-field-officer"],
        )

    async def test_initial_creation_without_tasks_saves_default_field_officer(self) -> None:
        self.fixture.existing_event = None
        payload = deepcopy(self.fixture.event)
        payload.pop("internalTasks")

        await self.fixture.save(payload)

        officers = self.fixture.saved[0]["internalTasks"]
        self.assertEqual(len(officers), 1)
        self.assertEqual(officers[0]["id"], "fixture-event-field-officer")
        self.assertTrue(officers[0]["isFieldOfficer"])
        self.assertEqual(officers[0]["status"], "Unassigned")
        self.assertEqual(officers[0]["volunteersNeeded"], 1)
        self.assertIsNone(officers[0]["assignedVolunteerId"])
        self.assertEqual(officers[0]["assignedVolunteerIds"], [])

    async def test_default_field_officer_is_preserved_across_repeated_partner_saves(self) -> None:
        payload = deepcopy(self.fixture.event)
        await self.fixture.save(payload)
        first_officer = deepcopy(self.fixture.saved[0]["internalTasks"][-1])
        self.fixture.existing_event = deepcopy(self.fixture.saved[0])

        # An older client may omit the canonical automatic task on its next save.
        await self.fixture.save(payload)

        officers = [entry for entry in self.fixture.saved[-1]["internalTasks"] if entry.get("isFieldOfficer")]
        self.assertEqual(officers, [first_officer])

    async def test_existing_server_field_officer_is_preserved_without_client_changes(self) -> None:
        canonical_officer = task(
            "fixture-server-field-officer",
            title="Field Officer",
            isFieldOfficer=True,
            assignedVolunteerId="fixture-volunteer-profile",
            assignedVolunteerIds=["fixture-volunteer-profile"],
            assignedVolunteerName="Official officer",
            status="Assigned",
        )
        self.fixture.existing_event["internalTasks"].append(deepcopy(canonical_officer))
        payload = deepcopy(self.fixture.existing_event)
        payload["internalTasks"][-1].update(title="Client changes", assignedVolunteerIds=[])
        payload["internalTasks"].extend([
            task("fixture-new-task"),
            task("fixture-extra-field-officer", isFieldOfficer=True),
        ])

        await self.fixture.save(payload)

        saved_tasks = self.fixture.saved[0]["internalTasks"]
        self.assertEqual([entry["id"] for entry in saved_tasks], [
            "fixture-existing-task", "fixture-new-task", "fixture-server-field-officer",
        ])
        self.assertEqual(saved_tasks[-1], canonical_officer)

    async def test_initial_event_creation_uses_canonical_officer_instead_of_client_placeholders(self) -> None:
        self.fixture.existing_event = None
        payload = deepcopy(self.fixture.event)
        payload["internalTasks"].append(task(
            "fixture-initial-field-officer", title="Field Officer", isFieldOfficer=True,
            status="Assigned",
            assignedVolunteerId="fixture-volunteer-profile",
            assignedVolunteerIds=["fixture-volunteer-profile"],
        ))
        payload["internalTasks"].append(task(
            "fixture-extra-client-officer", title="Client officer", isFieldOfficer=True,
        ))

        await self.fixture.save(payload)

        saved = self.fixture.saved[0]
        self.assertEqual(saved["volunteers"], [])
        self.assertEqual(saved["joinedUserIds"], [])
        self.assertEqual([entry["id"] for entry in saved["internalTasks"]], [
            "fixture-existing-task", "fixture-event-field-officer",
        ])
        self.assertTrue(saved["internalTasks"][-1]["isFieldOfficer"])
        self.assertEqual(saved["internalTasks"][-1]["status"], "Unassigned")
        self.assertIsNone(saved["internalTasks"][-1]["assignedVolunteerId"])
        self.assertEqual(saved["internalTasks"][-1]["assignedVolunteerIds"], [])
        self.fixture.calendar_push.assert_awaited_once_with("events", saved)

    async def test_partner_cannot_add_task_outside_project_scope(self) -> None:
        self.fixture.scope.clear()
        payload = deepcopy(self.fixture.event)
        payload["internalTasks"].append(task("fixture-new-task"))

        with self.assertRaises(FixtureHttpException) as rejected:
            await self.fixture.save(payload)

        self.assertEqual(rejected.exception.status_code, 403)
        self.assertEqual(self.fixture.saved, [])
        self.fixture.connection.commit.assert_not_called()
        self.fixture.broadcast.assert_not_awaited()


class AdminEventFixture(FixtureState):
    """Exercise the actual generic admin handlers with only relational writes stubbed."""

    def __init__(self) -> None:
        super().__init__()
        selected_names = FUNCTION_NAMES | {
            "_postgres_upsert_hot_item",
            "put_storage_item_by_id",
            "_put_storage_item_once",
        }
        namespace = load_functions(selected_names)
        namespace.update({
            key: value for key, value in self.namespace.items() if key not in selected_names
        })
        self.namespace = namespace
        self.session = {"sub": "fixture-admin", "role": "admin"}

        def upsert(connection: Any, collection: str, record: dict[str, Any]) -> dict[str, Any]:
            self.saved.append(deepcopy(record))
            return deepcopy(record)

        def replace_collection(connection: Any, collection: str, records: list[dict[str, Any]]) -> None:
            self.saved.extend(deepcopy(records))

        self.namespace.update({
            "_require_admin_session": lambda request: deepcopy(self.session),
            "is_hot_storage_key": lambda key: key in {"projects", "events"},
            "_require_terminal_admin_provisioning": Mock(),
            "_scan_storage_item_media": Mock(),
            "_assert_storage_item_write_access": Mock(),
            "upsert_relational_item": upsert,
            "replace_postgres_hot_storage_collection": replace_collection,
            "get_postgres_hot_storage_collection": lambda connection, key: (
                [deepcopy(self.existing_event)] if self.existing_event is not None else []
            ),
        })

    async def save_admin(self, payload: dict[str, Any]) -> dict[str, Any]:
        response = await self.namespace["put_storage_item_by_id"](
            object(), "events", self.event["id"], deepcopy(payload),
        )
        await asyncio.sleep(0)
        return response


class AdminAutomaticOfficerTaskTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.fixture = AdminEventFixture()
        self.fixture.existing_event = None

    async def test_admin_creation_without_tasks_persists_default_officer(self) -> None:
        payload = deepcopy(self.fixture.event)
        payload["internalTasks"] = []

        response = await self.fixture.save_admin(payload)

        officer = response["item"]["internalTasks"][0]
        self.assertEqual(officer["id"], "fixture-event-field-officer")
        self.assertEqual(officer["title"], "Field Officer")
        self.assertEqual(officer["status"], "Unassigned")
        self.assertEqual(officer["volunteersNeeded"], 1)
        self.assertIsNone(officer["assignedVolunteerId"])
        self.assertEqual(officer["assignedVolunteerIds"], [])
        self.assertEqual(self.fixture.saved[0]["internalTasks"], [officer])

    async def test_past_event_creation_also_persists_default_officer(self) -> None:
        payload = deepcopy(self.fixture.event)
        payload.update(startDate="2001-01-01", endDate="2001-01-01")

        await self.fixture.save_admin(payload)

        self.assertTrue(self.fixture.saved[0]["internalTasks"][-1]["isFieldOfficer"])
        self.assertEqual(self.fixture.saved[0]["internalTasks"][0], task("fixture-existing-task"))

    async def test_existing_officer_and_assignments_are_preserved(self) -> None:
        canonical_officer = task(
            "fixture-assigned-officer", title="Field Officer", isFieldOfficer=True,
            assignedVolunteerId="fixture-volunteer-profile",
            assignedVolunteerIds=["fixture-volunteer-profile"],
            assignedVolunteerName="Official officer", status="Assigned", volunteersNeeded=1,
        )
        payload = deepcopy(self.fixture.event)
        payload["internalTasks"].append(deepcopy(canonical_officer))

        await self.fixture.save_admin(payload)

        self.assertEqual(self.fixture.saved[0]["internalTasks"][-1], canonical_officer)
        self.assertEqual(sum(task.get("isFieldOfficer", False) for task in self.fixture.saved[0]["internalTasks"]), 1)

    async def test_collection_creation_persists_default_and_preserves_existing_officer(self) -> None:
        new_event = deepcopy(self.fixture.event)
        assigned_event = deepcopy(self.fixture.event)
        assigned_event["id"] = "fixture-other-event"
        officer = task(
            "fixture-other-field-officer", title="Field Officer", isFieldOfficer=True,
            volunteersNeeded=1, status="Assigned",
            assignedVolunteerIds=["fixture-volunteer-profile"],
        )
        assigned_event["internalTasks"].append(deepcopy(officer))

        response = await self.fixture.namespace["_put_storage_item_once"](
            object(), "events", SimpleNamespace(value=[new_event, assigned_event]),
        )
        await asyncio.sleep(0)

        self.assertEqual(response, {"status": "ok"})
        new_officer = self.fixture.saved[0]["internalTasks"][-1]
        self.assertEqual(new_officer["id"], "fixture-event-field-officer")
        self.assertEqual(new_officer["status"], "Unassigned")
        self.assertEqual(self.fixture.saved[1]["internalTasks"][-1], officer)

    async def test_repeated_write_keeps_one_identical_default_officer(self) -> None:
        await self.fixture.save_admin(deepcopy(self.fixture.event))
        first = deepcopy(self.fixture.saved[0])
        self.fixture.existing_event = deepcopy(first)

        await self.fixture.save_admin(first)

        self.assertEqual(self.fixture.saved[-1]["internalTasks"], first["internalTasks"])
        self.assertEqual(sum(task.get("isFieldOfficer", False) for task in self.fixture.saved[-1]["internalTasks"]), 1)


if __name__ == "__main__":
    unittest.main()
