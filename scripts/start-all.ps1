$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$pidDir = Join-Path $projectRoot '.dev-pids'
$backendLog = Join-Path $pidDir 'backend.log'
$expoLog = Join-Path $pidDir 'expo.log'

if (-not (Test-Path $projectRoot)) {
  throw "Project folder not found: $projectRoot"
}

if (-not (Test-Path $pidDir)) {
  New-Item -Path $pidDir -ItemType Directory | Out-Null
}

function Wait-BackendHealthy {
  param(
    [int]$ProcessId,
    [int]$MaxSeconds = 25
  )

  for ($elapsed = 0; $elapsed -lt $MaxSeconds; $elapsed++) {
    $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if (-not $process) {
      $tail = ''
      if (Test-Path $backendLog) {
        $tail = (Get-Content $backendLog -Tail 40) -join [Environment]::NewLine
      }
      throw "Backend process exited early. Last log lines:`n$tail"
    }

    try {
      $response = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/health' -Method Get -TimeoutSec 2
      if ($response) {
        return
      }
    } catch {
      # keep waiting while backend initializes
    }

    Start-Sleep -Seconds 1
  }

  throw "Backend did not become healthy within $MaxSeconds seconds."
}

function Start-ServiceProcess {
  param(
    [string]$Name,
    [string]$Command,
    [string]$LogPath,
    [switch]$WaitForBackendHealth
  )

  $pidFile = Join-Path $pidDir ("$Name.pid")

  if (Test-Path $pidFile) {
    $existingPid = Get-Content $pidFile -ErrorAction SilentlyContinue
    if ($existingPid) {
      $existing = Get-Process -Id ([int]$existingPid) -ErrorAction SilentlyContinue
      if ($existing) {
        Write-Host "$Name already running (PID $existingPid)."
        return
      }
    }

    Remove-Item $pidFile -ErrorAction SilentlyContinue
  }

  if (Test-Path $LogPath) {
    Remove-Item $LogPath -ErrorAction SilentlyContinue
  }

  $escapedProjectRoot = $projectRoot.Replace("'", "''")
  $escapedLogPath = $LogPath.Replace("'", "''")
  $innerCommand = "Set-Location '$escapedProjectRoot'; $Command *> '$escapedLogPath'"

  $process = Start-Process -FilePath 'powershell.exe' `
    -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $innerCommand) `
    -PassThru -WindowStyle Hidden

  Set-Content -Path $pidFile -Value $process.Id

  if ($WaitForBackendHealth) {
    Wait-BackendHealthy -ProcessId $process.Id
  }

  Write-Host "Started $Name (PID $($process.Id))."
}

Start-ServiceProcess -Name 'backend' -Command 'npm run backend' -LogPath $backendLog -WaitForBackendHealth
Start-ServiceProcess -Name 'expo' -Command 'npm start' -LogPath $expoLog

Write-Host "Use 'npm run all:status' to check processes and 'npm run all:stop' to stop them."

