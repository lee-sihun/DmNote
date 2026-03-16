param(
  [string[]]$WindowManagerProcesses = @('GameBarFTServer.exe', 'GameBar.exe'),
  [string[]]$TraceProcesses = @('explorer.exe', 'GameBar.exe', 'ShellHost.exe', 'ApplicationFrameHost.exe'),
  [int]$WindowDurationSeconds = 90,
  [int]$TraceDurationSeconds = 8,
  [int]$TraceAttachLeadSeconds = 2,
  [int]$TraceWaitSeconds = 5,
  [int]$TraceMaxSamples = 8
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Path $MyInvocation.MyCommand.Path -Parent
$repoRoot = Split-Path -Path (Split-Path -Path $scriptDir -Parent) -Parent
$artifactsDir = Join-Path $repoRoot 'docs\artifacts'
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$runDir = Join-Path $artifactsDir "gamebar-windowmanager-shell-correlation-$timestamp"

New-Item -ItemType Directory -Path $runDir -Force | Out-Null

$windowScript = Join-Path $scriptDir 'start-probe-window.ps1'
$windowManagerRunner = Join-Path $scriptDir 'run-windowmanager-external-hwnd-pass.ps1'
$traceScript = Join-Path $scriptDir 'trace_gamebar_frida.py'

Start-Process 'ms-gamebar:' | Out-Null
Start-Sleep -Seconds 2

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
            $matchedArgs += [pscustomobject]@{
              index = $arg.index
              raw = $raw
            }
          }
        }

        if ($matchedArgs.Count -gt 0) {
          $hits += [pscustomobject]@{
            pid = $proc.pid
            processName = $proc.name
            api = $sampleGroup.Name
            count = $call.count
            matchedArgs = $matchedArgs
          }
        }
      }
    }
  }

  return $hits
}

$summaryRuns = @()

foreach ($wmProcess in $WindowManagerProcesses) {
  $safeName = [IO.Path]::GetFileNameWithoutExtension($wmProcess).ToLowerInvariant()
  $traceProc = $null

  try {
    $traceJsonPath = Join-Path $runDir "$safeName-trace.json"
    $traceErrPath = Join-Path $runDir "$safeName-trace.stderr.txt"

    $traceArgs = @(
      $traceScript,
      '--output', $traceJsonPath,
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
      -RedirectStandardError $traceErrPath

    Start-Sleep -Seconds $TraceAttachLeadSeconds

    $wmSummaryPath = & $windowManagerRunner `
      -TargetProcesses @($wmProcess) `
      -WindowDurationSeconds $WindowDurationSeconds `
      -WindowRecordTimeoutSeconds 30 `
      -WaitSeconds 12

    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($wmSummaryPath)) {
      throw "$wmProcess WindowManagerFT runner 실행 실패"
    }

    $traceProc.WaitForExit()

    $wmSummaryPath = ($wmSummaryPath | Select-Object -Last 1).Trim()
    $wmSummary = Get-Content -Path $wmSummaryPath -Raw | ConvertFrom-Json
    $wmRun = @($wmSummary.runs | Where-Object { $_.processName -eq $wmProcess }) | Select-Object -First 1
    if ($null -eq $wmRun) {
      throw "$wmProcess WindowManagerFT summary 해석 실패"
    }

    $probeHwnd = [string]$wmRun.hwnd
    $traceJson = Get-Content -Path $traceJsonPath -Raw | ConvertFrom-Json
    $stderr = ''
    if (Test-Path $traceErrPath) {
      $stderr = Get-Content -Path $traceErrPath -Raw
    }

    $summaryRuns += [ordered]@{
      windowManagerProcess = $wmProcess
      probeWindow = $wmRun.probeWindow
      probeWindowProcessAliveBeforeCleanup = $wmRun.probeWindowProcessAliveBeforeCleanup
      windowManagerSummaryPath = $wmSummaryPath
      windowManagerResult = $wmRun
      traceTargetsFound = @($traceJson.targets_found)
      traceHwndHits = @(Get-HwndTraceHits -TraceJson $traceJson -Hwnd $probeHwnd)
      traceStderrNonempty = -not [string]::IsNullOrWhiteSpace($stderr)
      traceJsonPath = $traceJsonPath
    }
  }
  finally {
    if ($traceProc -and -not $traceProc.HasExited) {
      Stop-Process -Id $traceProc.Id -Force -ErrorAction SilentlyContinue
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
