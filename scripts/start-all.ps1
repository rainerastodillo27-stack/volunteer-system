$ErrorActionPreference = 'Stop'
$env:EXPO_NO_BROWSER = "1"

$projectRoot = Split-Path -Parent $PSScriptRoot
$pidDir      = Join-Path $projectRoot '.dev-pids'
$backendLog  = Join-Path $pidDir 'backend.log'
$backendErr  = Join-Path $pidDir 'backend.err.log'
$expoLog     = Join-Path $pidDir 'expo.log'

Write-Host ""
Write-Host "==========================================="
Write-Host " STARTING VOLUNTEER SYSTEM"
Write-Host "==========================================="
Write-Host ""

# -- 0. Ensure .dev-pids directory exists ---------------------------------
if (-not (Test-Path $pidDir)) {
  New-Item -Path $pidDir -ItemType Directory | Out-Null
}

# -- 1. Force-stop anything on ports 8000 / 8081 before starting ----------
foreach ($port in @(8000, 8081)) {
  $pids = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
          Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($p in $pids) {
    Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
    Write-Host "  Cleared port $port (PID $p)"
  }
}

# Wait for ports to release
Start-Sleep -Seconds 2

# -- 2. Start backend ------------------------------------------------------
Write-Host "  Starting backend on port 8000..."

if (Test-Path $backendLog) { Remove-Item $backendLog -Force -ErrorAction SilentlyContinue }
if (Test-Path $backendErr) { Remove-Item $backendErr -Force -ErrorAction SilentlyContinue }

$escapedRoot = $projectRoot.Replace("'", "''")
$backendCmd  = "Set-Location '$escapedRoot'; npm run backend:stable 2>&1 | Tee-Object -FilePath '$($backendLog.Replace("'","''"))'"

$backendProc = Start-Process -FilePath 'powershell.exe' `
  -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $backendCmd) `
  -PassThru -WindowStyle Hidden

Set-Content -Path (Join-Path $pidDir 'backend.pid') -Value $backendProc.Id
Write-Host "  Backend started (PID $($backendProc.Id))"

# -- 3. Wait for backend to be healthy (max 30 s) -------------------------
Write-Host "  Waiting for backend to be ready..."
$healthy = $false
for ($i = 0; $i -lt 30; $i++) {
  # Check the process is still alive
  $alive = Get-Process -Id $backendProc.Id -ErrorAction SilentlyContinue
  if (-not $alive) {
    Write-Warning "  Backend process exited unexpectedly. Check $backendLog"
    break
  }

  try {
    $resp = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/health' -Method Get -TimeoutSec 2 -ErrorAction Stop
    if ($resp.status -eq 'ok') {
      $healthy = $true
      Write-Host "  Backend is healthy! (mode: $($resp.mode))" -ForegroundColor Green
      break
    }
  } catch {
    # still starting up
  }
  Start-Sleep -Seconds 1
}

if (-not $healthy) {
  Write-Warning "  Backend did not respond in time - Expo will still start."
}

# -- 4. Start background browser opener task ------------------------------
Write-Host "  Starting browser opener helper..."
$openerCmd = @"
`$webReady = `$false
for (`$i = 0; `$i -lt 60; `$i++) {
  try {
    `$resp = Invoke-WebRequest -Uri 'http://localhost:8081' -Method Get -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
    if (`$resp.StatusCode -eq 200) {
      `$webReady = `$true
      Start-Process 'http://localhost:8081'
      Start-Sleep -Milliseconds 800
      Start-Process 'http://localhost:8081?mode=mobile'
      break
    }
  } catch {
    # still starting up
  }
  Start-Sleep -Seconds 1
}
"@

Start-Process -FilePath 'powershell.exe' `
  -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $openerCmd) `
  -WindowStyle Hidden

# -- 5. Start Expo web in foreground --------------------------------------
Write-Host "  Starting Expo dev server on port 8081..."
Write-Host "  Press Ctrl+C to stop the entire system."
Write-Host ""

Set-Location $projectRoot
$env:EXPO_NO_BROWSER = "1"
npx expo start --web --clear
