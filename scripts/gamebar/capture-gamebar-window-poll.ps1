param(
  [string]$OutputPath = 'C:\Users\esihun\Desktop\workfile\DmNote\docs\artifacts\gamebar-window-poll.json',
  [int]$DurationSeconds = 5,
  [int]$IntervalMs = 100,
  [switch]$LaunchGameBar
)

$ErrorActionPreference = 'Stop'

$typeName = 'GameBarWindowPollNative'
if (-not ([System.Management.Automation.PSTypeName]$typeName).Type) {
  $typeDef = @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class GameBarWindowPollNative {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool GetWindowBand(IntPtr hWnd, out uint pdwBand);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr hWnd);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out int pvAttribute, int cbAttribute);
}
'@
  Add-Type -TypeDefinition $typeDef
}

function Get-RectValue {
  param(
    [IntPtr]$Hwnd
  )

  $rect = New-Object GameBarWindowPollNative+RECT
  if ([GameBarWindowPollNative]::GetWindowRect($Hwnd, [ref]$rect)) {
    return [pscustomobject]@{
      left = $rect.Left
      top = $rect.Top
      right = $rect.Right
      bottom = $rect.Bottom
      width = $rect.Right - $rect.Left
      height = $rect.Bottom - $rect.Top
    }
  }

  return $null
}

function Get-CloakedValue {
  param(
    [IntPtr]$Hwnd
  )

  $DWMWA_CLOAKED = 14
  $value = 0
  $hr = [GameBarWindowPollNative]::DwmGetWindowAttribute($Hwnd, $DWMWA_CLOAKED, [ref]$value, 4)
  if ($hr -eq 0) {
    return $value
  }

  return $null
}

function Get-TopLevelWindows {
  $rows = New-Object System.Collections.Generic.List[object]

  $callback = [GameBarWindowPollNative+EnumWindowsProc]{
    param($hWnd, $lParam)

    [uint32]$procId = 0
    [void][GameBarWindowPollNative]::GetWindowThreadProcessId($hWnd, [ref]$procId)

    $classSb = New-Object System.Text.StringBuilder 512
    $textSb = New-Object System.Text.StringBuilder 512
    [void][GameBarWindowPollNative]::GetClassName($hWnd, $classSb, $classSb.Capacity)
    [void][GameBarWindowPollNative]::GetWindowText($hWnd, $textSb, $textSb.Capacity)

    [uint32]$band = 0
    $bandOk = [GameBarWindowPollNative]::GetWindowBand($hWnd, [ref]$band)

    $style = [GameBarWindowPollNative]::GetWindowLongPtr($hWnd, -16).ToInt64()
    $exStyle = [GameBarWindowPollNative]::GetWindowLongPtr($hWnd, -20).ToInt64()
    $parent = [GameBarWindowPollNative]::GetParent($hWnd)

    $rows.Add([pscustomobject]@{
      hwnd = ('0x{0:X}' -f $hWnd.ToInt64())
      pid = [int]$procId
      class_name = $classSb.ToString()
      title = $textSb.ToString()
      visible = [GameBarWindowPollNative]::IsWindowVisible($hWnd)
      band_known = $bandOk
      band = if ($bandOk) { [int]$band } else { $null }
      style = ('0x{0:X}' -f $style)
      ex_style = ('0x{0:X}' -f $exStyle)
      parent_hwnd = if ($parent -eq [IntPtr]::Zero) { $null } else { ('0x{0:X}' -f $parent.ToInt64()) }
      cloaked = Get-CloakedValue -Hwnd $hWnd
      rect = Get-RectValue -Hwnd $hWnd
    }) | Out-Null

    return $true
  }

  [GameBarWindowPollNative]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
  return $rows
}

function Get-Snapshot {
  $processMap = @{}
  Get-Process -ErrorAction SilentlyContinue | ForEach-Object {
    $processMap[$_.Id] = $_.ProcessName
  }

  return @(
    Get-TopLevelWindows | ForEach-Object {
      $_ | Add-Member -NotePropertyName process_name -NotePropertyValue $processMap[$_.pid] -PassThru
    }
  )
}

function Get-CandidateScore {
  param(
    [object]$Window
  )

  $score = 0

  if ($Window.process_name -match 'GameBar|Xbox|Widget|ApplicationFrameHost') { $score += 4 }
  if (($Window.classes -join ' ') -match 'ApplicationFrameWindow|Xaml|Windows\.UI|Chrome_WidgetWin') { $score += 3 }
  if (($Window.titles -join ' ') -match 'Game Bar|Xbox|Widget') { $score += 3 }
  if ($Window.visible_samples -gt 0) { $score += 2 }
  if ($Window.cloaked_values -contains 0) { $score += 1 }
  if (($Window.bands | Where-Object { $_ -ne 1 }).Count -gt 0) { $score += 2 }
  if ($Window.rects.Count -gt 0) { $score += 1 }

  return $score
}

$parent = Split-Path $OutputPath -Parent
if ($parent -and -not (Test-Path $parent)) {
  New-Item -ItemType Directory -Path $parent -Force | Out-Null
}

$baseline = Get-Snapshot
$baselineByHwnd = @{}
foreach ($window in $baseline) {
  $baselineByHwnd[$window.hwnd] = $window
}

if ($LaunchGameBar) {
  Start-Process 'ms-gamebar:'
}

$samples = New-Object System.Collections.Generic.List[object]
$deadline = (Get-Date).AddSeconds($DurationSeconds)
$sampleIndex = 0

while ((Get-Date) -lt $deadline) {
  $timestamp = (Get-Date).ToString('o')
  foreach ($window in Get-Snapshot) {
    $samples.Add([pscustomobject]@{
      sample_index = $sampleIndex
      timestamp = $timestamp
      hwnd = $window.hwnd
      pid = $window.pid
      process_name = $window.process_name
      class_name = $window.class_name
      title = $window.title
      visible = $window.visible
      band = $window.band
      cloaked = $window.cloaked
      style = $window.style
      ex_style = $window.ex_style
      parent_hwnd = $window.parent_hwnd
      rect = $window.rect
    }) | Out-Null
  }

  $sampleIndex += 1
  Start-Sleep -Milliseconds $IntervalMs
}

$grouped = $samples | Group-Object hwnd | ForEach-Object {
  $group = $_.Group
  $first = $group | Select-Object -First 1
  $visibleCount = @($group | Where-Object { $_.visible }).Count
  $baselineWindow = $baselineByHwnd[$_.Name]
  $baselineRect = if ($baselineWindow -and $baselineWindow.rect) {
    "{0},{1},{2},{3}" -f $baselineWindow.rect.left, $baselineWindow.rect.top, $baselineWindow.rect.width, $baselineWindow.rect.height
  } else {
    $null
  }

  $candidate = [pscustomobject]@{
    hwnd = $_.Name
    process_name = $first.process_name
    pid = $first.pid
    first_seen = ($group | Select-Object -First 1).timestamp
    last_seen = ($group | Select-Object -Last 1).timestamp
    sample_count = $group.Count
    visible_samples = $visibleCount
    classes = @($group.class_name | Where-Object { $_ } | Select-Object -Unique)
    titles = @($group.title | Where-Object { $_ } | Select-Object -Unique)
    bands = @($group.band | Where-Object { $null -ne $_ } | Select-Object -Unique)
    cloaked_values = @($group.cloaked | Where-Object { $null -ne $_ } | Select-Object -Unique)
    rects = @(
      $group.rect |
        Where-Object { $_ } |
        ForEach-Object { "{0},{1},{2},{3}" -f $_.left, $_.top, $_.width, $_.height } |
        Select-Object -Unique |
        Select-Object -First 6
    )
    is_new_after_launch = -not $baselineByHwnd.ContainsKey($_.Name)
    baseline_visible = if ($baselineWindow) { [bool]$baselineWindow.visible } else { $null }
    baseline_cloaked = if ($baselineWindow) { $baselineWindow.cloaked } else { $null }
    baseline_title = if ($baselineWindow) { $baselineWindow.title } else { $null }
    baseline_rect = $baselineRect
  }

  $stateChanged = $false
  if ($baselineWindow) {
    if ($candidate.visible_samples -gt 0 -and -not $baselineWindow.visible) { $stateChanged = $true }
    if (($candidate.cloaked_values | Select-Object -Unique).Count -gt 1) { $stateChanged = $true }
    if ($candidate.titles.Count -gt 1) { $stateChanged = $true }
    if ($candidate.rects.Count -gt 1) { $stateChanged = $true }
    if ($candidate.titles.Count -gt 0 -and $candidate.titles -notcontains $baselineWindow.title) { $stateChanged = $true }
    if ($candidate.rects.Count -gt 0 -and $baselineRect -and $candidate.rects -notcontains $baselineRect) { $stateChanged = $true }
  }

  $candidate |
    Add-Member -NotePropertyName state_changed_after_launch -NotePropertyValue $stateChanged -PassThru |
    Add-Member -NotePropertyName candidate_score -NotePropertyValue (Get-CandidateScore -Window $candidate) -PassThru
}

$summary = [ordered]@{
  analyzed_at = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz')
  duration_seconds = $DurationSeconds
  interval_ms = $IntervalMs
  launch_gamebar = [bool]$LaunchGameBar
  baseline_window_count = $baseline.Count
  sample_count = $samples.Count
  new_windows = @(
    $grouped |
      Where-Object { $_.is_new_after_launch } |
      Sort-Object `
        @{ Expression = 'candidate_score'; Descending = $true }, `
        @{ Expression = 'visible_samples'; Descending = $true } |
      Select-Object -First 80
  )
  changed_windows = @(
    $grouped |
      Where-Object { $_.state_changed_after_launch } |
      Sort-Object `
        @{ Expression = 'candidate_score'; Descending = $true }, `
        @{ Expression = 'visible_samples'; Descending = $true } |
      Select-Object -First 80
  )
  candidate_windows = @(
    $grouped |
      Sort-Object `
        @{ Expression = 'candidate_score'; Descending = $true }, `
        @{ Expression = 'visible_samples'; Descending = $true } |
      Select-Object -First 120
  )
  samples = @(
    $samples |
      Where-Object {
        $_.process_name -match 'GameBar|Xbox|Widget|ApplicationFrameHost' -or
        $_.class_name -match 'ApplicationFrameWindow|Xaml|Windows\.UI|Chrome_WidgetWin'
      } |
      Select-Object -First 300
  )
}

$json = $summary | ConvertTo-Json -Depth 8
Set-Content -Path $OutputPath -Value $json -Encoding UTF8
$json
