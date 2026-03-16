param(
  [string]$CsvPath = 'C:\Users\esihun\Desktop\workfile\DmNote\docs\artifacts\gamebar-procmon-capture.csv',
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $CsvPath)) {
  throw "Procmon CSV를 찾지 못했습니다: $CsvPath"
}

$rows = Import-Csv $CsvPath | Where-Object { $_.'Process Name' -match 'GameBar|Xbox|Widget' }

$summary = [ordered]@{
  csv_path = $CsvPath
  analyzed_at = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz')
  total_rows = $rows.Count
  process_counts = $rows |
    Group-Object 'Process Name' |
    Sort-Object Count -Descending |
    ForEach-Object {
      [pscustomobject]@{
        process_name = $_.Name
        count = $_.Count
      }
    }
  operation_counts = $rows |
    Group-Object Operation |
    Sort-Object Count -Descending |
    Select-Object -First 30 |
    ForEach-Object {
      [pscustomobject]@{
        operation = $_.Name
        count = $_.Count
      }
    }
  top_paths = $rows |
    Where-Object { $_.Path } |
    Group-Object Path |
    Sort-Object Count -Descending |
    Select-Object -First 40 |
    ForEach-Object {
      [pscustomobject]@{
        path = $_.Name
        count = $_.Count
      }
    }
  registry_focus = $rows |
    Where-Object { $_.Path -like 'HK*' } |
    Group-Object Path |
    Sort-Object Count -Descending |
    Select-Object -First 30 |
    ForEach-Object {
      [pscustomobject]@{
        path = $_.Name
        count = $_.Count
      }
    }
  file_focus = $rows |
    Where-Object { $_.Path -like '*:*' } |
    Group-Object Path |
    Sort-Object Count -Descending |
    Select-Object -First 30 |
    ForEach-Object {
      [pscustomobject]@{
        path = $_.Name
        count = $_.Count
      }
    }
  samples = $rows |
    Select-Object -First 120 'Time of Day', 'Process Name', PID, Operation, Path, Result, Detail
}

$json = $summary | ConvertTo-Json -Depth 6

if ($OutputPath) {
  $parent = Split-Path $OutputPath -Parent
  if ($parent -and -not (Test-Path $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }
  Set-Content -Path $OutputPath -Value $json -Encoding UTF8
}

$json
