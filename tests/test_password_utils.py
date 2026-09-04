import unittest

from backend.password_utils import hash_password, is_bcrypt_hash, verify_password
from backend.relational_mirror import _normalize_row, _row_to_item


class PasswordHashingTests(unittest.TestCase):
    def test_hash_is_bcrypt_and_verifies(self) -> None:
        password_hash = hash_password("Admin123!")

        self.assertTrue(is_bcrypt_hash(password_hash))
        self.assertNotEqual(password_hash, "Admin123!")
        self.assertTrue(verify_password("Admin123!", password_hash))
        self.assertFalse(verify_password("wrong-password", password_hash))

    def test_legacy_plaintext_can_be_verified_for_upgrade(self) -> None:
        self.assertTrue(verify_password("legacy-pass", "legacy-pass"))
        self.assertFalse(verify_password("wrong-pass", "legacy-pass"))

    def test_user_storage_hashes_and_redacts_credentials(self) -> None:
        row = _normalize_row(
            "users",
            {
                "id": "user-1",
                "email": "user@example.com",
                "password": "Password123!",
                "role": "volunteer",
                "name": "User",
                "pillarsOfInterest": [],
            },
        )
        self.assertTrue(is_bcrypt_hash(row[2]))

        database_row = {
            "users_id": "user-1",
            "email": "user@example.com",
            "password": row[2],
            "role": "volunteer",
            "name": "User",
            "phone": None,
            "user_type": None,
            "pillars_of_interest": [],
            "approval_status": "approved",
            "approved_by": None,
            "approved_at": None,
            "rejection_reason": None,
            "created_at": None,
        }
        self.assertNotIn("password", _row_to_item("users", database_row))
        self.assertTrue(is_bcrypt_hash(_row_to_item("users", database_row, include_password=True)["password"]))


if __name__ == "__main__":
    unittest.main()
