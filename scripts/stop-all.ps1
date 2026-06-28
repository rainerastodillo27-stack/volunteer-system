$ErrorActionPreference = 'Continue'

$projectRoot = Split-Path -Parent $PSScriptRoot
$pidDir      = Join-Path $projectRoot '.dev-pids'

Write-Host ""
Write-Host "==========================================="
Write-Host " STOPPING VOLUNTEER SYSTEM"
Write-Host "==========================================="
Write-Host ""

# -- 1. Kill processes recorded in .dev-pids/*.pid ------------------------
if (Test-Path $pidDir) {
  Get-ChildItem -Path $pidDir -Filter '*.pid' | ForEach-Object {
    $svc      = $_.BaseName
    $pidValue = (Get-Content $_.FullName -ErrorAction SilentlyContinue) -as [int]
    if ($pidValue) {
      $proc = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
      if ($proc) {
        Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue
        Write-Host "  Stopped $svc (PID $pidValue)"
      }
    }
    Remove-Item $_.FullName -ErrorAction SilentlyContinue
  }
}

# -- 2. Kill anything still holding port 8000 (backend) -------------------
$port8000 = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique
foreach ($pid8000 in $port8000) {
  $proc = Get-Process -Id $pid8000 -ErrorAction SilentlyContinue
  if ($proc) {
    Stop-Process -Id $pid8000 -Force -ErrorAction SilentlyContinue
    Write-Host "  Killed port-8000 process: $($proc.ProcessName) (PID $pid8000)"
  }
}

# -- 3. Kill anything still holding port 8081 (Expo web) ------------------
$port8081 = Get-NetTCPConnection -LocalPort 8081 -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique
foreach ($pid8081 in $port8081) {
  $proc = Get-Process -Id $pid8081 -ErrorAction SilentlyContinue
  if ($proc) {
    Stop-Process -Id $pid8081 -Force -ErrorAction SilentlyContinue
    Write-Host "  Killed port-8081 process: $($proc.ProcessName) (PID $pid8081)"
  }
}

# -- 4. Wait for ports to fully release -----------------------------------
$waited = 0
while ($waited -lt 8) {
  $still8000 = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
  $still8081 = Get-NetTCPConnection -LocalPort 8081 -State Listen -ErrorAction SilentlyContinue
  if (-not $still8000 -and -not $still8081) { break }
  Start-Sleep -Seconds 1
  $waited++
}

# -- 5. Clear Python cache to ensure fresh code loads ---------------------
Write-Host "  Clearing Python cache..."
$pycacheDir = Join-Path $projectRoot 'backend\__pycache__'
if (Test-Path $pycacheDir) {
  Remove-Item -Path $pycacheDir -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host "  Python cache cleared"
}

# -- 6. Clear mobile app cache (Expo) -------------------------------------
Write-Host "  Clearing mobile app cache..."
$expoDir = Join-Path $projectRoot '.expo'
if (Test-Path $expoDir) {
  Remove-Item -Path $expoDir -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host "  Mobile app cache cleared"
}

# Clear Metro bundler cache
$metroCache = Join-Path $env:TEMP 'metro-*'
Get-ChildItem -Path $env:TEMP -Filter 'metro-*' -ErrorAction SilentlyContinue | ForEach-Object {
  Remove-Item -Path $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host "  Metro bundler cache cleared"

# Clear React Native cache
$rnCache = Join-Path $env:TEMP 'react-*'
Get-ChildItem -Path $env:TEMP -Filter 'react-*' -ErrorAction SilentlyContinue | ForEach-Object {
  Remove-Item -Path $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host "  React Native cache cleared"

# -- 7. Clear web cache (Expo web) ----------------------------------------
Write-Host "  Clearing web cache..."
# Clear Expo web dist build
$webDistDir = Join-Path $projectRoot 'dist'
if (Test-Path $webDistDir) {
  Remove-Item -Path $webDistDir -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host "  Web build cache (dist) cleared"
}
# Clear .cache folder if it exists
$cacheDir = Join-Path $projectRoot '.cache'
if (Test-Path $cacheDir) {
  Remove-Item -Path $cacheDir -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host "  Web cache (.cache) cleared"
}

Write-Host ""
Write-Host "  All services stopped. Ports 8000 and 8081 are free."
Write-Host "  All caches cleared (Python, Expo, Metro, React Native, Web)"
Write-Host ""
Write-Host "==========================================="
Write-Host ""
