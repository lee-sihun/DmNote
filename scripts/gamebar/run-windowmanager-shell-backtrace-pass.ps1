param(
  [string[]]$WindowManagerProcesses = @('GameBarFTServer.exe', 'GameBar.exe'),
  [string[]]$TraceProcesses = @('explorer.exe', 'GameBar.exe', 'ShellHost.exe', 'ApplicationFrameHost.exe'),
  [int]$WindowDurationSeconds = 90,
  [int]$WindowRecordTimeoutSeconds = 30,
  [int]$ProbeWaitSeconds = 12,
  [int]$TraceDurationSeconds = 10,
  [int]$TraceAttachLeadSeconds = 2,
  [int]$TraceWaitSeconds = 5,
  [int]$TraceMaxSamples = 32,
  [int]$BacktraceDepth = 14
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Path $MyInvocation.MyCommand.Path -Parent
$repoRoot = Split-Path -Path (Split-Path -Path $scriptDir -Parent) -Parent
$artifactsDir = Join-Path $repoRoot 'docs\artifacts'
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$runDir = Join-Path $artifactsDir "gamebar-windowmanager-shell-backtrace-$timestamp"

New-Item -ItemType Directory -Path $runDir -Force | Out-Null

$windowScript = Join-Path $scriptDir 'start-probe-window.ps1'
$probeScript = Join-Path $scriptDir 'probe_windowmanager_external_hwnd_frida.py'
$traceScript = Join-Path $scriptDir 'trace_gamebar_frida.py'

Start-Process 'ms-gamebar:' | Out-Null
Start-Sleep -Seconds 2

function Wait-ForFile {
  param(
    [string]$Path,
    [datetime]$Deadline
  )

  while (-not (Test-Path $Path)) {
    if ((Get-Date) -gt $Deadline) {
      return $false
    }
    Start-Sleep -Milliseconds 200
  }

  return $true
}

function Get-WatchedTraceHits {
  param(
    [pscustomobject]$TraceJson
  )

  $hits = @()
  foreach ($proc in @($TraceJson.processes)) {
    foreach ($sampleGroup in @($proc.samples.PSObject.Properties)) {
      foreach ($call in @($sampleGroup.Value)) {
        if (-not $call.watched_hwnd_match) {
          continue
        }

        $hits += [ordered]@{
          pid = $proc.pid
          processName = $proc.name
          api = "$($call.module)!$($call.function)"
          count = $call.count
          timestampMs = $call.timestamp_ms
          args = $call.args
          decoded = $call.decoded
          backtrace = @($call.backtrace)
        }
      }
    }
  }

  return $hits
}

$summaryRuns = @()

foreach ($wmProcess in $WindowManagerProcesses) {
  $safeName = [IO.Path]::GetFileNameWithoutExtension($wmProcess).ToLowerInvariant()
  $windowJson = Join-Path $runDir "$safeName-window.json"
  $windowErr = Join-Path $runDir "$safeName-window.stderr.txt"
  $probeJson = Join-Path $runDir "$safeName-probe.json"
  $traceJson = Join-Path $runDir "$safeName-trace.json"
  $traceErr = Join-Path $runDir "$safeName-trace.stderr.txt"
  $windowTitle = "GameBar Shell Backtrace Probe $timestamp $safeName"
  $windowProc = $null
  $traceProc = $null

  try {
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

    $windowDeadline = (Get-Date).AddSeconds($WindowRecordTimeoutSeconds)
    if (-not (Wait-ForFile -Path $windowJson -Deadline $windowDeadline)) {
      $stderr = ''
      if (Test-Path $windowErr) {
        $stderr = Get-Content -Path $windowErr -Raw
      }
      throw "시험용 HWND 정보를 기록하지 못했습니다: $wmProcess STDERR=$stderr"
    }

    if ($windowProc.HasExited) {
      $stderr = ''
      if (Test-Path $windowErr) {
        $stderr = Get-Content -Path $windowErr -Raw
      }
      throw "시험용 HWND 프로세스가 조기 종료되었습니다: $wmProcess ExitCode=$($windowProc.ExitCode) STDERR=$stderr"
    }

    $windowInfo = Get-Content -Path $windowJson -Raw | ConvertFrom-Json
    $probeHwnd = [string]$windowInfo.hwnd

    $traceArgs = @(
      $traceScript,
      '--output', $traceJson,
      '--duration', $TraceDurationSeconds,
      '--wait-seconds', $TraceWaitSeconds,
      '--max-samples', $TraceMaxSamples,
      '--watch-hwnd', $probeHwnd,
      '--backtrace-depth', $BacktraceDepth
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

    & python $probeScript `
      --process-name $wmProcess `
      --hwnd $probeHwnd `
      --output $probeJson `
      --wait-seconds $ProbeWaitSeconds | Out-Null

    if ($LASTEXITCODE -ne 0) {
      throw "$wmProcess WindowManagerFT probe 실행 실패"
    }

    $traceProc.WaitForExit()

    $probeResult = Get-Content -Path $probeJson -Raw | ConvertFrom-Json
    $traceResult = Get-Content -Path $traceJson -Raw | ConvertFrom-Json
    $traceStderr = ''
    if (Test-Path $traceErr) {
      $traceStderr = Get-Content -Path $traceErr -Raw
    }

    $watchedHits = @(Get-WatchedTraceHits -TraceJson $traceResult)
    $dwmHits = @($watchedHits | Where-Object { $_.api -eq 'dwmapi.dll!DwmSetWindowAttribute' })

    $summaryRuns += [ordered]@{
      windowManagerProcess = $wmProcess
      probeWindow = $windowInfo
      probeWindowProcessAliveBeforeCleanup = (-not $windowProc.HasExited)
      probePath = $probeJson
      probeResult = $probeResult.result
      tracePath = $traceJson
      traceTargetsFound = @($traceResult.targets_found)
      watchedHwndHits = $watchedHits
      dwmSetWindowAttributeHits = $dwmHits
      traceStderrNonempty = -not [string]::IsNullOrWhiteSpace($traceStderr)
    }
  }
  finally {
    if ($traceProc -and -not $traceProc.HasExited) {
      Stop-Process -Id $traceProc.Id -Force -ErrorAction SilentlyContinue
    }
    if ($windowProc -and -not $windowProc.HasExited) {
      Stop-Process -Id $windowProc.Id -Force -ErrorAction SilentlyContinue
    }
  }
}

$summary = [ordered]@{
  analyzedAt = (Get-Date).ToString('o')
  runDir = $runDir
  windowManagerProcesses = $WindowManagerProcesses
  traceProcesses = $TraceProcesses
  runs = $summaryRuns
}

$summaryPath = Join-Path $runDir 'summary.json'
$summary | ConvertTo-Json -Depth 8 | Set-Content -Path $summaryPath -Encoding UTF8
Write-Output $summaryPath
