param(
  [string]$SessionName = 'GameBarDwmTrace',
  [string]$OutputPath = 'C:\Users\esihun\Desktop\workfile\DmNote\docs\artifacts\gamebar-logman.etl',
  [int]$DurationSeconds = 5,
  [switch]$LaunchGameBar,
  [switch]$IncludeDxgi,
  [switch]$IncludeXaml
)

$ErrorActionPreference = 'Stop'

$parent = Split-Path $OutputPath -Parent
if ($parent -and -not (Test-Path $parent)) {
  New-Item -ItemType Directory -Path $parent -Force | Out-Null
}

if (Test-Path $OutputPath) {
  Remove-Item $OutputPath -Force
}

cmd /c "logman stop $SessionName -ets" *> $null
cmd /c "logman delete $SessionName" *> $null

$providerFile = Join-Path $env:TEMP ("gamebar-logman-{0}.txt" -f ([guid]::NewGuid().ToString('N')))
$providers = @(
  'Microsoft-Windows-Dwm-Core 0x2000FF 5'
  'Microsoft-Windows-DirectComposition 0x1FF 5'
)

if ($IncludeDxgi) {
  $providers += 'Microsoft-Windows-DXGI 0xFFFFFFFFFFFFFFFF 5'
}

if ($IncludeXaml) {
  $providers += 'Microsoft-Windows-XAML 0xFFFFFFFFFFFFFFFF 5'
}

$providers | Set-Content -Path $providerFile -Encoding ASCII

$createArgs = @(
  'create',
  'trace',
  $SessionName,
  '-o',
  $OutputPath,
  '-ow',
  '-ets',
  '-pf',
  $providerFile
)

try {
  & logman @createArgs | Out-Null

  try {
    if ($LaunchGameBar) {
      Start-Process 'ms-gamebar:'
    }

    Start-Sleep -Seconds $DurationSeconds
  }
  finally {
    & logman stop $SessionName -ets | Out-Null
    cmd /c "logman delete $SessionName" *> $null
  }
}
finally {
  Remove-Item $providerFile -Force -ErrorAction SilentlyContinue
}

Get-Item $OutputPath | Select-Object FullName,Length,LastWriteTime
