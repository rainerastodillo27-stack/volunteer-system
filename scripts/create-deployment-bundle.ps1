# Create backend deployment bundle for uploading to cloud server
# Usage: .\scripts\create-deployment-bundle.ps1

param(
    [string]$OutputPath = ".",
    [string]$OutputName = "backend-deploy"
)

Write-Host "🚀 Creating deployment bundle..." -ForegroundColor Green
Write-Host ""

$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$bundleName = "$OutputName-$timestamp"
$bundlePath = Join-Path $OutputPath "$bundleName"

# Create temporary directory
Write-Host "📁 Creating temporary staging directory..." -ForegroundColor Cyan
New-Item -ItemType Directory -Path $bundlePath -Force | Out-Null

# Copy backend folder
Write-Host "📋 Copying backend files..." -ForegroundColor Cyan
Copy-Item -Path (Join-Path $projectRoot "backend") -Destination (Join-Path $bundlePath "backend") -Recurse -Force

# Copy configuration files
Write-Host "⚙️  Copying configuration files..." -ForegroundColor Cyan
Copy-Item -Path (Join-Path $projectRoot ".env") -Destination (Join-Path $bundlePath ".env") -Force -ErrorAction SilentlyContinue
Copy-Item -Path (Join-Path $projectRoot ".env.example") -Destination (Join-Path $bundlePath ".env.example") -Force
Copy-Item -Path (Join-Path $projectRoot "requirements.txt") -Destination (Join-Path $bundlePath "requirements.txt") -Force

# Copy documentation
Write-Host "📚 Copying documentation..." -ForegroundColor Cyan
Copy-Item -Path (Join-Path $projectRoot "README.md") -Destination (Join-Path $bundlePath "README.md") -Force -ErrorAction SilentlyContinue

# Create archive
Write-Host "📦 Creating archive..." -ForegroundColor Cyan

$archivePath = "$bundlePath.tar.gz"

# Check if 7z is available (common on Windows with Git Bash or other tools)
$sevenZip = Get-Command 7z -ErrorAction SilentlyContinue
if ($sevenZip) {
    Write-Host "   Using 7-Zip for compression..." -ForegroundColor Gray
    # Create tar first, then gzip
    $tarPath = "$bundlePath.tar"
    & 7z a -ttar "$tarPath" (Join-Path $bundlePath "*") | Out-Null
    & 7z a -tgzip "$archivePath" "$tarPath" | Out-Null
    Remove-Item $tarPath -Force
} else {
    # Try using tar command (available in PowerShell 7.0+ and Git Bash)
    $tar = Get-Command tar -ErrorAction SilentlyContinue
    if ($tar) {
        Write-Host "   Using tar for compression..." -ForegroundColor Gray
        $relativePath = Split-Path -Leaf $bundlePath
        Push-Location (Split-Path $bundlePath)
        & tar -czf "$bundleName.tar.gz" $relativePath
        Pop-Location
        Rename-Item -Path (Join-Path (Split-Path $bundlePath) "$bundleName.tar.gz") -NewName (Split-Path -Leaf $archivePath) -Force
    } else {
        Write-Host "   ⚠️  tar/7z not found. Using Compress-Archive (less efficient)..." -ForegroundColor Yellow
        Compress-Archive -Path $bundlePath -DestinationPath "$bundlePath.zip" -Force
        $archivePath = "$bundlePath.zip"
    }
}

# Clean up staging directory
Write-Host "🧹 Cleaning up staging directory..." -ForegroundColor Cyan
Remove-Item -Path $bundlePath -Recurse -Force

# Display results
Write-Host ""
Write-Host "✅ Deployment bundle created successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "📍 Bundle location: " -ForegroundColor Cyan -NoNewline
Write-Host $archivePath -ForegroundColor White
Write-Host ""
Write-Host "📦 Bundle size: " -ForegroundColor Cyan -NoNewline
$size = (Get-Item $archivePath).Length / 1MB
Write-Host ("{0:F2} MB" -f $size) -ForegroundColor White
Write-Host ""

Write-Host "📋 Bundle contents:" -ForegroundColor Cyan
Write-Host "   ✓ backend/              - FastAPI backend code" -ForegroundColor Gray
Write-Host "   ✓ .env                  - Environment configuration" -ForegroundColor Gray
Write-Host "   ✓ .env.example          - Example environment file" -ForegroundColor Gray
Write-Host "   ✓ requirements.txt      - Python dependencies" -ForegroundColor Gray
Write-Host "   ✓ README.md             - Documentation" -ForegroundColor Gray
Write-Host ""

Write-Host "🚀 Next steps:" -ForegroundColor Green
Write-Host "1. Upload to cloud server:" -ForegroundColor Cyan
Write-Host "   scp $archivePath your-user@your-instance:/path/to/app/" -ForegroundColor Yellow
Write-Host ""
Write-Host "2. Extract on server:" -ForegroundColor Cyan
Write-Host "   tar -xzf $(Split-Path -Leaf $archivePath)" -ForegroundColor Yellow
Write-Host ""
Write-Host "3. Install dependencies:" -ForegroundColor Cyan
Write-Host "   pip install -r backend/requirements.txt" -ForegroundColor Yellow
Write-Host ""
Write-Host "4. Run the API:" -ForegroundColor Cyan
Write-Host "   python -m uvicorn backend.api:app --host 0.0.0.0 --port 8000" -ForegroundColor Yellow
Write-Host ""
Write-Host "5. Update your local .env:" -ForegroundColor Cyan
Write-Host "   VOLCRE_API_BASE_URL=https://your-instance-url:8000" -ForegroundColor Yellow
Write-Host "   VOLCRE_WEB_API_BASE_URL=https://your-instance-url:8000" -ForegroundColor Yellow
Write-Host ""
