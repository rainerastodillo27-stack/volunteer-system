import asyncio
import contextlib
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from backend import api, db


class ProposalConnectionLifetimeTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        patches = contextlib.ExitStack()
        self.addCleanup(patches.close)
        self.events = []
        self.borrowed = False
        self.connection = MagicMock()
        self.connection.commit.side_effect = self._commit
        self.stored_application = None
        self.message = {"id": "submission-message", "content": "Persisted proposal card"}
        self.normalized_details = {
            "proposedTitle": "Education proposal",
            "requestedProgramModule": "Education",
            "attachments": [{"uri": "uncompressed-upload"}],
        }

        @contextlib.contextmanager
        def borrow_connection():
            self.assertFalse(self.borrowed, "Submission opened a nested database borrower")
            self.borrowed = True
            self.events.append("borrowed")
            try:
                yield self.connection
            finally:
                self.borrowed = False
                self.events.append("released")

        patches.enter_context(patch.object(api, "get_connection", side_effect=borrow_connection))
        patches.enter_context(
            patch.object(api, "_get_session_user", return_value={"sub": "partner-1", "role": "partner"})
        )
        patches.enter_context(patch.object(api, "_require_postgres"))
        patches.enter_context(patch.object(api, "_invalidate_collection_cache"))
        patches.enter_context(patch.object(api, "_projects_snapshot_cache"))
        patches.enter_context(patch.object(api.secrets, "token_hex", return_value="test-token"))
        self.lookup = patches.enter_context(patch.object(api, "_postgres_get_hot_item_by_id", return_value=None))
        patches.enter_context(patch.object(api, "_postgres_get_project_like_item_by_id", return_value=(None, None)))
        self.normalize = patches.enter_context(
            patch.object(api, "_normalize_partner_proposal_details", return_value=self.normalized_details)
        )
        self.upsert = patches.enter_context(patch.object(api, "_postgres_upsert_hot_item", side_effect=self._persist))
        self.card_writer = patches.enter_context(
            patch.object(api, "_create_proposal_submission_message", new=AsyncMock(side_effect=self._create_card))
        )
        self.broadcast = patches.enter_context(
            patch.object(
                api.connection_manager,
                "broadcast_storage_event",
                new=AsyncMock(side_effect=self._broadcast),
            )
        )
        patches.enter_context(patch("builtins.print"))
        self.live_connection = patches.enter_context(
            patch.object(db.psycopg, "connect", side_effect=AssertionError("Live database calls are forbidden"))
        )
        self.direct_connection = patches.enter_context(
            patch.object(db, "get_postgres_connection", side_effect=AssertionError("Direct connections are forbidden"))
        )

    def tearDown(self):
        self.live_connection.assert_not_called()
        self.direct_connection.assert_not_called()
        self.assertFalse(self.borrowed)

    def _commit(self):
        self.assertTrue(self.borrowed)
        self.events.append("committed")

    def _persist(self, connection, collection, application):
        self.assertTrue(self.borrowed)
        self.assertIs(connection, self.connection)
        self.assertEqual(collection, "partnerProjectApplications")
        self.events.append("persisted")
        # Storage can normalize/compress attachments before returning the row.
        self.stored_application = {
            **application,
            "proposalDetails": {
                **application["proposalDetails"],
                "attachments": [{"uri": "compressed-stored-upload"}],
            },
        }
        return self.stored_application

    async def _create_card(self, application, partner_user_id):
        self.assertFalse(self.borrowed, "Card creation must start after the proposal connection is released")
        self.assertIn("committed", self.events)
        self.assertIn("released", self.events)
        self.assertIs(application, self.stored_application)
        self.assertEqual(partner_user_id, "partner-1")
        self.events.append("card")
        return self.message

    async def _broadcast(self, keys):
        self.assertFalse(self.borrowed, "Background delivery must not run inside the proposal transaction")
        self.assertEqual(keys, ["partnerProjectApplications"])

    async def _submit(self, previous_application_id=None):
        details = {"proposedTitle": " Education proposal ", "attachments": [{"uri": "original-upload"}]}
        if previous_application_id:
            details["previousApplicationId"] = previous_application_id
        payload = api.PartnerProjectJoinRequestPayload(
            projectId="new",
            programModule="Education",
            partnerUserId="partner-1",
            partnerName="Test Partner",
            partnerEmail="partner@example.com",
            proposalDetails=details,
        )

        response = await api.request_partner_project_join(object(), payload)
        await asyncio.sleep(0)  # Complete the mocked background storage broadcast.

        self.connection.commit.assert_called_once_with()
        self.upsert.assert_called_once()
        self.normalize.assert_called_once_with(details, "Education", None)
        self.card_writer.assert_awaited_once_with(self.stored_application, "partner-1")
        self.broadcast.assert_awaited_once_with(["partnerProjectApplications"])
        self.assertEqual(self.events, ["borrowed", "persisted", "committed", "released", "card"])
        self.assertIs(response["application"], self.stored_application)
        self.assertIs(response["message"], self.message)
        self.assertEqual(
            response["application"]["proposalDetails"]["attachments"],
            [{"uri": "compressed-stored-upload"}],
        )
        return response

    async def test_new_proposal_creates_independent_application_and_card_after_release(self):
        response = await self._submit()

        self.lookup.assert_not_called()
        application = response["application"]
        self.assertTrue(application["id"].startswith("partner-application-"))
        self.assertTrue(application["projectId"].startswith("program:Education::"))
        self.assertEqual(application["revisionNumber"], 0)
        self.assertEqual(application["status"], "Pending")
        self.assertNotIn("resubmittedAt", application)

    async def test_explicit_rejected_revision_preserves_id_and_increments_revision(self):
        previous = {
            "id": "rejected-application",
            "projectId": "program:Education::original",
            "partnerUserId": "partner-1",
            "status": "Rejected",
            "revisionNumber": "2",
            "requestedAt": "2026-01-01T00:00:00+00:00",
            "reviewedAt": "2026-01-02T00:00:00+00:00",
            "reviewedBy": "admin-1",
            "reviewNotes": "Revise proposal",
        }
        self.lookup.return_value = previous

        response = await self._submit(previous["id"])

        self.lookup.assert_called_once_with(self.connection, "partnerProjectApplications", previous["id"])
        application = response["application"]
        self.assertEqual(application["id"], previous["id"])
        self.assertEqual(application["projectId"], previous["projectId"])
        self.assertEqual(application["revisionNumber"], 3)
        self.assertEqual(application["status"], "Pending")
        self.assertEqual(application["requestedAt"], application["resubmittedAt"])
        self.assertNotEqual(application["requestedAt"], previous["requestedAt"])
        for field in ("reviewedAt", "reviewedBy", "reviewNotes"):
            self.assertIsNone(application[field])
        self.assertEqual(previous["status"], "Rejected")
        self.assertEqual(previous["revisionNumber"], "2")

    async def test_approved_previous_application_is_not_overwritten_as_revision(self):
        previous = {
            "id": "approved-application",
            "projectId": "approved-project",
            "partnerUserId": "partner-1",
            "status": "Approved",
            "revisionNumber": 2,
        }
        self.lookup.return_value = previous

        response = await self._submit(previous["id"])

        self.assertNotEqual(response["application"]["id"], previous["id"])
        self.assertEqual(response["application"]["revisionNumber"], 0)
        self.assertEqual(previous["status"], "Approved")


if __name__ == "__main__":
    unittest.main()
