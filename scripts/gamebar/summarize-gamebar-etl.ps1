param(
  [string]$EtlPath,
  [string]$DiagDir = 'C:\Users\esihun\AppData\Local\Packages\Microsoft.XboxGamingOverlay_8wekyb3d8bbwe\LocalState\DiagOutputDir',
  [string]$OutputPath,
  [string]$CsvOutputPath
)

$ErrorActionPreference = 'Stop'

function Get-LatestEtlPath {
  param(
    [string]$Dir
  )

  if (-not (Test-Path $Dir)) {
    throw "DiagOutputDir를 찾지 못했습니다: $Dir"
  }

  $latest = Get-ChildItem $Dir -Filter 'GameBar_*_Sh.etl' |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

  if (-not $latest) {
    throw "GameBar ETL을 찾지 못했습니다: $Dir"
  }

  return $latest.FullName
}

function Invoke-Tracerpt {
  param(
    [string]$InputPath,
    [string]$OutputCsvPath
  )

  $parent = Split-Path $OutputCsvPath -Parent
  if ($parent -and -not (Test-Path $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }

  $args = @(
    $InputPath,
    '-o',
    $OutputCsvPath,
    '-of',
    'CSV',
    '-y'
  )

  $stdoutPath = Join-Path $env:TEMP ("tracerpt-{0}.out.txt" -f ([guid]::NewGuid().ToString('N')))
  $stderrPath = Join-Path $env:TEMP ("tracerpt-{0}.err.txt" -f ([guid]::NewGuid().ToString('N')))

  try {
    $proc = Start-Process `
      -FilePath 'C:\WINDOWS\system32\tracerpt.exe' `
      -ArgumentList $args `
      -Wait `
      -NoNewWindow `
      -PassThru `
      -RedirectStandardOutput $stdoutPath `
      -RedirectStandardError $stderrPath

    if ($proc.ExitCode -ne 0) {
      $stderr = if (Test-Path $stderrPath) { Get-Content $stderrPath -Raw } else { '' }
      throw "tracerpt.exe 실패($($proc.ExitCode)): $stderr"
    }
  } finally {
    Remove-Item $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
  }
}

function Get-PatternSamples {
  param(
    [object[]]$Rows,
    [string]$Pattern,
    [int]$Limit = 12
  )

  return @(
    $Rows |
      Where-Object { $_.message -match $Pattern } |
      Select-Object -First $Limit |
      ForEach-Object {
        [pscustomobject]@{
          tag = $_.tag
          message = $_.message
          pid = $_.pid
          tid = $_.tid
          clock_time = $_.clock_time
        }
      }
  )
}

if (-not $EtlPath) {
  $EtlPath = Get-LatestEtlPath -Dir $DiagDir
}

if (-not (Test-Path $EtlPath)) {
  throw "ETL을 찾지 못했습니다: $EtlPath"
}

$cleanupCsv = $false
if (-not $CsvOutputPath) {
  $CsvOutputPath = Join-Path $env:TEMP ("gamebar-etl-{0}.csv" -f ([guid]::NewGuid().ToString('N')))
  $cleanupCsv = $true
}

Invoke-Tracerpt -InputPath $EtlPath -OutputCsvPath $CsvOutputPath

$csvRows = Import-Csv $CsvOutputPath
$logRows = @(
  $csvRows |
    Where-Object { $_.'Event Name' -eq 'Microsoft-Windows-Diagnostics-LoggingChannel' } |
    ForEach-Object {
      $message = $_.'User Data'
      $tag = 'Unknown'
      $action = 'Unknown'

      if ($message -match '^\[[^\]]+\]:\[(?<tag>[^\]]+)\]\s*(?<body>.*)$') {
        $tag = $matches.tag
        $body = $matches.body
        if ($body -match '^(?<action>[^:]+)') {
          $action = $matches.action.Trim()
        }
      }

      [pscustomobject]@{
        tag = $tag
        action = $action
        message = $message
        pid = $_.PID
        tid = $_.TID
        clock_time = $_.'Clock-Time'
      }
    }
)

$patternMap = [ordered]@{
  full_trust = 'FullTrust|Ft server|FTServer|StartFullTrustServer'
  fullscreen = 'FullScreen|Fullscreen|FSE|IsFse|RegisterFullScreenExperienceChanged'
  target_tracking = 'AppTarget|TargetTracker|Target Captured|StartStopTargetTrackerAsync|StopTargetTrackerAsync|InitializeFtServerAsync'
  windowing = 'SetClickThrough|ClickThrough|UpdateWindowRegion|ResetWindowRect|CreateWindowAsync|AttachViewToWindowAsync|UpdateWindowVisibilityAsync|SetAppFrameHwnd|SetCoreWindowHwnd|WindowRegion|HostedViewSize|ChangeHostedViewSizeAsync'
  broker = 'GamingOverlayBroker'
  widgets = 'Widget|LoadInboxWidgets|CreateAndAddWidgetAsync|HandleWidgetAddedAsync|Command_ActivateAsync|InitializeInternal'
  input_focus = 'InputFocus|InputDelegation|m_inputFocusTrackerFT|FocusWidgetAsync|FocusAsync'
  launcher = 'steam|Epic|EA|GameLauncher|MRU item|Launcher'
}

$summary = [ordered]@{
  analyzed_at = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz')
  etl_path = $EtlPath
  csv_path = if ($cleanupCsv) { $null } else { $CsvOutputPath }
  total_events = $csvRows.Count
  logging_channel_events = $logRows.Count
  event_name_counts = @(
    $csvRows |
      Group-Object 'Event Name' |
      Sort-Object Count -Descending |
      ForEach-Object {
        [pscustomobject]@{
          event_name = $_.Name
          count = $_.Count
        }
      }
  )
  pid_counts = @(
    $logRows |
      Group-Object pid |
      Sort-Object Count -Descending |
      ForEach-Object {
        [pscustomobject]@{
          pid = $_.Name
          count = $_.Count
        }
      }
  )
  tag_counts = @(
    $logRows |
      Group-Object tag |
      Sort-Object Count -Descending |
      Select-Object -First 40 |
      ForEach-Object {
        [pscustomobject]@{
          tag = $_.Name
          count = $_.Count
        }
      }
  )
  action_counts = @(
    $logRows |
      Group-Object action |
      Sort-Object Count -Descending |
      Select-Object -First 60 |
      ForEach-Object {
        [pscustomobject]@{
          action = $_.Name
          count = $_.Count
        }
      }
  )
  pattern_hits = @(
    foreach ($entry in $patternMap.GetEnumerator()) {
      $matches = @($logRows | Where-Object { $_.message -match $entry.Value })
      [pscustomobject]@{
        key = $entry.Key
        pattern = $entry.Value
        count = $matches.Count
        samples = Get-PatternSamples -Rows $logRows -Pattern $entry.Value
      }
    }
  )
  first_messages = @(
    $logRows |
      Select-Object -First 80
  )
}

$json = $summary | ConvertTo-Json -Depth 8

if ($OutputPath) {
  $parent = Split-Path $OutputPath -Parent
  if ($parent -and -not (Test-Path $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }

  Set-Content -Path $OutputPath -Value $json -Encoding UTF8
}

if ($cleanupCsv) {
  Remove-Item $CsvOutputPath -Force -ErrorAction SilentlyContinue
}

$json
