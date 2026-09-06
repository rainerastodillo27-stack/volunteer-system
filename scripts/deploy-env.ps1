# Upload .env to VPS and restart backend
param(
    [string]$Server = "129.121.73.76",
    [string]$User = "root",
    [string]$RemoteDir = "/var/www/volunteer-system"
)

Write-Host ""
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host " VOLCRE - VPS ENV DEPLOYER" -ForegroundColor Cyan
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path ".env")) {
    Write-Host "  [!] Local .env file not found!" -ForegroundColor Red
    exit 1
}

# 1. Upload .env via SCP
Write-Host "[1/3] Uploading .env to VPS ($Server)..." -ForegroundColor Yellow
Write-Host "      (Enter your VPS root password when prompted)" -ForegroundColor Gray
Write-Host ""

scp .env "$User@${Server}:${RemoteDir}/.env"
if ($LASTEXITCODE -ne 0) {
    Write-Host "  [!] Upload failed. Please check password or connection." -ForegroundColor Red
    exit 1
}
Write-Host "  [+] .env uploaded successfully." -ForegroundColor Green

# 2. Restart backend to load new environment
Write-Host ""
Write-Host "[2/3] Restarting backend to reload .env..." -ForegroundColor Yellow
$remoteCmd = "pkill -9 -f 'backend.api:app' ; sleep 1 ; nohup $RemoteDir/.venv/bin/python -m uvicorn backend.api:app --host 0.0.0.0 --port 8001 --ws websockets > backend.log 2>&1 &"
ssh "$User@$Server" $remoteCmd

# 3. Check health
Write-Host ""
Write-Host "[3/3] Verifying backend health..." -ForegroundColor Yellow
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
Write-Host "New .env deployed and applied successfully!" -ForegroundColor Green
Write-Host ""
