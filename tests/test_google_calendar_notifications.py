import unittest
from unittest.mock import patch

from backend.api import _notify_google_calendar_schedule_change


class _MockCursor:
    def __init__(self) -> None:
        self.query = ""
        self.inserted_messages: list[tuple] = []
        self.rowcount = 0

    def __enter__(self):
        return self

    def __exit__(self, *_args) -> None:
        return None

    def execute(self, query: str, parameters: tuple | None = None) -> None:
        self.query = query
        self.rowcount = 0
        if "insert into public.messages" in query.lower():
            self.inserted_messages.append(parameters or ())
            self.rowcount = 1

    def fetchall(self) -> list[tuple[str]]:
        query = self.query.lower()
        if "select users_id from public.users" in query:
            return [("admin-1",)]
        if "select distinct users_id" in query:
            return [("volunteer-1",)]
        return []


class _MockConnection:
    def __init__(self) -> None:
        self.mock_cursor = _MockCursor()

    def cursor(self) -> _MockCursor:
        return self.mock_cursor


class GoogleCalendarScheduleNotificationTests(unittest.TestCase):
    def test_notifies_admin_and_active_volunteer_with_old_and_new_schedule(self) -> None:
        connection = _MockConnection()
        project = {
            "id": "event-1",
            "title": "Community Event",
            "isEvent": True,
            "volunteers": ["volunteer-profile-1"],
        }
        old_schedule = ("2026-10-01T08:00:00+08:00", "2026-10-01T10:00:00+08:00")
        new_schedule = ("2026-10-02T09:00:00+08:00", "2026-10-02T11:00:00+08:00")

        with patch("backend.api._postgres_get_hot_items_by_field", return_value=[]), patch(
            "backend.api._get_active_event_volunteer_keys",
            return_value={"volunteer-profile-1"},
        ), patch("backend.api._resolve_admin_message_user_id", return_value="admin-1"):
            inserted = _notify_google_calendar_schedule_change(
                connection,
                "partner-1",
                "event-1",
                project,
                old_schedule,
                new_schedule,
            )

        self.assertTrue(inserted)
        messages = connection.mock_cursor.inserted_messages
        self.assertEqual(len(messages), 2)
        self.assertEqual(
            {(message[1], message[2]) for message in messages},
            {("partner-1", "admin-1"), ("admin-1", "volunteer-1")},
        )
        for message in messages:
            self.assertEqual(message[3], "event-1")
            self.assertIn("Community Event", message[4])
            self.assertIn("Previous schedule", message[4])
            self.assertIn("Oct 01, 2026", message[4])
            self.assertIn("New official NVC schedule", message[4])
            self.assertIn("Oct 02, 2026", message[4])


if __name__ == "__main__":
    unittest.main()
