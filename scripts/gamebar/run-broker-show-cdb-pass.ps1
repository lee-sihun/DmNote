param(
  [string]$ArtifactsDir = 'C:\Users\esihun\Desktop\workfile\DmNote\docs\artifacts',
  [int]$LaunchWaitSeconds = 3,
  [int]$AttachLeadSeconds = 3,
  [int]$PostTriggerSeconds = 6
)

$ErrorActionPreference = 'Stop'

function Get-CdbPath {
  return 'C:\Program Files (x86)\Windows Kits\10\Debuggers\x64\cdb.exe'
}

function Get-BrokerProbeScript {
  $scriptDir = $PSScriptRoot
  return Join-Path $scriptDir 'probe-gamebar-broker-win32.ps1'
}

function Start-GameBar {
  try {
    Start-Process 'ms-gamebar:' | Out-Null
  } catch {
  }
}

function Wait-ProcessByName {
  param(
    [string]$Name,
    [int]$TimeoutSeconds = 10
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $proc = Get-Process $Name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($proc) {
      return $proc
    }

    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)

  throw "$Name 프로세스를 찾지 못했습니다."
}

function Get-ShellExplorer {
  $withWindow = Get-Process explorer -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 } |
    Select-Object -First 1

  if ($withWindow) {
    return $withWindow
  }

  $fallback = Get-Process explorer -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($fallback) {
    return $fallback
  }

  throw 'explorer.exe 프로세스를 찾지 못했습니다.'
}

function New-CdbCommandFile {
  param(
    [string]$Path,
    [string[]]$Lines
  )

  Set-Content -Path $Path -Value $Lines -Encoding ASCII
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

function Get-MarkerCount {
  param(
    [string]$Path,
    [string]$Marker
  )

  if (-not (Test-Path $Path)) {
    return 0
  }

  return @(
    Select-String -Path $Path -Pattern ([regex]::Escape($Marker)) -SimpleMatch
  ).Count
}

function Get-LogTail {
  param(
    [string]$Path,
    [int]$LineCount = 120
  )

  if (-not (Test-Path $Path)) {
    return @()
  }

  return @(Get-Content -Path $Path -Tail $LineCount)
}

$cdbPath = Get-CdbPath
$brokerScript = Get-BrokerProbeScript

New-Item -ItemType Directory -Path $ArtifactsDir -Force | Out-Null

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$runDir = Join-Path $ArtifactsDir "gamebar-broker-show-cdb-$timestamp"
New-Item -ItemType Directory -Path $runDir -Force | Out-Null

$explorerCmdFile = Join-Path $runDir 'explorer.cmd.txt'
$explorerLogFile = Join-Path $runDir 'explorer.log'
$gameBarCmdFile = Join-Path $runDir 'gamebar.cmd.txt'
$gameBarLogFile = Join-Path $runDir 'gamebar.log'
$summaryPath = Join-Path $runDir 'summary.json'

$explorerCmd = @(
  'bu user32!ShowWindow ".echo [EXP] user32!ShowWindow; r rcx; r rdx; kb 10; g"',
  'bu user32!SetWindowPos ".echo [EXP] user32!SetWindowPos; r rcx; kb 10; g"',
  'bu user32!GetWindowBand ".echo [EXP] user32!GetWindowBand; r rcx; kb 10; g"',
  'bu dcomp!DCompositionCreateSurfaceHandle ".echo [EXP] dcomp!DCompositionCreateSurfaceHandle; kb 10; g"',
  'bu dwmapi!DwmSetWindowAttribute ".echo [EXP] dwmapi!DwmSetWindowAttribute; r rcx; r rdx; kb 10; g"',
  'g'
)

$gameBarCmd = @(
  'bp GameBar+0xad6a0 ".echo [GB] BrokerShow; r rcx; kb 10; g"',
  'bp GameBar+0x6cfc50 ".echo [GB] UpdateWindowRegionForPinnedOnlyAsync; r rcx; kb 10; g"',
  'bp GameBar+0x25bc60 ".echo [GB] SetAppFrameHwnd; r rcx; kb 10; g"',
  'bu user32!GetAncestor ".echo [GB] user32!GetAncestor; r rcx; r rdx; kb 10; g"',
  'bu user32!GetWindowRect ".echo [GB] user32!GetWindowRect; r rcx; kb 10; g"',
  'bu user32!SetWindowLongW ".echo [GB] user32!SetWindowLongW; r rcx; r rdx; kb 10; g"',
  'g'
)

New-CdbCommandFile -Path $explorerCmdFile -Lines $explorerCmd
New-CdbCommandFile -Path $gameBarCmdFile -Lines $gameBarCmd

Start-GameBar
Start-Sleep -Seconds $LaunchWaitSeconds

$gameBar = Wait-ProcessByName -Name 'GameBar'
$explorer = Get-ShellExplorer

$explorerCdb = Start-CdbAttach -TargetPid $explorer.Id -CdbPath $cdbPath -CmdFile $explorerCmdFile -LogFile $explorerLogFile
$gameBarCdb = Start-CdbAttach -TargetPid $gameBar.Id -CdbPath $cdbPath -CmdFile $gameBarCmdFile -LogFile $gameBarLogFile

try {
  Start-Sleep -Seconds $AttachLeadSeconds

  & powershell -NoProfile -ExecutionPolicy Bypass -File $brokerScript -Methods @('show') | Out-Null

  Start-Sleep -Seconds $PostTriggerSeconds
} finally {
  if ($explorerCdb -and -not $explorerCdb.HasExited) {
    Stop-Process -Id $explorerCdb.Id -Force -ErrorAction SilentlyContinue
  }

  if ($gameBarCdb -and -not $gameBarCdb.HasExited) {
    Stop-Process -Id $gameBarCdb.Id -Force -ErrorAction SilentlyContinue
  }

  Start-Sleep -Milliseconds 750
}

$summary = [ordered]@{
  analyzed_at = Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz'
  run_dir = $runDir
  explorer_pid = $explorer.Id
  gamebar_pid = $gameBar.Id
  explorer_log = $explorerLogFile
  gamebar_log = $gameBarLogFile
  marker_counts = [ordered]@{
    explorer = [ordered]@{
      show_window = Get-MarkerCount -Path $explorerLogFile -Marker '[EXP] user32!ShowWindow'
      set_window_pos = Get-MarkerCount -Path $explorerLogFile -Marker '[EXP] user32!SetWindowPos'
      get_window_band = Get-MarkerCount -Path $explorerLogFile -Marker '[EXP] user32!GetWindowBand'
      create_surface_handle = Get-MarkerCount -Path $explorerLogFile -Marker '[EXP] dcomp!DCompositionCreateSurfaceHandle'
      dwm_set_window_attribute = Get-MarkerCount -Path $explorerLogFile -Marker '[EXP] dwmapi!DwmSetWindowAttribute'
    }
    gamebar = [ordered]@{
      broker_show = Get-MarkerCount -Path $gameBarLogFile -Marker '[GB] BrokerShow'
      update_window_region = Get-MarkerCount -Path $gameBarLogFile -Marker '[GB] UpdateWindowRegionForPinnedOnlyAsync'
      set_app_frame_hwnd = Get-MarkerCount -Path $gameBarLogFile -Marker '[GB] SetAppFrameHwnd'
      get_ancestor = Get-MarkerCount -Path $gameBarLogFile -Marker '[GB] user32!GetAncestor'
      get_window_rect = Get-MarkerCount -Path $gameBarLogFile -Marker '[GB] user32!GetWindowRect'
      set_window_long_w = Get-MarkerCount -Path $gameBarLogFile -Marker '[GB] user32!SetWindowLongW'
    }
  }
  tails = [ordered]@{
    explorer = Get-LogTail -Path $explorerLogFile
    gamebar = Get-LogTail -Path $gameBarLogFile
  }
}

$summary | ConvertTo-Json -Depth 8 | Set-Content -Path $summaryPath -Encoding UTF8
Write-Output $summaryPath
