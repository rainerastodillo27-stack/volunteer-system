# Audit Script: Check for broken features after rainer copy migration

Write-Host "=== AUDIT: Checking for broken features ===" -ForegroundColor Cyan

# 1. Check for missing/broken imports
Write-Host "`n[1] Checking for non-installed package imports..." -ForegroundColor Yellow
$badImports = Select-String -Path "screens\*.tsx","components\*.tsx","utils\*.ts","navigation\*.tsx" `
    -Pattern "from '(react-native-vector-icons|react-native-fs|react-native-share|react-native-document-picker|react-native-image-picker)'" |
    Select-Object Filename, LineNumber, Line
if ($badImports) { $badImports | Format-Table -AutoSize } else { Write-Host "OK: No broken package imports found" -ForegroundColor Green }

# 2. Check for missing assets
Write-Host "`n[2] Checking for referenced assets that don't exist..." -ForegroundColor Yellow
$assetRefs = Select-String -Path "screens\*.tsx","utils\*.ts","components\*.tsx" -Pattern "assets/([a-z0-9_/.-]+\.(jpg|png|gif))" |
    ForEach-Object { $_.Matches[0].Groups[1].Value } | Sort-Object -Unique
foreach ($asset in $assetRefs) {
    if (-not (Test-Path "assets\$asset")) {
        Write-Host "MISSING: assets/$asset" -ForegroundColor Red
    }
}

# 3. Check Google Calendar API key availability
Write-Host "`n[3] Checking Google Calendar API key..." -ForegroundColor Yellow
$envContent = Get-Content ".env" -Raw
if ($envContent -match "EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY=([^\r\n]+)") {
    Write-Host "FOUND: Google Maps API Key = $($Matches[1].Substring(0,10))..." -ForegroundColor Green
    Write-Host "NOTE: This key must also have Google Calendar API enabled in Google Cloud Console" -ForegroundColor Yellow
} else {
    Write-Host "MISSING: EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY not found in .env" -ForegroundColor Red
}

# 4. Check email config
Write-Host "`n[4] Checking email config..." -ForegroundColor Yellow
if ($envContent -match "OTP_GMAIL_SENDER=([^\r\n]+)") {
    Write-Host "FOUND: Gmail Sender = $($Matches[1])" -ForegroundColor Green
}
if ($envContent -match "OTP_GMAIL_APP_PASSWORD=([^\r\n]+)") {
    Write-Host "FOUND: Gmail App Password configured" -ForegroundColor Green
}

# 5. Check Firebase config
Write-Host "`n[5] Checking Firebase config..." -ForegroundColor Yellow
$firebaseKeys = @("EXPO_PUBLIC_FIREBASE_API_KEY","EXPO_PUBLIC_FIREBASE_PROJECT_ID","EXPO_PUBLIC_FIREBASE_APP_ID")
foreach ($key in $firebaseKeys) {
    if ($envContent -match "$key=([^\r\n]+)") {
        Write-Host "FOUND: $key = $($Matches[1].Substring(0,10))..." -ForegroundColor Green
    } else {
        Write-Host "MISSING: $key" -ForegroundColor Red
    }
}

# 6. Check for navigation errors (missing screens referenced in navigators)
Write-Host "`n[6] Checking navigator screen imports..." -ForegroundColor Yellow
$navFiles = Get-ChildItem "navigation\*.tsx"
foreach ($navFile in $navFiles) {
    $content = Get-Content $navFile.FullName -Raw
    $imports = [regex]::Matches($content, "from '\.\./screens/([^']+)'")
    foreach ($import in $imports) {
        $screenFile = "screens\$($import.Groups[1].Value).tsx"
        if (-not (Test-Path $screenFile)) {
            Write-Host "MISSING SCREEN: $screenFile (referenced in $($navFile.Name))" -ForegroundColor Red
        }
    }
}

Write-Host "`n=== AUDIT COMPLETE ===" -ForegroundColor Cyan
