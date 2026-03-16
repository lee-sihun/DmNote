param(
  [string]$OutputDir = 'C:\Users\esihun\Desktop\workfile\DmNote\docs\artifacts\winmdidl',
  [string]$SummaryPath
)

$ErrorActionPreference = 'Stop'

function Get-WinmdidlPath {
  $candidates = @(
    'C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\winmdidl.exe',
    'C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\winmdidl.exe'
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  $cmd = Get-Command winmdidl.exe -ErrorAction SilentlyContinue
  if ($cmd) {
    return $cmd.Source
  }

  throw 'winmdidl.exe를 찾지 못했습니다.'
}

function Get-PatternMatches {
  param(
    [string]$Path,
    [string[]]$Patterns
  )

  if (-not (Test-Path $Path)) {
    return @()
  }

  return Select-String -Path $Path -Pattern ($Patterns -join '|') |
    ForEach-Object {
      [pscustomobject]@{
        line = $_.LineNumber
        text = $_.Line.Trim()
      }
    }
}

$pkg = Get-AppxPackage *XboxGamingOverlay* | Select-Object -First 1
if (-not $pkg) {
  throw 'Microsoft.XboxGamingOverlay 패키지를 찾지 못했습니다.'
}

$winmdidlPath = Get-WinmdidlPath

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

$winmdFiles = @(
  'XboxGameBarFT.winmd',
  'Microsoft.Gaming.XboxGameBar.Private.winmd',
  'Microsoft.Gaming.XboxGameBar.winmd',
  'GameBar.winmd'
)

foreach ($winmdFile in $winmdFiles) {
  $inputPath = Join-Path $pkg.InstallLocation $winmdFile
  if (-not (Test-Path $inputPath)) {
    throw "WinMD를 찾지 못했습니다: $inputPath"
  }

  $stdoutPath = Join-Path $env:TEMP ("winmdidl-{0}.out.txt" -f ([guid]::NewGuid().ToString('N')))
  $stderrPath = Join-Path $env:TEMP ("winmdidl-{0}.err.txt" -f ([guid]::NewGuid().ToString('N')))

  try {
    $argumentLine = "/nologo /utf8 /outdir:`"$OutputDir`" `"$inputPath`""

    $proc = Start-Process `
      -FilePath $winmdidlPath `
      -ArgumentList $argumentLine `
      -Wait `
      -NoNewWindow `
      -PassThru `
      -RedirectStandardOutput $stdoutPath `
      -RedirectStandardError $stderrPath

    if ($proc.ExitCode -ne 0) {
      $stderr = if (Test-Path $stderrPath) { Get-Content $stderrPath -Raw } else { '' }
      throw "winmdidl.exe 실패($($proc.ExitCode)): $stderr"
    }
  } finally {
    Remove-Item $stdoutPath, $stderrPath -ErrorAction SilentlyContinue
  }
}

$ftIdlPath = Join-Path $OutputDir 'XboxGameBarFT.idl'
$privateIdlPath = Join-Path $OutputDir 'Microsoft.Gaming.XboxGameBar.Private.idl'
$publicIdlPath = Join-Path $OutputDir 'Microsoft.Gaming.XboxGameBar.idl'
$gameBarIdlPath = Join-Path $OutputDir 'GameBar.idl'

$summary = [ordered]@{
  collected_at = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz')
  install_location = $pkg.InstallLocation
  winmdidl_path = $winmdidlPath
  outputs = @(
    $ftIdlPath,
    $privateIdlPath,
    $publicIdlPath,
    $gameBarIdlPath
  )
  xbox_gamebar_ft = [ordered]@{
    app_target_info = Get-PatternMatches -Path $ftIdlPath -Patterns @(
      'struct AppTargetInfo',
      'AumId;',
      'DisplayName;',
      'Hwnd;',
      'InputHwnd;',
      'ImageName;',
      'ImageNameFullPath;',
      'IsFse;',
      'IsFullscreen;',
      'IsInputDelegationSupported;',
      'IsPackaged;',
      'ProcessId;',
      'InputProcessId;'
    )
    target_tracking = Get-PatternMatches -Path $ftIdlPath -Patterns @(
      'interface IAppTargetManagerFT',
      'StartTargetTrackerAsync',
      'StopTargetTrackerAsync',
      'RefreshCurrentTargetAsync',
      'TargetChanged',
      'HRESULT Target\('
    )
    factory = Get-PatternMatches -Path $ftIdlPath -Patterns @(
      'interface IGbftFactory',
      'CreateAppTargetManagerFT',
      'CreateWindowManagerFT',
      'CreatePresentMonFpsMonitor',
      'CreateGfxPerfFpsMonitor',
      'CreateThirdPartyLauncherDataProvider',
      'CreateGameConfigStoreFT',
      'CreateInputFocusTrackerFT',
      'CreateWinUserFT',
      'CreateMonitorUtils',
      'CreateRegistryWatcherFT',
      'CreateHamDependencyFT'
    )
    window_manager = Get-PatternMatches -Path $ftIdlPath -Patterns @(
      'interface IWindowManagerFT',
      'EnableClickThrough',
      'DisableClickThrough',
      'GetWindowLong',
      'SetWindowLong',
      'SetWindowRegion',
      'ClearWindowRegion',
      'ShowWindow'
    )
    input_focus = Get-PatternMatches -Path $ftIdlPath -Patterns @(
      'struct InputFocusInfo',
      'EventSource;',
      'interface IInputFocusTrackerFT',
      'StartAsync',
      'StopAsync',
      'GetLatestInputFocusEvent',
      'InputFocusChanged'
    )
    launcher_and_game_config = Get-PatternMatches -Path $ftIdlPath -Patterns @(
      'interface IThirdPartyLauncherDataProvider',
      'GetSteamLauncherInfoAsync',
      'GetEpicProductMapAsync',
      'GetEAGamesAsync',
      'interface IGameConfigStoreFT',
      'AddEntryForHwnd',
      'EntryExistsByUserForHwnd',
      'EntryExistsForHwnd',
      'GetGcsIdForHwnd',
      'RemoveEntryForHwnd'
    )
  }
  private_sdk = [ordered]@{
    widget_host = Get-PatternMatches -Path $privateIdlPath -Patterns @(
      'interface IXboxGameBarWidgetHost',
      'GetGameBarDisplayMode',
      'GetWindowState',
      'GetAppTargetHost',
      'GetWindowBounds',
      'SetGameBarDisplayMode',
      'SetWindowState',
      'WaitForCompositionTargetRendered',
      'SetWindowBounds'
    )
    widget_private = Get-PatternMatches -Path $privateIdlPath -Patterns @(
      'interface IXboxGameBarWidgetPrivate',
      'SetClickThroughEnabled',
      'SetInputDelegation',
      'SetRequestedOpacity',
      'EnableInputDelegation',
      'DisableInputDelegation',
      'SetRequestedTheme',
      'RaiseBackButtonClickedEvent'
    )
  }
  public_sdk = [ordered]@{
    widget = Get-PatternMatches -Path $publicIdlPath -Patterns @(
      'runtimeclass XboxGameBarWidget',
      'interface IXboxGameBarWidget',
      'SuppressedForFullScreenExclusive',
      'GameBarDisplayModeChanged',
      'WindowStateChanged',
      'WindowBoundsChanged',
      'RequestedOpacity',
      'HorizontalResizeSupported',
      'MaxWindowSize',
      'MinWindowSize'
    )
    app_target = Get-PatternMatches -Path $publicIdlPath -Patterns @(
      'runtimeclass XboxGameBarAppTargetTracker',
      'interface IXboxGameBarAppTargetTracker',
      'HRESULT GetTarget',
      'SettingChanged',
      'TargetChanged',
      'CreateInstance'
    )
  }
  gamebar_package = [ordered]@{
    broker = Get-PatternMatches -Path $gameBarIdlPath -Patterns @(
      'GamingOverlayBroker',
      'ResetWindowRegion',
      'SetCombinedWindowRegion',
      'GetDisplayMonitors',
      'ResetWindowRect'
    )
    input_delegation = Get-PatternMatches -Path $gameBarIdlPath -Patterns @(
      'InputDelegationManager',
      'HandleWinGForegroundTargetFseLaunch',
      'FocusGameBarInternalAsync',
      'CheckForTargetWindowInForeground',
      'Command_TakeForegroundDuringOperationAsync',
      'HandleInputDelegated'
    )
    hosted_view = Get-PatternMatches -Path $gameBarIdlPath -Patterns @(
      'HostedView',
      'HostedViewSize',
      'HostedViewPosition',
      'WidgetWindow',
      'GetHostedViewRectForPinning'
    )
    click_through = Get-PatternMatches -Path $gameBarIdlPath -Patterns @(
      'ClickThrough',
      'SetClickThrough',
      'GlobalClickThrough',
      'CuiWidgetAdapter',
      'ClickThroughChangedHandler'
    )
  }
}

$json = $summary | ConvertTo-Json -Depth 8

if ($SummaryPath) {
  $parent = Split-Path $SummaryPath -Parent
  if ($parent -and -not (Test-Path $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }

  Set-Content -Path $SummaryPath -Value $json -Encoding UTF8
}

$json
