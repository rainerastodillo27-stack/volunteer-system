import unittest
from unittest.mock import patch

from backend.api import _ensure_volunteer_profile_for_user


class VolunteerDocumentSyncTests(unittest.TestCase):
    def test_existing_profile_receives_membership_documents(self) -> None:
        existing_profile = {
            "id": "volunteer-user-1",
            "userId": "user-1",
            "name": "Volunteer One",
            "email": "volunteer@example.com",
            "validIdPhoto": "",
            "certificationsOrTrainings": "",
        }
        user = {
            "id": "user-1",
            "role": "volunteer",
            "name": "Volunteer One",
            "email": "volunteer@example.com",
            "volunteerMembershipSheet": {
                "validIdPhoto": "data:image/jpeg;base64,valid-id",
                "certificationsOrTrainings": "data:image/jpeg;base64,certificate",
            },
        }

        with patch(
            "backend.api.get_postgres_hot_storage_collection",
            return_value=[existing_profile],
        ), patch("backend.api._postgres_upsert_hot_item") as upsert:
            changed = _ensure_volunteer_profile_for_user(object(), user)

        self.assertTrue(changed)
        saved_profile = upsert.call_args.args[2]
        self.assertEqual(saved_profile["validIdPhoto"], "data:image/jpeg;base64,valid-id")
        self.assertEqual(
            saved_profile["certificationsOrTrainings"],
            "data:image/jpeg;base64,certificate",
        )

    def test_new_profile_includes_membership_valid_id(self) -> None:
        user = {
            "id": "user-2",
            "role": "volunteer",
            "name": "Volunteer Two",
            "email": "volunteer-two@example.com",
            "createdAt": "2026-09-09T00:00:00+00:00",
            "volunteerMembershipSheet": {
                "validIdPhoto": "data:image/png;base64,new-valid-id",
            },
        }

        with patch(
            "backend.api.get_postgres_hot_storage_collection",
            return_value=[],
        ), patch("backend.api._postgres_upsert_hot_item") as upsert:
            changed = _ensure_volunteer_profile_for_user(object(), user)

        self.assertTrue(changed)
        saved_profile = upsert.call_args.args[2]
        self.assertEqual(saved_profile["id"], "volunteer-user-2")
        self.assertEqual(saved_profile["validIdPhoto"], "data:image/png;base64,new-valid-id")


if __name__ == "__main__":
    unittest.main()
