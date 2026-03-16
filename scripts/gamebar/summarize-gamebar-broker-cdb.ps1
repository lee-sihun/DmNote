param(
  [Parameter(Mandatory = $true)]
  [string]$LogPath,
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $LogPath)) {
  throw "로그를 찾지 못했습니다: $LogPath"
}

$lines = Get-Content $LogPath

$functions = @(
  'EnsureBrokerComObject',
  'BrokerShow',
  'BrokerHide',
  'SetClickThrough',
  'ResetWindowRectCaller',
  'GetDisplayMonitorsCaller',
  'UpdateWindowRegionForPinnedOnlyAsync',
  'combase!CoCreateInstance'
)

$hitCounts = [ordered]@{}
foreach ($fn in $functions) {
  $hitCounts[$fn] = @(
    $lines | Select-String -Pattern ("^\[GBBROKER\] func=" + [regex]::Escape($fn) + '$')
  ).Count
}

$summary = [ordered]@{
  analyzed_at = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz')
  log_path = (Resolve-Path $LogPath).Path
  hit_counts = $hitCounts
  dcomp_loaded = @($lines | Select-String -Pattern '^\[GBLOAD\] mod=dcomp\.dll$').Count -gt 0
  exact_agile_immersive_shell_broker_guid_observed = @(
    $lines | Select-String -SimpleMatch '33 41 61 59 b4 bf 06 49-90 af c4 4f 15 16 7f 1a'
  ).Count -gt 0
  exact_agile_immersive_shell_broker_iid_observed = @(
    $lines | Select-String -SimpleMatch '0c 06 67 97 76 94 e2 42-8f 7b 2f 10 fd 13 76 5c'
  ).Count -gt 0
}

$json = $summary | ConvertTo-Json -Depth 6

if ($OutputPath) {
  $parent = Split-Path $OutputPath -Parent
  if ($parent -and -not (Test-Path $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }

  Set-Content -Path $OutputPath -Value $json -Encoding UTF8
}

$json
