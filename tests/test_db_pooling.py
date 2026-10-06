import contextlib
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import MagicMock, patch
from urllib.parse import parse_qs, urlsplit

from backend import db


TRANSACTION_URL = (
    "postgresql://test_user:test_password@"
    "aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres"
)


class DatabasePoolingTests(unittest.TestCase):
    def setUp(self):
        patches = contextlib.ExitStack()
        self.addCleanup(patches.close)
        self.environment = {"SUPABASE_DB_URL": TRANSACTION_URL}
        patches.enter_context(patch.object(db, "load_environment"))
        patches.enter_context(
            patch.object(
                db.os,
                "getenv",
                side_effect=lambda key, default=None: self.environment.get(key, default),
            )
        )
        patches.enter_context(patch.object(db, "_POSTGRES_CONNECTION_POOL", None))
        patches.enter_context(patch.object(db, "_POSTGRES_POOL_INIT_LOCK", threading.Lock()))
        self.pool_constructor = patches.enter_context(patch.object(db, "ConnectionPool"))
        self.pool_constructor.side_effect = AssertionError("Unexpected pool construction")
        self.driver = patches.enter_context(patch.object(db, "psycopg"))
        self.driver.connect.side_effect = AssertionError("Live database connections are forbidden")
        self.direct_connection = patches.enter_context(
            patch.object(
                db,
                "get_postgres_connection",
                side_effect=AssertionError("Pool bypass is forbidden"),
            )
        )

    def tearDown(self):
        self.driver.connect.assert_not_called()
        self.direct_connection.assert_not_called()

    def test_api_candidates_preserve_configured_transaction_endpoint(self):
        candidates = db._get_database_url_candidates()

        self.assertEqual(len(candidates), 1)
        parsed = urlsplit(candidates[0])
        self.assertEqual(parsed.port, 6543)
        self.assertEqual(parse_qs(parsed.query)["sslmode"], ["require"])

    def test_listener_candidates_use_only_session_endpoint(self):
        candidates = db._get_session_database_url_candidates()

        self.assertEqual(len(candidates), 1)
        self.assertEqual(urlsplit(candidates[0]).port, 5432)
        self.assertNotIn(6543, [urlsplit(candidate).port for candidate in candidates])

    def test_explicit_listener_endpoint_preserves_separate_session_host(self):
        self.environment["SUPABASE_DB_SESSION_URL"] = (
            "postgresql://test_user:test_password@db.test-project.supabase.co:5432/postgres"
        )

        session_candidate = db._get_session_database_url_candidates()[0]

        self.assertEqual(urlsplit(session_candidate).hostname, "db.test-project.supabase.co")
        self.assertEqual(urlsplit(session_candidate).port, 5432)
        self.assertEqual(urlsplit(db._get_database_url_candidates()[0]).port, 6543)

    def test_pool_capacity_errors_report_busy_without_direct_fallback(self):
        pool = MagicMock()
        db._POSTGRES_CONNECTION_POOL = pool

        for exception_type in (db.PoolTimeout, db.TooManyRequests):
            with self.subTest(exception_type=exception_type.__name__):
                failure = exception_type("Pool capacity exhausted")
                pool.connection.return_value.__enter__.side_effect = failure

                with self.assertRaises(db.DatabaseBusyError) as raised:
                    with db.get_connection():
                        self.fail("An exhausted pool must not yield a connection")

                self.assertIs(raised.exception.__cause__, failure)

    def test_connection_errors_propagate_without_direct_fallback(self):
        pool = MagicMock()
        db._POSTGRES_CONNECTION_POOL = pool
        failure = OSError("Connection reset")
        pool.connection.return_value.__enter__.side_effect = failure

        with self.assertRaises(OSError) as raised:
            with db.get_connection():
                self.fail("A failed checkout must not yield a connection")

        self.assertIs(raised.exception, failure)

    def test_caller_transaction_exception_propagates_after_single_yield(self):
        pool = MagicMock()
        db._POSTGRES_CONNECTION_POOL = pool
        connection = object()
        pool.connection.return_value.__enter__.return_value = connection
        pool.connection.return_value.__exit__.return_value = False
        failure = ValueError("Transaction validation failed")
        yielded = []

        with self.assertRaises(ValueError) as raised:
            with db.get_connection() as borrowed:
                yielded.append(borrowed)
                raise failure

        self.assertIs(raised.exception, failure)
        self.assertEqual(yielded, [connection])
        pool.connection.assert_called_once_with()
        pool.connection.return_value.__exit__.assert_called_once()

    def test_concurrent_lazy_initialization_creates_one_bounded_pool(self):
        pool = MagicMock()
        connection = object()

        @contextlib.contextmanager
        def borrow_connection():
            yield connection

        pool.connection.side_effect = borrow_connection
        constructor_entered = threading.Event()
        release_constructor = threading.Event()
        worker_count = 8
        ready = threading.Barrier(worker_count + 1)

        def construct_pool(*args, **kwargs):
            constructor_entered.set()
            if not release_constructor.wait(timeout=3):
                raise AssertionError("Test did not release pool constructor")
            return pool

        def request_connection():
            ready.wait(timeout=3)
            with db.get_connection() as borrowed:
                return borrowed

        self.pool_constructor.side_effect = construct_pool
        with ThreadPoolExecutor(max_workers=worker_count) as executor:
            futures = [executor.submit(request_connection) for _ in range(worker_count)]
            try:
                ready.wait(timeout=3)
                self.assertTrue(constructor_entered.wait(timeout=3))
            finally:
                release_constructor.set()
            borrowed_connections = [future.result(timeout=3) for future in futures]

        self.assertEqual(borrowed_connections, [connection] * worker_count)
        self.pool_constructor.assert_called_once()
        options = self.pool_constructor.call_args.kwargs
        self.assertEqual(urlsplit(self.pool_constructor.call_args.args[0]).port, 6543)
        self.assertEqual(options["max_size"], 3)
        self.assertEqual(options["max_waiting"], 64)
        self.assertIsNone(options["kwargs"]["prepare_threshold"])
        self.assertEqual(pool.connection.call_count, worker_count)

    def test_unavailable_pool_dependency_fails_without_direct_connection(self):
        with patch.object(db, "ConnectionPool", None):
            with self.assertRaisesRegex(RuntimeError, "pooling is unavailable"):
                with db.get_connection():
                    self.fail("Missing pooling dependencies must not open direct sessions")

    def test_failed_pool_initialization_does_not_open_direct_connection(self):
        self.pool_constructor.side_effect = RuntimeError("Pool construction failed")

        with self.assertRaisesRegex(RuntimeError, "could not be initialized"):
            with db.get_connection():
                self.fail("An initialization failure must not open direct sessions")

        self.pool_constructor.assert_called_once()


if __name__ == "__main__":
    unittest.main()
