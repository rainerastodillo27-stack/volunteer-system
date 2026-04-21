# Database Usage Limit Optimization Guide

## Overview

The volunteer system database uses multiple "hot storage" tables that accumulate historical data. Without proper cleanup and retention policies, the database can exceed Supabase's storage limits. This guide explains the optimization strategy and how to manage database growth.

## Problem Analysis

### Current Database Tables

Your database has several tables that accumulate data:

- **`app_volunteer_time_logs_store`** (32 kB) - Logs of volunteer work hours
- **`app_volunteer_project_joins_store`** (32 kB) - Volunteer participation records
- **`app_partner_event_check_ins_store`** (32 kB) - Event attendance records
- **`app_partner_reports_store`** (16-32 kB) - Partner-submitted reports
- **`app_published_impact_reports_store`** (32 kB) - Published impact reports
- **`app_status_updates_store`** (32 kB) - Project status updates
- **`project_group_messages`** (48 kB) - Group chat messages

**Total Current Usage:** ~200+ kB and growing

### Root Cause

These tables use JSON storage without automatic cleanup. Old records from completed projects, archived events, and historical data accumulate indefinitely.

## Solution: Retention Policies & Archival

### Default Retention Periods

| Data Type | Retention | Purpose |
|-----------|-----------|---------|
| Volunteer time logs | 2 years | Audit trail & performance history |
| Project joins | 1 year | Volunteer participation history |
| Event check-ins | 6 months | Recent event data only |
| Partner reports | 1 year | Accountability & reports |
| Published reports | 2 years | Impact documentation |
| Status updates | 6 months | Recent project status |
| Group messages | 6 months | Recent communication history |

### Maximum Record Limits (as backup)

If time-based retention doesn't work, these limits trigger:

| Table | Max Records |
|-------|------------|
| Volunteer time logs | 5,000 |
| Project joins | 10,000 |
| Event check-ins | 5,000 |
| Partner reports | 2,000 |
| Published reports | 1,000 |
| Group messages | 20,000 |

## Implementation

### Automatic Cleanup (During Schema Init)

Cleanup runs automatically when you initialize the schema:

```bash
cd backend
python init_supabase.py
```

Output:
```
Supabase Postgres schema created or updated.
Archived old records: app_volunteer_time_logs_store:145 (expired), ...
```

### Manual Cleanup

#### Full Database Maintenance

```bash
cd backend
python database_manager.py
```

This:
1. ✓ Removes old time logs (>730 days)
2. ✓ Removes old project joins (>365 days)
3. ✓ Removes old event check-ins (>180 days)
4. ✓ Removes old reports (>365 days)
5. ✓ Removes orphaned records
6. ✓ Removes duplicate records
7. ✓ Optimizes storage (VACUUM ANALYZE)

#### Storage Report

```bash
cd backend
python database_manager.py --report
```

Shows:
- Current size of each table
- Row counts
- Average row size
- Archival recommendations

### One-Time Cleanup Script

```bash
cd backend
python database_cleanup.py
```

For quick cleanup of a specific issue.

## Advanced Configuration

### Customizing Retention Periods

Edit `backend/database_cleanup.py`:

```python
def get_retention_policies() -> dict[str, int]:
    return {
        "volunteer_time_logs": 730,      # Change this value (in days)
        "volunteer_project_joins": 365,
        # ... etc
    }
```

### Customizing Record Limits

Edit `backend/data_archival.py`:

```python
MAX_RECORDS_PER_TABLE = {
    "app_volunteer_time_logs_store": 5000,  # Change this value
    # ... etc
}
```

## Scheduling Automatic Cleanup

### Option 1: Windows Task Scheduler

Create a scheduled task to run:
```
python "C:\Users\ACER\OneDrive\Desktop\volunteer-system\backend\database_manager.py"
```

Recommended: Run weekly on Sunday at 2 AM

### Option 2: Cron (Linux/Mac)

Add to crontab:
```bash
# Weekly cleanup every Sunday at 2 AM
0 2 * * 0 cd /path/to/volunteer-system/backend && python database_manager.py
```

### Option 3: GitHub Actions / CI/CD

Create `.github/workflows/db-maintenance.yml`:

```yaml
name: Database Maintenance
on:
  schedule:
    - cron: '0 2 * * 0'  # Weekly Sunday at 2 AM UTC

jobs:
  cleanup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Set up Python
        uses: actions/setup-python@v2
        with:
          python-version: '3.11'
      - name: Install dependencies
        run: |
          pip install python-dotenv psycopg
      - name: Run database cleanup
        env:
          SUPABASE_DB_URL: ${{ secrets.SUPABASE_DB_URL }}
        run: cd backend && python database_manager.py
```

## Expected Results

### Before Optimization
- Storage growing ~5-10 kB/week
- Old records accumulating indefinitely
- Database potentially exceeding limits

### After Optimization
- Storage stabilized at ~150-200 kB
- Old data automatically archived
- Meets Supabase usage limits
- Better query performance

## Monitoring

### Check Current Usage

```bash
python database_manager.py --report
```

### Database Size Query

In Supabase dashboard > SQL editor:
```sql
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

## Troubleshooting

### "ImportError: No module named 'data_archival'"

Make sure you're running from the backend directory:
```bash
cd backend
python database_manager.py
```

### Cleanup Fails with "Connection Timeout"

Check your `.env` file:
```bash
# Increase timeout
DB_CONNECT_TIMEOUT=10
```

### Still Exceeding Limits?

1. Check which tables are largest: `python database_manager.py --report`
2. Reduce retention periods in `database_cleanup.py`
3. Lower `MAX_RECORDS_PER_TABLE` limits
4. Manual cleanup: Delete very old completed projects' data

## Data Safety

### Backup Before Cleanup

Supabase automatically backs up data. To be extra safe:

1. Export important reports before cleanup
2. Cleanup runs in transactions - it's safe to retry
3. Old data is deleted (not recoverable), so archive if needed

### What Data Is Deleted?

- ✓ Completed time logs older than 2 years
- ✓ Completed project joins older than 1 year  
- ✓ Old event check-ins older than 6 months
- ✓ Reviewed reports older than 1 year
- ✓ Orphaned records with missing references
- ✓ Duplicate records (keeps most recent)

### What Data Is Preserved

- ✓ Active/ongoing projects
- ✓ User accounts & credentials
- ✓ Core project information
- ✓ Recent activity (within retention period)

## Performance Impact

### Cleanup Performance

- ✓ Safe to run during normal operations
- ✓ Takes 5-30 minutes depending on data volume
- ✓ Uses transactions to ensure consistency
- ✓ Won't block normal queries

### After Cleanup

- ✓ Query performance improves
- ✓ Index scans faster
- ✓ Lower RAM usage
- ✓ Better connection pool efficiency

## Support

For issues or questions:

1. Check retention periods in `database_cleanup.py`
2. Run `python database_manager.py --report` for analysis
3. Review Supabase dashboard for storage trends
4. Contact DevOps team if limits still exceeded
