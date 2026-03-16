param(
  [string]$ArtifactsDir = 'C:\Users\esihun\Desktop\workfile\DmNote\docs\artifacts'
)

$ErrorActionPreference = 'Stop'

New-Item -ItemType Directory -Path $ArtifactsDir -Force | Out-Null

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$structuralDirMarker = $timestamp
$fridaPath = Join-Path $ArtifactsDir "gamebar-frida-trace-$timestamp.json"
$logmanPath = Join-Path $ArtifactsDir "gamebar-logman-$timestamp.etl"
$logmanSummaryPath = Join-Path $ArtifactsDir "gamebar-logman-summary-$timestamp.json"
$logmanEventSummaryPath = Join-Path $ArtifactsDir "gamebar-logman-events-$timestamp.json"
$rizinPath = Join-Path $ArtifactsDir "gamebar-rizin-summary-$timestamp.json"

& (Join-Path $PSScriptRoot 'run-gamebar-structural-pass.ps1') `
  -LaunchGameBar `
  -ArtifactsDir $ArtifactsDir | Out-Null

Get-Process GameBar,GameBarFTServer -ErrorAction SilentlyContinue |
  Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

python (Join-Path $PSScriptRoot 'trace_gamebar_frida.py') `
  --output $fridaPath `
  --duration 6 `
  --wait-seconds 10 `
  --launch-gamebar | Out-Null

& (Join-Path $PSScriptRoot 'capture-gamebar-logman.ps1') `
  -LaunchGameBar `
  -DurationSeconds 4 `
  -OutputPath $logmanPath | Out-Null

& (Join-Path $PSScriptRoot 'summarize-gamebar-wpr.ps1') `
  -EtlPath $logmanPath `
  -OutputPath $logmanSummaryPath | Out-Null

& (Join-Path $PSScriptRoot 'summarize-gamebar-etw-events.ps1') `
  -EtlPath $logmanPath `
  -OutputPath $logmanEventSummaryPath | Out-Null

& (Join-Path $PSScriptRoot 'summarize-gamebar-rizin.ps1') `
  -OutputPath $rizinPath | Out-Null

[pscustomobject]@{
  timestamp = $timestamp
  structural_marker = $structuralDirMarker
  frida_trace = $fridaPath
  logman_etl = $logmanPath
  logman_summary = $logmanSummaryPath
  logman_event_summary = $logmanEventSummaryPath
  rizin_summary = $rizinPath
}
