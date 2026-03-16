param(
  [string]$ArtifactsDir = 'C:\Users\esihun\Desktop\workfile\DmNote\docs\artifacts',
  [int]$DurationSeconds = 12,
  [switch]$LaunchGameBar
)

$ErrorActionPreference = 'Stop'

function Get-PlmDebugPath {
  return 'C:\Program Files (x86)\Windows Kits\10\Debuggers\x64\plmdebug.exe'
}

function Get-CdbPath {
  return 'C:\Program Files (x86)\Windows Kits\10\Debuggers\x64\cdb.exe'
}

function Get-GameBarPackage {
  $pkg = Get-AppxPackage *XboxGamingOverlay* | Select-Object -First 1
  if (-not $pkg) {
    throw 'Microsoft.XboxGamingOverlay 패키지를 찾지 못했습니다.'
  }

  return $pkg
}

function Invoke-ProcessWithTimeout {
  param(
    [string]$FilePath,
    [string[]]$ArgumentList,
    [int]$TimeoutMs = 15000
  )

  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $FilePath
  $psi.Arguments = [string]::Join(' ', ($ArgumentList | ForEach-Object {
    if ($_ -match '\s') {
      '"' + ($_ -replace '"', '\"') + '"'
    } else {
      $_
    }
  }))
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true

  $proc = New-Object System.Diagnostics.Process
  $proc.StartInfo = $psi
  $proc.Start() | Out-Null

  if (-not $proc.WaitForExit($TimeoutMs)) {
    try {
      $proc.Kill($true)
    } catch {
    }

    return [pscustomobject]@{
      timed_out = $true
      exit_code = $null
      stdout = $proc.StandardOutput.ReadToEnd()
      stderr = $proc.StandardError.ReadToEnd()
    }
  }

  return [pscustomobject]@{
    timed_out = $false
    exit_code = $proc.ExitCode
    stdout = $proc.StandardOutput.ReadToEnd()
    stderr = $proc.StandardError.ReadToEnd()
  }
}

function New-CdbCommandFile {
  param(
    [string]$Path
  )

  $lines = @(
    'sxe -c ".echo [GBLOAD] mod=GameBar.exe; g" ld:GameBar',
    'sxe -c ".echo [GBLOAD] mod=combase.dll; g" ld:combase',
    'sxe -c ".echo [GBLOAD] mod=user32.dll; g" ld:user32',
    'sxe -c ".echo [GBLOAD] mod=dxgi.dll; g" ld:dxgi',
    'sxe -c ".echo [GBLOAD] mod=dcomp.dll; g" ld:dcomp',
    'bu GameBar+0xad240 ".echo [GBBROKER] func=EnsureBrokerComObject; r rcx; kb 8; g"',
    'bu GameBar+0xad6a0 ".echo [GBBROKER] func=BrokerShow; r rcx; kb 8; g"',
    'bu GameBar+0xad6f0 ".echo [GBBROKER] func=BrokerHide; r rcx; kb 8; g"',
    'bu GameBar+0x25bb20 ".echo [GBBROKER] func=SetClickThrough; r rcx; r rdx; kb 8; g"',
    'bu GameBar+0x2596b0 ".echo [GBBROKER] func=ResetWindowRectCaller; r rcx; kb 8; g"',
    'bu GameBar+0x25b550 ".echo [GBBROKER] func=GetDisplayMonitorsCaller; r rcx; kb 8; g"',
    'bu GameBar+0x6cfc50 ".echo [GBBROKER] func=UpdateWindowRegionForPinnedOnlyAsync; r rcx; kb 8; g"',
    'bu combase!CoCreateInstance ".echo [GBBROKER] func=combase!CoCreateInstance; r rcx; r r8; r r9; db @rcx L16; db @r9 L16; kb 8; g"',
    'g'
  )

  Set-Content -Path $Path -Value $lines -Encoding ASCII
}

function Get-CdbProcessSnapshot {
  return Get-CimInstance Win32_Process -Filter "Name = 'cdb.exe'" |
    Select-Object ProcessId, CommandLine
}

function Get-NewCdbProcesses {
  param(
    [object[]]$Before
  )

  $beforeIds = @($Before | ForEach-Object { $_.ProcessId })

  return Get-CimInstance Win32_Process -Filter "Name = 'cdb.exe'" |
    Where-Object { $beforeIds -notcontains $_.ProcessId } |
    Select-Object ProcessId, CommandLine
}

$plmPath = Get-PlmDebugPath
$cdbPath = Get-CdbPath
$pkg = Get-GameBarPackage

New-Item -ItemType Directory -Path $ArtifactsDir -Force | Out-Null

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$runDir = Join-Path $ArtifactsDir "gamebar-broker-cdb-$timestamp"
New-Item -ItemType Directory -Path $runDir -Force | Out-Null

$tempRunDir = Join-Path $env:TEMP "gbbroker-$timestamp"
New-Item -ItemType Directory -Path $tempRunDir -Force | Out-Null

$tempCmdFile = Join-Path $tempRunDir 'c.txt'
$tempLogFile = Join-Path $tempRunDir 'g.log'
$cmdFile = Join-Path $runDir 'gamebar-broker-cdb.cmds.txt'
$logFile = Join-Path $runDir 'gamebar-broker-cdb.log'
$metaFile = Join-Path $runDir 'gamebar-broker-cdb-meta.json'

New-CdbCommandFile -Path $tempCmdFile
Copy-Item $tempCmdFile $cmdFile -Force

$beforeSnapshot = Get-CdbProcessSnapshot

Invoke-ProcessWithTimeout -FilePath $plmPath -ArgumentList @('/forceterminate', $pkg.PackageFullName) | Out-Null

$debugger = '"{0}" -o -logo "{1}" -cf "{2}"' -f $cdbPath, $tempLogFile, $tempCmdFile
Invoke-ProcessWithTimeout -FilePath $plmPath -ArgumentList @('/enableDebug', $pkg.PackageFullName, $debugger) | Out-Null

try {
  Start-Sleep -Seconds 1

  if ($LaunchGameBar) {
    Start-Process 'ms-gamebar:'
  }

  Start-Sleep -Seconds $DurationSeconds
} finally {
  $newCdb = Get-NewCdbProcesses -Before $beforeSnapshot

  foreach ($proc in $newCdb) {
    Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
  }

  Start-Sleep -Milliseconds 750

  Get-Process GameBar,GameBarFTServer -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue

  Start-Sleep -Milliseconds 750

  try {
    Invoke-ProcessWithTimeout -FilePath $plmPath -ArgumentList @('/disableDebug', $pkg.PackageFullName) | Out-Null
  } catch {
  }

  if (Test-Path $tempLogFile) {
    Copy-Item $tempLogFile $logFile -Force
  }

  $meta = [pscustomobject]@{
    captured_at = Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz'
    package_full_name = $pkg.PackageFullName
    duration_seconds = $DurationSeconds
    launch_gamebar = [bool]$LaunchGameBar
    debugger = $debugger
    temp_run_dir = $tempRunDir
    temp_cmd_file = $tempCmdFile
    temp_log_file = $tempLogFile
    cmd_file = $cmdFile
    log_file = $logFile
    cdb_processes = @($newCdb)
  }

  $meta | ConvertTo-Json -Depth 6 | Set-Content -Path $metaFile -Encoding UTF8
}

[pscustomobject]@{
  timestamp = $timestamp
  run_dir = $runDir
  cmd_file = $cmdFile
  log_file = $logFile
  meta_file = $metaFile
}
