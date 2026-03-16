param(
  [string]$ArtifactsDir = 'C:\Users\esihun\Desktop\workfile\DmNote\docs\artifacts',
  [int]$DurationSeconds = 4,
  [switch]$IncludeDxgi,
  [switch]$IncludeXaml
)

$ErrorActionPreference = 'Stop'

New-Item -ItemType Directory -Path $ArtifactsDir -Force | Out-Null

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$idleEtlPath = Join-Path $ArtifactsDir "gamebar-logman-idle-$timestamp.etl"
$idleSummaryPath = Join-Path $ArtifactsDir "gamebar-logman-idle-summary-$timestamp.json"
$launchEtlPath = Join-Path $ArtifactsDir "gamebar-logman-launch-$timestamp.etl"
$launchSummaryPath = Join-Path $ArtifactsDir "gamebar-logman-launch-summary-$timestamp.json"
$diffPath = Join-Path $ArtifactsDir "gamebar-logman-diff-$timestamp.json"

Get-Process GameBar,GameBarFTServer -ErrorAction SilentlyContinue |
  Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

& (Join-Path $PSScriptRoot 'capture-gamebar-logman.ps1') `
  -SessionName "GameBarIdleTrace$timestamp" `
  -OutputPath $idleEtlPath `
  -DurationSeconds $DurationSeconds `
  -IncludeDxgi:$IncludeDxgi `
  -IncludeXaml:$IncludeXaml | Out-Null

& (Join-Path $PSScriptRoot 'summarize-gamebar-etw-events.ps1') `
  -EtlPath $idleEtlPath `
  -OutputPath $idleSummaryPath | Out-Null

Get-Process GameBar,GameBarFTServer -ErrorAction SilentlyContinue |
  Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

& (Join-Path $PSScriptRoot 'capture-gamebar-logman.ps1') `
  -SessionName "GameBarLaunchTrace$timestamp" `
  -OutputPath $launchEtlPath `
  -DurationSeconds $DurationSeconds `
  -LaunchGameBar `
  -IncludeDxgi:$IncludeDxgi `
  -IncludeXaml:$IncludeXaml | Out-Null

& (Join-Path $PSScriptRoot 'summarize-gamebar-etw-events.ps1') `
  -EtlPath $launchEtlPath `
  -OutputPath $launchSummaryPath | Out-Null

$idleSummary = Get-Content $idleSummaryPath -Raw | ConvertFrom-Json
$launchSummary = Get-Content $launchSummaryPath -Raw | ConvertFrom-Json

$idleMap = @{}
foreach ($item in $idleSummary.provider_event_counts) {
  $key = "{0}|{1}|{2}|{3}" -f $item.provider, $item.event_id, $item.task, $item.opcode
  $idleMap[$key] = [int]$item.count
}

$launchMap = @{}
foreach ($item in $launchSummary.provider_event_counts) {
  $key = "{0}|{1}|{2}|{3}" -f $item.provider, $item.event_id, $item.task, $item.opcode
  $launchMap[$key] = [int]$item.count
}

$allKeys = @($idleMap.Keys + $launchMap.Keys | Sort-Object -Unique)

$diffRows = @(
  foreach ($key in $allKeys) {
    $parts = $key -split '\|', 4
    $idleCount = if ($idleMap.ContainsKey($key)) { $idleMap[$key] } else { 0 }
    $launchCount = if ($launchMap.ContainsKey($key)) { $launchMap[$key] } else { 0 }

    [pscustomobject]@{
      provider = $parts[0]
      event_id = [int]$parts[1]
      task = [int]$parts[2]
      opcode = [int]$parts[3]
      idle_count = $idleCount
      launch_count = $launchCount
      delta = $launchCount - $idleCount
    }
  }
)

$diffSummary = [ordered]@{
  analyzed_at = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz')
  duration_seconds = $DurationSeconds
  include_dxgi = [bool]$IncludeDxgi
  include_xaml = [bool]$IncludeXaml
  idle_etl = $idleEtlPath
  launch_etl = $launchEtlPath
  idle_summary = $idleSummaryPath
  launch_summary = $launchSummaryPath
  top_positive_deltas = @(
    $diffRows |
      Sort-Object delta -Descending |
      Select-Object -First 60
  )
  top_negative_deltas = @(
    $diffRows |
      Sort-Object delta |
      Select-Object -First 60
  )
}

$json = $diffSummary | ConvertTo-Json -Depth 6
Set-Content -Path $diffPath -Value $json -Encoding UTF8

[pscustomobject]@{
  timestamp = $timestamp
  idle_etl = $idleEtlPath
  idle_summary = $idleSummaryPath
  launch_etl = $launchEtlPath
  launch_summary = $launchSummaryPath
  diff_summary = $diffPath
}
