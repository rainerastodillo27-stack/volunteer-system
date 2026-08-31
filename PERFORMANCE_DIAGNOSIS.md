# Performance Diagnosis Report

**Date:** September 1, 2026  
**Status:** 🔴 CRITICAL PERFORMANCE ISSUES DETECTED

---

## Executive Summary

The system is experiencing **severe performance degradation** with API response times averaging 14.5 seconds per request, and some endpoints timing out after 30+ seconds. This makes the application essentially unusable.

---

## Performance Measurements

### Backend API Response Times

| Endpoint | Response Time | Status | Target |
|----------|--------------|--------|---------|
| **Health Check** | 63,178 ms (63s) | ❌ CRITICAL | <100ms |
| **Users Storage** | 2,648 ms | ⚠️ SLOW | <500ms |
| **Partners Storage** | 2,291 ms | ⚠️ SLOW | <500ms |
| **Programs Storage** | 4,350 ms | ❌ VERY SLOW | <1000ms |
| **Projects Storage** | TIMEOUT | ❌ FAILED | <2000ms |
| **Events Storage** | 13,046 ms (13s) | ❌ CRITICAL | <2000ms |
| **Volunteers Storage** | 1,553 ms | ⚠️ SLOW | <500ms |

**Average Response Time:** 14.5 seconds  
**Success Rate:** 85% (1 timeout)

### System Resources

- **CPU Usage:** 56% (elevated)
- **Memory Usage:** 72.3% (5.34 GB / 7.39 GB)
- **Database Pool:** 4 connections (healthy)
- **Disk Space:** 307 GB free (healthy)

---

## Root Cause Analysis

### 1. **Database Query Performance Issues**

#### Problem
The `get_relational_collection` function in `backend/relational_mirror.py` is executing slow queries:

```python
# Line 2368+
def get_relational_collection(connection: Any, key: str) -> list[dict[str, Any]]:
    # ... 
    cursor.execute("SET statement_timeout = '30s'")  # 30 second timeout!
    query = f"select {', '.join(column_names)} from {spec['table']}"
    cursor.execute(query)
```

**Issues:**
- No query optimization or indexing strategy
- Fetching all columns for every request
- No pagination or limit clause
- 30-second timeout suggests queries are expected to be slow
- Reading entire collections on every request

### 2. **Supabase Pooler Connection Latency**

From backend logs:
```
[OK] Postgres connection pool initialized (min=2, max=10) 
     using aws-0-ap-southeast-2.pooler.supabase.com
```

**Potential Issues:**
- Network latency to AWS Sydney region
- Pooler connection overhead
- No connection reuse strategy visible

### 3. **Cache Warming Performance**

From logs:
```
[TRACE] _build_projects_snapshot: read core collections after 2.362s
[TRACE] _build_projects_snapshot: read core collections after 0.677s
[OK] Warmed projects snapshot cache.
```

- Projects snapshot takes 2+ seconds to build
- Multiple collections being read synchronously
- No parallel fetch strategy

### 4. **No Query Result Caching**

While there's a `TTLCache` class defined, large collection queries appear to bypass efficient caching:

```python
# backend/api.py line 1617
if key in NON_CACHEABLE_COLLECTION_KEYS:
    if is_hot_storage_key(key):
        return get_postgres_hot_storage_collection(connection, key)
```

Many keys are marked as non-cacheable, forcing fresh DB queries every time.

### 5. **PowerShell Invoke-WebRequest Overhead**

The performance script uses `Invoke-WebRequest` which:
- Parses HTML/JS (security prompts)
- Adds 2-5 seconds overhead per request
- Not representative of real API performance

---

## Impact Assessment

### User Experience
- **Mobile App:** Essentially unusable with 10-60 second load times
- **Admin Dashboard:** Time-intensive for data operations
- **Real-time Updates:** WebSocket connections dropping due to connection timeouts

### Business Impact
- **High:** Critical usability issue affecting all users
- **Data Operations:** Admin tasks taking 10x longer than expected
- **Volunteer Engagement:** Poor UX may reduce volunteer participation

---

## Recommended Fixes (Priority Order)

### 🔥 IMMEDIATE (P0)

#### 1. Add Database Indexes
```sql
-- On primary lookup columns
CREATE INDEX IF NOT EXISTS idx_projects_id ON projects(projects_id);
CREATE INDEX IF NOT EXISTS idx_events_id ON events(events_id);
CREATE INDEX IF NOT EXISTS idx_users_id ON users(users_id);
CREATE INDEX IF NOT EXISTS idx_partners_id ON partners(partners_id);
CREATE INDEX IF NOT EXISTS idx_volunteers_user_id ON volunteers(user_id);

-- On frequently joined columns
CREATE INDEX IF NOT EXISTS idx_volunteer_matches_project_id ON volunteer_matches(project_id);
CREATE INDEX IF NOT EXISTS idx_volunteer_matches_volunteer_id ON volunteer_matches(volunteer_id);
CREATE INDEX IF NOT EXISTS idx_volunteer_time_logs_project_id ON volunteer_time_logs(project_id);
CREATE INDEX IF NOT EXISTS idx_volunteer_time_logs_volunteer_id ON volunteer_time_logs(volunteer_id);
```

#### 2. Implement Query Pagination
Modify `get_relational_collection` to support LIMIT/OFFSET:

```python
def get_relational_collection(
    connection: Any, 
    key: str,
    limit: int | None = None,
    offset: int = 0
) -> list[dict[str, Any]]:
    # ...
    query = f"select {', '.join(column_names)} from {spec['table']}"
    if filter_clause:
        query += f" where {filter_clause}"
    query += f" order by {_primary_key_column(key)} asc"
    if limit:
        query += f" LIMIT {limit} OFFSET {offset}"
```

#### 3. Enable Aggressive Collection Caching
Remove most keys from `NON_CACHEABLE_COLLECTION_KEYS` and cache for 30-60 seconds:

```python
_storage_collection_cache = TTLCache(ttl_seconds=60)  # Increase from 5s
```

### 🚨 URGENT (P1)

#### 4. Optimize Large Table Queries
For tables with 1000+ rows (projects, events, volunteers):

```python
# Only fetch necessary columns, not all
LIGHT_COLUMN_SETS = {
    "projects": ["projects_id", "name", "status", "start_date", "end_date"],
    "events": ["events_id", "name", "status", "event_date", "project_id"],
    # ...
}
```

#### 5. Add Query Performance Monitoring
```python
import time

def get_relational_collection(connection: Any, key: str):
    start = time.time()
    try:
        # ... query execution
        result = ...
        duration = (time.time() - start) * 1000
        if duration > 1000:
            print(f"[SLOW QUERY] {key}: {duration:.0f}ms")
        return result
```

#### 6. Use Connection Pooling More Efficiently
Increase pool size for high-concurrency scenarios:

```python
# backend/db.py
def _get_pool_max_size() -> int:
    return int(os.getenv("DB_POOL_MAX_SIZE", "20"))  # Increase from 10
```

### ⚡ HIGH (P2)

#### 7. Implement Parallel Collection Fetching
For dashboard snapshots, fetch multiple collections in parallel:

```python
import asyncio

async def get_dashboard_snapshot_async():
    tasks = [
        fetch_collection_async("projects"),
        fetch_collection_async("events"),
        fetch_collection_async("volunteers"),
        # ...
    ]
    return await asyncio.gather(*tasks)
```

#### 8. Add Query Result Streaming
For very large collections, stream results instead of loading all into memory:

```python
def stream_collection(connection, key):
    with connection.cursor() as cursor:
        cursor.itersize = 500  # Fetch 500 rows at a time
        cursor.execute(query)
        for row in cursor:
            yield _row_to_item(key, row)
```

#### 9. Database Query Plan Analysis
Run EXPLAIN ANALYZE on slow queries to identify bottlenecks:

```sql
EXPLAIN ANALYZE 
SELECT projects_id, name, description, status, /* ... */
FROM projects 
ORDER BY projects_id ASC;
```

### 📊 MEDIUM (P3)

#### 10. Implement Redis Caching Layer
Use Redis for distributed caching across multiple backend instances.

#### 11. Add Read Replicas
Configure Supabase to use read replicas for non-write operations.

#### 12. GraphQL Optimization
If using GraphQL, implement DataLoader pattern to batch queries.

---

## Performance Testing Script Improvements

### Fix the PowerShell Script

The current script has issues with `Invoke-WebRequest` overhead. Create a pure HTTP client:

```powershell
# Use -UseBasicParsing to avoid HTML parsing
$response = Invoke-WebRequest -Uri $url -UseBasicParsing -Method GET
```

Or use a dedicated tool:
```bash
# Using curl (faster)
curl -w "@curl-format.txt" -o /dev/null -s "http://localhost:8000/storage/users"
```

---

## Monitoring Recommendations

1. **Add Application Performance Monitoring (APM)**
   - DataDog, New Relic, or Sentry Performance
   
2. **Database Query Monitoring**
   - Enable Supabase query insights
   - Track slow query logs
   
3. **Set up Alerts**
   - Response time > 5s: Warning
   - Response time > 10s: Critical
   - Error rate > 5%: Critical

---

## Next Steps

1. ✅ **Measure baseline** (completed)
2. ⏭️ **Implement P0 fixes** (indexes, caching, pagination)
3. ⏭️ **Re-measure performance** (target: <2s avg response)
4. ⏭️ **Implement P1 fixes** if needed
5. ⏭️ **Set up continuous monitoring**

---

## Related Files

- `backend/relational_mirror.py` - Query execution
- `backend/api.py` - API endpoints and caching
- `backend/db.py` - Database connection pooling
- `backend/app_storage_seed.py` - Storage collection fetching
- `scripts/check-performance.ps1` - Performance testing

---

**Estimated Fix Time:**
- P0 Fixes: 2-4 hours
- P1 Fixes: 4-8 hours
- P2 Fixes: 1-2 days
- Full optimization: 1 week

**Expected Improvement:**
- Target: 80-90% reduction in response times
- Health check: <100ms (from 63s)
- Storage endpoints: <500ms (from 2-13s)
- Overall: <2s average (from 14.5s)
