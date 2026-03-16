param(
  [string]$ArtifactsDir = 'C:\Users\esihun\Desktop\workfile\DmNote\docs\artifacts',
  [int]$PollDurationSeconds = 4,
  [int]$PollIntervalMs = 100,
  [switch]$LaunchGameBar
)

$ErrorActionPreference = 'Stop'

New-Item -ItemType Directory -Path $ArtifactsDir -Force | Out-Null

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$windowPollPath = Join-Path $ArtifactsDir "gamebar-window-poll-$timestamp.json"
$etlSummaryPath = Join-Path $ArtifactsDir "gamebar-etl-summary-$timestamp.json"
$ftSummaryPath = Join-Path $ArtifactsDir "ftserver-log-summary-$timestamp.json"
$baselinePath = Join-Path $ArtifactsDir "gamebar-baseline-$timestamp.json"
$winmdSummaryPath = Join-Path $ArtifactsDir "gamebar-winmd-summary-$timestamp.json"
$packageSummaryPath = Join-Path $ArtifactsDir "gamebar-package-summary-$timestamp.json"
$binarySummaryPath = Join-Path $ArtifactsDir "gamebar-binaries-summary-$timestamp.json"

$windowPollArgs = @{
  DurationSeconds = $PollDurationSeconds
  IntervalMs = $PollIntervalMs
  OutputPath = $windowPollPath
}

if ($LaunchGameBar) {
  $windowPollArgs.LaunchGameBar = $true
}

& (Join-Path $PSScriptRoot 'capture-gamebar-window-poll.ps1') @windowPollArgs | Out-Null

& (Join-Path $PSScriptRoot 'summarize-gamebar-etl.ps1') `
  -OutputPath $etlSummaryPath | Out-Null

& (Join-Path $PSScriptRoot 'summarize-ftserver-log.ps1') `
  -OutputPath $ftSummaryPath | Out-Null

& (Join-Path $PSScriptRoot 'collect-gamebar-baseline.ps1') `
  -OutputPath $baselinePath | Out-Null

& (Join-Path $PSScriptRoot 'dump-gamebar-winmd.ps1') `
  -SummaryPath $winmdSummaryPath | Out-Null

& (Join-Path $PSScriptRoot 'summarize-gamebar-package.ps1') `
  -OutputPath $packageSummaryPath | Out-Null

& (Join-Path $PSScriptRoot 'summarize-gamebar-binaries.ps1') `
  -OutputPath $binarySummaryPath | Out-Null

[pscustomobject]@{
  timestamp = $timestamp
  window_poll = $windowPollPath
  etl_summary = $etlSummaryPath
  ftserver_summary = $ftSummaryPath
  baseline = $baselinePath
  winmd_summary = $winmdSummaryPath
  package_summary = $packageSummaryPath
  binary_summary = $binarySummaryPath
}
