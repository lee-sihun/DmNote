param(
  [string]$PackageName = 'Microsoft.XboxGamingOverlay',
  [string]$RzBinPath = 'C:\Users\esihun\Desktop\tools\research\rizin\rizin-win-installer-vs2019_static-64\bin\rz-bin.exe',
  [string]$RizinPath = 'C:\Users\esihun\Desktop\tools\research\rizin\rizin-win-installer-vs2019_static-64\bin\rizin.exe',
  [string]$PrivateIdlPath = 'C:\Users\esihun\Desktop\workfile\DmNote\docs\artifacts\winmdidl\Microsoft.Gaming.XboxGameBar.Private.idl',
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $RzBinPath)) {
  throw "rz-bin.exe를 찾지 못했습니다: $RzBinPath"
}

if (-not (Test-Path $RizinPath)) {
  throw "rizin.exe를 찾지 못했습니다: $RizinPath"
}

if (-not (Test-Path $PrivateIdlPath)) {
  throw "Private idl을 찾지 못했습니다: $PrivateIdlPath"
}

$pkg = Get-AppxPackage $PackageName | Select-Object -First 1
if (-not $pkg) {
  throw "패키지를 찾지 못했습니다: $PackageName"
}

$binaryPath = Join-Path $pkg.InstallLocation 'GameBar.exe'
if (-not (Test-Path $binaryPath)) {
  throw "GameBar.exe를 찾지 못했습니다: $binaryPath"
}

function Invoke-RizinText {
  param(
    [string[]]$Commands
  )

  $joined = ($Commands -join '; ')
  & $RizinPath -A -q -e scr.color=0 -c $joined $binaryPath
}

function Invoke-RizinSections {
  param(
    [System.Collections.Specialized.OrderedDictionary]$Sections
  )

  $commands = @()
  foreach ($entry in $Sections.GetEnumerator()) {
    $commands += "echo __SECTION__:$($entry.Key)"
    $commands += $entry.Value
  }

  $lines = Invoke-RizinText -Commands $commands
  $result = [ordered]@{}
  $current = $null

  foreach ($line in $lines) {
    if ($line -match '^__SECTION__:(.+)$') {
      $current = $matches[1]
      $result[$current] = @()
      continue
    }

    if ($null -ne $current) {
      $result[$current] += $line
    }
  }

  $result
}

function Get-StringEntry {
  param(
    [object[]]$Strings,
    [string]$Pattern
  )

  $Strings |
    Where-Object { $_.string -match $Pattern } |
    Select-Object -First 1 vaddr, paddr, length, size, string
}

function Get-XrefsForString {
  param(
    [object]$StringEntry
  )

  if (-not $StringEntry) {
    return @()
  }

  $lines = Invoke-RizinText -Commands @(
    "axt @ $($StringEntry.vaddr)"
  )

  @(
    $lines |
      ForEach-Object { $_.Trim() } |
      Where-Object { $_ }
  )
}

function Get-FunctionSymbolFromXrefLines {
  param(
    [string[]]$XrefLines
  )

  foreach ($line in $XrefLines) {
    if ($line -match '^(?<symbol>[^\s]+)\s+(?<xref>0x[0-9A-Fa-f]+)\s') {
      $symbol = $matches.symbol
      if ($symbol -like 'fcn.*' -or $symbol -like 'sub.*') {
        return $symbol
      }
    }
  }

  $null
}

function Get-DisasmSnippetFromXrefLines {
  param(
    [string[]]$XrefLines,
    [int]$Before = 16,
    [int]$Count = 48
  )

  foreach ($line in $XrefLines) {
    if ($line -match '^(?<symbol>[^\s]+)\s+(?<xref>0x[0-9A-Fa-f]+)\s') {
      $xref = [UInt64]::Parse($matches.xref.Substring(2), [System.Globalization.NumberStyles]::HexNumber)
      $start = if ($xref -gt [uint64]$Before) { $xref - [uint64]$Before } else { $xref }
      $snippet = Invoke-RizinText -Commands @(
        "pd $Count @ 0x{0:X}" -f $start
      )

      return @(
        $snippet |
          ForEach-Object { $_.TrimEnd() }
      )
    }
  }

  @()
}

function Get-InterfaceMethods {
  param(
    [string]$IdlText,
    [string]$InterfaceName
  )

  $escapedName = [regex]::Escape($InterfaceName)
  $match = [regex]::Match(
    $IdlText,
    "(?s)interface\s+$escapedName\s*:\s*IInspectable\s*\{(?<body>.*?)\}"
  )

  if (-not $match.Success) {
    return @()
  }

  @(
    [regex]::Matches($match.Groups['body'].Value, 'HRESULT\s+(?<name>[A-Za-z0-9_]+)') |
      ForEach-Object { $_.Groups['name'].Value } |
      Select-Object -Unique
  )
}

$strings = (& $RzBinPath -z -N 8:260 -j $binaryPath | ConvertFrom-Json).strings
$idlText = Get-Content -Path $PrivateIdlPath -Raw

$interestingStrings = [ordered]@{
  windows_gamebar_ui_extension = Get-StringEntry -Strings $strings -Pattern '^Windows\.GameBarUIExtension$'
  widget_control_host = Get-StringEntry -Strings $strings -Pattern 'GameBar\.WidgetControlHost'
  cui_widget_adapter_runtime = Get-StringEntry -Strings $strings -Pattern '^GameBar\.CuiWidgetAdapter$'
  cui_widget_adapter_cpp = Get-StringEntry -Strings $strings -Pattern 'CuiWidgetAdapter\.cpp$'
  activate_widget_async = Get-StringEntry -Strings $strings -Pattern 'CuiWidgetAdapter::ActivateWidgetAsync$'
  launch_async_contract_call = Get-StringEntry -Strings $strings -Pattern 'Calling LaunchAsyncByContractWithArgsAsUser'
  launch_async_contract_done = Get-StringEntry -Strings $strings -Pattern 'LaunchAsyncByContractWithArgsAsUser completed'
  contract_not_supported = Get-StringEntry -Strings $strings -Pattern 'Contract not supported'
  acquire_ham_dependency = Get-StringEntry -Strings $strings -Pattern 'AcquireHamDependency'
  webview2_support_required = Get-StringEntry -Strings $strings -Pattern '^WebView2SupportRequired$'
  widget_private_timeout = Get-StringEntry -Strings $strings -Pattern 'Widget private not set before timeout'
  attach_visual_to_element = Get-StringEntry -Strings $strings -Pattern 'AttachVisualToElement called'
  set_element_child_visual_failed = Get-StringEntry -Strings $strings -Pattern 'SetElementChildVisual failed'
  launch_uri_input_data = Get-StringEntry -Strings $strings -Pattern 'routing to system launcher with options and inputData'
  click_through_changed = Get-StringEntry -Strings $strings -Pattern 'ClickThroughChangedHandler$'
  input_delegated = Get-StringEntry -Strings $strings -Pattern 'InputDelegated$'
}

$xrefTargets = [ordered]@{
  windows_gamebar_ui_extension = $interestingStrings.windows_gamebar_ui_extension
  launch_async_contract_call = $interestingStrings.launch_async_contract_call
  contract_not_supported = $interestingStrings.contract_not_supported
  cui_widget_adapter_runtime = $interestingStrings.cui_widget_adapter_runtime
}

$xrefSections = [ordered]@{}
foreach ($key in $xrefTargets.Keys) {
  if ($xrefTargets[$key]) {
    $xrefSections[$key] = "axt @ $($xrefTargets[$key].vaddr)"
  }
}

$xrefs = [ordered]@{}
$xrefOutputs = Invoke-RizinSections -Sections $xrefSections
foreach ($key in $xrefTargets.Keys) {
  $xrefs[$key] = @(
    ($xrefOutputs[$key] | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  )
}

$loadWidgetFunctionSymbol = Get-FunctionSymbolFromXrefLines -XrefLines $xrefs.launch_async_contract_call

$snippetSections = [ordered]@{}
if ($loadWidgetFunctionSymbol) {
  $snippetSections.load_widget_function = "afij @ $loadWidgetFunctionSymbol"
}

foreach ($pair in @(
  @{ name = 'contract_launch'; lines = $xrefs.launch_async_contract_call; before = 24; count = 64 },
  @{ name = 'contract_not_supported'; lines = $xrefs.contract_not_supported; before = 24; count = 64 },
  @{ name = 'cui_widget_adapter_registration'; lines = $xrefs.cui_widget_adapter_runtime; before = 16; count = 40 }
)) {
  foreach ($line in $pair.lines) {
    if ($line -match '^(?<symbol>[^\s]+)\s+(?<xref>0x[0-9A-Fa-f]+)\s') {
      $xref = [UInt64]::Parse($matches.xref.Substring(2), [System.Globalization.NumberStyles]::HexNumber)
      $start = if ($xref -gt [uint64]$pair.before) { $xref - [uint64]$pair.before } else { $xref }
      $snippetSections[$pair.name] = "pd $($pair.count) @ 0x{0:X}" -f $start
      break
    }
  }
}

$snippetOutputs = Invoke-RizinSections -Sections $snippetSections

$loadWidgetFunctionInfo = if ($snippetOutputs.load_widget_function) {
  try {
    ($snippetOutputs.load_widget_function -join [Environment]::NewLine) | ConvertFrom-Json | Select-Object -First 1
  } catch {
    $null
  }
} else {
  $null
}

$registrationSnippet = @($snippetOutputs.cui_widget_adapter_registration | ForEach-Object { $_.TrimEnd() })
$contractCallSnippet = @($snippetOutputs.contract_launch | ForEach-Object { $_.TrimEnd() })
$contractUnsupportedSnippet = @($snippetOutputs.contract_not_supported | ForEach-Object { $_.TrimEnd() })

$implementedHostVersions = @(
  $strings |
    Where-Object { $_.string -match 'UIXboxGameBarWidgetHost(?<version>\d*)@Private@XboxGameBar@Gaming@Microsoft' } |
    ForEach-Object {
      if ($_.string -match 'UIXboxGameBarWidgetHost(?<version>\d*)@Private@XboxGameBar@Gaming@Microsoft') {
        if ([string]::IsNullOrEmpty($matches.version)) {
          '1'
        } else {
          $matches.version
        }
      }
    } |
    Sort-Object -Unique
)

$interfaces = [ordered]@{}
foreach ($name in @(
  'IXboxGameBarWidgetControlHost',
  'IXboxGameBarWidgetHost',
  'IXboxGameBarWidgetHost5',
  'IXboxGameBarWidgetHost6',
  'IXboxGameBarWidgetHost8',
  'IXboxGameBarWidgetHost9',
  'IXboxGameBarWidgetPrivate',
  'IXboxGameBarWidgetPrivate2',
  'IXboxGameBarWidgetPrivate3',
  'IXboxGameBarWidgetPrivate4',
  'IXboxGameBarWidgetPrivate5',
  'IXboxGameBarWidgetPrivate6'
)) {
  $interfaces[$name] = @(Get-InterfaceMethods -IdlText $idlText -InterfaceName $name)
}

$summary = [ordered]@{
  analyzed_at = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz')
  package = $pkg.PackageFullName
  binary_path = $binaryPath
  private_idl_path = $PrivateIdlPath
  implemented_widget_host_versions = $implementedHostVersions
  interesting_strings = $interestingStrings
  xrefs = $xrefs
  load_widget_function = $loadWidgetFunctionInfo
  snippets = [ordered]@{
    contract_launch = $contractCallSnippet
    contract_not_supported = $contractUnsupportedSnippet
    cui_widget_adapter_registration = $registrationSnippet
  }
  idl_interfaces = $interfaces
  assessment = @(
    'CuiWidgetAdapter is directly tied to Windows.GameBarUIExtension, GameBar.WidgetControlHost, and LaunchAsyncByContractWithArgsAsUser strings.',
    'The binary exposes implementation traces for IXboxGameBarWidgetHost versions 1 through 9.',
    'The LoadWidget path groups WebView2, contract launch, AcquireHamDependency, package updating, widget private timeout, and AttachVisualToElement in one pipeline.',
    'Private IDL methods such as LaunchUriAsync2, WaitForCompositionTargetRendered, SetClickThroughEnabled, SetWindowBounds, and SetRequestedOpacity align with the CuiWidgetAdapter string cluster.',
    'Current evidence suggests widget or hosted-view creation remains strongly tied to the packaged app-extension host and private widget host contracts, separate from the externally reachable broker control path.'
  )
}

$json = $summary | ConvertTo-Json -Depth 8

if ($OutputPath) {
  $parent = Split-Path -Path $OutputPath -Parent
  if ($parent -and -not (Test-Path $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }

  Set-Content -Path $OutputPath -Value $json -Encoding UTF8
  $OutputPath
} else {
  $json
}
