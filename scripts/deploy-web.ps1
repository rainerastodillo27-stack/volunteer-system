# Deploy latest Web frontend build to VPS
param(
    [string]$Server = "129.121.73.76",
    [string]$User = "root",
    [string]$RemoteDir = "/var/www/volunteer-system"
)

Write-Host ""
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host " VOLCRE - WEB FRONTEND VPS DEPLOYER" -ForegroundColor Cyan
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Build web export locally
Write-Host "[1/4] Building latest web production bundle..." -ForegroundColor Yellow
npx expo export --platform web
if ($LASTEXITCODE -ne 0) {
    Write-Host "  [!] Web export build failed." -ForegroundColor Red
    exit 1
}
Write-Host "  [+] Web export built successfully in dist/." -ForegroundColor Green

# 2. Compress dist folder
Write-Host ""
Write-Host "[2/4] Packaging web bundle..." -ForegroundColor Yellow
tar -czf dist.tar.gz dist
Write-Host "  [+] dist.tar.gz created." -ForegroundColor Green

# 3. Upload to VPS
Write-Host ""
Write-Host "[3/4] Uploading web bundle to VPS ($Server)..." -ForegroundColor Yellow
Write-Host "      (Enter your VPS root password when prompted)" -ForegroundColor Gray
Write-Host ""

scp dist.tar.gz "$User@${Server}:${RemoteDir}/dist.tar.gz"
if ($LASTEXITCODE -ne 0) {
    Write-Host "  [!] Upload failed. Please check password." -ForegroundColor Red
    Remove-Item dist.tar.gz -Force -ErrorAction SilentlyContinue
    exit 1
}

# 4. Extract and restart on VPS
Write-Host ""
Write-Host "[4/4] Extracting web files and restarting web server..." -ForegroundColor Yellow
$remoteCmd = "cd $RemoteDir && tar -xzf dist.tar.gz && rm -f dist.tar.gz && pm2 restart all"
ssh "$User@$Server" $remoteCmd

Remove-Item dist.tar.gz -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Web frontend deployed and updated successfully!" -ForegroundColor Green
Write-Host ""
