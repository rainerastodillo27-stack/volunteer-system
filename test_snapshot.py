#!/usr/bin/env python3
from backend.api import _build_projects_snapshot
from backend.db import get_postgres_connection
import time

with get_postgres_connection() as conn:
    t = time.perf_counter()
    snapshot = _build_projects_snapshot(conn, None, None, {'projects'})
    elapsed = round(time.perf_counter() - t, 3)
    proj_count = len(snapshot.get("projects", []))
    print(f"Snapshot projects: {proj_count} ({elapsed}s)")
    if proj_count == 0:
        print("WARNING: Snapshot returned 0 projects even though database has data!")
    print(f"Snapshot keys: {list(snapshot.keys())}")
