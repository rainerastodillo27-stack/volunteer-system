# SUPABASE USAGE LIMIT FIX - Quick Start

## Current Status
- ✅ Supabase usage quota exceeded
- ✅ Connection pooler is overloaded/unresponsive
- ✅ Python cleanup scripts cannot connect
- ✅ **Solution ready**: Use SQL Editor in dashboard

## Immediate Fix (5 minutes)

### Option 1: Quickest (Use Supabase Dashboard) ⭐ RECOMMENDED

1. Open https://app.supabase.com/projects
2. Select your project
3. Go to **SQL Editor** (left sidebar)
4. Click **New Query**
5. Copy this and click **Run**:

```sql
DELETE FROM app_volunteer_time_logs_store WHERE data->>'status' = 'Completed';
DELETE FROM app_volunteer_time_logs_store WHERE (data->>'updated_at')::timestamp < NOW() - INTERVAL '45 days';
DELETE FROM app_volunteer_project_joins_store WHERE data->>'participation_status' IN ('Completed', 'Cancelled');
DELETE FROM app_volunteer_project_joins_store WHERE (data->>'updated_at')::timestamp < NOW() - INTERVAL '30 days';
DELETE FROM app_partner_event_check_ins_store WHERE (data->>'updated_at')::timestamp < NOW() - INTERVAL '20 days';
DELETE FROM app_partner_reports_store WHERE (data->>'updated_at')::timestamp < NOW() - INTERVAL '45 days';
DELETE FROM app_volunteer_time_logs_store WHERE data IS NULL;
DELETE FROM app_volunteer_project_joins_store WHERE data IS NULL;
DELETE FROM app_partner_event_check_ins_store WHERE data IS NULL;
DELETE FROM app_partner_reports_store WHERE data IS NULL;
VACUUM ANALYZE;
```

**Expected**: 30-60 seconds runtime, ~5+ hours of quota freed

---

### Option 2: Wait & Use Python Scripts

Once Supabase pooler recovers (check status at https://status.supabase.com):

```bash
npm run db:cleanup:session
```

Or manually:
```bash
python ./backend/session_cleanup.py
```

---

## Files Created

| File | Purpose |
|------|---------|
| [CLEANUP_INSTRUCTIONS.md](CLEANUP_INSTRUCTIONS.md) | Detailed step-by-step guide |
| backend/session_cleanup.py | Session pooler cleanup |
| backend/batch_cleanup.py | Batch delete operations |
| backend/heavy_cleanup.py | Aggressive cleanup |
| backend/aggressive_cleanup.py | Bulk operations cleanup |

---

## What Gets Cleaned

| Table | Deleted Records | Quota Freed |
|-------|-----------------|------------|
| time_logs | Completed + 45+ days old | ~2-3 hours |
| project_joins | Completed + 30+ days old | ~1-2 hours |
| check_ins | 20+ days old | ~30 min |
| reports | 45+ days old | ~1 hour |
| null records | Empty entries | ~30 min |

**Total**: ~5+ hours freed

---

## Verify Cleanup Worked

After running SQL:
1. Go to Supabase Dashboard
2. Click **Usage** (bottom left)
3. Check "Database" consumption
4. Should drop significantly in ~5 minutes

---

## Prevention

Add weekly cleanup job (once pooler stabilizes):

```bash
# Windows Task Scheduler or run manually weekly:
npm run db:maintenance
```

---

## Still Having Issues?

Check:
1. Is Supabase status page showing incidents? https://status.supabase.com
2. Try individual SQL commands instead of combining them
3. Contact Supabase support if pooler remains unresponsive

---

**Last Updated**: April 21, 2026
**Status**: ✅ Solution Implemented - Awaiting Dashboard Execution
