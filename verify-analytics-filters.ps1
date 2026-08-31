# Analytics Filters Verification Script
Write-Host \"
=== Verifying Analytics Filters & Connection Speed Fix ===\" -ForegroundColor Cyan

# Check LoginScreen.tsx for connection speed improvements
Write-Host \"
1. Checking LoginScreen.tsx connection speed improvements...\" -ForegroundColor Yellow
$loginContent = Get-Content \"screens\LoginScreen.tsx\" -Raw

if ($loginContent -match \"BACKEND_HEALTH_TIMEOUT_MS = 8000\") {
    Write-Host \"   [OK] Backend timeout reduced to 8 seconds\" -ForegroundColor Green
} else {
    Write-Host \"   [FAIL] Backend timeout not updated\" -ForegroundColor Red
}

if ($loginContent -match \"BACKEND_HEALTH_RETRY_MS = 3000\") {
    Write-Host \"   [OK] Retry interval reduced to 3 seconds\" -ForegroundColor Green
} else {
    Write-Host \"   [FAIL] Retry interval not updated\" -ForegroundColor Red
}

if ($loginContent -match \"BACKEND_HEALTH_MAX_SLOW_RETRIES = 2\") {
    Write-Host \"   [OK] Max retries reduced to 2\" -ForegroundColor Green
} else {
    Write-Host \"   [FAIL] Max retries not updated\" -ForegroundColor Red
}

# Check AdminAnalyticsScreen.tsx for program filter
Write-Host \"
2. Checking AdminAnalyticsScreen.tsx for program filter...\" -ForegroundColor Yellow
$analyticsContent = Get-Content \"screens\AdminAnalyticsScreen.tsx\" -Raw

if ($analyticsContent -match \"selectedProgramId.*useState.*'all'\") {
    Write-Host \"   [OK] Program selector state found\" -ForegroundColor Green
} else {
    Write-Host \"   [FAIL] Program selector state NOT found\" -ForegroundColor Red
}

if ($analyticsContent -match \"showProgramDropdown.*useState.*false\") {
    Write-Host \"   [OK] Program dropdown visibility state found\" -ForegroundColor Green
} else {
    Write-Host \"   [FAIL] Program dropdown visibility state NOT found\" -ForegroundColor Red
}

Write-Host \"
=== Verification Complete ===\" -ForegroundColor Cyan
