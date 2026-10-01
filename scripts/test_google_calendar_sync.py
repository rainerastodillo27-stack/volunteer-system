"""Isolated calendar conversion checks; no database, Google requests, or accounts.

Run with: python scripts/test_google_calendar_sync.py
"""

import importlib.util
import os
from pathlib import Path
import unittest
from unittest.mock import patch


MODULE_PATH = Path(__file__).resolve().parents[1] / "backend" / "google_calendar_sync.py"
SPEC = importlib.util.spec_from_file_location("google_calendar_sync_under_test", MODULE_PATH)
calendar = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(calendar)


class CalendarScheduleTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {"GOOGLE_CALENDAR_TIME_ZONE": "Asia/Manila"})
        self.environment.start()
        self.addCleanup(self.environment.stop)
        # Every test fails immediately if a conversion unexpectedly calls Google.
        self.network = patch.object(calendar.urllib.request, "urlopen", side_effect=AssertionError("Network access forbidden"))
        self.network.start()
        self.addCleanup(self.network.stop)

    def project(self, **changes):
        return {
            "id": "event-test",
            "title": "In-memory fixture",
            "isEvent": True,
            "repeat": "Daily",
            "startDate": "2026-10-02T08:00:00+08:00",
            "endDate": "2026-10-06T17:00:00+08:00",
            **changes,
        }

    def event(self, project=None):
        return calendar.format_project_as_google_event(project or self.project())

    def test_daily_round_trip(self):
        project = self.project()
        self.assertEqual(calendar.schedule_from_google_event(self.event(project), project), calendar.project_schedule(project))

    def test_weekly_round_trip(self):
        project = self.project(repeat="Weekly")
        self.assertEqual(calendar.schedule_from_google_event(self.event(project), project), calendar.project_schedule(project))

    def test_monthly_last_day_round_trip(self):
        project = self.project(repeat="Monthly", startDate="2026-01-31T08:00:00+08:00", endDate="2026-05-31T17:00:00+08:00")
        event = self.event(project)
        self.assertIn("BYMONTHDAY=31,-1;BYSETPOS=1", event["recurrence"][0])
        self.assertEqual(calendar.schedule_from_google_event(event, project), calendar.project_schedule(project))

    def test_recurring_end_time_edit_preserved_with_old_until(self):
        event = self.event()
        event["recurrence"] = ["RRULE:FREQ=DAILY;UNTIL=20261006T090000Z"]
        event["end"]["dateTime"] = "2026-10-02T18:30:00+08:00"
        self.assertEqual(calendar.schedule_from_google_event(event, self.project())[1], "2026-10-06T18:30:00+08:00")

    def test_recurring_series_end_date_edit(self):
        event = self.event()
        event["recurrence"] = ["RRULE:FREQ=DAILY;UNTIL=20261010T155959Z"]
        self.assertEqual(calendar.schedule_from_google_event(event, self.project())[1], "2026-10-10T17:00:00+08:00")

    def test_recurring_start_time_edit(self):
        event = self.event()
        event["start"]["dateTime"] = "2026-10-02T09:15:00+08:00"
        self.assertEqual(calendar.schedule_from_google_event(event, self.project())[0], "2026-10-02T09:15:00+08:00")

    def test_overnight_series_final_start_is_included(self):
        project = self.project(startDate="2026-10-02T22:00:00+08:00", endDate="2026-10-06T01:00:00+08:00")
        event = self.event(project)
        self.assertEqual(event["end"]["dateTime"], "2026-10-03T01:00:00+08:00")
        self.assertEqual(event["recurrence"], ["RRULE:FREQ=DAILY;UNTIL=20261006T140000Z"])
        self.assertEqual(calendar.schedule_from_google_event(event, project), calendar.project_schedule(project))

    def test_naive_dates_use_calendar_zone(self):
        project = self.project(startDate="2026-10-02T08:00:00", endDate="2026-10-06T17:00:00")
        event = self.event(project)
        self.assertEqual(event["start"]["dateTime"], "2026-10-02T08:00:00+08:00")
        self.assertEqual(event["recurrence"], ["RRULE:FREQ=DAILY;UNTIL=20261006T000000Z"])
        self.assertEqual(calendar.normalize_schedule_value(project["startDate"]), "2026-10-02T00:00:00+00:00")

    def test_google_naive_datetime_uses_explicit_timezone(self):
        project = self.project(repeat="Does not repeat", endDate="2026-10-02T17:00:00+08:00")
        event = {"start": {"dateTime": "2026-10-02T08:00:00", "timeZone": "Asia/Manila"}, "end": {"dateTime": "2026-10-02T17:00:00", "timeZone": "Asia/Manila"}}
        self.assertEqual(calendar.schedule_from_google_event(event, project), calendar.project_schedule(project))

    def test_utc_dates_use_local_calendar_clocks(self):
        project = self.project(startDate="2026-10-02T00:00:00Z", endDate="2026-10-06T09:00:00Z")
        event = self.event(project)
        self.assertEqual(event["end"]["dateTime"], "2026-10-02T17:00:00+08:00")
        imported = calendar.schedule_from_google_event(event, project)
        self.assertEqual(calendar.normalize_schedule_value(imported[1]), calendar.normalize_schedule_value(project["endDate"]))

    def test_nonrecurring_all_day_end_is_exclusive_in_google(self):
        project = self.project(repeat="Does not repeat", startDate="2026-10-02", endDate="2026-10-06")
        event = self.event(project)
        self.assertEqual(event["end"], {"date": "2026-10-07"})
        self.assertEqual(calendar.schedule_from_google_event(event, project), calendar.project_schedule(project))

    def test_single_all_day_round_trip(self):
        project = self.project(repeat="Does not repeat", startDate="2026-10-02", endDate="2026-10-02")
        self.assertEqual(calendar.schedule_from_google_event(self.event(project), project), calendar.project_schedule(project))

    def test_recurring_all_day_round_trip(self):
        project = self.project(startDate="2026-10-02", endDate="2026-10-06")
        event = self.event(project)
        self.assertEqual(event["end"], {"date": "2026-10-03"})
        self.assertEqual(event["recurrence"], ["RRULE:FREQ=DAILY;UNTIL=20261006"])
        self.assertEqual(calendar.schedule_from_google_event(event, project), calendar.project_schedule(project))

    def test_series_without_until_keeps_official_end_date(self):
        event = self.event()
        event["recurrence"] = ["RRULE:FREQ=DAILY"]
        event["end"]["dateTime"] = "2026-10-02T18:00:00+08:00"
        self.assertEqual(calendar.schedule_from_google_event(event, self.project())[1], "2026-10-06T18:00:00+08:00")

    def test_invalid_google_schedules_ignored(self):
        for changes in (
            {"start": {"dateTime": "invalid"}},
            {"end": {"dateTime": "2026-10-02T07:00:00+08:00"}},
            {"end": {"date": "2026-10-03"}},
            {"start": {}},
            {"recurrence": ["RRULE:FREQ=DAILY;UNTIL=20261001"]},
            {"recurrence": ["RRULE:FREQ=DAILY;UNTIL=20261399"]},
        ):
            with self.subTest(changes=changes):
                event = {**self.event(), **changes}
                self.assertIsNone(calendar.schedule_from_google_event(event, self.project()))

    def test_recurrence_changes_and_custom_rules_ignored(self):
        for rule in (
            "RRULE:FREQ=WEEKLY;UNTIL=20261006T000000Z",
            "RRULE:FREQ=DAILY;INTERVAL=2;UNTIL=20261006T000000Z",
            "RRULE:FREQ=DAILY;COUNT=5",
            "RRULE:FREQ=DAILY;BYHOUR=8,12;UNTIL=20261006T000000Z",
        ):
            with self.subTest(rule=rule):
                event = {**self.event(), "recurrence": [rule]}
                self.assertIsNone(calendar.schedule_from_google_event(event, self.project()))
        self.assertIsNone(calendar.schedule_from_google_event({**self.event(), "recurrence": []}, self.project()))

    def test_individual_occurrence_edit_and_cancellation_ignored(self):
        self.assertIsNone(calendar.schedule_from_google_event({**self.event(), "recurringEventId": "master"}, self.project()))
        self.assertIsNone(calendar.schedule_from_google_event({**self.event(), "status": "cancelled"}, self.project()))

    def test_nonrecurring_timed_round_trip(self):
        project = self.project(repeat="Does not repeat")
        self.assertEqual(calendar.schedule_from_google_event(self.event(project), project), calendar.project_schedule(project))

    def test_export_rejects_invalid_and_mixed_schedules(self):
        for changes in (
            {"startDate": "invalid"},
            {"endDate": "2026-09-30T17:00:00+08:00"},
            {"endDate": "2026-10-06"},
            {"repeat": "Does not repeat", "endDate": "2026-10-02T08:00:00+08:00"},
        ):
            with self.subTest(changes=changes), self.assertRaises(calendar.GoogleCalendarError):
                self.event(self.project(**changes))

    def test_snake_case_project_fields(self):
        project = {"is_event": True, "repeat_rule": "daily", "start_date": "2026-10-02T08:00:00+08:00", "end_date": "2026-10-06T17:00:00+08:00"}
        event = self.event(project)
        self.assertTrue(event["summary"].startswith("[Event]"))
        self.assertEqual(calendar.schedule_from_google_event(event, project), calendar.project_schedule(project))

    def test_stable_google_id_matches_js_utf16_hash(self):
        # Constants independently computed with the TypeScript hash in Node.
        self.assertEqual(calendar.stable_google_event_id("event-test"), "nvce1f7cc55a")
        self.assertEqual(calendar.stable_google_event_id("event-\U0001f31f"), "nvc7345d1108")

    def stale(self, event, approved=None, known=None, linked=None):
        return calendar.is_stale_partner_calendar_event(event, "partner-test", approved or set(), known or {}, linked or {})

    def tagged(self, project_id="deleted-event"):
        return {
            "id": calendar.stable_google_event_id(project_id),
            "extendedProperties": calendar.partner_calendar_event_properties("partner-test", project_id),
        }

    def test_partner_owned_obsolete_event_is_recognized(self):
        self.assertTrue(self.stale(self.tagged()))

    def test_new_approved_unlinked_partner_event_is_kept(self):
        self.assertFalse(self.stale(self.tagged("new-event"), approved={"new-event"}))

    def test_other_role_user_partial_marker_and_personal_items_are_kept(self):
        for changes in (
            {"nvcSyncRole": "volunteer"},
            {"nvcSyncRole": "admin"},
            {"nvcSyncUserId": "another-partner"},
            {"nvcManagedBy": "another-system"},
            {"nvcProjectId": ""},
        ):
            with self.subTest(changes=changes):
                event = self.tagged()
                event["extendedProperties"]["private"].update(changes)
                self.assertFalse(self.stale(event))
        self.assertFalse(self.stale({"id": "personal-item", "summary": "[Event] Personal reminder"}))
        self.assertFalse(self.stale({"id": self.tagged()["id"], "extendedProperties": {"private": {"nvcManagedBy": "nvc-connect"}}}))
        self.assertFalse(self.stale({"id": self.tagged()["id"], "extendedProperties": {"private": {"nvcRecordType": "event"}}}))

    def test_deleted_legacy_app_export_needs_full_generated_signature(self):
        event = {
            "id": calendar.stable_google_event_id("deleted-legacy-event"),
            "summary": "[Event] Old approved proposal event",
            "description": "Old description\n\n📂 Category: Nutrition\n📌 Status: Completed\n👥 Volunteers Needed: 10",
        }
        self.assertTrue(self.stale(event))
        self.assertFalse(self.stale({**event, "id": "ordinary-google-id"}))
        self.assertFalse(self.stale({**event, "description": "Old description"}))
        self.assertFalse(self.stale({**event, "summary": "Personal item"}))
        self.assertFalse(self.stale({**event, "extendedProperties": {"private": {"nvcRecordType": "event"}}}))

    def test_existing_unlinked_legacy_export_with_unknown_owner_is_preserved(self):
        project = self.project(description="Official description")
        event_id = calendar.stable_google_event_id(project["id"])
        event = {"id": event_id, **self.event(project)}
        self.assertFalse(self.stale(event, known={event_id: project}))
        self.assertFalse(self.stale({**event, "summary": "[Event] Something else"}, known={event_id: project}))
        self.assertFalse(self.stale({**event, "description": "Something else"}, known={event_id: project}))
        event["description"] = "📂 Category: Nutrition\n📌 Status: Active\n👥 Volunteers Needed: 10"
        self.assertFalse(self.stale(event, known={event_id: project}))

    def test_linked_legacy_cleanup_does_not_require_description_marker(self):
        self.assertTrue(self.stale({"id": "legacy-id"}, linked={"legacy-id": "removed-project"}))
        self.assertFalse(self.stale({"id": "legacy-id"}, approved={"approved-project"}, linked={"legacy-id": "approved-project"}))

    def test_recurring_exceptions_and_cancelled_entries_are_not_deleted_again(self):
        self.assertFalse(self.stale({**self.tagged(), "recurringEventId": "series-id"}))
        self.assertFalse(self.stale({**self.tagged(), "status": "cancelled"}))


if __name__ == "__main__":
    unittest.main(verbosity=2)
