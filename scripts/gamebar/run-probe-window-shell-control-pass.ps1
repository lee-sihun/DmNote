param(
  [string[]]$TraceProcesses = @('explorer.exe', 'GameBar.exe', 'ShellHost.exe', 'ApplicationFrameHost.exe'),
  [int]$WindowDurationSeconds = 20,
  [int]$WindowRecordTimeoutSeconds = 20,
  [int]$TraceDurationSeconds = 8,
  [int]$TraceAttachLeadSeconds = 2,
  [int]$TraceWaitSeconds = 5,
  [int]$TraceMaxSamples = 32,
  [switch]$SkipLaunchGameBar
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Path $MyInvocation.MyCommand.Path -Parent
$repoRoot = Split-Path -Path (Split-Path -Path $scriptDir -Parent) -Parent
$artifactsDir = Join-Path $repoRoot 'docs\artifacts'
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$runDir = Join-Path $artifactsDir "gamebar-probe-window-shell-control-$timestamp"

New-Item -ItemType Directory -Path $runDir -Force | Out-Null

$windowScript = Join-Path $scriptDir 'start-probe-window.ps1'
$traceScript = Join-Path $scriptDir 'trace_gamebar_frida.py'
$windowJson = Join-Path $runDir 'probe-window.json'
$windowErr = Join-Path $runDir 'probe-window.stderr.txt'
$traceJson = Join-Path $runDir 'trace.json'
$traceErr = Join-Path $runDir 'trace.stderr.txt'
$windowTitle = "GameBar Shell Control $timestamp"

function Get-HwndVariants {
  param(
    [string]$Hwnd
  )

  $normalized = $Hwnd.ToLowerInvariant()
  $bare = $normalized -replace '^0x', ''
  return @($normalized, "0x$bare", $bare)
}

function Get-HwndTraceHits {
  param(
    [pscustomobject]$TraceJson,
    [string]$Hwnd
  )

  $variants = Get-HwndVariants -Hwnd $Hwnd
  $hits = @()

  foreach ($proc in @($TraceJson.processes)) {
    foreach ($sampleGroup in @($proc.samples.PSObject.Properties)) {
      foreach ($call in @($sampleGroup.Value)) {
        $matchedArgs = @()
        foreach ($arg in @($call.args)) {
          $raw = [string]$arg.raw
          if ($variants -contains $raw.ToLowerInvariant()) {
            $matchedArgs += [ordered]@{
              index = $arg.index
              raw = $raw
            }
          }
        }

        if ($matchedArgs.Count -gt 0) {
          $hits += [ordered]@{
            pid = $proc.pid
            processName = $proc.name
            api = "$($call.module)!$($call.function)"
            count = $call.count
            timestampMs = $call.timestamp_ms
            args = $call.args
            decoded = $call.decoded
            matchedArgs = $matchedArgs
          }
        }
      }
    }
  }

  return $hits
}

$windowProc = $null
$traceProc = $null

try {
  if (-not $SkipLaunchGameBar) {
    Start-Process 'ms-gamebar:' | Out-Null
    Start-Sleep -Seconds 2
  }

  $traceArgs = @(
    $traceScript,
    '--output', $traceJson,
    '--duration', $TraceDurationSeconds,
    '--wait-seconds', $TraceWaitSeconds,
    '--max-samples', $TraceMaxSamples
  )
  foreach ($traceProcess in $TraceProcesses) {
    $traceArgs += '--process-name'
    $traceArgs += $traceProcess
  }

  $traceProc = Start-Process python `
    -ArgumentList $traceArgs `
    -WorkingDirectory $repoRoot `
    -PassThru `
    -WindowStyle Hidden `
    -RedirectStandardError $traceErr

  Start-Sleep -Seconds $TraceAttachLeadSeconds

  $windowArgs = @(
    '-NoProfile',
    '-STA',
    '-ExecutionPolicy', 'Bypass',
    '-File', $windowScript,
    '-OutputPath', $windowJson,
    '-DurationSeconds', "$WindowDurationSeconds",
    '-Title', $windowTitle
  )

  $windowProc = Start-Process powershell `
    -WindowStyle Hidden `
    -PassThru `
    -RedirectStandardError $windowErr `
    -ArgumentList $windowArgs

  $deadline = (Get-Date).AddSeconds($WindowRecordTimeoutSeconds)
  while (-not (Test-Path $windowJson)) {
    if ($windowProc.HasExited) {
      $stderr = ''
      if (Test-Path $windowErr) {
        $stderr = Get-Content -Path $windowErr -Raw
      }
      throw "시험용 HWND 프로세스가 조기 종료되었습니다. ExitCode=$($windowProc.ExitCode) STDERR=$stderr"
    }
    if ((Get-Date) -gt $deadline) {
      $stderr = ''
      if (Test-Path $windowErr) {
        $stderr = Get-Content -Path $windowErr -Raw
      }
      throw "시험용 HWND 정보를 기록하지 못했습니다. STDERR=$stderr"
    }
    Start-Sleep -Milliseconds 200
  }

  $traceProc.WaitForExit()

  $windowInfo = Get-Content -Path $windowJson -Raw | ConvertFrom-Json
  $traceResult = Get-Content -Path $traceJson -Raw | ConvertFrom-Json
  $traceStderr = ''
  if (Test-Path $traceErr) {
    $traceStderr = Get-Content -Path $traceErr -Raw
  }

  $summary = [ordered]@{
    analyzedAt = (Get-Date).ToString('o')
    runDir = $runDir
    skipLaunchGameBar = [bool]$SkipLaunchGameBar
    probeWindow = $windowInfo
    traceProcesses = $TraceProcesses
    traceTargetsFound = @($traceResult.targets_found)
    traceHwndHits = @(Get-HwndTraceHits -TraceJson $traceResult -Hwnd ([string]$windowInfo.hwnd))
    tracePath = $traceJson
    traceStderrNonempty = -not [string]::IsNullOrWhiteSpace($traceStderr)
  }

  $summaryPath = Join-Path $runDir 'summary.json'
  $summary | ConvertTo-Json -Depth 8 | Set-Content -Path $summaryPath -Encoding UTF8
  Write-Output $summaryPath
}
finally {
  if ($traceProc -and -not $traceProc.HasExited) {
    Stop-Process -Id $traceProc.Id -Force -ErrorAction SilentlyContinue
  }
  if ($windowProc -and -not $windowProc.HasExited) {
    Stop-Process -Id $windowProc.Id -Force -ErrorAction SilentlyContinue
  }
}
