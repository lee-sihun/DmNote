param(
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

function Get-DumpbinPath {
  $cmd = Get-Command dumpbin.exe -ErrorAction SilentlyContinue
  if ($cmd) {
    return $cmd.Source
  }

  $fallback = Get-ChildItem 'C:\Program Files*\Microsoft Visual Studio' -Recurse -Filter dumpbin.exe -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName

  return $fallback
}

function Get-StringsPath {
  $candidates = @(
    'C:\Users\esihun\Downloads\SysinternalsSuite\strings64.exe',
    'C:\Users\esihun\Desktop\tools\sysinternals\ProcessExplorer_extracted\strings64.exe',
    'C:\Users\esihun\Desktop\tools\sysinternals\Procmon_extracted\strings64.exe'
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  $cmd = Get-Command strings64.exe -ErrorAction SilentlyContinue
  if ($cmd) {
    return $cmd.Source
  }

  return $null
}

function Get-FilteredDumpbinText {
  param(
    [string]$TargetPath,
    [string]$Mode,
    [string[]]$Patterns,
    [string]$DumpbinPath
  )

  if (-not $DumpbinPath -or -not (Test-Path $TargetPath)) {
    return @()
  }

  $lines = & $DumpbinPath $Mode $TargetPath 2>$null
  if (-not $lines) {
    return @()
  }

  return $lines | Select-String ($Patterns -join '|') | ForEach-Object { $_.Line.Trim() }
}

function Get-FilteredStrings {
  param(
    [string]$TargetPath,
    [string[]]$Patterns,
    [string]$StringsPath
  )

  if (-not $StringsPath -or -not (Test-Path $TargetPath)) {
    return @()
  }

  $lines = & $StringsPath -accepteula -nobanner $TargetPath 2>$null
  if (-not $lines) {
    return @()
  }

  return $lines | Select-String ($Patterns -join '|') | ForEach-Object { $_.Line.Trim() } | Select-Object -Unique
}

function Get-FilteredModules {
  param(
    [string]$ProcessName
  )

  try {
    return Get-Process -Name $ProcessName -Module -ErrorAction Stop |
      Select-Object ModuleName, FileName |
      Where-Object { $_.ModuleName -match 'dxgi|dwm|dcomp|user32|combase|uxtheme' } |
      Sort-Object ModuleName
  } catch {
    return @()
  }
}

function Get-LatestFtServerLog {
  $diagDir = 'C:\Users\esihun\AppData\Local\Packages\Microsoft.XboxGamingOverlay_8wekyb3d8bbwe\LocalState\DiagOutputDir'
  if (-not (Test-Path $diagDir)) {
    return $null
  }

  return Get-ChildItem $diagDir -Filter 'XboxGamingOverlayTraces_FT_Server_*.txt' |
    Where-Object { $_.Length -gt 0 } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
}

function Get-RecentDiagFiles {
  $diagDir = 'C:\Users\esihun\AppData\Local\Packages\Microsoft.XboxGamingOverlay_8wekyb3d8bbwe\LocalState\DiagOutputDir'
  if (-not (Test-Path $diagDir)) {
    return @()
  }

  return Get-ChildItem $diagDir |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 10 Name, Length, LastWriteTime
}

function Get-LogPatternSamples {
  param(
    [string]$LogPath,
    [string[]]$Patterns,
    [int]$MaxLines = 80
  )

  if (-not $LogPath -or -not (Test-Path $LogPath)) {
    return @()
  }

  return Select-String -Path $LogPath -Pattern ($Patterns -join '|') |
    Select-Object -First $MaxLines |
    ForEach-Object { $_.Line }
}

function Get-TopLevelWindows {
  param(
    [hashtable]$PidToName
  )

  $typeName = 'GameBarWindowProbe'
  if (-not ([System.Management.Automation.PSTypeName]$typeName).Type) {
    $typeDef = @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class GameBarWindowProbe {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool GetWindowBand(IntPtr hWnd, out uint pdwBand);
}
'@
    Add-Type -TypeDefinition $typeDef
  }

  $rows = New-Object System.Collections.Generic.List[object]
  $targetPids = @($PidToName.Keys)

  $callback = [GameBarWindowProbe+EnumWindowsProc]{
    param($hWnd, $lParam)

    [uint32]$procId = 0
    [void][GameBarWindowProbe]::GetWindowThreadProcessId($hWnd, [ref]$procId)

    if ($targetPids -contains [int]$procId) {
      $classSb = New-Object System.Text.StringBuilder 512
      $textSb = New-Object System.Text.StringBuilder 512
      [void][GameBarWindowProbe]::GetClassName($hWnd, $classSb, $classSb.Capacity)
      [void][GameBarWindowProbe]::GetWindowText($hWnd, $textSb, $textSb.Capacity)

      [uint32]$band = 0
      $bandOk = [GameBarWindowProbe]::GetWindowBand($hWnd, [ref]$band)

      $rows.Add([pscustomobject]@{
        hwnd = ('0x{0:X}' -f $hWnd.ToInt64())
        pid = [int]$procId
        process_name = $PidToName[[int]$procId]
        visible = [GameBarWindowProbe]::IsWindowVisible($hWnd)
        band_known = $bandOk
        band = if ($bandOk) { $band } else { $null }
        class_name = $classSb.ToString()
        title = $textSb.ToString()
      }) | Out-Null
    }

    return $true
  }

  [GameBarWindowProbe]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
  return $rows
}

$pkg = Get-AppxPackage *XboxGamingOverlay* | Select-Object -First 1
if (-not $pkg) {
  throw 'Microsoft.XboxGamingOverlay 패키지를 찾지 못했습니다.'
}

$manifestPath = Join-Path $pkg.InstallLocation 'AppxManifest.xml'
[xml]$manifest = Get-Content $manifestPath
$ns = New-Object System.Xml.XmlNamespaceManager($manifest.NameTable)
$ns.AddNamespace('m', $manifest.DocumentElement.NamespaceURI)
$ns.AddNamespace('uap', 'http://schemas.microsoft.com/appx/manifest/uap/windows10')
$ns.AddNamespace('uap3', 'http://schemas.microsoft.com/appx/manifest/uap/windows10/3')
$ns.AddNamespace('desktop', 'http://schemas.microsoft.com/appx/manifest/desktop/windows10')
$ns.AddNamespace('com', 'http://schemas.microsoft.com/appx/manifest/com/windows10')
$ns.AddNamespace('rescap', 'http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities')

$wmiProcesses = Get-CimInstance Win32_Process | Group-Object ProcessId -AsHashTable -AsString
$allByPid = Get-CimInstance Win32_Process | Group-Object ProcessId -AsHashTable -AsString

$processes = Get-Process | Where-Object { $_.ProcessName -match 'GameBar|Xbox|Widget' } |
  Sort-Object ProcessName |
  ForEach-Object {
    $wmi = $wmiProcesses[[string]$_.Id]
    $parent = if ($wmi -and $allByPid.ContainsKey([string]$wmi.ParentProcessId)) { $allByPid[[string]$wmi.ParentProcessId] } else { $null }

    [pscustomobject]@{
      ProcessName = $_.ProcessName
      Id = $_.Id
      ParentProcessId = if ($wmi) { $wmi.ParentProcessId } else { $null }
      ParentProcessName = if ($parent) { $parent.Name } else { $null }
      MainWindowTitle = $_.MainWindowTitle
      Path = $_.Path
      CommandLine = if ($wmi) { $wmi.CommandLine } else { $null }
    }
  }

$pidToName = @{}
foreach ($proc in $processes) {
  $pidToName[$proc.Id] = $proc.ProcessName
}

$dumpbinPath = Get-DumpbinPath
$stringsPath = Get-StringsPath
$gameBarExe = Join-Path $pkg.InstallLocation 'GameBar.exe'
$ftServerExe = Join-Path $pkg.InstallLocation 'GameBarFTServer.exe'
$latestFtLog = Get-LatestFtServerLog

$result = [ordered]@{
  collected_at = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz')
  package = [ordered]@{
    name = $pkg.Name
    package_full_name = $pkg.PackageFullName
    install_location = $pkg.InstallLocation
    manifest_path = $manifestPath
    app_execution_alias = $manifest.SelectNodes("//uap3:Extension[@Category='windows.appExecutionAlias']/uap3:AppExecutionAlias/desktop:ExecutionAlias", $ns) | ForEach-Object { $_.Alias }
    app_extension_host = $manifest.SelectNodes("//uap3:Extension[@Category='windows.appExtensionHost']/uap3:AppExtensionHost/uap3:Name", $ns) | ForEach-Object { $_.'#text' }
    protocols = $manifest.SelectNodes("//uap:Extension[@Category='windows.protocol']/uap:Protocol", $ns) | ForEach-Object { $_.Name }
    com_server = $manifest.SelectNodes("//com:Extension[@Category='windows.comServer']/com:ComServer/com:ExeServer", $ns) | ForEach-Object { $_.Executable }
    restricted_capabilities = $manifest.SelectNodes('//rescap:Capability', $ns) | ForEach-Object { $_.Name }
  }
  relevant_processes = $processes
  top_level_windows = Get-TopLevelWindows -PidToName $pidToName
  modules = [ordered]@{
    GameBar = Get-FilteredModules -ProcessName 'GameBar'
    GameBarFTServer = Get-FilteredModules -ProcessName 'GameBarFTServer'
    Widgets = Get-FilteredModules -ProcessName 'Widgets'
  }
  exports = [ordered]@{
    user32 = Get-FilteredDumpbinText -TargetPath 'C:\Windows\System32\user32.dll' -Mode '/exports' -Patterns @(
      'CreateWindowInBand',
      'CreateWindowInBandEx',
      'SetWindowBand',
      'GetWindowBand'
    ) -DumpbinPath $dumpbinPath
    dwmapi = Get-FilteredDumpbinText -TargetPath 'C:\Windows\System32\dwmapi.dll' -Mode '/exports' -Patterns @(
      'DwmEnableComposition',
      'DwmGetCompositionTimingInfo',
      'DwmIsCompositionEnabled',
      'DwmpDxGetWindowSharedSurface',
      'DwmpDxUpdateWindowSharedSurface',
      'DwmpDxgiIsThreadDesktopComposited'
    ) -DumpbinPath $dumpbinPath
  }
  imports = [ordered]@{
    GameBar = Get-FilteredDumpbinText -TargetPath $gameBarExe -Mode '/imports' -Patterns @(
      'GetProcAddress',
      'LoadLibrary',
      'LoadPackagedLibrary',
      'RoGetActivationFactory',
      'WindowsCreateString',
      'CreateDXGIFactory',
      'CreateWindowInBand',
      'SetWindowBand',
      'GetWindowBand',
      'DComposition',
      'dcomp',
      'dwmapi',
      'dxgi'
    ) -DumpbinPath $dumpbinPath
    GameBarFTServer = Get-FilteredDumpbinText -TargetPath $ftServerExe -Mode '/imports' -Patterns @(
      'GetProcAddress',
      'LoadLibrary',
      'LoadPackagedLibrary',
      'RoGetActivationFactory',
      'WindowsCreateString',
      'CreateDXGIFactory',
      'CreateWindowInBand',
      'SetWindowBand',
      'GetWindowBand',
      'DComposition',
      'dcomp',
      'dwmapi',
      'dxgi'
    ) -DumpbinPath $dumpbinPath
  }
  strings = [ordered]@{
    GameBar = Get-FilteredStrings -TargetPath $gameBarExe -Patterns @(
      'GameBarUIExtension',
      'gameBarUIExtension',
      'GameBarWidgetHost',
      'DXGI',
      'Composition'
    ) -StringsPath $stringsPath
    GameBarFTServer = Get-FilteredStrings -TargetPath $ftServerExe -Patterns @(
      'DXGI',
      'SwapChain',
      'DwmProcessID',
      'IsProcessFse',
      'Composition'
    ) -StringsPath $stringsPath
  }
  etw_providers = [ordered]@{
    gamebar = @(Get-WinEvent -ListProvider *GameBar* -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name)
    xbox = @(Get-WinEvent -ListProvider *Xbox* -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name)
    dwm = @(Get-WinEvent -ListProvider *Dwm* -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name)
    composition = @(Get-WinEvent -ListProvider *Composition* -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name)
  }
  diagnostics = [ordered]@{
    recent_files = Get-RecentDiagFiles
    latest_ft_server_log = if ($latestFtLog) { $latestFtLog.FullName } else { $null }
    latest_ft_server_log_samples = if ($latestFtLog) {
      Get-LogPatternSamples -LogPath $latestFtLog.FullName -Patterns @(
        'CaptureCurrentTarget',
        'GetFocusedHwnd',
        'RegisterFullscreenCheckTimer',
        'IsProcessFse',
        'IsWindowFullscreenOnMonitor',
        'UpdateAllTargetData',
        'UpdateIsFullscreenTargetData',
        'InputFocusInfo',
        'OnWinEvent'
      )
    } else {
      @()
    }
  }
}

$json = $result | ConvertTo-Json -Depth 8

if ($OutputPath) {
  $parent = Split-Path $OutputPath -Parent
  if ($parent -and -not (Test-Path $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }
  Set-Content -Path $OutputPath -Value $json -Encoding UTF8
}

$json
