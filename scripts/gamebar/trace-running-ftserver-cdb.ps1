param(
  [string]$ArtifactsDir = 'C:\Users\esihun\Desktop\workfile\DmNote\docs\artifacts',
  [int]$DurationSeconds = 10,
  [switch]$LaunchGameBar,
  [switch]$LaunchFullscreenProbe,
  [switch]$LaunchProbeBeforeGameBar,
  [int]$ProbeDurationSeconds = 4
)

$ErrorActionPreference = 'Stop'

function Invoke-Proc {
  param(
    [string]$FilePath,
    [string[]]$ArgumentList,
    [int]$TimeoutMs = 15000
  )

  $escapedArgs = @(
    $ArgumentList |
      Where-Object { $null -ne $_ } |
      ForEach-Object {
        if ($_ -match '[\s"]') {
          '"' + ($_.Replace('"', '\"')) + '"'
        } else {
          $_
        }
      }
  )

  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $FilePath
  $psi.Arguments = [string]::Join(' ', $escapedArgs)
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true

  $proc = [System.Diagnostics.Process]::new()
  $proc.StartInfo = $psi
  [void]$proc.Start()

  if (-not $proc.WaitForExit($TimeoutMs)) {
    try {
      $proc.Kill($true)
    } catch {
    }
  }

  [pscustomobject]@{
    exit_code = if ($proc.HasExited) { $proc.ExitCode } else { $null }
    stdout = $proc.StandardOutput.ReadToEnd()
    stderr = $proc.StandardError.ReadToEnd()
  }
}

function Wait-ForProcessByName {
  param(
    [string]$Name,
    [int]$TimeoutSeconds = 8
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $proc = Get-Process -Name $Name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($proc) {
      return $proc
    }

    Start-Sleep -Milliseconds 200
  }

  return $null
}

$cdb = 'C:\Program Files (x86)\Windows Kits\10\Debuggers\x64\cdb.exe'
$probeScript = Join-Path $PSScriptRoot 'start-fullscreen-probe.ps1'

New-Item -ItemType Directory -Path $ArtifactsDir -Force | Out-Null

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$runDir = Join-Path $ArtifactsDir "gamebar-running-ftserver-cdb-$timestamp"
$tmpDir = Join-Path $env:TEMP "gbrftcdb-$timestamp"

New-Item -ItemType Directory -Path $runDir -Force | Out-Null
New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null

$cmdFile = Join-Path $tmpDir 'c.txt'
$logFile = Join-Path $tmpDir 'g.log'
$finalLog = Join-Path $runDir 'gamebar-running-ftserver-cdb.log'
$metaFile = Join-Path $runDir 'gamebar-running-ftserver-cdb-meta.json'
$summaryFile = Join-Path $runDir 'gamebar-running-ftserver-cdb-summary.json'

$lines = @(
  '.symfix',
  '.reload /f user32.dll',
  '.reload /f dxgi.dll',
  '.echo [GBTRACE] attached=GameBarFTServer.exe',
  'bu user32!EnumWindows ".echo [GBTRACE] func=user32!EnumWindows; |.; kb 6; g"',
  'bu user32!SetWinEventHook ".echo [GBTRACE] func=user32!SetWinEventHook; |.; r rcx; r rdx; r r8; r r9; dq @rsp L6; kb 6; g"',
  'bu user32!GetForegroundWindow ".echo [GBTRACE] func=user32!GetForegroundWindow; |.; kb 6; g"',
  'bu user32!GetWindowThreadProcessId ".echo [GBTRACE] func=user32!GetWindowThreadProcessId; |.; r rcx; r rdx; kb 6; g"',
  'bu user32!GetWindowRect ".echo [GBTRACE] func=user32!GetWindowRect; |.; r rcx; r rdx; kb 6; g"',
  'bu user32!MonitorFromWindow ".echo [GBTRACE] func=user32!MonitorFromWindow; |.; r rcx; r rdx; kb 6; g"',
  'bu user32!GetMonitorInfoW ".echo [GBTRACE] func=user32!GetMonitorInfoW; |.; r rcx; r rdx; kb 6; g"',
  'bu user32!QueryDisplayConfig ".echo [GBTRACE] func=user32!QueryDisplayConfig; |.; r rcx; r rdx; r r8; r r9; dq @rsp L6; kb 6; g"',
  'bu user32!SetWindowRgn ".echo [GBTRACE] func=user32!SetWindowRgn; |.; r rcx; r rdx; r r8; kb 6; g"',
  'bu user32!SetWindowLongPtrW ".echo [GBTRACE] func=user32!SetWindowLongPtrW; |.; r rcx; r rdx; r r8; kb 6; g"',
  'bu dxgi!CreateDXGIFactory1 ".echo [GBTRACE] func=dxgi!CreateDXGIFactory1; |.; r rcx; r rdx; kb 6; g"',
  'bu dxgi!CreateDXGIFactory2 ".echo [GBTRACE] func=dxgi!CreateDXGIFactory2; |.; r rcx; r rdx; r r8; kb 6; g"',
  'g'
)
Set-Content -Path $cmdFile -Value $lines -Encoding ASCII
Copy-Item $cmdFile (Join-Path $runDir 'gamebar-running-ftserver-cdb.cmds.txt') -Force

if ($LaunchProbeBeforeGameBar -and $LaunchFullscreenProbe) {
  $probeProc = Start-Process powershell.exe -ArgumentList @(
    '-STA',
    '-ExecutionPolicy', 'Bypass',
    '-File', $probeScript,
    '-DurationSeconds', $ProbeDurationSeconds,
    '-Title', 'GameBar FTServer Probe'
  ) -PassThru -WindowStyle Hidden

  Start-Sleep -Seconds 1
}

if ($LaunchGameBar) {
  Get-Process GameBar,GameBarFTServer -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 500
  Start-Process explorer.exe -ArgumentList 'ms-gamebar:' | Out-Null
}

$ftServer = Wait-ForProcessByName -Name 'GameBarFTServer' -TimeoutSeconds 10
if (-not $ftServer) {
  throw 'GameBarFTServer.exe 프로세스를 찾지 못했습니다.'
}

$escapedCdb = '"' + $cdb + '"'
$escapedLog = '"' + $logFile + '"'
$escapedCmd = '"' + $cmdFile + '"'
$startArgs = "/c start `"`" /min $escapedCdb -p $($ftServer.Id) -logo $escapedLog -cf $escapedCmd"
$cmdProc = Start-Process cmd.exe -ArgumentList $startArgs -PassThru -WindowStyle Hidden

$cdbProc = Wait-ForProcessByName -Name 'cdb' -TimeoutSeconds 6
if (-not $cdbProc) {
  throw 'cdb attach 프로세스를 찾지 못했습니다.'
}

$stimuli = New-Object System.Collections.Generic.List[object]

try {
  Start-Sleep -Seconds 2

  if ($LaunchFullscreenProbe -and -not $LaunchProbeBeforeGameBar) {
    $probeProc = Start-Process powershell.exe -ArgumentList @(
      '-STA',
      '-ExecutionPolicy', 'Bypass',
      '-File', $probeScript,
      '-DurationSeconds', $ProbeDurationSeconds,
      '-Title', 'GameBar FTServer Probe'
    ) -PassThru

    $stimuli.Add([pscustomobject]@{
      kind = 'fullscreen_probe'
      pid = $probeProc.Id
      duration_seconds = $ProbeDurationSeconds
    }) | Out-Null

    Start-Sleep -Seconds ([Math]::Max(2, $ProbeDurationSeconds))
  }

  Start-Sleep -Seconds $DurationSeconds
} finally {
  Get-Process -Id $cdbProc.Id -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue

  Start-Sleep -Milliseconds 750

  if (Test-Path $logFile) {
    Copy-Item $logFile $finalLog -Force
  }

  $summaryProc = Start-Process powershell.exe -ArgumentList @(
    '-ExecutionPolicy', 'Bypass',
    '-File', (Join-Path $PSScriptRoot 'summarize-gamebar-cdb.ps1'),
    '-LogPath', $finalLog,
    '-OutputPath', $summaryFile
  ) -Wait -PassThru -WindowStyle Hidden

  $meta = [ordered]@{
    captured_at = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')
    ftserver_pid = [int]$ftServer.Id
    launch_gamebar = [bool]$LaunchGameBar
    launch_fullscreen_probe = [bool]$LaunchFullscreenProbe
    launch_probe_before_gamebar = [bool]$LaunchProbeBeforeGameBar
    probe_duration_seconds = [int]$ProbeDurationSeconds
    attach_duration_seconds = [int]$DurationSeconds
    log_file = [string]$finalLog
    cmd_file = [string](Join-Path $runDir 'gamebar-running-ftserver-cdb.cmds.txt')
    summary_file = [string]$summaryFile
    summarize_exit_code = [int]$summaryProc.ExitCode
    stimuli = @($stimuli.ToArray())
  }

  $meta | ConvertTo-Json -Depth 6 | Set-Content -Path $metaFile -Encoding UTF8
}

[pscustomobject]@{
  timestamp = $timestamp
  run_dir = $runDir
  log_file = $finalLog
  summary_file = $summaryFile
  meta_file = $metaFile
}
