param(
  [string]$ArtifactsDir = 'C:\Users\esihun\Desktop\workfile\DmNote\docs\artifacts',
  [int]$DurationSeconds = 12
)

$ErrorActionPreference = 'Stop'

function Get-CdbPath {
  return 'C:\Program Files (x86)\Windows Kits\10\Debuggers\x64\cdb.exe'
}

function Start-GameBar {
  try {
    Start-Process 'ms-gamebar:' -ErrorAction Stop | Out-Null
  } catch {
  }
}

function Wait-GameBar {
  param(
    [int]$TimeoutSeconds = 10
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $proc = Get-Process GameBar -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($proc) {
      return $proc
    }

    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)

  throw 'GameBar 프로세스를 찾지 못했습니다.'
}

function New-CdbCommandFile {
  param(
    [string]$Path
  )

  $lines = @(
    'bp GameBar+0xad240 ".echo [GBBROKER] func=EnsureBrokerComObject; r rcx; kb 8; g"',
    'bp GameBar+0xad6a0 ".echo [GBBROKER] func=BrokerShow; r rcx; kb 8; g"',
    'bp GameBar+0xad6f0 ".echo [GBBROKER] func=BrokerHide; r rcx; kb 8; g"',
    'bp GameBar+0x25bb20 ".echo [GBBROKER] func=SetClickThrough; r rcx; r rdx; kb 8; g"',
    'bp GameBar+0x2596b0 ".echo [GBBROKER] func=ResetWindowRectCaller; r rcx; kb 8; g"',
    'bp GameBar+0x25b550 ".echo [GBBROKER] func=GetDisplayMonitorsCaller; r rcx; kb 8; g"',
    'bp GameBar+0x6cfc50 ".echo [GBBROKER] func=UpdateWindowRegionForPinnedOnlyAsync; r rcx; kb 8; g"',
    'bp combase!CoCreateInstance ".echo [GBBROKER] func=combase!CoCreateInstance; r rcx; r r8; r r9; db @rcx L16; db @r9 L16; kb 8; g"',
    'g'
  )

  Set-Content -Path $Path -Value $lines -Encoding ASCII
}

function Start-CdbAttach {
  param(
    [int]$TargetPid,
    [string]$CdbPath,
    [string]$CmdFile,
    [string]$LogFile
  )

  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $CdbPath
  $psi.Arguments = "-p $TargetPid -logo `"$LogFile`" -cf `"$CmdFile`""
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true

  $proc = New-Object System.Diagnostics.Process
  $proc.StartInfo = $psi
  $proc.Start() | Out-Null
  return $proc
}

$cdbPath = Get-CdbPath
New-Item -ItemType Directory -Path $ArtifactsDir -Force | Out-Null

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$runDir = Join-Path $ArtifactsDir "gamebar-running-broker-cdb-$timestamp"
New-Item -ItemType Directory -Path $runDir -Force | Out-Null

$cmdFile = Join-Path $runDir 'gamebar-running-broker-cdb.cmds.txt'
$logFile = Join-Path $runDir 'gamebar-running-broker-cdb.log'
$metaFile = Join-Path $runDir 'gamebar-running-broker-cdb-meta.json'

New-CdbCommandFile -Path $cmdFile

Start-GameBar
Start-Sleep -Seconds 2
$gameBar = Wait-GameBar
$cdb = Start-CdbAttach -TargetPid $gameBar.Id -CdbPath $cdbPath -CmdFile $cmdFile -LogFile $logFile

try {
  Start-Sleep -Seconds 2
  Start-GameBar
  Start-Sleep -Seconds 2
  Start-GameBar
  Start-Sleep -Seconds $DurationSeconds
} finally {
  if (-not $cdb.HasExited) {
    Stop-Process -Id $cdb.Id -Force -ErrorAction SilentlyContinue
  }

  $meta = [pscustomobject]@{
    captured_at = Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz'
    duration_seconds = $DurationSeconds
    cdb_pid = $cdb.Id
    gamebar_pid = $gameBar.Id
    cmd_file = $cmdFile
    log_file = $logFile
  }

  $meta | ConvertTo-Json -Depth 4 | Set-Content -Path $metaFile -Encoding UTF8
}

[pscustomobject]@{
  timestamp = $timestamp
  run_dir = $runDir
  cmd_file = $cmdFile
  log_file = $logFile
  meta_file = $metaFile
}
