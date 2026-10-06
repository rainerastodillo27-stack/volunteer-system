import contextlib
import json
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, call, patch

from backend import db, realtime_bus as bus


SESSION_URL = (
    "postgresql://test_user:test_password@"
    "aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres"
)


class RealtimePoolingTests(unittest.TestCase):
    def setUp(self):
        patches = contextlib.ExitStack()
        self.addCleanup(patches.close)
        patches.enter_context(patch.object(bus, "_ORIGIN", "test-origin"))
        patches.enter_context(patch.object(bus, "_state_lock", threading.Lock()))
        patches.enter_context(patch.object(bus, "_publisher_lock", threading.Lock()))
        patches.enter_context(patch.object(bus, "_stop_event", threading.Event()))
        patches.enter_context(patch.object(bus, "_listener_thread", None))
        patches.enter_context(patch.object(bus, "_listener_connection", None))
        patches.enter_context(patch.object(bus, "_listener_callback", None))
        patches.enter_context(patch.object(bus, "_get_connect_timeout", return_value=1))
        self.session_candidates = patches.enter_context(
            patch.object(bus, "_get_session_database_url_candidates", return_value=[SESSION_URL])
        )
        self.driver = patches.enter_context(patch.object(bus, "psycopg"))
        self.driver.connect.side_effect = AssertionError("Live database calls are forbidden")
        self.pool_checkout = patches.enter_context(
            patch.object(bus, "get_connection", side_effect=AssertionError("Unexpected pool checkout"))
        )
        self.direct_connection = patches.enter_context(
            patch.object(db, "get_postgres_connection", side_effect=AssertionError("Direct fallback is forbidden"))
        )
        patches.enter_context(patch("builtins.print"))
        self.addCleanup(bus.stop)

    def tearDown(self):
        self.direct_connection.assert_not_called()

    def test_publisher_releases_shared_pool_and_preserves_notification_envelope(self):
        events = []
        connection = Mock()
        connection.execute.side_effect = lambda *_args: events.append("notify")

        @contextlib.contextmanager
        def borrow_connection():
            events.append("checkout")
            try:
                yield connection
            finally:
                events.append("release")

        self.pool_checkout.side_effect = borrow_connection
        event = {"kind": "storage.changed", "keys": ["events", "volunteerTimeLogs"]}

        with patch.object(bus, "_open_connection") as listener_opener:
            published = bus.publish(event)

        self.assertTrue(published)
        self.assertEqual(events, ["checkout", "notify", "release"])
        self.pool_checkout.assert_called_once_with()
        query, parameters = connection.execute.call_args.args
        self.assertEqual(query, "select pg_notify('volcre_realtime', %s)")
        self.assertEqual(json.loads(parameters[0]), {"origin": "test-origin", "event": event})
        listener_opener.assert_not_called()
        self.driver.connect.assert_not_called()

    def test_busy_pool_never_opens_dedicated_listener_connection(self):
        context = MagicMock()
        context.__enter__.side_effect = db.DatabaseBusyError("Database busy")
        self.pool_checkout.side_effect = None
        self.pool_checkout.return_value = context

        with patch.object(bus, "_open_connection") as listener_opener:
            self.assertFalse(bus.publish({"kind": "storage.changed", "keys": ["events"]}))

        self.pool_checkout.assert_called_once_with()
        listener_opener.assert_not_called()
        self.driver.connect.assert_not_called()

    def test_oversized_utf8_payload_skips_all_database_connections(self):
        # These 2,000 characters encode to 8,000 bytes, exceeding the NOTIFY limit.
        event = {"kind": "message.changed", "text": "\U0001f680" * 2000}

        with patch.object(bus, "_open_connection") as listener_opener:
            self.assertFalse(bus.publish(event))

        self.pool_checkout.assert_not_called()
        listener_opener.assert_not_called()
        self.driver.connect.assert_not_called()

    def test_listener_opens_only_configured_session_endpoint(self):
        connection = Mock()
        self.driver.connect.side_effect = None
        self.driver.connect.return_value = connection

        self.assertIs(bus._open_connection(), connection)

        self.session_candidates.assert_called_once_with()
        self.driver.connect.assert_called_once()
        args, options = self.driver.connect.call_args
        self.assertEqual(args, (SESSION_URL,))
        self.assertTrue(options["autocommit"])
        self.assertIsNone(options["prepare_threshold"])
        self.assertEqual(options["connect_timeout"], 1)
        self.pool_checkout.assert_not_called()

    def test_failed_listener_session_does_not_fall_back_to_transaction_pool(self):
        failure = OSError("Session endpoint unavailable")
        self.driver.connect.side_effect = failure

        with self.assertRaises(OSError) as raised:
            bus._open_connection()

        self.assertIs(raised.exception, failure)
        self.driver.connect.assert_called_once()
        self.assertEqual(self.driver.connect.call_args.args, (SESSION_URL,))
        self.pool_checkout.assert_not_called()

    def test_listener_delivers_remote_event_once_and_closes_session_on_stop(self):
        connected = threading.Event()
        delivered = threading.Event()
        closed = threading.Event()
        connection = MagicMock()
        connection.close.side_effect = closed.set
        remote_event = {"kind": "storage.changed", "keys": ["events"]}
        notifications = [
            SimpleNamespace(payload=json.dumps({"origin": "test-origin", "event": remote_event})),
            SimpleNamespace(payload=json.dumps({"origin": "remote-worker", "event": remote_event})),
        ]

        def receive_notifications(timeout):
            self.assertEqual(timeout, 5)
            if notifications:
                batch = list(notifications)
                notifications.clear()
                return iter(batch)
            if not closed.wait(timeout=3):
                raise AssertionError("Listener was not closed during test shutdown")
            return iter(())

        def receive_event(event):
            if event.get("kind") == "realtime.connected":
                connected.set()
            else:
                delivered.set()

        connection.notifies.side_effect = receive_notifications
        callback = Mock(side_effect=receive_event)
        with patch.object(bus, "_open_connection", return_value=connection) as listener_opener:
            bus.start(callback)
            self.assertTrue(connected.wait(timeout=2))
            self.assertTrue(delivered.wait(timeout=2))
            listener_thread = bus._listener_thread
            bus.start(callback)
            self.assertIs(bus._listener_thread, listener_thread)
            bus.stop()

        self.assertTrue(closed.is_set())
        self.assertFalse(listener_thread.is_alive())
        self.assertIsNone(bus._listener_thread)
        self.assertIsNone(bus._listener_connection)
        listener_opener.assert_called_once_with()
        connection.cursor.return_value.__enter__.return_value.execute.assert_called_once_with(
            "listen volcre_realtime"
        )
        self.assertEqual(callback.call_args_list, [call({"kind": "realtime.connected"}), call(remote_event)])
        self.pool_checkout.assert_not_called()
        self.driver.connect.assert_not_called()


if __name__ == "__main__":
    unittest.main()
