# Build APK for NVC Volunteer System
# This script builds an APK using EAS Build

Write-Host ""
Write-Host "==========================================="  -ForegroundColor Cyan
Write-Host " NVC VOLUNTEER SYSTEM - APK BUILDER"  -ForegroundColor Cyan
Write-Host "==========================================="  -ForegroundColor Cyan
Write-Host ""

# Check if EAS CLI is installed
Write-Host "[1/5] Checking EAS CLI..." -ForegroundColor Yellow
$easInstalled = Get-Command eas -ErrorAction SilentlyContinue
if (-not $easInstalled) {
    Write-Host "  ✗ EAS CLI not found. Installing..." -ForegroundColor Red
    npm install -g eas-cli
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  ✗ Failed to install EAS CLI" -ForegroundColor Red
        exit 1
    }
    Write-Host "  ✓ EAS CLI installed" -ForegroundColor Green
} else {
    Write-Host "  ✓ EAS CLI found" -ForegroundColor Green
}

# Check if logged in to EAS
Write-Host ""
Write-Host "[2/5] Checking EAS authentication..." -ForegroundColor Yellow
$whoami = eas whoami 2>&1
if ($whoami -match "Not logged in") {
    Write-Host "  ✗ Not logged in to EAS. Please login:" -ForegroundColor Red
    eas login
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  ✗ Login failed" -ForegroundColor Red
        exit 1
    }
    Write-Host "  ✓ Logged in successfully" -ForegroundColor Green
} else {
    Write-Host "  ✓ Already logged in as: $($whoami.Trim())" -ForegroundColor Green
}

# Check backend is running
Write-Host ""
Write-Host "[3/5] Checking local backend..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:8000/db-health" -TimeoutSec 5 -ErrorAction Stop
    Write-Host "  ✓ Backend is running" -ForegroundColor Green
} catch {
    Write-Host "  ⚠ Backend not responding. Starting backend..." -ForegroundColor Yellow
    Write-Host "  Please run 'npm start' in another terminal and wait 30 seconds" -ForegroundColor Yellow
    Write-Host "  Then run this script again" -ForegroundColor Yellow
    exit 1
}

# Check ngrok tunnel
Write-Host ""
Write-Host "[4/5] Checking ngrok tunnel..." -ForegroundColor Yellow
try {
    $ngrokUrl = "https://chatroom-vice-frivolous.ngrok-free.dev/db-health"
    $response = Invoke-WebRequest -Uri $ngrokUrl -TimeoutSec 10 -ErrorAction Stop
    Write-Host "  ✓ Ngrok tunnel is active" -ForegroundColor Green
    Write-Host "    URL: https://chatroom-vice-frivolous.ngrok-free.dev" -ForegroundColor Cyan
} catch {
    Write-Host "  ⚠ Ngrok tunnel not responding" -ForegroundColor Yellow
    Write-Host "  The APK will be built with this URL, but it may not work until ngrok is running" -ForegroundColor Yellow
    Write-Host ""
    $continue = Read-Host "Continue anyway? (y/n)"
    if ($continue -ne "y") {
        Write-Host "  Build cancelled. Please start ngrok and try again." -ForegroundColor Red
        exit 1
    }
}

# Build APK
Write-Host ""
Write-Host "[5/5] Building APK..." -ForegroundColor Yellow
Write-Host "  This will take 10-15 minutes. The build runs on EAS servers." -ForegroundColor Cyan
Write-Host ""

# Prompt for build profile
Write-Host "Choose build profile:" -ForegroundColor Cyan
Write-Host "  1. preview  (recommended - for testing)" -ForegroundColor White
Write-Host "  2. production  (for final release)" -ForegroundColor White
Write-Host ""
$choice = Read-Host "Enter choice (1 or 2)"

$profile = "preview"
if ($choice -eq "2") {
    $profile = "production"
}

Write-Host ""
Write-Host "  Building with profile: $profile" -ForegroundColor Green
Write-Host ""

# Run EAS build
eas build --platform android --profile $profile

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "==========================================="  -ForegroundColor Green
    Write-Host " BUILD COMPLETED SUCCESSFULLY!"  -ForegroundColor Green
    Write-Host "==========================================="  -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "  1. Download the APK from the link provided above" -ForegroundColor White
    Write-Host "  2. Transfer it to your Android device" -ForegroundColor White
    Write-Host "  3. Install and test" -ForegroundColor White
    Write-Host ""
    Write-Host "IMPORTANT: Keep your backend and ngrok running while testing the app!" -ForegroundColor Yellow
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "==========================================="  -ForegroundColor Red
    Write-Host " BUILD FAILED"  -ForegroundColor Red
    Write-Host "==========================================="  -ForegroundColor Red
    Write-Host ""
    Write-Host "Check the error messages above for details." -ForegroundColor Red
    Write-Host ""
    exit 1
}
