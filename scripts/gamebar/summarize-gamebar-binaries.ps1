param(
  [string]$PackageName = 'Microsoft.XboxGamingOverlay',
  [string]$StringsPath = 'C:\Users\esihun\Downloads\SysinternalsSuite\strings64.exe',
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

function Get-DumpbinPath {
  $cmd = Get-Command dumpbin.exe -ErrorAction SilentlyContinue
  if ($cmd) {
    return $cmd.Source
  }

  $candidates = @(
    'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207\bin\Hostx64\x64\dumpbin.exe',
    'C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Tools\MSVC\14.44.35207\bin\Hostx64\x64\dumpbin.exe'
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  throw 'dumpbin.exe를 찾지 못했습니다.'
}

function Invoke-DumpbinImports {
  param(
    [string]$DumpbinPath,
    [string]$BinaryPath
  )

  return @(& $DumpbinPath /nologo /imports $BinaryPath)
}

function Parse-Imports {
  param(
    [string[]]$Lines
  )

  $imports = [ordered]@{}
  $currentDll = $null

  foreach ($line in $Lines) {
    if ($line -match '^\s{4}([A-Za-z0-9._-]+\.dll)$') {
      $currentDll = $matches[1].ToLowerInvariant()
      if (-not $imports.Contains($currentDll)) {
        $imports[$currentDll] = New-Object System.Collections.Generic.List[string]
      }
      continue
    }

    if ($currentDll -and $line -match '^\s+[0-9A-F]+\s+([A-Za-z0-9_@$?]+)$') {
      $imports[$currentDll].Add($matches[1])
      continue
    }

    if ($currentDll -and $line -match '^\s+([A-Za-z0-9_@$?]+)$') {
      $imports[$currentDll].Add($matches[1])
    }
  }

  return $imports
}

function Get-InterestingImports {
  param(
    [hashtable]$Imports
  )

  $interestingDlls = @(
    'user32.dll',
    'dwmapi.dll',
    'dcomp.dll',
    'dxgi.dll',
    'combase.dll',
    'coremessaging.dll',
    'api-ms-win-ntuser-sysparams-l1-1-0.dll'
  )

  return @(
    foreach ($dll in $interestingDlls) {
      if ($Imports.Contains($dll)) {
        [pscustomobject]@{
          dll = $dll
          functions = @($Imports[$dll] | Sort-Object -Unique)
        }
      }
    }
  )
}

function Get-InterestingStrings {
  param(
    [string]$StringsPath,
    [string]$BinaryPath
  )

  if (-not (Test-Path $StringsPath)) {
    throw "strings64.exe를 찾지 못했습니다: $StringsPath"
  }

  $patterns = @(
    'CreateWindowInBand',
    'CreateWindowInBandEx',
    'SetWindowBand',
    'GetWindowBand',
    'DComposition',
    'DirectComposition',
    'SwapChain',
    'Dwm',
    'Fullscreen',
    'FullScreen',
    'IsProcessFse',
    'AppTarget',
    'InputDelegation',
    'ClickThrough',
    'WidgetHost',
    'gameBarUIExtension',
    'WaitForCompositionTargetRendered',
    'SetWindowRegion'
  )

  $regex = ($patterns | ForEach-Object { [regex]::Escape($_) }) -join '|'

  return @(
    & $StringsPath -nobanner -n 5 $BinaryPath |
      Select-String -Pattern $regex |
      Select-Object -First 160 |
      ForEach-Object { $_.Line.Trim() }
  )
}

$pkg = Get-AppxPackage $PackageName | Select-Object -First 1
if (-not $pkg) {
  throw "패키지를 찾지 못했습니다: $PackageName"
}

$dumpbinPath = Get-DumpbinPath

$binaries = @(
  'GameBar.exe',
  'GameBarFTServer.exe',
  'GameBarElevatedFT.exe'
)

$summary = [ordered]@{
  analyzed_at = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz')
  package = $pkg.PackageFullName
  install_location = $pkg.InstallLocation
  dumpbin_path = $dumpbinPath
  strings_path = $StringsPath
  binaries = @()
}

foreach ($binaryName in $binaries) {
  $binaryPath = Join-Path $pkg.InstallLocation $binaryName
  if (-not (Test-Path $binaryPath)) {
    continue
  }

  $lines = Invoke-DumpbinImports -DumpbinPath $dumpbinPath -BinaryPath $binaryPath
  $imports = Parse-Imports -Lines $lines
  $fileItem = Get-Item $binaryPath

  $summary.binaries += [pscustomobject]@{
    name = $binaryName
    path = $binaryPath
    length = $fileItem.Length
    last_write_time = $fileItem.LastWriteTime
    imported_dll_count = $imports.Count
    imported_dlls = @($imports.Keys | Sort-Object)
    interesting_imports = Get-InterestingImports -Imports $imports
    candidate_strings = Get-InterestingStrings -StringsPath $StringsPath -BinaryPath $binaryPath
  }
}

$json = $summary | ConvertTo-Json -Depth 8

if ($OutputPath) {
  $parent = Split-Path $OutputPath -Parent
  if ($parent -and -not (Test-Path $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }

  Set-Content -Path $OutputPath -Value $json -Encoding UTF8
}

$json
