param(
  [string]$ArtifactsDir = 'C:\Users\esihun\Desktop\workfile\DmNote\docs\artifacts',
  [string]$ProcmonPath = 'C:\Users\esihun\Downloads\SysinternalsSuite\Procmon64.exe',
  [int]$CaptureSeconds = 6,
  [switch]$SkipProcmon,
  [switch]$LaunchGameBar
)

$ErrorActionPreference = 'Stop'

New-Item -ItemType Directory -Path $ArtifactsDir -Force | Out-Null

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$pmlPath = Join-Path $ArtifactsDir "gamebar-procmon-$timestamp.pml"
$csvPath = Join-Path $ArtifactsDir "gamebar-procmon-$timestamp.csv"
$procmonSummaryPath = Join-Path $ArtifactsDir "procmon-gamebar-summary-$timestamp.json"
$startupSummaryPath = Join-Path $ArtifactsDir "procmon-gamebar-startup-$timestamp.json"
$clsidSummaryPath = Join-Path $ArtifactsDir "procmon-gamebar-clsids-$timestamp.json"
$ftSummaryPath = Join-Path $ArtifactsDir "ftserver-log-summary-$timestamp.json"
$baselinePath = Join-Path $ArtifactsDir "gamebar-baseline-$timestamp.json"
$winmdSummaryPath = Join-Path $ArtifactsDir "gamebar-winmd-summary-$timestamp.json"
$etlSummaryPath = Join-Path $ArtifactsDir "gamebar-etl-summary-$timestamp.json"
$packageSummaryPath = Join-Path $ArtifactsDir "gamebar-package-summary-$timestamp.json"
$binarySummaryPath = Join-Path $ArtifactsDir "gamebar-binaries-summary-$timestamp.json"

if (-not $SkipProcmon) {
  $captureArgs = @{
    ProcmonPath = $ProcmonPath
    OutputPath = $pmlPath
    CaptureSeconds = $CaptureSeconds
  }

  if ($LaunchGameBar) {
    $captureArgs.LaunchGameBar = $true
  }

  & (Join-Path $PSScriptRoot 'capture-gamebar-procmon.ps1') @captureArgs | Out-Null

  & (Join-Path $PSScriptRoot 'export-procmon-log.ps1') `
    -ProcmonPath $ProcmonPath `
    -InputPath $pmlPath `
    -OutputPath $csvPath | Out-Null

  & (Join-Path $PSScriptRoot 'summarize-procmon-gamebar.ps1') `
    -CsvPath $csvPath `
    -OutputPath $procmonSummaryPath | Out-Null

  & (Join-Path $PSScriptRoot 'summarize-procmon-startup.ps1') `
    -CsvPath $csvPath `
    -OutputPath $startupSummaryPath | Out-Null

  & (Join-Path $PSScriptRoot 'resolve-procmon-clsids.ps1') `
    -SummaryPath $startupSummaryPath `
    -OutputPath $clsidSummaryPath | Out-Null
} elseif ($LaunchGameBar) {
  Start-Process 'ms-gamebar:'
  Start-Sleep -Seconds 3
}

& (Join-Path $PSScriptRoot 'summarize-ftserver-log.ps1') `
  -OutputPath $ftSummaryPath | Out-Null

& (Join-Path $PSScriptRoot 'collect-gamebar-baseline.ps1') `
  -OutputPath $baselinePath | Out-Null

& (Join-Path $PSScriptRoot 'dump-gamebar-winmd.ps1') `
  -SummaryPath $winmdSummaryPath | Out-Null

& (Join-Path $PSScriptRoot 'summarize-gamebar-etl.ps1') `
  -OutputPath $etlSummaryPath | Out-Null

& (Join-Path $PSScriptRoot 'summarize-gamebar-package.ps1') `
  -OutputPath $packageSummaryPath | Out-Null

& (Join-Path $PSScriptRoot 'summarize-gamebar-binaries.ps1') `
  -OutputPath $binarySummaryPath | Out-Null

[pscustomobject]@{
  timestamp = $timestamp
  procmon_pml = if ($SkipProcmon) { $null } else { $pmlPath }
  procmon_csv = if ($SkipProcmon) { $null } else { $csvPath }
  procmon_summary = if ($SkipProcmon) { $null } else { $procmonSummaryPath }
  startup_summary = if ($SkipProcmon) { $null } else { $startupSummaryPath }
  clsid_summary = if ($SkipProcmon) { $null } else { $clsidSummaryPath }
  ftserver_summary = $ftSummaryPath
  baseline = $baselinePath
  winmd_summary = $winmdSummaryPath
  etl_summary = $etlSummaryPath
  package_summary = $packageSummaryPath
  binary_summary = $binarySummaryPath
}
