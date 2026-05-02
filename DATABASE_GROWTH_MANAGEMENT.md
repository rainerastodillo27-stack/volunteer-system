# Database Growth Management Strategy

**Current Status:** 27 MB / 500 MB (5.4%) — ✅ Sustainable

## Goal
Prevent database from exceeding Supabase Free Plan (500 MB) while maintaining system stability.

---

## 1. AUTOMATIC CLEANUP SCHEDULE

### Weekly Maintenance (Every Monday 2 AM)
- Remove time logs older than 2 years
- Remove project joins older than 1 year
- Remove check-ins older than 6 months
- Remove reports older than 1 year
- Deduplicate records
- Optimize storage (VACUUM ANALYZE)

### Manual Trigger
```bash
npm run db:maintenance          # Full cleanup
npm run db:maintenance:report   # See storage usage
```

---

## 2. RETENTION POLICIES (Automatic)

Data is automatically retained based on these policies:

| Table | Retention | Reason |
|-------|-----------|--------|
| `volunteer_time_logs` | 2 years | Legal/compliance requirement |
| `volunteer_project_joins` | 1 year | Historical volunteer records |
| `partner_event_check_ins` | 6 months | Temporary operational data |
| `partner_reports` | 1 year | Annual review period |
| `published_impact_reports` | 2 years | Impact tracking |
| `status_updates` | 6 months | Temporary project status |
| `project_group_messages` | 6 months | Communication archive |
| `app_volunteer_time_logs_store` | 6 months | Session data (auto-cleaned) |

---

## 3. GROWTH PROJECTIONS

### Baseline (Current)
- Database Size: 27 MB
- Demo Data: ~7 MB
- Operational Data: ~20 MB

### Annual Growth Estimate (Conservative)
```
Month 1:   27 MB (seed data)
Month 3:   45 MB (+18 MB from operations)
Month 6:   85 MB (+40 MB from 6 months ops)
Month 12: 180 MB (with cleanup removing 6+ month logs)
Month 24: 250 MB (steady state with yearly cleanup)
```

### Capacity Safety Threshold
- ⚠️ Yellow Alert: 350 MB (70% full) — trigger aggressive cleanup
- 🔴 Red Alert: 450 MB (90% full) — pause new features until cleaned
- 🛑 Critical: 490 MB (98% full) — automatic lockdown mode

---

## 4. AUTOMATED SAFEGUARDS

### Database Size Monitoring
1. **Weekly Check** (Monday 1:30 AM)
   - Query current database size
   - Compare to threshold limits
   - Log to monitoring system

2. **Alert Triggers**
   - If 70% full → Run aggressive cleanup
   - If 85% full → Send admin notification
   - If 95% full → Trigger emergency cleanup
   - If >99% full → System enters read-only mode

### Auto-Cleanup on Threshold
```python
# backend/db_monitor.py (runs via cron/scheduler)
- Check size every 6 hours
- If > 350 MB → Run cleanup
- If > 400 MB → Run aggressive cleanup  
- If > 450 MB → Alert and cleanup
```

---

## 5. STORAGE OPTIMIZATION TECHNIQUES

### Implemented
- ✅ Soft deletes (mark as deleted, don't remove)
- ✅ Data archival (export old records before deletion)
- ✅ VACUUM ANALYZE (defrag storage)
- ✅ Index optimization
- ✅ Duplicate removal

### Future Options (if needed)
- Partition large tables by date
- Move 2+ year old data to external archive
- Implement cold storage strategy
- Use Supabase RLS policies to limit query scans

---

## 6. COMMANDS FOR MANUAL MANAGEMENT

### Check Current Storage
```bash
npm run db:maintenance:report
```

Output:
```
Storage Analysis by Table:
app_volunteer_time_logs_store    12,345  185.50 MB
app_projects_store               1,234    8.25 MB
app_partner_reports_store        456      2.15 MB
...
TOTAL                          100,000  250.00 MB
```

### Run Cleanup
```bash
npm run db:maintenance
```

### Run Aggressive Cleanup (if emergency)
```bash
npm run db:cleanup:aggressive
```

### Create Archival Report
```python
python -m backend.data_archival --analyze
```

---

## 7. IMPLEMENTATION CHECKLIST

- [ ] Deploy database monitoring script (daily size check)
- [ ] Set up Windows Task Scheduler for weekly cleanup (see section 8)
- [ ] Configure email alerts for 70% threshold
- [ ] Document archival location for exported data
- [ ] Set up GitHub Actions workflow for cleanup (optional)
- [ ] Test cleanup script with staging data
- [ ] Document recovery procedure if cleanup fails
- [ ] Train team on manual cleanup commands

---

## 8. WINDOWS TASK SCHEDULER SETUP

### Step 1: Create PowerShell Script
Save as `C:\volunteer-system\run-db-cleanup.ps1`:

```powershell
# Database Cleanup Task
$workdir = "C:\Users\ACER\OneDrive\Desktop\volunteer-system"
$logfile = "$workdir\logs\cleanup-$(Get-Date -Format 'yyyy-MM-dd-HHmmss').log"

# Ensure logs directory exists
if (-not (Test-Path "$workdir\logs")) { mkdir "$workdir\logs" }

# Run cleanup
cd $workdir
& .\.venv\Scripts\Activate.ps1
npm run db:maintenance 2>&1 | Tee-Object -FilePath $logfile

# Log completion
Add-Content $logfile "Cleanup completed at $(Get-Date)"
```

### Step 2: Schedule Task
```powershell
# Run as Administrator
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-ExecutionPolicy RemoteSigned -File C:\volunteer-system\run-db-cleanup.ps1"
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At 2am
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable
Register-ScheduledTask -Action $action -Trigger $trigger -Settings $settings -TaskName "VolunteerSystemDBCleanup" -Description "Weekly database cleanup and optimization"
```

### Step 3: Verify Task
```powershell
Get-ScheduledTask -TaskName "VolunteerSystemDBCleanup" | Format-Table -AutoSize
```

---

## 9. EMERGENCY PROCEDURES

### If Database Exceeds 90% (450 MB)

1. **Immediate Actions**
   ```bash
   npm run db:cleanup:aggressive    # Remove all logs >6 months
   npm run db:cleanup:session       # Clear session data
   npm run db:cleanup:batch         # Batch cleanup old records
   ```

2. **If Still Over 90%**
   - Manually archive reports via Supabase dashboard SQL Editor
   - Export data to CSV before deletion
   - Contact Supabase support for emergency increase

3. **If System Locks (>99%)**
   - Database goes read-only
   - Only admin can write
   - Wait for cleanup to complete
   - Check `ALERTS` log for details

---

## 10. ARCHIVAL WORKFLOW

### Export Before Deletion
```python
# Automatically creates timestamped exports
python -m backend.data_archival --export-2024 /mnt/archive/
# Creates: archive_2024-01-01_to_2024-12-31.csv
```

### Restore from Archive (if needed)
```python
python -m backend.data_archival --import /mnt/archive/archive_2024-01-01.csv
```

---

## 11. MONITORING DASHBOARD (Optional)

Create monitoring via Supabase dashboard:

```sql
-- Check current size (run weekly)
SELECT 
  pg_size_pretty(pg_database_size('postgres')) as database_size,
  count(*) as total_records
FROM information_schema.tables 
WHERE table_schema = 'public';
```

---

## 12. COST ESTIMATES

| Scenario | Storage | Cost | Status |
|----------|---------|------|--------|
| Demo + 1 month ops | 45 MB | Free | ✅ Safe |
| Demo + 6 months ops | 85 MB | Free | ✅ Safe |
| Demo + 1 year ops | 180 MB | Free | ✅ Safe |
| Demo + 2 years ops | 250 MB | Free | ✅ Safe |
| No cleanup (2 years) | 850+ MB | $12/mo | ❌ Unsafe |

---

## Summary

✅ **Current:** 27 MB (5.4%) — Plenty of headroom  
✅ **With 2 years ops:** ~250 MB (50%) — Still safe  
✅ **Auto-cleanup:** Weekly maintenance removes old logs  
✅ **Safeguards:** Alerts at 70% and automatic cleanup at 85%  
✅ **Emergency:** Multiple cleanup strategies available  

**Recommendation:** Enable Windows Task Scheduler to run weekly cleanup (Section 8). This will keep the database at ~200-250 MB indefinitely.
