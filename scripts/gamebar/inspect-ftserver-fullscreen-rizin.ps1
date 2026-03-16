param(
  [string]$ArtifactsDir = 'C:\Users\esihun\Desktop\workfile\DmNote\docs\artifacts',
  [string]$PackageName = 'Microsoft.XboxGamingOverlay',
  [string]$RizinPath = 'C:\Users\esihun\Desktop\tools\research\rizin\rizin-win-installer-vs2019_static-64\bin\rizin.exe'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $RizinPath)) {
  throw "rizin.exe를 찾지 못했습니다: $RizinPath"
}

$pkg = Get-AppxPackage $PackageName | Select-Object -First 1
if (-not $pkg) {
  throw "패키지를 찾지 못했습니다: $PackageName"
}

$binaryPath = Join-Path $pkg.InstallLocation 'GameBarFTServer.exe'
if (-not (Test-Path $binaryPath)) {
  throw "GameBarFTServer.exe를 찾지 못했습니다: $binaryPath"
}

New-Item -ItemType Directory -Path $ArtifactsDir -Force | Out-Null

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outputPath = Join-Path $ArtifactsDir "gamebar-ftserver-rizin-fullscreen-$timestamp.txt"

$commands = @(
  'aaa',
  'afij @ 0x140002bb0',
  'afij @ 0x1400828f0',
  'pdf @ 0x140002bb0',
  's 0x140082a20',
  'pd 96',
  'q'
)

$escapedCmd = [string]::Join('; ', $commands)
$result = & $RizinPath -2 -q -c $escapedCmd $binaryPath

$header = @(
  "captured_at=$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')",
  "binary_path=$binaryPath",
  'target_functions=0x140002bb0,0x1400828f0',
  ''
)

Set-Content -Path $outputPath -Value ($header + $result) -Encoding UTF8

[pscustomobject]@{
  output_path = $outputPath
  binary_path = $binaryPath
}
