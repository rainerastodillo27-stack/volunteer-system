import unittest

from backend.field_rules import (
    normalize_ph_contact_phone,
    normalize_ph_mobile_phone,
    sanitize_hot_storage_item,
)
from backend.relational_mirror import TABLE_SPECS, _normalize_row, _row_filter_clause
from backend.storage_table_contract import CANONICAL_STORAGE_TABLES, DEPRECATED_STORAGE_TABLES


class PhilippinePhoneNormalizationTests(unittest.TestCase):
    def test_accepts_local_mobile_number(self) -> None:
        self.assertEqual(normalize_ph_mobile_phone("0917 123 4567"), "09171234567")

    def test_converts_country_code_to_local_eleven_digits(self) -> None:
        self.assertEqual(normalize_ph_mobile_phone("+63 917 123 4567"), "09171234567")

    def test_rejects_wrong_length_or_prefix(self) -> None:
        self.assertIsNone(normalize_ph_mobile_phone("0917123456"))
        self.assertIsNone(normalize_ph_mobile_phone("08171234567"))
        self.assertIsNone(normalize_ph_mobile_phone("091712345678"))

    def test_partner_contact_uses_same_mobile_rule(self) -> None:
        self.assertEqual(normalize_ph_contact_phone("639171234567"), "09171234567")
        self.assertIsNone(normalize_ph_contact_phone("034 123 4567"))

    def test_storage_rejects_invalid_phone_instead_of_saving_null(self) -> None:
        with self.assertRaisesRegex(ValueError, "11-digit Philippine mobile"):
            sanitize_hot_storage_item(
                "users",
                {"id": "user-1", "name": "Test", "phone": "0917123456"},
            )

    def test_storage_persists_canonical_phone(self) -> None:
        sanitized = sanitize_hot_storage_item(
            "partners",
            {"id": "partner-1", "name": "Test", "contactPhone": "+63 917 123 4567"},
        )
        self.assertEqual(sanitized["contactPhone"], "09171234567")


class RelationalNormalizationTests(unittest.TestCase):
    def test_redundant_tables_are_not_runtime_storage(self) -> None:
        self.assertNotIn("programTracks", CANONICAL_STORAGE_TABLES)
        self.assertNotIn("adminPlanningItems", CANONICAL_STORAGE_TABLES)
        self.assertNotIn("programTracks", TABLE_SPECS)
        self.assertNotIn("adminPlanningItems", TABLE_SPECS)
        self.assertIn("program_tracks", DEPRECATED_STORAGE_TABLES)
        self.assertIn("admin_planning_items", DEPRECATED_STORAGE_TABLES)

    def test_event_columns_and_values_remain_aligned(self) -> None:
        item = {
            "id": "event-1",
            "title": "Test event",
            "locationVenue": "NVC Hall",
            "googleMeetUrl": "https://meet.google.com/example",
            "notificationSettings": ["one-day"],
        }
        row = _normalize_row("events", item)
        columns = [name for name, _ in TABLE_SPECS["events"]["columns"]]
        self.assertEqual(len(row), len(columns))
        values = dict(zip(columns, row))
        self.assertEqual(values["location_venue"], "NVC Hall")
        self.assertEqual(values["google_meet_url"], "https://meet.google.com/example")
        self.assertEqual(values["notification_settings"], '["one-day"]')

    def test_published_reports_share_the_reports_table(self) -> None:
        self.assertEqual(TABLE_SPECS["publishedImpactReports"]["table"], "reports")
        self.assertEqual(_row_filter_clause("partnerReports"), "generated_at is null")
        self.assertEqual(_row_filter_clause("publishedImpactReports"), "generated_at is not null")


if __name__ == "__main__":
    unittest.main()
