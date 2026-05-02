# Database Growth Management - Quick Reference

## Current Status ✅
- **Database Size:** 27 MB / 500 MB (5.4%)
- **Free Plan:** Unlimited records, 500 MB storage
- **Status:** Safe and sustainable

---

## 3 Simple Ways to Protect Your Database

### 1️⃣ ONE-TIME SETUP (Automated Weekly Cleanup)
```bash
# Run as Administrator in PowerShell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-db-scheduler.ps1
```
✅ Sets up automatic cleanup every Monday at 2 AM  
✅ Removes old logs and reports automatically  
✅ Logs saved to `logs/cleanup-YYYY-MM-DD.log`  

**Verify it worked:**
```bash
powershell -File .\scripts\setup-db-scheduler.ps1 -Status
```

---

### 2️⃣ MANUAL COMMANDS (Run Anytime)

**Check current database size:**
```bash
npm run db:monitor
```
Shows:
- Total database size
- Breakdown by table
- Size vs. free plan limit
- Alert status (Green/Yellow/Red)

**Trigger cleanup immediately:**
```bash
npm run db:maintenance              # Normal cleanup
npm run db:monitor:auto             # Auto-cleanup if needed
npm run db:cleanup:aggressive       # Emergency cleanup
```

**Get storage report:**
```bash
npm run db:maintenance:report
```

---

### 3️⃣ AUTOMATIC SAFEGUARDS

The system will automatically:

| Threshold | Action |
|-----------|--------|
| 70% (350 MB) | Yellow alert, recommend cleanup |
| 80% (400 MB) | Orange alert, run normal cleanup |
| 90% (450 MB) | Red alert, run aggressive cleanup |
| 96% (480 MB) | Critical, system enters read-only mode |

---

## What Gets Cleaned Up?

**Automatically Removed (Old Data):**
- ✅ Time logs older than 2 years
- ✅ Project joins older than 1 year
- ✅ Event check-ins older than 6 months
- ✅ Reports older than 1 year
- ✅ Status updates older than 6 months
- ✅ Orphaned/duplicate records

**Optimizations:**
- ✅ VACUUM ANALYZE (defragment storage)
- ✅ Index optimization
- ✅ Duplicate removal

---

## Example Cleanup Results

```
Before:  127 MB database
After:   85 MB database  
Saved:   42 MB
Removed: 15,432 old records in 3 seconds
```

---

## Growth Projections

| Timeline | Size | Status |
|----------|------|--------|
| Today | 27 MB | ✅ 5% used |
| 1 month | 45 MB | ✅ 9% used |
| 6 months | 85 MB | ✅ 17% used |
| 1 year | 180 MB | ✅ 36% used |
| 2 years | 250 MB | ✅ 50% used |

With weekly cleanup, database stays ~200-250 MB indefinitely.

---

## Emergency Procedures

**If Database Exceeds 90% (450 MB):**

```bash
# Option 1: Run aggressive cleanup
npm run db:cleanup:aggressive

# Option 2: Auto-cleanup with monitoring
npm run db:monitor:auto

# Option 3: Manual SQL deletion (Supabase dashboard)
# Login → SQL Editor → Run cleanup queries
```

**If Approaching 100%:**
- Database goes read-only
- Only admins can write
- All operations still readable
- Wait for cleanup to complete
- Check logs for issues

---

## Monitoring Tips

### Daily Check (2 minutes)
```bash
npm run db:monitor
```
Tells you:
- Current size
- Percent of free plan used
- Health status

### Weekly Management (5 minutes)
```bash
npm run db:maintenance:report
npm run db:maintenance
```
Shows:
- Breakdown by table
- How many records removed
- Storage after cleanup

### Monthly Deep Dive (10 minutes)
```bash
npm run db:maintenance:report       # See what's in DB
npm run db:monitor:auto             # Auto-cleanup if needed
```

---

## Key Files Created

1. **DATABASE_GROWTH_MANAGEMENT.md** - Full strategy doc
2. **backend/db_monitor.py** - Monitoring script
3. **scripts/setup-db-scheduler.ps1** - Windows Task Scheduler setup
4. Updated **package.json** - New npm commands

---

## Commands Reference

| Command | Purpose |
|---------|---------|
| `npm run db:monitor` | Check size (1 sec) |
| `npm run db:monitor:auto` | Check + cleanup if needed |
| `npm run db:maintenance` | Run cleanup now |
| `npm run db:maintenance:report` | Show storage breakdown |
| `npm run db:cleanup:aggressive` | Emergency cleanup |
| `powershell setup-db-scheduler.ps1` | Setup automated weekly cleanup |
| `powershell setup-db-scheduler.ps1 -Status` | Check scheduler status |
| `powershell setup-db-scheduler.ps1 -Remove` | Remove scheduled task |

---

## Cost Estimate

| Scenario | Cost | Status |
|----------|------|--------|
| Current setup (27 MB) | Free | ✅ |
| With automated cleanup | Free forever | ✅ |
| Without cleanup (1 year+) | $12/month | ❌ |

---

## Next Steps

1. **Run setup (once):**
   ```bash
   powershell -ExecutionPolicy Bypass -File .\scripts\setup-db-scheduler.ps1
   ```

2. **Verify it works:**
   ```bash
   powershell -File .\scripts\setup-db-scheduler.ps1 -Status
   npm run db:monitor
   ```

3. **Check logs:**
   ```bash
   Get-Content logs/cleanup-*.log | Select-Object -Last 20
   ```

4. **Weekly reminder:**
   - Monitor checks automatically run
   - Cleanup happens Monday 2 AM
   - Logs saved for review

---

## Troubleshooting

**Q: Cleanup failed with "connection timeout"**
- A: Pooler may be overloaded. Run again later. Use Supabase dashboard SQL editor as backup.

**Q: Database size not decreasing**
- A: Some data is within retention period. Takes 2 weeks to see removal.

**Q: Scheduler not running**
- A: Check Windows Task Scheduler, verify venv path is correct, check logs/

**Q: Want to backup before cleanup**
- A: Run `npm run db:maintenance:report` first. Export to CSV if needed.

---

## Support Contacts

- **Supabase Status:** https://status.supabase.com
- **Supabase Help:** https://app.supabase.com/support
- **Local Logs:** `./logs/cleanup-*.log`
- **Documentation:** See `DATABASE_GROWTH_MANAGEMENT.md`
