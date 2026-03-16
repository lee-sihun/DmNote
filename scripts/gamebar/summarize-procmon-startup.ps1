param(
  [string]$CsvPath = 'C:\Users\esihun\Desktop\workfile\DmNote\docs\artifacts\gamebar-procmon-capture.csv',
  [string]$OutputPath,
  [int]$StartupWindowSeconds = 3
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $CsvPath)) {
  throw "Procmon CSV를 찾지 못했습니다: $CsvPath"
}

$rows = Import-Csv $CsvPath | Where-Object { $_.'Process Name' -match 'GameBar|Xbox|Widget' }

if (-not $rows) {
  throw 'Game Bar 관련 행을 찾지 못했습니다.'
}

$orderedRows = $rows | Sort-Object { [datetime]::Parse($_.'Time of Day') }
$baselineTime = [datetime]::Parse($orderedRows[0].'Time of Day')
$windowEnd = $baselineTime.AddSeconds($StartupWindowSeconds)

$summary = [ordered]@{
  csv_path = $CsvPath
  analyzed_at = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz')
  baseline_time = $baselineTime.ToString('o')
  startup_window_seconds = $StartupWindowSeconds
  first_seen = $orderedRows |
    Group-Object 'Process Name' |
    ForEach-Object {
      $first = $_.Group | Sort-Object { [datetime]::Parse($_.'Time of Day') } | Select-Object -First 1
      $firstTime = [datetime]::Parse($first.'Time of Day')

      [pscustomobject]@{
        process_name = $_.Name
        pid = $first.PID
        first_seen = $firstTime.ToString('o')
        delta_ms = [math]::Round(($firstTime - $baselineTime).TotalMilliseconds, 3)
        first_operation = $first.Operation
        first_path = $first.Path
      }
    } |
    Sort-Object delta_ms
  startup_operations = $orderedRows |
    Where-Object {
      $time = [datetime]::Parse($_.'Time of Day')
      $time -le $windowEnd -and $_.Operation -ne 'Process Profiling'
    } |
    Select-Object -First 160 @{
      Name = 'time';
      Expression = { ([datetime]::Parse($_.'Time of Day')).ToString('o') }
    }, 'Process Name', PID, Operation, Path, Result, Detail
  first_non_profiling_by_process = $orderedRows |
    Where-Object { $_.Operation -ne 'Process Profiling' } |
    Group-Object 'Process Name' |
    ForEach-Object {
      $first = $_.Group | Sort-Object { [datetime]::Parse($_.'Time of Day') } | Select-Object -First 12

      [pscustomobject]@{
        process_name = $_.Name
        samples = $first | ForEach-Object {
          [pscustomobject]@{
            time = ([datetime]::Parse($_.'Time of Day')).ToString('o')
            pid = $_.PID
            operation = $_.Operation
            path = $_.Path
            result = $_.Result
          }
        }
      }
    }
}

$json = $summary | ConvertTo-Json -Depth 8

if ($OutputPath) {
  $parent = Split-Path $OutputPath -Parent
  if ($parent -and -not (Test-Path $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }

  Set-Content -Path $OutputPath -Value $json -Encoding UTF8
}

$json
