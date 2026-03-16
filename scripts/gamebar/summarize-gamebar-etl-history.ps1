param(
  [string]$DiagDir = 'C:\Users\esihun\AppData\Local\Packages\Microsoft.XboxGamingOverlay_8wekyb3d8bbwe\LocalState\DiagOutputDir',
  [int]$MaxFiles = 5,
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $DiagDir)) {
  throw "DiagOutputDir를 찾지 못했습니다: $DiagDir"
}

$etlFiles = Get-ChildItem $DiagDir -Filter 'GameBar_*_Sh.etl' |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First $MaxFiles

if (-not $etlFiles) {
  throw "GameBar ETL을 찾지 못했습니다: $DiagDir"
}

$summaryRows = foreach ($etlFile in $etlFiles) {
  $raw = & (Join-Path $PSScriptRoot 'summarize-gamebar-etl.ps1') -EtlPath $etlFile.FullName
  $raw | ConvertFrom-Json
}

$allTagRows = @(
  foreach ($file in $summaryRows) {
    foreach ($tag in $file.tag_counts) {
      [pscustomobject]@{
        file = $file.etl_path
        tag = $tag.tag
        count = [int]$tag.count
      }
    }
  }
)

$allPatternRows = @(
  foreach ($file in $summaryRows) {
    foreach ($pattern in $file.pattern_hits) {
      [pscustomobject]@{
        file = $file.etl_path
        key = $pattern.key
        count = [int]$pattern.count
      }
    }
  }
)

$history = [ordered]@{
  analyzed_at = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz')
  etl_files = @(
    $etlFiles |
      ForEach-Object {
        [pscustomobject]@{
          name = $_.Name
          full_name = $_.FullName
          last_write_time = $_.LastWriteTime
          length = $_.Length
        }
      }
  )
  per_file = @(
    $summaryRows |
      ForEach-Object {
        [pscustomobject]@{
          etl_path = $_.etl_path
          logging_channel_events = $_.logging_channel_events
          top_tags = @($_.tag_counts | Select-Object -First 10)
          top_patterns = @($_.pattern_hits | Sort-Object count -Descending | Select-Object key,count)
        }
      }
  )
  aggregate_tags = @(
    $allTagRows |
      Group-Object tag |
      Sort-Object { ($_.Group | Measure-Object count -Sum).Sum } -Descending |
      Select-Object -First 25 |
      ForEach-Object {
        [pscustomobject]@{
          tag = $_.Name
          total_count = ($_.Group | Measure-Object count -Sum).Sum
          files_seen = @($_.Group.file | Sort-Object -Unique).Count
        }
      }
  )
  aggregate_patterns = @(
    $allPatternRows |
      Group-Object key |
      Sort-Object { ($_.Group | Measure-Object count -Sum).Sum } -Descending |
      ForEach-Object {
        [pscustomobject]@{
          key = $_.Name
          total_count = ($_.Group | Measure-Object count -Sum).Sum
          files_seen = @($_.Group.file | Sort-Object -Unique).Count
        }
      }
  )
  representative_samples = @(
    foreach ($tagName in @('WB', 'PC', 'HPVM', 'SC', 'WM', 'ATM', 'IDM', 'PROF')) {
      $sample = $null
      foreach ($file in $summaryRows) {
        $sample = $file.first_messages | Where-Object { $_.tag -eq $tagName } | Select-Object -First 1
        if ($sample) {
          break
        }
      }

      if ($sample) {
        [pscustomobject]@{
          tag = $tagName
          sample_message = $sample.message
        }
      }
    }
  )
}

$json = $history | ConvertTo-Json -Depth 8

if ($OutputPath) {
  $parent = Split-Path $OutputPath -Parent
  if ($parent -and -not (Test-Path $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }

  Set-Content -Path $OutputPath -Value $json -Encoding UTF8
}

$json
