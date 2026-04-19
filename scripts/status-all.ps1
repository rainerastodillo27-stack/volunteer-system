$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$pidDir = Join-Path $projectRoot '.dev-pids'

if (-not (Test-Path $pidDir)) {
  Write-Host 'No running services found.'
  exit 1
}

$services = @('backend', 'expo')
$healthyCount = 0

foreach ($service in $services) {
  $pidFile = Join-Path $pidDir ("$service.pid")

  if (-not (Test-Path $pidFile)) {
    Write-Host "${service}: stopped"
    continue
  }

  $pidValue = Get-Content $pidFile -ErrorAction SilentlyContinue
  if (-not $pidValue) {
    Write-Host "${service}: stopped (empty pid file)"
    Remove-Item $pidFile -ErrorAction SilentlyContinue
    continue
  }

  $process = Get-Process -Id ([int]$pidValue) -ErrorAction SilentlyContinue
  if (-not $process) {
    Write-Host "${service}: stopped (stale pid file removed)"
    Remove-Item $pidFile -ErrorAction SilentlyContinue
    continue
  }

  if ($service -eq 'backend') {
    $listener = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) {
      Write-Host "${service}: running (PID $pidValue, port 8000 listening)"
      $healthyCount++
    } else {
      Write-Host "${service}: unhealthy (PID $pidValue alive, port 8000 not listening)"
    }
    continue
  }

  Write-Host "${service}: running (PID $pidValue)"
  $healthyCount++
}

if ($healthyCount -lt 2) {
  exit 1
}
