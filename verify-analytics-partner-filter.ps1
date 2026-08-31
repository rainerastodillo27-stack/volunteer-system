# Analytics Partner Filter Verification Script
Write-Host "`n=== Verifying Analytics Partner Filter Implementation ===" -ForegroundColor Cyan

$filePath = "screens\AdminAnalyticsScreen.tsx"
$content = Get-Content $filePath -Raw

# Check for partner selector state
Write-Host "`n1. Checking for partner selector state..." -ForegroundColor Yellow
if ($content -match "selectedPartnerId.*useState.*'all'") {
    Write-Host "   [OK] Partner selector state found" -ForegroundColor Green
} else {
    Write-Host "   [FAIL] Partner selector state NOT found" -ForegroundColor Red
}

if ($content -match "showPartnerDropdown.*useState.*false") {
    Write-Host "   [OK] Dropdown visibility state found" -ForegroundColor Green
} else {
    Write-Host "   [FAIL] Dropdown visibility state NOT found" -ForegroundColor Red
}

# Check for filtered data useMemos
Write-Host "`n2. Checking for filtered data implementation..." -ForegroundColor Yellow
$filters = @("filteredProjects", "filteredReports", "filteredTimeLogs", "filteredJoinRecords", "filteredVolunteers")
foreach ($filter in $filters) {
    if ($content -match "const $filter = useMemo") {
        Write-Host "   [OK] $filter filtering implemented" -ForegroundColor Green
    } else {
        Write-Host "   [FAIL] $filter filtering NOT found" -ForegroundColor Red
    }
}

# Check for partner sectors function
Write-Host "`n3. Checking for Partner Sectors by Quarter function..." -ForegroundColor Yellow
if ($content -match "function buildPartnerSectorsByQuarter") {
    Write-Host "   [OK] buildPartnerSectorsByQuarter function found" -ForegroundColor Green
} else {
    Write-Host "   [FAIL] buildPartnerSectorsByQuarter function NOT found" -ForegroundColor Red
}

if ($content -match "partnerSectorsByQuarter = useMemo") {
    Write-Host "   [OK] partnerSectorsByQuarter memo hook found" -ForegroundColor Green
} else {
    Write-Host "   [FAIL] partnerSectorsByQuarter memo hook NOT found" -ForegroundColor Red
}

# Check for UI components
Write-Host "`n4. Checking for UI components..." -ForegroundColor Yellow
if ($content -match "partnerSelectorCard") {
    Write-Host "   [OK] Partner selector card component found" -ForegroundColor Green
} else {
    Write-Host "   [FAIL] Partner selector card component NOT found" -ForegroundColor Red
}

if ($content -match "PARTNER SECTORS BY QUARTER") {
    Write-Host "   [OK] Partner sectors table title found" -ForegroundColor Green
} else {
    Write-Host "   [FAIL] Partner sectors table title NOT found" -ForegroundColor Red
}

if ($content -match "sectorsByQuarterCard") {
    Write-Host "   [OK] Sectors by quarter card component found" -ForegroundColor Green
} else {
    Write-Host "   [FAIL] Sectors by quarter card component NOT found" -ForegroundColor Red
}

# Check for styles
Write-Host "`n5. Checking for styles..." -ForegroundColor Yellow
$styleKeys = @(
    "partnerSelectorCard",
    "partnerDropdownButton", 
    "partnerDropdownMenu",
    "sectorsByQuarterCard",
    "sectorTable",
    "sectorTableHeaderCell"
)

foreach ($styleKey in $styleKeys) {
    if ($content -match "$styleKey\s*:") {
        Write-Host "   [OK] Style '$styleKey' found" -ForegroundColor Green
    } else {
        Write-Host "   [FAIL] Style '$styleKey' NOT found" -ForegroundColor Red
    }
}

# Check dropdown interaction
Write-Host "`n6. Checking for dropdown interactions..." -ForegroundColor Yellow
if ($content -match "setShowPartnerDropdown") {
    Write-Host "   [OK] Dropdown toggle handler found" -ForegroundColor Green
} else {
    Write-Host "   [FAIL] Dropdown toggle handler NOT found" -ForegroundColor Red
}

if ($content -match "setSelectedPartnerId") {
    Write-Host "   [OK] Partner selection handler found" -ForegroundColor Green
} else {
    Write-Host "   [FAIL] Partner selection handler NOT found" -ForegroundColor Red
}

# Check for filtered footer stats
Write-Host "`n7. Checking for filtered footer stats..." -ForegroundColor Yellow
if ($content -match "filteredReports\.length") {
    Write-Host "   [OK] Filtered reports count found" -ForegroundColor Green
} else {
    Write-Host "   [FAIL] Filtered reports count NOT found" -ForegroundColor Red
}

if ($content -match "filteredProjects\.filter.*isEvent") {
    Write-Host "   [OK] Filtered events count found" -ForegroundColor Green
} else {
    Write-Host "   [FAIL] Filtered events count NOT found" -ForegroundColor Red
}

# Check partner type field usage
Write-Host "`n8. Checking for correct partner field usage..." -ForegroundColor Yellow
if ($content -match "partner\.sectorType") {
    Write-Host "   [OK] Using correct 'sectorType' field" -ForegroundColor Green
} else {
    Write-Host "   [FAIL] 'sectorType' field usage NOT found" -ForegroundColor Red
}

Write-Host "`n=== Verification Complete ===" -ForegroundColor Cyan
Write-Host ""
