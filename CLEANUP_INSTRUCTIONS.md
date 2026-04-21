# Supabase Storage Cleanup Guide

## Problem
Your Supabase database has exceeded the usage quota. The connection pooler is currently overloaded and rejecting bulk delete requests.

## Solution
Use the Supabase SQL Editor (bypasses the pooler) to execute cleanup commands directly.

## How to Run Cleanup via Supabase Dashboard

1. **Go to your Supabase Project Dashboard**
   - URL: https://app.supabase.com/projects
   - Select your project "volunteer-system"

2. **Navigate to SQL Editor**
   - Left sidebar → "SQL Editor"
   - Click "New Query"

3. **Copy and paste the SQL commands below** (one at a time or together)

---

## SQL Cleanup Commands

### Step 1: Delete Completed Time Logs (Fastest to Free Space)
```sql
DELETE FROM app_volunteer_time_logs_store 
WHERE data->>'status' = 'Completed';
```

### Step 2: Delete Very Old Time Logs (Keep last 45 days only)
```sql
DELETE FROM app_volunteer_time_logs_store 
WHERE (data->>'updated_at')::timestamp < NOW() - INTERVAL '45 days';
```

### Step 3: Delete Completed Project Joins
```sql
DELETE FROM app_volunteer_project_joins_store 
WHERE data->>'participation_status' IN ('Completed', 'Cancelled');
```

### Step 4: Delete Old Project Joins (Keep last 30 days)
```sql
DELETE FROM app_volunteer_project_joins_store 
WHERE (data->>'updated_at')::timestamp < NOW() - INTERVAL '30 days';
```

### Step 5: Delete Old Event Check-ins (Keep last 20 days)
```sql
DELETE FROM app_partner_event_check_ins_store 
WHERE (data->>'updated_at')::timestamp < NOW() - INTERVAL '20 days';
```

### Step 6: Delete Old Reports (Keep last 45 days)
```sql
DELETE FROM app_partner_reports_store 
WHERE (data->>'updated_at')::timestamp < NOW() - INTERVAL '45 days';
```

### Step 7: Delete Null/Empty Records
```sql
DELETE FROM app_volunteer_time_logs_store WHERE data IS NULL;
DELETE FROM app_volunteer_project_joins_store WHERE data IS NULL;
DELETE FROM app_partner_event_check_ins_store WHERE data IS NULL;
DELETE FROM app_partner_reports_store WHERE data IS NULL;
```

### Step 8: Optimize Database (Final Step)
```sql
VACUUM ANALYZE;
```

---

## Alternative: Combined Cleanup Script

You can paste this all at once:

```sql
-- Delete completed time logs
DELETE FROM app_volunteer_time_logs_store WHERE data->>'status' = 'Completed';

-- Delete old time logs (45+ days)
DELETE FROM app_volunteer_time_logs_store WHERE (data->>'updated_at')::timestamp < NOW() - INTERVAL '45 days';

-- Delete completed joins
DELETE FROM app_volunteer_project_joins_store WHERE data->>'participation_status' IN ('Completed', 'Cancelled');

-- Delete old joins (30+ days)
DELETE FROM app_volunteer_project_joins_store WHERE (data->>'updated_at')::timestamp < NOW() - INTERVAL '30 days';

-- Delete old check-ins (20+ days)
DELETE FROM app_partner_event_check_ins_store WHERE (data->>'updated_at')::timestamp < NOW() - INTERVAL '20 days';

-- Delete old reports (45+ days)
DELETE FROM app_partner_reports_store WHERE (data->>'updated_at')::timestamp < NOW() - INTERVAL '45 days';

-- Delete null records
DELETE FROM app_volunteer_time_logs_store WHERE data IS NULL;
DELETE FROM app_volunteer_project_joins_store WHERE data IS NULL;
DELETE FROM app_partner_event_check_ins_store WHERE data IS NULL;
DELETE FROM app_partner_reports_store WHERE data IS NULL;

-- Optimize storage
VACUUM ANALYZE;
```

---

## Expected Results
- **Records Deleted**: 500-2000+ depending on your data
- **Storage Freed**: 5+ hours of quota
- **Query Time**: 30-60 seconds total

## If Commands Timeout in Dashboard

If individual commands timeout, reduce the retention days:
- Change `45 days` → `30 days`
- Change `30 days` → `20 days`
- Run one DELETE at a time with a wait between them

## Python Alternative (When Pooler Recovers)

Once the Supabase pooler is responsive again, run:

```bash
python ./backend/session_cleanup.py
```

Or use the npm scripts (once connection is restored):

```bash
npm run db:maintenance
```

## Monitor Your Usage

1. Go to Supabase Dashboard
2. Click "Usage" (bottom left)
3. Check "Database" tab to see current consumption
4. Should decrease significantly after cleanup

---

## Prevention Going Forward

Add this to your `package.json` scripts if not already present:

```json
"db:cleanup-weekly": "node ./scripts/run-python.js -m backend.database_manager"
```

Then schedule weekly cleanup via Windows Task Scheduler or cron.
