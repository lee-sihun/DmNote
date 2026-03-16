param(
  [string]$LogPath,
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

$diagDir = 'C:\Users\esihun\AppData\Local\Packages\Microsoft.XboxGamingOverlay_8wekyb3d8bbwe\LocalState\DiagOutputDir'

if (-not $LogPath) {
  $latest = Get-ChildItem $diagDir -Filter 'XboxGamingOverlayTraces_FT_Server_*.txt' |
    Where-Object { $_.Length -gt 0 } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

  if (-not $latest) {
    throw '분석할 FT 서버 로그를 찾지 못했습니다.'
  }

  $LogPath = $latest.FullName
}

if (-not (Test-Path $LogPath)) {
  throw "로그 파일을 찾지 못했습니다: $LogPath"
}

$tagCounts = @{}
$targetSnapshots = New-Object System.Collections.Generic.List[object]
$focusLines = New-Object System.Collections.Generic.List[string]

Get-Content $LogPath | ForEach-Object {
  $line = $_

  if ($line -match '^\[[0-9A-F]+\]\([A-Z]\)\[[0-9:.]+\]:\[([^\]]+)\]') {
    $tag = $matches[1]
    if (-not $tagCounts.ContainsKey($tag)) {
      $tagCounts[$tag] = 0
    }
    $tagCounts[$tag] += 1
  }

  if ($line -match 'UpdateAllTargetData: hwnd\(([^)]+)\), inputHwnd\(([^)]+)\), image\(([^)]*)\), pid\(([^)]*)\), aumId\(([^)]*)\), displayName\(([^)]*)\), class\(([^)]*)\), input\(([^)]*)\), IsFse\(([^)]*)\), IsFullscreen\(([^)]*)\)') {
    $targetSnapshots.Add([pscustomobject]@{
      hwnd = $matches[1]
      input_hwnd = $matches[2]
      image = $matches[3]
      pid = $matches[4]
      aum_id = $matches[5]
      display_name = $matches[6]
      class_name = $matches[7]
      input = $matches[8]
      is_fse = $matches[9]
      is_fullscreen = $matches[10]
    }) | Out-Null
  }

  if ($line -match 'GetFocusedHwnd|IsProcessFse|IsWindowFullscreenOnMonitor|OnWinEvent|CaptureCurrentTarget|UpdateIsFullscreenTargetData') {
    $focusLines.Add($line) | Out-Null
  }
}

$uniqueTargets = $targetSnapshots |
  Group-Object image, display_name, class_name, is_fse, is_fullscreen |
  Sort-Object Count -Descending |
  ForEach-Object {
    $first = $_.Group[0]
    [pscustomobject]@{
      count = $_.Count
      image = $first.image
      display_name = $first.display_name
      class_name = $first.class_name
      is_fse = $first.is_fse
      is_fullscreen = $first.is_fullscreen
    }
  }

$summary = [ordered]@{
  log_path = $LogPath
  analyzed_at = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz')
  tag_counts = $tagCounts.GetEnumerator() | Sort-Object Value -Descending | ForEach-Object {
    [pscustomobject]@{
      tag = $_.Key
      count = $_.Value
    }
  }
  unique_targets = $uniqueTargets
  sample_focus_lines = $focusLines | Select-Object -First 120
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
