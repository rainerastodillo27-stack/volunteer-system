$ErrorActionPreference = 'Continue'

Write-Host ""
Write-Host "==========================================="
Write-Host " PERFORMANCE CHECK"
Write-Host "==========================================="
Write-Host ""

# Check if backend is running
$port8000 = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
if (-not $port8000) {
  Write-Host "ERROR: Backend is not running on port 8000"
  Write-Host "Please start the backend first with: npm run backend:stable"
  Write-Host ""
  Write-Host "==========================================="
  Write-Host ""
  exit 1
}

Write-Host "Backend is running on port 8000"
Write-Host ""

# Test endpoints and measure response times
$baseUrl = "http://localhost:8000"
$endpoints = @(
  @{Name="Health Check"; Url="/health"},
  @{Name="Users Storage"; Url="/storage/users"},
  @{Name="Partners Storage"; Url="/storage/partners"},
  @{Name="Programs Storage"; Url="/storage/programs"},
  @{Name="Projects Storage"; Url="/storage/projects"},
  @{Name="Events Storage"; Url="/storage/events"},
  @{Name="Volunteers Storage"; Url="/storage/volunteers"}
)

Write-Host "ENDPOINT RESPONSE TIMES:"
Write-Host ""

$totalTime = 0
$successCount = 0
$failCount = 0

foreach ($endpoint in $endpoints) {
  try {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $response = Invoke-WebRequest -Uri "$baseUrl$($endpoint.Url)" -Method GET -TimeoutSec 10 -ErrorAction Stop
    $sw.Stop()
    
    $timeMs = $sw.ElapsedMilliseconds
    $totalTime += $timeMs
    $successCount++
    
    $status = "OK"
    if ($timeMs -gt 1000) {
      $status = "SLOW"
    } elseif ($timeMs -gt 500) {
      $status = "WARNING"
    }
    
    Write-Host "  [$status] $($endpoint.Name): $timeMs ms"
  }
  catch {
    $failCount++
    Write-Host "  [FAIL] $($endpoint.Name): $($_.Exception.Message)"
  }
}

Write-Host ""
Write-Host "SUMMARY:"
Write-Host "  Successful: $successCount"
Write-Host "  Failed: $failCount"

if ($successCount -gt 0) {
  $avgTime = [math]::Round($totalTime / $successCount, 2)
  Write-Host "  Average Response Time: $avgTime ms"
  
  if ($avgTime -lt 200) {
    Write-Host "  Performance: EXCELLENT"
  } elseif ($avgTime -lt 500) {
    Write-Host "  Performance: GOOD"
  } elseif ($avgTime -lt 1000) {
    Write-Host "  Performance: ACCEPTABLE"
  } else {
    Write-Host "  Performance: NEEDS IMPROVEMENT"
  }
}

Write-Host ""

# Check database connection pool status
Write-Host "DATABASE CONNECTION POOL:"
$pythonProcs = Get-Process python* -ErrorAction SilentlyContinue
if ($pythonProcs) {
  foreach ($proc in $pythonProcs) {
    $dbConns = netstat -ano 2>$null | Select-String ":5432" | Select-String "ESTABLISHED" | Select-String $proc.Id
    if ($dbConns) {
      $connCount = ($dbConns | Measure-Object).Count
      Write-Host "  Active Connections: $connCount"
      
      if ($connCount -lt 5) {
        Write-Host "  Pool Status: HEALTHY"
      } elseif ($connCount -lt 10) {
        Write-Host "  Pool Status: NORMAL"
      } else {
        Write-Host "  Pool Status: HIGH (may indicate connection leak)"
      }
    }
    
    # Check for stuck connections
    $stuckConns = netstat -ano 2>$null | Select-String ":5432" | Select-String "FIN_WAIT" | Select-String $proc.Id
    if ($stuckConns) {
      $stuckCount = ($stuckConns | Measure-Object).Count
      Write-Host "  WARNING: $stuckCount stuck connections in FIN_WAIT state!"
    }
  }
} else {
  Write-Host "  No Python processes running"
}

Write-Host ""

# Check system load
Write-Host "SYSTEM LOAD:"
$cpu = Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average | Select-Object -ExpandProperty Average
Write-Host "  CPU Usage: $cpu%"

$os = Get-CimInstance Win32_OperatingSystem
$freeMemGB = [math]::Round($os.FreePhysicalMemory/1MB,2)
$totalMemGB = [math]::Round($os.TotalVisibleMemorySize/1MB,2)
$usedMemGB = $totalMemGB - $freeMemGB
$memPercent = [math]::Round(($usedMemGB / $totalMemGB) * 100, 1)

Write-Host "  Memory Usage: $usedMemGB GB / $totalMemGB GB ($memPercent%)"

if ($memPercent -gt 80) {
  Write-Host "  WARNING: High memory usage!"
}

Write-Host ""
Write-Host "==========================================="
Write-Host ""
