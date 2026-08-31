# Global Data Preloading - Verification Script
Write-Host "`n🔍 Verifying Global Data Preloading System..." -ForegroundColor Cyan
Write-Host ""

$allGood = $true

# Check required files
$requiredFiles = @{
    "contexts/GlobalDataContext.tsx" = "Core data cache provider"
    "components/SplashScreen.tsx" = "Loading screen component"
    "App.tsx" = "App entry point with GlobalDataProvider"
    "GLOBAL_DATA_USAGE.md" = "Usage documentation"
    "MIGRATION_EXAMPLE.md" = "Migration examples"
}

Write-Host "Checking files..." -ForegroundColor Yellow
foreach ($file in $requiredFiles.Keys) {
    $fullPath = "c:\Users\ACER\OneDrive\Desktop\volunteer-system\$file"
    if (Test-Path $fullPath) {
        Write-Host "  ✓ $file" -ForegroundColor Green
        Write-Host "    └─ $($requiredFiles[$file])" -ForegroundColor Gray
    } else {
        Write-Host "  ✗ $file - MISSING!" -ForegroundColor Red
        $allGood = $false
    }
}

Write-Host ""

# Check App.tsx has GlobalDataProvider
Write-Host "Checking App.tsx integration..." -ForegroundColor Yellow
$appContent = Get-Content "c:\Users\ACER\OneDrive\Desktop\volunteer-system\App.tsx" -Raw
if ($appContent -match "GlobalDataProvider") {
    Write-Host "  ✓ GlobalDataProvider imported and used" -ForegroundColor Green
} else {
    Write-Host "  ✗ GlobalDataProvider not found in App.tsx" -ForegroundColor Red
    $allGood = $false
}

if ($appContent -match "SplashScreen") {
    Write-Host "  ✓ SplashScreen component integrated" -ForegroundColor Green
} else {
    Write-Host "  ✗ SplashScreen not found in App.tsx" -ForegroundColor Red
    $allGood = $false
}

Write-Host ""

# Check GlobalDataContext exports
Write-Host "Checking GlobalDataContext exports..." -ForegroundColor Yellow
$contextContent = Get-Content "c:\Users\ACER\OneDrive\Desktop\volunteer-system\contexts\GlobalDataContext.tsx" -Raw
$exports = @("useGlobalData", "useProjects", "useVolunteers", "usePartners", "GlobalDataProvider")
foreach ($export in $exports) {
    if ($contextContent -match "export.*$export") {
        Write-Host "  ✓ $export exported" -ForegroundColor Green
    } else {
        Write-Host "  ✗ $export not exported" -ForegroundColor Red
        $allGood = $false
    }
}

Write-Host ""
Write-Host "=" * 60 -ForegroundColor Gray
Write-Host ""

if ($allGood) {
    Write-Host "🎉 All systems ready!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Your global data preloading is correctly installed!" -ForegroundColor White
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Yellow
    Write-Host "  1. Run: npm start" -ForegroundColor White
    Write-Host "  2. Watch for the splash screen (3 seconds)" -ForegroundColor White
    Write-Host "  3. All screens will load instantly!" -ForegroundColor White
    Write-Host ""
    Write-Host "📖 Read MIGRATION_EXAMPLE.md to update your screens" -ForegroundColor Cyan
} else {
    Write-Host "⚠️  Some issues detected!" -ForegroundColor Yellow
    Write-Host "Please check the errors above and fix them." -ForegroundColor White
}

Write-Host ""
