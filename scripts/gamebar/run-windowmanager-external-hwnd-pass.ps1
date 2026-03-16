param(
  [string[]]$TargetProcesses = @('GameBarFTServer.exe', 'GameBar.exe'),
  [int]$WindowDurationSeconds = 90,
  [int]$WaitSeconds = 12,
  [switch]$WindowedProbe,
  [int]$WindowRecordTimeoutSeconds = 10
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Path $MyInvocation.MyCommand.Path -Parent
$repoRoot = Split-Path -Path (Split-Path -Path $scriptDir -Parent) -Parent
$artifactsDir = Join-Path $repoRoot 'docs\artifacts'
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$runDir = Join-Path $artifactsDir "gamebar-windowmanager-external-hwnd-$timestamp"
New-Item -ItemType Directory -Path $runDir -Force | Out-Null

$windowTitle = "GameBar External HWND Probe $timestamp"
$windowScript = Join-Path $scriptDir 'start-probe-window.ps1'
$probeScript = Join-Path $scriptDir 'probe_windowmanager_external_hwnd_frida.py'

try {
  Start-Process 'ms-gamebar:'
  Start-Sleep -Seconds 2

  $runResults = @()
  $probeWindows = @()

  foreach ($processName in $TargetProcesses) {
    $safeName = [IO.Path]::GetFileNameWithoutExtension($processName).ToLowerInvariant()
    $windowJson = Join-Path $runDir "$safeName-window.json"
    $windowErr = Join-Path $runDir "$safeName-window.stderr.txt"
    $windowArgs = @(
      '-NoProfile',
      '-STA',
      '-ExecutionPolicy', 'Bypass',
      '-File', $windowScript,
      '-OutputPath', $windowJson,
      '-DurationSeconds', "$WindowDurationSeconds",
      '-Title', "$windowTitle $safeName"
    )
    if ($WindowedProbe) {
      $windowArgs += '-Fullscreen:$false'
    }

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
        throw "시험용 HWND 프로세스가 조기 종료되었습니다: $processName ExitCode=$($windowProc.ExitCode) STDERR=$stderr"
      }
      if ((Get-Date) -gt $deadline) {
        $stderr = ''
        if (Test-Path $windowErr) {
          $stderr = Get-Content -Path $windowErr -Raw
        }
        throw "시험용 HWND 정보를 기록하지 못했습니다: $processName STDERR=$stderr"
      }
      Start-Sleep -Milliseconds 200
    }

    $windowInfo = Get-Content -Path $windowJson -Raw | ConvertFrom-Json
    $probeWindows += $windowInfo
    $probeHwnd = [string]$windowInfo.hwnd

    $outputPath = Join-Path $runDir "$safeName.json"

    $command = @(
      'python',
      $probeScript,
      '--process-name', $processName,
      '--hwnd', $probeHwnd,
      '--output', $outputPath,
      '--wait-seconds', $WaitSeconds
    )

    & $command[0] $command[1..($command.Length - 1)]
    if ($LASTEXITCODE -ne 0) {
      throw "$processName probe 실행 실패"
    }

    $result = Get-Content -Path $outputPath -Raw | ConvertFrom-Json
    $windowProc.Refresh()
    $result | Add-Member -NotePropertyName probeWindow -NotePropertyValue $windowInfo
    $result | Add-Member -NotePropertyName probeWindowProcessAliveBeforeCleanup -NotePropertyValue (-not $windowProc.HasExited)
    $runResults += $result

    if ($windowProc -and -not $windowProc.HasExited) {
      Stop-Process -Id $windowProc.Id -Force -ErrorAction SilentlyContinue
    }
  }

  $summaryRuns = @()
  foreach ($item in $runResults) {
    $payload = $item.result
    $summaryRuns += [ordered]@{
      processName = $item.processName
      hwnd = $item.hwnd
      probeWindow = $item.probeWindow
      probeWindowProcessAliveBeforeCleanup = $item.probeWindowProcessAliveBeforeCleanup
      createWindowManagerHr = $payload.factory.createWindowManagerHr
      rawBefore = $payload.rawBefore
      ftBefore = $payload.ftBefore
      showWindowHideHr = $payload.showWindowHideHr
      rawAfterHide = $payload.rawAfterHide
      showWindowShowHr = $payload.showWindowShowHr
      rawAfterShow = $payload.rawAfterShow
      setWindowRegion = $payload.setWindowRegion
      rawAfterSetWindowRegion = $payload.rawAfterSetWindowRegion
      resetWindowRegionHr = $payload.resetWindowRegionHr
      rawAfterResetWindowRegion = $payload.rawAfterResetWindowRegion
      enableClickThroughHr = $payload.enableClickThroughHr
      rawAfterEnableClickThrough = $payload.rawAfterEnableClickThrough
      disableClickThroughHr = $payload.disableClickThroughHr
      rawAfterDisableClickThrough = $payload.rawAfterDisableClickThrough
      setWindowLongTransparentHr = $payload.setWindowLongTransparentHr
      rawAfterSetTransparent = $payload.rawAfterSetTransparent
      restoreWindowLongHr = $payload.restoreWindowLongHr
      rawAfterRestoreExStyle = $payload.rawAfterRestoreExStyle
      ftAfter = $payload.ftAfter
      apiTrace = $payload.apiTrace
      exception = $payload.exception
    }
  }

  $summary = [ordered]@{
    analyzedAt = (Get-Date).ToString('o')
    runDir = $runDir
    windowedProbe = [bool]$WindowedProbe
    probeWindows = $probeWindows
    targetProcesses = $TargetProcesses
    runs = $summaryRuns
  }

  $summaryPath = Join-Path $runDir 'summary.json'
  $summary | ConvertTo-Json -Depth 8 | Set-Content -Path $summaryPath -Encoding UTF8
  Write-Output $summaryPath
}
finally {
  if ($windowProc -and -not $windowProc.HasExited) {
    Stop-Process -Id $windowProc.Id -Force -ErrorAction SilentlyContinue
  }
}
