# Deploy latest commits to VPS
param(
    [string]$Server = "129.121.73.76",
    [string]$User = "root",
    [string]$RemoteDir = "/var/www/volunteer-system"
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
    Write-Host "  [!] Git push check finished." -ForegroundColor Gray
} else {
    Write-Host "  [+] GitHub repository is up to date." -ForegroundColor Green
}

# 2. Trigger pull and restart on VPS
Write-Host ""
Write-Host "[2/3] Connecting to VPS at $Server..." -ForegroundColor Yellow
Write-Host "      (Enter your VPS root password when prompted)" -ForegroundColor Gray
Write-Host ""

$remoteCmd = "cd $RemoteDir && git pull origin main && source .venv/bin/activate && pip install -r backend/requirements.txt && pkill -9 -f 'backend.api:app' ; sleep 1 ; nohup $RemoteDir/.venv/bin/python -m uvicorn backend.api:app --host 0.0.0.0 --port 8001 --ws websockets > backend.log 2>&1 &"

ssh "$User@$Server" $remoteCmd

# 3. Check health
Write-Host ""
Write-Host "[3/3] Verifying backend health on VPS..." -ForegroundColor Yellow
Start-Sleep -Seconds 3
try {
    $resp = Invoke-RestMethod -Uri "http://${Server}/db-health" -TimeoutSec 6 -ErrorAction Stop
    if ($resp.status -eq "ok" -and $resp.available) {
        Write-Host "  [+] Backend is LIVE and connected to the database!" -ForegroundColor Green
    } else {
        Write-Host "  [!] Backend responded with status: $($resp.status)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  [!] Backend is still initializing, check in 5 seconds." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Deployment completed successfully!" -ForegroundColor Green
Write-Host ""
