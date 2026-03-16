param(
  [string]$ArtifactsDir = 'C:\Users\esihun\Desktop\workfile\DmNote\docs\artifacts',
  [string[]]$Interfaces = @('hidden1', 'hidden2'),
  [int[]]$Slots = @(6, 7, 10, 39, 49, 51, 52),
  [string[]]$Signatures = @('noarg', 'outptr'),
  [switch]$LaunchGameBar = $true,
  [switch]$TraceGameBar,
  [int]$TraceDurationSeconds = 6,
  [int]$AttachLeadSeconds = 2,
  [int]$WaitSeconds = 5,
  [int]$MaxSamples = 4
)

$ErrorActionPreference = 'Stop'

New-Item -ItemType Directory -Path $ArtifactsDir -Force | Out-Null

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$runDir = Join-Path $ArtifactsDir "gamebar-hidden-slot-pass-$timestamp"
New-Item -ItemType Directory -Path $runDir -Force | Out-Null

$gameBarStarted = $false
if ($LaunchGameBar) {
  Start-Process 'ms-gamebar:'
  Start-Sleep -Seconds 3
  $gameBarStarted = $true
}

$runs = @()

foreach ($interfaceName in $Interfaces) {
  foreach ($slot in $Slots) {
    foreach ($signature in $Signatures) {
      $baseName = "$interfaceName-slot$slot-$signature"
      $jsonPath = Join-Path $runDir "$baseName.json"
      $stderrPath = Join-Path $runDir "$baseName.stderr.txt"
      $tracePath = Join-Path $runDir "$baseName.trace.json"
      $traceErrPath = Join-Path $runDir "$baseName.trace.stderr.txt"

      $traceProc = $null
      if ($TraceGameBar) {
        $traceArgs = @(
          'scripts/gamebar/trace_gamebar_frida.py',
          '--output',
          $tracePath,
          '--duration',
          $TraceDurationSeconds,
          '--wait-seconds',
          $WaitSeconds,
          '--max-samples',
          $MaxSamples,
          '--process-name',
          'GameBar.exe',
          '--process-name',
          'explorer.exe'
        )

        $traceProc = Start-Process python `
          -ArgumentList $traceArgs `
          -WorkingDirectory (Get-Location).Path `
          -PassThru `
          -WindowStyle Hidden `
          -RedirectStandardError $traceErrPath

        Start-Sleep -Seconds $AttachLeadSeconds
      }

      $probeArgs = @(
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        (Join-Path $PSScriptRoot 'probe-gamebar-broker-slot.ps1'),
        '-InterfaceName',
        $interfaceName,
        '-Slot',
        $slot,
        '-Signature',
        $signature
      )

      $probe = Start-Process powershell `
        -ArgumentList $probeArgs `
        -WorkingDirectory (Get-Location).Path `
        -PassThru `
        -WindowStyle Hidden `
        -RedirectStandardOutput $jsonPath `
        -RedirectStandardError $stderrPath

      $probe.WaitForExit()

      if ($traceProc) {
        $traceProc.WaitForExit()
        if (-not $traceProc.HasExited) {
          Stop-Process -Id $traceProc.Id -Force -ErrorAction SilentlyContinue
        }
      }

      $runs += [pscustomobject]@{
        interface = $interfaceName
        slot = $slot
        signature = $signature
        exit_code = $probe.ExitCode
        json_path = $jsonPath
        stderr_path = $stderrPath
        trace_path = $(if (Test-Path $tracePath) { $tracePath } else { $null })
        trace_stderr_path = $(if (Test-Path $traceErrPath) { $traceErrPath } else { $null })
      }
    }
  }
}

$summary = [ordered]@{
  analyzed_at = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz')
  run_dir = $runDir
  interfaces = $Interfaces
  slots = $Slots
  signatures = $Signatures
  trace_gamebar = [bool]$TraceGameBar
  runs = $runs
}

$summaryPath = Join-Path $runDir 'summary.json'
$summary | ConvertTo-Json -Depth 8 | Set-Content -Path $summaryPath -Encoding UTF8

if ($gameBarStarted) {
  Get-Process GameBar -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}

$summaryPath
