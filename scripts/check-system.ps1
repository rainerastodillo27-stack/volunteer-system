$ErrorActionPreference = 'Continue'

Write-Host ""
Write-Host "==========================================="
Write-Host " SYSTEM CHECK"
Write-Host "==========================================="
Write-Host ""

# Check running processes
Write-Host "1. RUNNING PROCESSES:"
$pythonProcs = Get-Process python* -ErrorAction SilentlyContinue
$nodeProcs = Get-Process node* -ErrorAction SilentlyContinue

if ($pythonProcs) {
  Write-Host "  Python processes: $($pythonProcs.Count)"
} else {
  Write-Host "  OK: No Python processes"
}

if ($nodeProcs) {
  Write-Host "  Node processes: $($nodeProcs.Count)"
} else {
  Write-Host "  OK: No Node processes"
}

Write-Host ""

# Check ports
Write-Host "2. PORT STATUS:"
$port8000 = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
$port8081 = Get-NetTCPConnection -LocalPort 8081 -State Listen -ErrorAction SilentlyContinue

if ($port8000) {
  Write-Host "  WARNING: Port 8000 IN USE"
} else {
  Write-Host "  OK: Port 8000 FREE"
}

if ($port8081) {
  Write-Host "  WARNING: Port 8081 IN USE"
} else {
  Write-Host "  OK: Port 8081 FREE"
}

Write-Host ""

# Check database connections
Write-Host "3. DATABASE CONNECTIONS:"
if ($pythonProcs) {
  foreach ($proc in $pythonProcs) {
    $dbConns = netstat -ano 2>$null | Select-String ":5432" | Select-String $proc.Id
    if ($dbConns) {
      $connCount = ($dbConns | Measure-Object).Count
      Write-Host "  Python PID $($proc.Id): $connCount Supabase connections"
      
      $finWait = $dbConns | Select-String "FIN_WAIT"
      if ($finWait) {
        $stuckCount = ($finWait | Measure-Object).Count
        Write-Host "    WARNING: $stuckCount connections stuck!"
      }
    }
  }
} else {
  Write-Host "  OK: No database connections"
}

Write-Host ""

# Check system resources
Write-Host "4. SYSTEM RESOURCES:"
$os = Get-CimInstance Win32_OperatingSystem
$freeMemGB = [math]::Round($os.FreePhysicalMemory/1MB,2)
$totalMemGB = [math]::Round($os.TotalVisibleMemorySize/1MB,2)

Write-Host "  Memory: $freeMemGB GB free / $totalMemGB GB total"

$drive = Get-PSDrive C
$freeGB = [math]::Round($drive.Free/1GB,2)
$totalGB = [math]::Round(($drive.Free + $drive.Used)/1GB,2)

Write-Host "  Disk C: $freeGB GB free / $totalGB GB total"

Write-Host ""

# Overall status
Write-Host "5. OVERALL STATUS:"
if (-not $pythonProcs -and -not $nodeProcs -and -not $port8000 -and -not $port8081) {
  Write-Host "  SYSTEM IS READY TO START"
} else {
  Write-Host "  SERVICES ARE RUNNING"
}

Write-Host ""
Write-Host "==========================================="
Write-Host ""
