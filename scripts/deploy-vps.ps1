# Deploy latest commits to VPS
param(
    [string]$Server = "129.121.73.76",
    [string]$User = "root",
    [string]$RemoteDir = "/var/www/volunteer-system",
    [string]$HealthUrl = "https://nvcfoundationconnect.online/db-health"
)

Write-Host ""
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host " VOLCRE - VPS AUTO DEPLOYER" -ForegroundColor Cyan
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Push local commits to GitHub
Write-Host "[1/3] Checking and pushing commits to GitHub..." -ForegroundColor Yellow
git push origin main
if ($LASTEXITCODE -ne 0) {
    Write-Host "  [!] Git push failed. Deployment stopped." -ForegroundColor Red
    exit 1
}
Write-Host "  [+] GitHub repository is up to date." -ForegroundColor Green

# 2. Trigger pull and restart on VPS
Write-Host ""
Write-Host "[2/3] Connecting to VPS at $Server..." -ForegroundColor Yellow
Write-Host "      (Enter your VPS root password when prompted)" -ForegroundColor Gray
Write-Host ""

$remoteCmd = "set -e; cd $RemoteDir; git pull origin main; source .venv/bin/activate; pip install -r backend/requirements.txt; pkill -TERM -f '[u]vicorn backend.api:app' || true; sleep 1; nohup $RemoteDir/.venv/bin/python -m uvicorn backend.api:app --host 0.0.0.0 --port 8001 --ws websockets > backend.log 2>&1 < /dev/null &"

ssh "$User@$Server" $remoteCmd
if ($LASTEXITCODE -ne 0) {
    Write-Host "  [!] VPS update failed. Check the SSH output above." -ForegroundColor Red
    exit 1
}
Write-Host "  [+] VPS code pulled and backend restart requested." -ForegroundColor Green

# 3. Check health
Write-Host ""
Write-Host "[3/3] Verifying backend health on VPS..." -ForegroundColor Yellow
Start-Sleep -Seconds 3
try {
    $resp = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 10 -ErrorAction Stop
    if ($resp.status -eq "ok" -and $resp.available) {
        Write-Host "  [+] Backend is LIVE and connected to the database!" -ForegroundColor Green
        $healthOk = $true
    } else {
        Write-Host "  [!] Backend responded with status: $($resp.status)" -ForegroundColor Yellow
        $healthOk = $false
    }
} catch {
    Write-Host "  [!] Health check failed at $HealthUrl : $($_.Exception.Message)" -ForegroundColor Red
    $healthOk = $false
}

if (-not $healthOk) {
    Write-Host "Deployment did not pass the health check." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Deployment completed successfully!" -ForegroundColor Green
Write-Host ""
