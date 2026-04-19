$ErrorActionPreference = 'Continue'

$projectRoot = Split-Path -Parent $PSScriptRoot
$pidDir = Join-Path $projectRoot '.dev-pids'

if (-not (Test-Path $pidDir)) {
  Write-Host 'No running services found.'
  exit 0
}

$services = @('backend', 'expo')

foreach ($service in $services) {
  $pidFile = Join-Path $pidDir ("$service.pid")
  if (-not (Test-Path $pidFile)) {
    continue
  }

  $pidValue = Get-Content $pidFile -ErrorAction SilentlyContinue
  if ($pidValue) {
    $process = Get-Process -Id ([int]$pidValue) -ErrorAction SilentlyContinue
    if ($process) {
      Stop-Process -Id ([int]$pidValue) -Force -ErrorAction SilentlyContinue
      Write-Host "Stopped $service (PID $pidValue)."
    }
  }

  Remove-Item $pidFile -ErrorAction SilentlyContinue
}

Write-Host 'All tracked services have been stopped.'
