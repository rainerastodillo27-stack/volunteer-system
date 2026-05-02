# Windows Task Scheduler Setup for Database Cleanup
# Run this script as Administrator to schedule automated weekly database maintenance
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\scripts\setup-db-scheduler.ps1

param(
    [switch]$Remove,
    [switch]$Status
)

$TaskName = "VolunteerSystemDBCleanup"
$TaskScheduler = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

# Remove existing task if requested
if ($Remove) {
    if ($TaskScheduler) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "[OK] Task '$TaskName' removed" -ForegroundColor Green
    } else {
        Write-Host "[INFO] Task '$TaskName' does not exist" -ForegroundColor Blue
    }
    exit 0
}

# Show status if requested
if ($Status) {
    if ($TaskScheduler) {
        Write-Host "`n[STATUS] Task: $TaskName" -ForegroundColor Cyan
        Write-Host "Status: $($TaskScheduler.State)" -ForegroundColor Green
        Write-Host "Next Run: $($TaskScheduler.Triggers[0].NextRun)" -ForegroundColor Yellow
        $TaskScheduler.Triggers | ForEach-Object {
            Write-Host "Schedule: Weekly on $(if($_.DaysOfWeek) { $_.DaysOfWeek } else { 'Unknown' }) at $($_.StartBoundary)" -ForegroundColor Yellow
        }
        Write-Host ""
    } else {
        Write-Host "[ERROR] Task '$TaskName' not found" -ForegroundColor Red
    }
    exit 0
}

# Check if running as Administrator
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "[ERROR] This script must run as Administrator" -ForegroundColor Red
    exit 1
}

# Get paths
$projectRoot = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $projectRoot "logs"

# Create logs directory
if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

Write-Host "`n[INFO] Setting up Database Cleanup Schedule..." -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan

# Create the cleanup command
$command = "cd $projectRoot; npm run db:maintenance"

# Create scheduled task action
$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -WindowStyle Hidden -Command `"$command`""

# Create trigger (Weekly Monday at 2 AM)
$trigger = New-ScheduledTaskTrigger `
    -Weekly `
    -DaysOfWeek Monday `
    -At 2am

# Create task settings
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable `
    -MultipleInstances IgnoreNew

# Register the task
try {
    if ($TaskScheduler) {
        Write-Host "[INFO] Updating existing task..." -ForegroundColor Yellow
        Set-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings | Out-Null
    } else {
        Write-Host "[INFO] Creating new task..." -ForegroundColor Yellow
        Register-ScheduledTask `
            -TaskName $TaskName `
            -Action $action `
            -Trigger $trigger `
            -Settings $settings `
            -Description "Weekly database cleanup for volunteer system" `
            -RunLevel Highest | Out-Null
    }
    
    Write-Host "`n[SUCCESS] Task scheduled successfully!" -ForegroundColor Green
    
    # Display task info
    Write-Host "`n[TASK DETAILS]" -ForegroundColor Cyan
    Write-Host "  Name:       $TaskName" -ForegroundColor White
    Write-Host "  Schedule:   Weekly on Monday at 2:00 AM" -ForegroundColor White
    Write-Host "  Action:     npm run db:maintenance" -ForegroundColor White
    Write-Host "  Status:     ACTIVE (will run next Monday)" -ForegroundColor Green
    
    Write-Host "`n[USEFUL COMMANDS]" -ForegroundColor Cyan
    Write-Host "  Check status:    powershell -File .\scripts\setup-db-scheduler.ps1 -Status" -ForegroundColor Yellow
    Write-Host "  Remove task:     powershell -File .\scripts\setup-db-scheduler.ps1 -Remove" -ForegroundColor Yellow
    Write-Host "  Manual cleanup:  npm run db:maintenance" -ForegroundColor Yellow
    Write-Host "  Check size:      npm run db:monitor" -ForegroundColor Yellow
    Write-Host "`n"
    
} catch {
    Write-Host "[ERROR] Failed to schedule task: $_" -ForegroundColor Red
    exit 1
}
