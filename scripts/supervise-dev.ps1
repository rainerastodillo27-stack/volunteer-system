$ErrorActionPreference = 'Stop'

$scriptPath = Join-Path $PSScriptRoot 'start-all.ps1'
if (-not (Test-Path $scriptPath)) {
  throw "Missing script: $scriptPath"
}

& $scriptPath
