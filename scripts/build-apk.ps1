# Build the current NVC Android APK with the selected EAS profile.

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host " NVC VOLUNTEER SYSTEM - APK BUILDER" -ForegroundColor Cyan
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/5] Checking EAS CLI..." -ForegroundColor Yellow
$easCommand = Get-Command eas -ErrorAction SilentlyContinue
if (-not $easCommand) {
    Write-Host "  EAS CLI is not installed. Install it with: npm install -g eas-cli@latest" -ForegroundColor Red
    exit 1
}
Write-Host "  EAS CLI found" -ForegroundColor Green

Write-Host ""
Write-Host "[2/5] Checking EAS authentication..." -ForegroundColor Yellow
$whoami = (& eas whoami 2>&1 | Out-String).Trim()
if ($whoami -match "Not logged in") {
    Write-Host "  Please log in to EAS." -ForegroundColor Yellow
    & eas login
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  EAS login failed." -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "  Logged in to EAS" -ForegroundColor Green
}

Write-Host ""
Write-Host "[3/5] Selecting build profile..." -ForegroundColor Yellow
Write-Host "  1. preview     (testing APK)" -ForegroundColor White
Write-Host "  2. production  (release APK)" -ForegroundColor White
Write-Host ""
$choice = Read-Host "Enter choice (1 or 2)"
$profile = if ($choice -eq "2") { "production" } else { "preview" }
Write-Host "  Using profile: $profile" -ForegroundColor Green

$easConfig = Get-Content -Raw -Path "./eas.json" | ConvertFrom-Json
$profileConfig = $easConfig.build.PSObject.Properties[$profile].Value
$apiBaseUrl = [string]$profileConfig.env.EXPO_PUBLIC_API_BASE_URL
if ([string]::IsNullOrWhiteSpace($apiBaseUrl)) {
    Write-Host "  No API URL is configured for the $profile profile." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[4/5] Checking the backend and Android OAuth configuration..." -ForegroundColor Yellow
try {
    $healthUrl = "$($apiBaseUrl.TrimEnd('/'))/db-health"
    $health = Invoke-WebRequest -Uri $healthUrl -TimeoutSec 10 -UseBasicParsing
    if ($health.StatusCode -ne 200) {
        throw "Unexpected status $($health.StatusCode)"
    }
    Write-Host "  Backend is reachable: $healthUrl" -ForegroundColor Green
} catch {
    Write-Host "  Backend health check failed for $apiBaseUrl" -ForegroundColor Red
    Write-Host "  Start or repair the VPS backend before building the APK." -ForegroundColor Yellow
    exit 1
}

$androidGoogleClientId = [string]$env:EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID
if ([string]::IsNullOrWhiteSpace($androidGoogleClientId) -and (Test-Path "./.env")) {
    $localOAuthLine = Get-Content -Path "./.env" | Where-Object {
        $_ -match '^EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID='
    } | Select-Object -Last 1
    if ($localOAuthLine) {
        $androidGoogleClientId = ($localOAuthLine -split '=', 2)[1].Trim()
    }
}
if ([string]::IsNullOrWhiteSpace($androidGoogleClientId)) {
    try {
        $remoteOAuthOutput = (& eas env:get $profile --variable-name EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID --non-interactive 2>$null | Out-String).Trim()
        if ($LASTEXITCODE -eq 0 -and $remoteOAuthOutput -match '\.apps\.googleusercontent\.com') {
            $androidGoogleClientId = "configured-remotely"
        }
    } catch {
        $androidGoogleClientId = ""
    }
}
if ([string]::IsNullOrWhiteSpace($androidGoogleClientId)) {
    Write-Host "  Android Google OAuth is missing." -ForegroundColor Red
    Write-Host "  Set EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID in the EAS $profile environment." -ForegroundColor Yellow
    exit 1
}
Write-Host "  Android Google OAuth is configured" -ForegroundColor Green

Write-Host ""
Write-Host "[5/5] Validating the current mobile source..." -ForegroundColor Yellow
& npx tsc --noEmit
if ($LASTEXITCODE -ne 0) {
    Write-Host "  TypeScript validation failed. APK build cancelled." -ForegroundColor Red
    exit 1
}
Write-Host "  TypeScript validation passed" -ForegroundColor Green

Write-Host ""
Write-Host "Starting EAS Android build with the latest source..." -ForegroundColor Yellow
& eas build --platform android --profile $profile
if ($LASTEXITCODE -ne 0) {
    Write-Host "APK build failed." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "APK build submitted successfully. Download the finished APK from the EAS link." -ForegroundColor Green
